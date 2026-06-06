import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase-admin";
import { getReviewSettings, type ReviewSettings } from "@/lib/reviews/settings";
import { getWapiConfig, sendText } from "@/lib/wapi-api";
import { getSmtpConfig, sendEmail } from "@/lib/cashback/locaweb-smtp";
import { normalizeBrazilianWhatsAppPhone } from "@/lib/phone";
import { getVndaConfig, getVndaOrderShipping } from "@/lib/vnda-api";
import { logCommunication, getRecentContacts } from "@/lib/crm/message-log";

// Quantas vezes adiamos esperando o pedido faturar/enviar antes de desistir
// (cron roda a cada 30min; checagem real ~a cada 2 dias → ~60 dias de espera).
const MAX_DEFERS = 30;
// Não enviar review se o cliente recebeu OUTRA comunicação (cashback, campanha,
// etc.) nas últimas N horas — evita sobreposição de réguas.
const COMMS_COOLDOWN_HOURS = 18;

// Régua de comunicação pós-compra: a fila vive em `review_requests`.
//
//   enqueue  — lê compras confirmadas (crm_vendas, já alimentada pelo webhook
//              VNDA) e cria 1 pedido de avaliação por compra (item principal),
//              agendado pra data_compra + delay_days.
//   dispatch — envia os pedidos vencidos (WhatsApp/email) e lembretes.
//
// Tudo idempotente via UNIQUE(workspace_id, order_id, product_id).

function baseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "https://dash.bulking.com.br"
  ).replace(/\/$/, "");
}

export function reviewLink(token: string): string {
  return `${baseUrl()}/avaliar/${token}`;
}

function fillTemplate(tpl: string, vars: { nome: string; produto: string; link: string }): string {
  return tpl
    .replace(/\{nome\}/gi, vars.nome)
    .replace(/\{produto\}/gi, vars.produto)
    .replace(/\{link\}/gi, vars.link);
}

interface CrmItem {
  name?: string | null;
  sku?: string | null;
  reference?: string | null;
  total?: number | null;
  quantity?: number | null;
}

interface CrmRow {
  cliente: string | null;
  email: string | null;
  telefone: string | null;
  data_compra: string | null;
  numero_pedido: string | null;
  source_order_id: string | null;
  items: CrmItem[] | null;
}

// Escolhe o item "principal" do pedido (maior valor) pra não spammar 1 msg/produto.
function mainItem(items: CrmItem[] | null): CrmItem | null {
  if (!items || items.length === 0) return null;
  return items.reduce((best, cur) => {
    const a = Number(cur.total) || 0;
    const b = Number(best.total) || 0;
    return a > b ? cur : best;
  }, items[0]);
}

export interface EnqueueResult {
  scanned: number;
  created: number;
  skipped: number;
}

export async function enqueueReviewRequests(
  workspaceId: string,
  settings: ReviewSettings,
  admin: SupabaseClient = createAdminClient(),
  opts: { lookbackDays?: number } = {}
): Promise<EnqueueResult> {
  const result: EnqueueResult = { scanned: 0, created: 0, skipped: 0 };
  if (!settings.request_enabled) return result;

  const lookbackDays = opts.lookbackDays ?? settings.request_delay_days + 14;
  const cutoff = new Date(Date.now() - lookbackDays * 86400_000).toISOString();
  const now = Date.now();

  const { data: orders } = await admin
    .from("crm_vendas")
    .select("cliente, email, telefone, data_compra, numero_pedido, source_order_id, items")
    .eq("workspace_id", workspaceId)
    .gte("data_compra", cutoff)
    .order("data_compra", { ascending: false })
    .limit(500);

  const rows = (orders || []) as CrmRow[];
  result.scanned = rows.length;

  const toInsert: Record<string, unknown>[] = [];
  for (const o of rows) {
    const orderId = o.source_order_id;
    if (!orderId) { result.skipped++; continue; }

    // Contato necessário conforme o canal.
    const phone = normalizeBrazilianWhatsAppPhone(o.telefone);
    if (settings.request_channel === "whatsapp" && !phone) { result.skipped++; continue; }
    if (settings.request_channel === "email" && !o.email) { result.skipped++; continue; }

    const item = mainItem(o.items);
    if (!item) { result.skipped++; continue; }
    const productId = item.reference || item.sku || null;
    if (!productId) { result.skipped++; continue; }

    // Agenda a 1ª checagem pra data_compra + delay (mínimo de dias após compra).
    // Com gate de faturamento ligado, o disparo real é controlado no dispatch
    // (shipped + days_after_invoice), então NÃO pulamos por idade aqui — produtos
    // sob demanda demoram a faturar. Sem o gate, pulamos pedidos velhos (anti back-spam).
    const purchased = o.data_compra ? new Date(o.data_compra).getTime() : now;
    const scheduledFor = purchased + settings.request_delay_days * 86400_000;
    if (!settings.request_require_invoice && scheduledFor < now - 5 * 86400_000) { result.skipped++; continue; }

    // Enriquecer produto via shelf_products.
    let productName = item.name || null;
    let productImage: string | null = null;
    let productUrl: string | null = null;
    const { data: prod } = await admin
      .from("shelf_products")
      .select("product_id, name, image_url, product_url")
      .eq("workspace_id", workspaceId)
      .or(`product_id.eq.${productId},sku.eq.${item.sku || productId}`)
      .limit(1)
      .maybeSingle();
    if (prod) {
      productName = prod.name || productName;
      productImage = prod.image_url || null;
      productUrl = prod.product_url || null;
    }

    toInsert.push({
      workspace_id: workspaceId,
      order_id: orderId,
      order_code: o.numero_pedido,
      customer_name: o.cliente,
      customer_email: o.email,
      customer_phone: phone,
      product_id: String(productId),
      product_name: productName,
      product_image: productImage,
      product_url: productUrl,
      channel: settings.request_channel,
      scheduled_for: new Date(scheduledFor).toISOString(),
      status: "pending",
      token: randomUUID(),
    });
  }

  if (toInsert.length) {
    // Dedup por (workspace, order, product) dentro do lote.
    const seen = new Set<string>();
    const rowsDedup = toInsert.filter((r) => {
      const k = `${r.order_id}|${r.product_id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const { data, error } = await admin
      .from("review_requests")
      .upsert(rowsDedup, { onConflict: "workspace_id,order_id,product_id", ignoreDuplicates: true })
      .select("id");
    if (!error) result.created = data?.length ?? 0;
  }

  return result;
}

export interface DispatchResult {
  sent: number;
  reminded: number;
  failed: number;
}

function firstName(name: string | null): string {
  if (!name) return "Olá";
  return name.trim().split(/\s+/)[0];
}

function emailHtml(opts: { name: string; product: string; image: string | null; link: string; askMedia: boolean }): string {
  const img = opts.image
    ? `<img src="${opts.image}" alt="" width="120" style="border-radius:12px;display:block;margin:0 auto 16px">`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f6f6f7;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:18px;padding:32px;max-width:480px">
<tr><td align="center">
${img}
<h1 style="font-size:22px;margin:0 0 8px;color:#0a0a0a">${escapeHtmlSrv(opts.name)}, o que você achou?</h1>
<p style="font-size:15px;color:#555;line-height:1.5;margin:0 0 4px">Sua opinião sobre <b>${escapeHtmlSrv(opts.product)}</b> ajuda muita gente a comprar com confiança.</p>
${opts.askMedia ? '<p style="font-size:14px;color:#888;margin:0 0 20px">Pode mandar foto ou vídeo também! 📸</p>' : '<div style="height:16px"></div>'}
<a href="${opts.link}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:14px 32px;border-radius:999px;font-weight:600;font-size:15px">Avaliar produto</a>
</td></tr></table>
</td></tr></table></body></html>`;
}

function escapeHtmlSrv(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function dispatchDueRequests(
  workspaceId: string,
  settings: ReviewSettings,
  admin: SupabaseClient = createAdminClient()
): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, reminded: 0, failed: 0 };
  const nowIso = new Date().toISOString();

  const template =
    settings.request_message_template ||
    "Oi {nome}! Conta pra gente o que achou de {produto}? Sua avaliação ajuda muita gente: {link}";

  // Carrega config do canal uma vez.
  const wapi = settings.request_channel === "whatsapp" ? await getWapiConfig(workspaceId) : null;
  const smtp = settings.request_channel === "email" ? await getSmtpConfig(workspaceId, admin) : null;

  async function deliver(req: {
    customer_name: string | null;
    customer_phone: string | null;
    customer_email: string | null;
    product_name: string | null;
    product_image: string | null;
    token: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const link = reviewLink(req.token);
    const product = req.product_name || "seu pedido";
    if (settings.request_channel === "whatsapp") {
      if (!wapi) return { ok: false, error: "WhatsApp (W-API) não configurado" };
      const phone = normalizeBrazilianWhatsAppPhone(req.customer_phone);
      if (!phone) return { ok: false, error: "Telefone inválido" };
      const msg = fillTemplate(template, { nome: firstName(req.customer_name), produto: product, link });
      const r = await sendText(wapi, phone, msg);
      return r.error ? { ok: false, error: r.error } : { ok: true };
    } else {
      if (!smtp) return { ok: false, error: "SMTP não configurado" };
      if (!req.customer_email) return { ok: false, error: "Email ausente" };
      const r = await sendEmail(smtp, {
        to: req.customer_email,
        subject: `${firstName(req.customer_name)}, o que você achou? 💛`,
        bodyHtml: emailHtml({
          name: firstName(req.customer_name),
          product,
          image: req.product_image,
          link,
          askMedia: settings.request_ask_media,
        }),
      });
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    }
  }

  // Gate de faturamento: só pede review depois que o pedido foi enviado
  // (shipped_at, proxy de faturado) + days_after_invoice. A VNDA não expõe NF;
  // shipped_at é o melhor sinal — e resolve o caso de produtos sob demanda.
  const requireInvoice = settings.request_require_invoice;
  const vndaConfig = requireInvoice ? await getVndaConfig(workspaceId) : null;
  const daysAfterInvoice = settings.request_days_after_invoice ?? 9;

  // 1) Pendentes vencidos.
  const { data: due } = await admin
    .from("review_requests")
    .select("id, customer_name, customer_phone, customer_email, product_name, product_image, token, order_code, defer_count")
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(100);

  for (const req of due || []) {
    // --- Checagem de faturamento/envio antes de qualquer disparo ---
    if (requireInvoice) {
      const order = vndaConfig && req.order_code
        ? await getVndaOrderShipping(vndaConfig, req.order_code)
        : null;

      // Pedido cancelado → cancela o pedido de avaliação.
      if (order && (order.canceled_at || order.status === "canceled" || order.status === "cancelled")) {
        await admin.from("review_requests").update({ status: "cancelled", error_message: "pedido cancelado", last_checked_at: nowIso, updated_at: nowIso }).eq("id", req.id);
        continue;
      }

      const shippedAt = order?.shipped_at || order?.delivered_at || null;

      // Ainda não enviado/faturado (ex.: produto sob demanda) → adia ~2 dias.
      if (!shippedAt) {
        const dc = (req.defer_count || 0) + 1;
        const patch: Record<string, unknown> = {
          last_checked_at: nowIso,
          defer_count: dc,
          scheduled_for: new Date(Date.now() + 2 * 86400_000).toISOString(),
          updated_at: nowIso,
        };
        if (dc >= MAX_DEFERS) { patch.status = "cancelled"; patch.error_message = "sem faturamento/envio após várias tentativas"; }
        await admin.from("review_requests").update(patch).eq("id", req.id);
        continue;
      }

      // Enviado: garante shipped + days_after_invoice antes de disparar.
      const eligibleAt = new Date(shippedAt).getTime() + daysAfterInvoice * 86400_000;
      if (Date.now() < eligibleAt) {
        await admin.from("review_requests").update({
          shipped_at: shippedAt, invoice_ok: true, last_checked_at: nowIso,
          scheduled_for: new Date(eligibleAt).toISOString(), updated_at: nowIso,
        }).eq("id", req.id);
        continue;
      }

      // Elegível: marca faturado e segue pro envio.
      await admin.from("review_requests").update({ shipped_at: shippedAt, invoice_ok: true, last_checked_at: nowIso, updated_at: nowIso }).eq("id", req.id);
    }

    // Anti-sobreposição: se o cliente recebeu outra comunicação (cashback,
    // campanha, etc.) há pouco, adia o review pra não atropelar.
    const recent = await getRecentContacts(
      workspaceId,
      { email: req.customer_email, phone: req.customer_phone, withinHours: COMMS_COOLDOWN_HOURS },
      admin
    );
    if (recent.length > 0) {
      await admin.from("review_requests").update({
        scheduled_for: new Date(Date.now() + COMMS_COOLDOWN_HOURS * 3600_000).toISOString(),
        last_checked_at: nowIso,
        updated_at: nowIso,
      }).eq("id", req.id);
      continue;
    }

    const out = await deliver(req);
    if (out.ok) {
      await admin.from("review_requests").update({ status: "sent", sent_at: nowIso, error_message: null, updated_at: nowIso }).eq("id", req.id);
      await logCommunication({
        workspaceId, email: req.customer_email, phone: req.customer_phone,
        channel: settings.request_channel, source: "review", sourceId: req.id, status: "sent",
      }, admin);
      result.sent++;
    } else {
      await admin.from("review_requests").update({ status: "failed", error_message: out.error?.slice(0, 300), updated_at: nowIso }).eq("id", req.id);
      result.failed++;
    }
  }

  // 2) Lembretes (se configurado).
  if (settings.request_reminder_days && settings.request_reminder_days > 0) {
    const reminderCutoff = new Date(Date.now() - settings.request_reminder_days * 86400_000).toISOString();
    const { data: toRemind } = await admin
      .from("review_requests")
      .select("id, customer_name, customer_phone, customer_email, product_name, product_image, token")
      .eq("workspace_id", workspaceId)
      .eq("status", "sent")
      .lte("sent_at", reminderCutoff)
      .limit(100);

    for (const req of toRemind || []) {
      const out = await deliver(req);
      if (out.ok) {
        await admin.from("review_requests").update({ status: "reminded", reminded_at: nowIso, updated_at: nowIso }).eq("id", req.id);
        result.reminded++;
      } else {
        result.failed++;
      }
    }
  }

  return result;
}

// Orquestra os dois passos pra um workspace.
export async function runRulerForWorkspace(workspaceId: string, admin: SupabaseClient = createAdminClient()) {
  const settings = await getReviewSettings(workspaceId);
  if (!settings.request_enabled) return { enqueue: { scanned: 0, created: 0, skipped: 0 }, dispatch: { sent: 0, reminded: 0, failed: 0 } };
  const enqueue = await enqueueReviewRequests(workspaceId, settings, admin);
  const dispatch = await dispatchDueRequests(workspaceId, settings, admin);
  return { enqueue, dispatch };
}

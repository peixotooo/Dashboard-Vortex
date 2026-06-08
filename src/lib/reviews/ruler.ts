import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase-admin";
import { getReviewSettings, type ReviewSettings } from "@/lib/reviews/settings";
import { getWaConfig, sendTemplateMessage } from "@/lib/whatsapp-api";
import { getSmtpConfig, sendEmail } from "@/lib/cashback/locaweb-smtp";
import { normalizeBrazilianWhatsAppPhone } from "@/lib/phone";
import { getVndaConfigAdmin, getVndaOrderShipping } from "@/lib/vnda-api";
import { logCommunication, getRecentContacts } from "@/lib/crm/message-log";

// Quantas vezes adiamos esperando o pedido faturar/enviar antes de desistir
// (cron roda a cada 30min; checagem real ~a cada 2 dias → ~60 dias de espera).
const MAX_DEFERS = 30;
// Não enviar review se o cliente recebeu OUTRA comunicação (cashback, campanha,
// etc.) nas últimas N horas — evita sobreposição de réguas.
const COMMS_COOLDOWN_HOURS = 18;
const CRM_ORDER_PAGE_SIZE = 1000;
const MAX_CRM_ROWS_TO_SCAN = 10000;

// Régua de comunicação pós-compra: a fila vive em `review_requests`.
//
//   enqueue  — lê compras confirmadas (crm_vendas, já alimentada pelo webhook
//              VNDA) e cria 1 pedido de avaliação por COMPRA, carregando TODOS
//              os produtos comprados (coluna products); agendado pra data_compra
//              + delay_days. A landing vira um quiz: 1 etapa por produto + loja.
//   dispatch — envia os pedidos vencidos (WhatsApp/email) e lembretes.
//
// Idempotente via UNIQUE(workspace_id, order_id, product_id) — product_id = item
// principal do pedido, então fica 1 linha por pedido.

function baseUrl(): string {
  // Domínio próprio das avaliações (review.bulking.com.br). Configurável por
  // REVIEW_BASE_URL; precisa apontar pro app na Vercel (a rota /avaliar é pública).
  return (process.env.REVIEW_BASE_URL || "https://review.bulking.com.br").replace(/\/$/, "");
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

function parsePurchaseTime(value: string | null): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

async function loadRecentCrmOrders(admin: SupabaseClient, workspaceId: string, cutoffMs: number): Promise<CrmRow[]> {
  const rows: CrmRow[] = [];

  for (let from = 0; from < MAX_CRM_ROWS_TO_SCAN; from += CRM_ORDER_PAGE_SIZE) {
    const { data, error } = await admin
      .from("crm_vendas")
      .select("cliente, email, telefone, data_compra, numero_pedido, source_order_id, items")
      .eq("workspace_id", workspaceId)
      // A tabela também carrega linhas legadas com data textual ("Sep 9, 2025")
      // e sem itens/order_id. Se elas entram no topo da ordenação textual, a
      // régua escaneia 500 linhas inválidas e não enfileira ninguém.
      .not("source_order_id", "is", null)
      .not("items", "is", null)
      .order("data_compra", { ascending: false })
      .range(from, from + CRM_ORDER_PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    const page = (data || []) as CrmRow[];
    if (page.length === 0) break;

    let reachedCutoff = false;
    for (const row of page) {
      const purchasedAt = parsePurchaseTime(row.data_compra);
      if (purchasedAt == null) continue;
      if (purchasedAt < cutoffMs) {
        reachedCutoff = true;
        continue;
      }
      rows.push(row);
    }

    if (page.length < CRM_ORDER_PAGE_SIZE || reachedCutoff) break;
  }

  return rows;
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
  const cutoffMs = Date.now() - lookbackDays * 86400_000;
  const now = Date.now();

  const rows = await loadRecentCrmOrders(admin, workspaceId, cutoffMs);
  result.scanned = rows.length;

  const toInsert: Record<string, unknown>[] = [];
  for (const o of rows) {
    const orderId = o.source_order_id;
    if (!orderId) { result.skipped++; continue; }

    // Contato necessário conforme o canal.
    const phone = normalizeBrazilianWhatsAppPhone(o.telefone);
    if (settings.request_channel === "whatsapp" && !phone) { result.skipped++; continue; }
    if (settings.request_channel === "email" && !o.email) { result.skipped++; continue; }

    // Todos os produtos comprados (dedup por id) — cada um vira uma etapa do quiz.
    const orderItems = (o.items || []).filter((it) => it.reference || it.sku);
    if (orderItems.length === 0) { result.skipped++; continue; }
    const seenPid = new Set<string>();
    const uniqueItems: { pid: string; item: CrmItem }[] = [];
    for (const it of orderItems) {
      const pid = String(it.reference || it.sku);
      if (seenPid.has(pid)) continue;
      seenPid.add(pid);
      uniqueItems.push({ pid, item: it });
    }

    // Agenda a 1ª checagem pra data_compra + delay (mínimo de dias após compra).
    // Com gate de faturamento ligado, o disparo real é controlado no dispatch
    // (shipped + days_after_invoice), então NÃO pulamos por idade aqui — produtos
    // sob demanda demoram a faturar. Sem o gate, pulamos pedidos velhos (anti back-spam).
    const purchased = parsePurchaseTime(o.data_compra) ?? now;
    const scheduledFor = purchased + settings.request_delay_days * 86400_000;
    if (!settings.request_require_invoice && scheduledFor < now - 5 * 86400_000) { result.skipped++; continue; }

    // Enriquecer TODOS os produtos via shelf_products (1 query por pedido).
    const safeIds = uniqueItems.map((u) => u.pid).filter((id) => /^[\w.-]+$/.test(id));
    const catalog = new Map<string, { product_id: string; name: string | null; image: string | null; url: string | null }>();
    if (safeIds.length) {
      const { data: prods } = await admin
        .from("shelf_products")
        .select("product_id, name, image_url, product_url, sku")
        .eq("workspace_id", workspaceId)
        .or(`product_id.in.(${safeIds.join(",")}),sku.in.(${safeIds.join(",")})`);
      for (const p of prods || []) {
        const entry = {
          product_id: String(p.product_id),
          name: (p.name as string) || null,
          image: (p.image_url as string) || null,
          url: (p.product_url as string) || null,
        };
        catalog.set(String(p.product_id), entry);
        if (p.sku) catalog.set(String(p.sku), entry);
      }
    }

    const products = uniqueItems.map((u) => {
      const c = catalog.get(u.pid);
      return { product_id: c?.product_id || u.pid, name: c?.name || u.item.name || null, image: c?.image || null, url: c?.url || null };
    });

    // Item principal (maior valor) = produto "primário" pra mensagem e colunas.
    const main = mainItem(o.items);
    const mainPid = main ? String(main.reference || main.sku || "") : products[0].product_id;
    const primary = products.find((p) => p.product_id === mainPid) || products[0];

    toInsert.push({
      workspace_id: workspaceId,
      order_id: orderId,
      order_code: o.numero_pedido,
      customer_name: o.cliente,
      customer_email: o.email,
      customer_phone: phone,
      product_id: String(primary.product_id),
      product_name: primary.name,
      product_image: primary.image,
      product_url: primary.url,
      products,
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

  // Mensagens por etapa da régua (substância, sem saudação — {produto}/{link}).
  const msgStep1 = settings.request_message_template ||
    "Sua {produto} já chegou? 💛 Conta rapidinho o que você achou — leva 1 minutinho e ajuda muita gente. Pode mandar foto ou vídeo! Avalie aqui: {link}";
  const msgStep2 = settings.request_reminder_message ||
    "Passando só pra lembrar 😊 Sua opinião sobre a {produto} ajuda demais quem está pensando em comprar. É rapidinho: {link}";
  const msgStep3 = settings.request_reminder_2_message ||
    "Última chamada! 🙏 Conta o que você achou da {produto} e ajude outros clientes: {link}";

  // Carrega config do canal uma vez.
  const smtp = settings.request_channel === "email" ? await getSmtpConfig(workspaceId, admin) : null;

  // WhatsApp SEMPRE via API oficial (Meta Cloud API) com template aprovado —
  // nunca W-API. Se o template ainda não estiver aprovado, a régua AGUARDA
  // (não dispara por outro canal).
  let waConfig: Awaited<ReturnType<typeof getWaConfig>> = null;
  let waTemplate: { name: string; language: string } | null = null;
  if (settings.request_channel === "whatsapp" && settings.wa_template_id) {
    waConfig = await getWaConfig(workspaceId);
    if (waConfig) {
      const { data: tpl } = await admin
        .from("wa_templates")
        .select("name, language, status, category")
        .eq("id", settings.wa_template_id)
        .maybeSingle();
      if (tpl && tpl.status === "APPROVED") waTemplate = { name: tpl.name as string, language: (tpl.language as string) || "pt_BR" };
    }
  }

  // Sem template Meta aprovado, não enviamos por WhatsApp (e jamais por W-API):
  // espera a aprovação. Os pedidos seguem pendentes e são repescados no próximo tick.
  if (settings.request_channel === "whatsapp" && !(waTemplate && waConfig)) {
    return result;
  }

  async function deliver(
    req: {
      customer_name: string | null;
      customer_phone: string | null;
      customer_email: string | null;
      product_name: string | null;
      product_image: string | null;
      token: string;
    },
    substance: string
  ): Promise<{ ok: boolean; error?: string }> {
    const link = reviewLink(req.token);
    const product = req.product_name || "seu pedido";
    const nome = firstName(req.customer_name);
    let body = fillTemplate(substance, { nome, produto: product, link });
    // Com recompensa ativa, a copy foca no benefício — mas SEM revelar o valor
    // (surpresa, liberada só após a avaliação). Foca em enviar foto/vídeo.
    if (settings.rewards_enabled) {
      body += "\n\n🎁 E tem um cashback surpresa pra você ao avaliar com foto ou vídeo!";
    }
    if (settings.request_channel === "whatsapp") {
      const phone = normalizeBrazilianWhatsAppPhone(req.customer_phone);
      if (!phone) return { ok: false, error: "Telefone inválido" };
      if (!waTemplate || !waConfig) return { ok: false, error: "Template Meta não aprovado" };
      // API oficial (Meta). O body do template tem "Olá {{1}}, tudo bem?" —
      // {{1}}=nome, {{2}}=conteúdo+link.
      const r = await sendTemplateMessage(waConfig, phone, waTemplate.name, waTemplate.language, { "1": nome, "2": body });
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

  // Gate de despacho: só pede review depois que o pedido foi DESPACHADO +
  // days_after_invoice. A VNDA não expõe NF nem preenche shipped_at/delivered_at
  // (testado: sempre null) — o sinal real de despacho é o `tracking_code`. Como
  // não há data de despacho na VNDA, ancoramos os +9 dias na data em que
  // DETECTAMOS o tracking (gravada em review_requests.shipped_at na 1ª vez).
  const requireInvoice = settings.request_require_invoice || settings.request_trigger === "delivery";
  const vndaConfig = requireInvoice ? await getVndaConfigAdmin(workspaceId) : null;
  const daysAfterInvoice = settings.request_days_after_invoice ?? 9;

  // 1) Pendentes vencidos.
  const { data: due } = await admin
    .from("review_requests")
    .select("id, customer_name, customer_phone, customer_email, product_name, product_image, token, order_code, defer_count, shipped_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(100);

  for (const req of due || []) {
    // --- Checagem de despacho antes de qualquer disparo ---
    if (requireInvoice) {
      const order = vndaConfig && req.order_code
        ? await getVndaOrderShipping(vndaConfig, req.order_code)
        : null;

      // Pedido cancelado → cancela o pedido de avaliação.
      if (order && (order.canceled_at || order.status === "canceled" || order.status === "cancelled")) {
        await admin.from("review_requests").update({ status: "cancelled", error_message: "pedido cancelado", last_checked_at: nowIso, updated_at: nowIso }).eq("id", req.id);
        continue;
      }

      // Despachado? Sinal real = tracking_code presente (shipped/delivered como bônus).
      const dispatched = !!(order && (order.tracking_code || order.shipped_at || order.delivered_at));
      if (!dispatched) {
        // Ainda não despachado (ex.: produto sob demanda) → adia ~2 dias.
        const dc = (req.defer_count || 0) + 1;
        const patch: Record<string, unknown> = {
          last_checked_at: nowIso,
          defer_count: dc,
          scheduled_for: new Date(Date.now() + 2 * 86400_000).toISOString(),
          updated_at: nowIso,
        };
        if (dc >= MAX_DEFERS) { patch.status = "cancelled"; patch.error_message = "sem despacho após várias tentativas"; }
        await admin.from("review_requests").update(patch).eq("id", req.id);
        continue;
      }

      // Data do despacho: real (se a VNDA preencher) ou a data em que detectamos.
      const despachoDate = order!.shipped_at || order!.delivered_at || req.shipped_at || nowIso;
      const eligibleAt = new Date(despachoDate).getTime() + daysAfterInvoice * 86400_000;

      // 1ª detecção do despacho → registra a data-âncora.
      if (!req.shipped_at) {
        await admin.from("review_requests").update({
          shipped_at: despachoDate, invoice_ok: true, last_checked_at: nowIso,
          scheduled_for: new Date(Math.max(eligibleAt, Date.now())).toISOString(), updated_at: nowIso,
        }).eq("id", req.id);
      }
      // Ainda dentro da janela dos +N dias → adia até elegível.
      if (Date.now() < eligibleAt) {
        if (req.shipped_at) {
          await admin.from("review_requests").update({ invoice_ok: true, last_checked_at: nowIso, scheduled_for: new Date(eligibleAt).toISOString(), updated_at: nowIso }).eq("id", req.id);
        }
        continue;
      }
      // Elegível → marca e segue pro envio.
      await admin.from("review_requests").update({ invoice_ok: true, last_checked_at: nowIso, updated_at: nowIso }).eq("id", req.id);
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

    const out = await deliver(req, msgStep1);
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

  // 2) Régua de lembretes: até 2 lembretes (2-3 contatos no total). O envio
  // respeita o mesmo guard anti-sobreposição; quem completa a avaliação sai
  // da fila (status 'completed').
  const reminderSelect = "id, customer_name, customer_phone, customer_email, product_name, product_image, token";
  async function sendReminder(
    req: { id: string; customer_name: string | null; customer_phone: string | null; customer_email: string | null; product_name: string | null; product_image: string | null; token: string },
    stage: 1 | 2
  ) {
    const recent = await getRecentContacts(workspaceId, { email: req.customer_email, phone: req.customer_phone, withinHours: COMMS_COOLDOWN_HOURS }, admin);
    if (recent.length > 0) return; // adia pro próximo tick
    const out = await deliver(req, stage === 1 ? msgStep2 : msgStep3);
    if (out.ok) {
      await admin.from("review_requests").update({ status: "reminded", reminder_count: stage, reminded_at: nowIso, updated_at: nowIso }).eq("id", req.id);
      await logCommunication({ workspaceId, email: req.customer_email, phone: req.customer_phone, channel: settings.request_channel, source: "review", sourceId: req.id, status: "sent" }, admin);
      result.reminded++;
    } else {
      result.failed++;
    }
  }

  // Lembrete 1: 1º contato ('sent') há >= request_reminder_days.
  if (settings.request_reminder_days && settings.request_reminder_days > 0) {
    const cutoff = new Date(Date.now() - settings.request_reminder_days * 86400_000).toISOString();
    const { data: r1 } = await admin
      .from("review_requests").select(reminderSelect)
      .eq("workspace_id", workspaceId).eq("status", "sent").eq("reminder_count", 0)
      .lte("sent_at", cutoff).limit(100);
    for (const req of r1 || []) await sendReminder(req, 1);
  }

  // Lembrete 2: 1º lembrete há >= request_reminder_2_days.
  if (settings.request_reminder_2_days && settings.request_reminder_2_days > 0) {
    const cutoff = new Date(Date.now() - settings.request_reminder_2_days * 86400_000).toISOString();
    const { data: r2 } = await admin
      .from("review_requests").select(reminderSelect)
      .eq("workspace_id", workspaceId).eq("status", "reminded").eq("reminder_count", 1)
      .lte("reminded_at", cutoff).limit(100);
    for (const req of r2 || []) await sendReminder(req, 2);
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

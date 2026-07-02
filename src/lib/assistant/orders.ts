// Consulta de pedido (WISMO) do assistente — a ÚNICA exceção à regra "nada de
// pedidos", construída com prova de posse:
//
//   número do pedido + e-mail da compra PRECISAM bater. Errou qualquer um →
//   resposta genérica "não encontrado" (sem oráculo de qual campo falhou).
//
// MINIMIZAÇÃO: o retorno expõe só o que acalma o cliente — status, rastreio,
// itens (nome/quantidade) e o flag sob-demanda. NUNCA endereço, telefone,
// pagamento, valores ou dados de outra pessoa. O objetivo de negócio: muito
// "pedido atrasado" é produto sob demanda (produção ~10 dias úteis) — detectar
// e explicar evita cancelamento/estorno.

import { createAdminClient } from "@/lib/supabase-admin";
import { getVndaConfigAdmin } from "@/lib/vnda-api";

export interface SafeOrderItem {
  name: string;
  quantity: number;
  sob_demanda: boolean;
}

export interface SafeOrder {
  code: string;
  /** Rótulo pt-BR derivado de sinais confiáveis (canceled_at, tracking, confirmed_at). */
  status: string;
  confirmed_at: string | null;
  canceled_at: string | null;
  /** Código de rastreio (sinal real de "despachado" na VNDA). */
  tracking_code: string | null;
  expected_delivery_date: string | null;
  dispatched: boolean;
  items: SafeOrderItem[];
  has_sob_demanda: boolean;
}

const norm = (s: string) =>
  (s || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

/** "779909392-1" → "779909392" (SKU-pai). */
const stripVariant = (s: string) => {
  const m = (s || "").match(/^(.+)-(\d{1,5})$/);
  return m ? m[1] : s || "";
};

const ORDER_CODE_RE = /^[\w-]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface RawOrderPayload {
  code?: string;
  status?: string;
  email?: string;
  confirmed_at?: string | null;
  canceled_at?: string | null;
  tracking_code?: string | null;
  tracking_code_list?: unknown[];
  expected_delivery_date?: string | null;
  items?: Array<{ product_name?: string; quantity?: number; sku?: string }>;
}

function statusLabel(o: RawOrderPayload, dispatched: boolean): string {
  if (o.canceled_at) return "cancelado";
  if (dispatched) return "despachado (a caminho)";
  if (o.confirmed_at) return "pagamento confirmado, em preparação/produção";
  return "aguardando confirmação do pagamento";
}

export async function lookupOrder(
  workspaceId: string,
  orderCodeRaw: unknown,
  emailRaw: unknown
): Promise<SafeOrder | null> {
  const orderCode = String(orderCodeRaw || "").trim();
  const email = String(emailRaw || "").trim().toLowerCase();
  if (!ORDER_CODE_RE.test(orderCode) || !EMAIL_RE.test(email)) return null;

  const config = await getVndaConfigAdmin(workspaceId);
  if (!config) return null;

  let raw: RawOrderPayload | null = null;
  try {
    const res = await fetch(
      `https://api.vnda.com.br/api/v2/orders/${encodeURIComponent(orderCode)}`,
      {
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "X-Shop-Host": config.storeHost,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return null;
    raw = (await res.json()) as RawOrderPayload;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;

  // PROVA DE POSSE: e-mail do pedido tem que bater com o informado.
  const orderEmail = String(raw.email || "").trim().toLowerCase();
  if (!orderEmail || orderEmail !== email) return null;

  // Sinal real de despachado é o tracking (VNDA não popula shipped_at)
  const list = Array.isArray(raw.tracking_code_list) ? raw.tracking_code_list : [];
  const tracking =
    (typeof raw.tracking_code === "string" && raw.tracking_code) ||
    (typeof list[0] === "string" ? (list[0] as string) : null) ||
    null;
  const dispatched = !raw.canceled_at && Boolean(tracking);

  // Detecta sob-demanda por item via espelho do catálogo (tag sob-demanda /
  // banner dropbits) — casa por SKU-pai, com fallback por nome.
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const admin = createAdminClient();
  const { data: sp } = await admin
    .from("shelf_products")
    .select("name, sku, tags")
    .eq("workspace_id", workspaceId)
    .limit(5000);
  const isOnDemandRow = (tags: unknown): boolean =>
    Array.isArray(tags) &&
    tags.some((t) => {
      const name = t && typeof t === "object" ? String((t as { name?: unknown }).name || "") : "";
      return name === "sob-demanda" || name === "banner-produto-dropbits";
    });
  const bySku = new Map<string, boolean>();
  const byName = new Map<string, boolean>();
  for (const r of sp || []) {
    const onDemand = isOnDemandRow(r.tags);
    const pfx = stripVariant(String(r.sku || ""));
    if (pfx) bySku.set(pfx, onDemand);
    byName.set(norm(String(r.name || "")), onDemand);
  }

  const items: SafeOrderItem[] = rawItems.slice(0, 20).map((it) => {
    const skuPfx = stripVariant(String(it.sku || ""));
    const viaSku = skuPfx ? bySku.get(skuPfx) : undefined;
    const viaName = byName.get(norm(String(it.product_name || "")));
    return {
      name: String(it.product_name || "produto").slice(0, 120),
      quantity: Number(it.quantity) || 1,
      sob_demanda: Boolean(viaSku ?? viaName ?? false),
    };
  });

  return {
    code: String(raw.code || orderCode),
    status: statusLabel(raw, dispatched),
    confirmed_at: raw.confirmed_at || null,
    canceled_at: raw.canceled_at || null,
    tracking_code: tracking,
    expected_delivery_date: raw.expected_delivery_date || null,
    dispatched,
    items,
    has_sob_demanda: items.some((i) => i.sob_demanda),
  };
}

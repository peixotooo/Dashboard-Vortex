/**
 * medusa-orders-export.ts
 * Exporta o HISTÓRICO DE PEDIDOS (2026 em diante) da loja VNDA pro JSON que o
 * módulo `legacyOrder` do Medusa importa.
 *
 * Uso:
 *   npx tsx scripts/medusa-orders-export.ts --dry
 *   npx tsx scripts/medusa-orders-export.ts --limit 200
 *   npx tsx scripts/medusa-orders-export.ts --from 2026-01-01
 *
 * Saída: output/medusa/orders-export.json  (NÃO versionar — dado pessoal)
 *
 * ╔═ FONTE ESCOLHIDA: API DA VNDA (GET /api/v2/orders) ═══════════════════════╗
 * ║ Avaliamos as duas fontes com dados reais (probe em 2026-07-21):          ║
 * ║                                                                          ║
 * ║ (a) crm_vendas (Supabase) — REPROVADA:                                   ║
 * ║   • `data_compra` é TEXT e a MAIORIA das linhas está no formato legado   ║
 * ║     do Bubble ("Sep 9, 2025 "), não ISO. Como "S" > "2" na comparação    ║
 * ║     lexicográfica, um filtro `.gte("data_compra","2026-01-01")` retorna  ║
 * ║     88.480 linhas — quase todas de 2023/2024/2025. O recorte "2026 em    ║
 * ║     diante" É IMPOSSÍVEL de fazer com confiança nessa coluna.            ║
 * ║   • só 9.636 dessas linhas têm `items` != null.                          ║
 * ║   • NÃO tem coluna de status nem de rastreio (confirmado varrendo todas  ║
 * ║     as 35 colunas) — dois campos que "Meus pedidos" precisa mostrar.     ║
 * ║                                                                          ║
 * ║ (b) API da VNDA — ESCOLHIDA:                                             ║
 * ║   • filtro `start`/`finish` server-side funciona: 16.083 pedidos em 2026 ║
 * ║     (14.800 confirmados).                                                ║
 * ║   • traz `status`, `tracking_code`/`tracking_code_list`, `coupon_code`,  ║
 * ║     `confirmed_at`/`received_at`, e `items[]` completos (product_name,   ║
 * ║     sku, quantity, price, total) — itens confiáveis, que era o critério. ║
 * ║   • `code` é o número que o cliente vê no e-mail/site.                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Credenciais: `vnda_connections` no Supabase (token AES-256-GCM), igual ao
 * resto do dashboard. Fallback: VNDA_API_TOKEN + VNDA_STORE_HOST.
 */
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const CONTRACT_VERSION = 1;
const WORKSPACE_ID = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04"; // Bulking
const PER_PAGE = 200;
const THROTTLE_MS = 180;
const MAX_RETRIES = 5;
const DEFAULT_FROM = "2026-01-01"; // escopo definido pelo dono
const OUT_DIR = path.join(process.cwd(), "output", "medusa");
const OUT_FILE = path.join(OUT_DIR, "orders-export.json");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** status da VNDA → rótulo pt-BR mostrado em "Meus pedidos". */
const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmado",
  received: "Aguardando pagamento",
  canceled: "Cancelado",
  cancelled: "Cancelado",
  shipped: "Enviado",
  delivered: "Entregue",
  returned: "Devolvido",
  refunded: "Reembolsado",
  pending: "Pendente",
  processing: "Em separação",
};

// ---------- tipos ----------
interface VndaOrderItem {
  product_name?: string | null;
  variant_name?: string | null;
  sku?: string | null;
  quantity?: number | null;
  price?: number | null;
  original_price?: number | null;
  total?: number | null;
  product_id?: number | null;
  reference?: string | null;
}

interface VndaOrderRaw {
  id?: number;
  code?: string | null;
  status?: string | null;
  email?: string | null;
  total?: number | null;
  subtotal?: number | null;
  discount_price?: number | null;
  shipping_price?: number | null;
  coupon_code?: string | null;
  payment_method?: string | null;
  installments?: number | null;
  confirmed_at?: string | null;
  received_at?: string | null;
  paid_at?: string | null;
  shipped_at?: string | null;
  delivered_at?: string | null;
  canceled_at?: string | null;
  tracking_code?: string | null;
  tracking_code_list?: unknown;
  items?: VndaOrderItem[] | null;
}

interface ExportItem {
  name: string;
  sku: string | null;
  quantity: number;
  unit_price: number | null;
  total: number | null;
}

interface ExportOrder {
  vnda_order_number: string;
  customer_email: string;
  placed_at: string;
  status_label: string;
  total: number;
  currency: string;
  discount_total: number;
  tracking: string | null;
  items: ExportItem[];
  metadata: Record<string, unknown>;
}

// ---------- credenciais ----------
function decryptToken(payload: string): string {
  const key = Buffer.from((process.env.ENCRYPTION_KEY || "").trim(), "hex");
  const [ivHex, tagHex, dataHex] = payload.split(":");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return (
    decipher.update(Buffer.from(dataHex, "hex")).toString("utf8") +
    decipher.final("utf8")
  );
}

async function getVndaConfig(): Promise<{ token: string; host: string }> {
  const envToken = process.env.VNDA_API_TOKEN?.trim();
  const envHost = process.env.VNDA_STORE_HOST?.trim();
  if (envToken && envHost) return { token: envToken, host: envHost };

  const db = createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim(),
    (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
    { auth: { persistSession: false } },
  );
  const { data, error } = await db
    .from("vnda_connections")
    .select("api_token, store_host")
    .eq("workspace_id", WORKSPACE_ID)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error(
      `Sem conexão VNDA no Supabase (workspace ${WORKSPACE_ID}): ${error?.message ?? "não encontrada"}. ` +
        `Alternativa: exportar VNDA_API_TOKEN e VNDA_STORE_HOST no ambiente.`,
    );
  }
  return { token: decryptToken(data.api_token), host: data.store_host };
}

// ---------- HTTP ----------
interface Pagination {
  total_pages?: number;
  total_count?: number;
  next_page?: boolean;
}

async function vndaGetOrders(
  cfg: { token: string; host: string },
  page: number,
  from: string,
  to: string,
): Promise<{ rows: VndaOrderRaw[]; pagination: Pagination | null }> {
  const url =
    `https://api.vnda.com.br/api/v2/orders?page=${page}&per_page=${PER_PAGE}` +
    `&start=${from}&finish=${to}`;
  const headers = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: "application/json",
    "X-Shop-Host": cfg.host,
  };

  let lastErr = "";
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, { headers });

    if (res.ok) {
      const body = await res.json();
      let pagination: Pagination | null = null;
      const raw = res.headers.get("x-pagination");
      if (raw) {
        try {
          pagination = JSON.parse(raw) as Pagination;
        } catch {
          /* header malformado */
        }
      }
      return { rows: Array.isArray(body) ? body : [], pagination };
    }

    if (res.status < 500 && res.status !== 429) {
      throw new Error(`GET /orders page=${page} → HTTP ${res.status}`);
    }
    lastErr = `HTTP ${res.status}`;
    await sleep(Math.min(8000, 500 * 2 ** (attempt - 1)));
  }
  throw new Error(`GET /orders page=${page} falhou após ${MAX_RETRIES}: ${lastErr}`);
}

// ---------- normalização ----------
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function firstTracking(o: VndaOrderRaw): string | null {
  if (typeof o.tracking_code === "string" && o.tracking_code.trim()) {
    return o.tracking_code.trim();
  }
  const list = o.tracking_code_list;
  if (Array.isArray(list)) {
    for (const t of list) {
      if (typeof t === "string" && t.trim()) return t.trim();
      if (t && typeof t === "object") {
        const code = (t as Record<string, unknown>).code;
        if (typeof code === "string" && code.trim()) return code.trim();
      }
    }
  }
  return null;
}

/** Data do pedido: a mais confiável disponível, nessa ordem. */
function placedAt(o: VndaOrderRaw): string | null {
  const candidate =
    o.confirmed_at || o.paid_at || o.received_at || o.canceled_at || null;
  if (!candidate) return null;
  const d = new Date(candidate);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeOrder(o: VndaOrderRaw, from: string): ExportOrder | null {
  const number = (o.code ?? "").trim() || (o.id != null ? String(o.id) : "");
  if (!number) return null;

  const email = (o.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) return null;

  const at = placedAt(o);
  if (!at) return null;
  // Recorte final no cliente: o filtro server-side da VNDA é por data de
  // criação, e pedidos criados em 2025 podem ter sido confirmados em 2026 (e
  // vice-versa). Aqui garantimos o escopo pedido: 2026 em diante.
  if (at.slice(0, 10) < from) return null;

  const total = num(o.total);
  if (total === null) return null;

  const status = (o.status ?? "").trim().toLowerCase();

  const items: ExportItem[] = (o.items ?? []).map((it) => {
    const name = [it.product_name, it.variant_name]
      .filter((s) => typeof s === "string" && s.trim())
      .join(" — ");
    return {
      name: name || "Produto",
      sku: it.sku?.trim() || null,
      quantity: num(it.quantity) ?? 1,
      unit_price: num(it.price),
      total: num(it.total),
    };
  });

  return {
    vnda_order_number: number,
    customer_email: email,
    placed_at: at,
    status_label: STATUS_LABEL[status] ?? (status ? status : "Desconhecido"),
    total,
    currency: "brl",
    discount_total: num(o.discount_price) ?? 0,
    tracking: firstTracking(o),
    items,
    metadata: {
      vnda_id: o.id ?? null,
      vnda_status: status || null,
      coupon: o.coupon_code?.trim() || null,
      subtotal: num(o.subtotal),
      shipping_price: num(o.shipping_price),
      payment_method: o.payment_method?.trim() || null,
      installments: num(o.installments),
      shipped_at: o.shipped_at ?? null,
      delivered_at: o.delivered_at ?? null,
    },
  };
}

// ---------- CLI ----------
interface Args {
  limit: number | null;
  dry: boolean;
  from: string;
  to: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let limit: number | null = null;
  let dry = false;
  let from = DEFAULT_FROM;
  let to = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--dry") dry = true;
    else if (t === "--limit") limit = Number(argv[++i]);
    else if (t.startsWith("--limit=")) limit = Number(t.split("=")[1]);
    else if (t === "--from") from = argv[++i];
    else if (t.startsWith("--from=")) from = t.split("=")[1];
    else if (t === "--to") to = argv[++i];
    else if (t.startsWith("--to=")) to = t.split("=")[1];
    else throw new Error(`Argumento desconhecido: ${t}`);
  }

  if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error("--limit precisa ser inteiro > 0");
  }
  for (const [name, v] of [
    ["--from", from],
    ["--to", to],
  ] as const) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      throw new Error(`${name} inválido: use YYYY-MM-DD (recebi "${v}")`);
    }
  }
  return { limit, dry, from, to };
}

// ---------- main ----------
async function main() {
  const { limit, dry, from, to } = parseArgs();
  const cfg = await getVndaConfig();

  console.log(
    `[orders-export] host=${cfg.host} janela=${from}..${to} limit=${limit ?? "todos"} dry=${dry}`,
  );

  const orders: ExportOrder[] = [];
  const statusTally = new Map<string, number>();
  let seen = 0;
  let skipped = 0;
  let withTracking = 0;
  let withItems = 0;
  let totalPages: number | null = null;
  let totalCount: number | null = null;

  for (let page = 1; ; page++) {
    const { rows, pagination } = await vndaGetOrders(cfg, page, from, to);

    if (pagination) {
      totalPages ??= pagination.total_pages ?? null;
      totalCount ??= pagination.total_count ?? null;
    }

    for (const raw of rows) {
      seen++;
      const o = normalizeOrder(raw, from);
      if (!o) {
        skipped++;
        continue;
      }
      statusTally.set(o.status_label, (statusTally.get(o.status_label) ?? 0) + 1);
      if (o.tracking) withTracking++;
      if (o.items.length) withItems++;
      orders.push(o);
    }

    const done =
      rows.length === 0 ||
      pagination?.next_page === false ||
      (totalPages !== null && page >= totalPages) ||
      (limit !== null && orders.length >= limit);

    if (page % 10 === 0 || done) {
      console.log(
        `  página ${page}${totalPages ? `/${totalPages}` : ""} — ${seen} lidos, ${orders.length} exportáveis`,
      );
    }
    if (done) break;

    await sleep(THROTTLE_MS);
  }

  const trimmed = limit !== null ? orders.slice(0, limit) : orders;
  trimmed.sort((a, b) => (a.placed_at < b.placed_at ? 1 : -1));

  const payload = {
    version: CONTRACT_VERSION,
    exported_at: new Date().toISOString(),
    source: "vnda_api:/api/v2/orders",
    store_host: cfg.host,
    window: { from, to },
    stats: {
      vnda_total_count: totalCount,
      lidos: seen,
      exportados: trimmed.length,
      pulados: skipped,
      com_rastreio: withTracking,
      com_itens: withItems,
      clientes_distintos: new Set(trimmed.map((o) => o.customer_email)).size,
      por_status: Object.fromEntries(statusTally),
    },
    orders: trimmed,
  };

  console.log(`\n[orders-export] ${JSON.stringify(payload.stats, null, 2)}`);

  if (dry) {
    console.log("\n[dry] nada foi escrito em disco.");
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");
  console.log(`\n✓ ${OUT_FILE} (${trimmed.length} pedidos)`);
}

main().catch((err) => {
  console.error(`[orders-export] ERRO: ${err?.message ?? err}`);
  process.exitCode = 1;
});

/**
 * medusa-coupons-export.ts
 * Exporta as DUAS promoções de comunidade da VNDA (Bulking Club + Team Bulking)
 * e TODOS os seus códigos de cupom pro JSON que o importador do Medusa lê
 * (migração de plataforma VNDA → Medusa).
 *
 * Uso:
 *   npx tsx scripts/medusa-coupons-export.ts --dry
 *   npx tsx scripts/medusa-coupons-export.ts --limit 50        # 50 códigos/grupo
 *   npx tsx scripts/medusa-coupons-export.ts                   # tudo (~2.9k)
 *
 * Saída: output/medusa/coupons-export.json  (NÃO versionar — pode conter e-mail
 *        de membro no owner; ver .gitignore do bulking-app bootstrap-data)
 *
 * ── CREDENCIAIS ────────────────────────────────────────────────────────────
 * Iguais aos outros exportadores: saem da tabela `vnda_connections` do Supabase
 * (api_token AES-256-GCM, chave `ENCRYPTION_KEY`). Fallback: VNDA_API_TOKEN +
 * VNDA_STORE_HOST no ambiente.
 *
 * ── ESTRUTURA REAL NA VNDA (probe 2026-07-21) ──────────────────────────────
 * "Promoção" na VNDA = objeto `discount`. As duas de comunidade:
 *   - id 7  · name "Bulking Club" · description "Membros do Bulking Club" → club
 *   - id 5  · name "Team Bulking" · description "Membros do Team Bulking" → team
 * (ids/nomes descobertos via GET /api/v2/discounts — a conta tem ~2.8k discounts
 *  no total; estes dois são os de comunidade. IDs hardcoded + VERIFICAÇÃO de nome
 *  em runtime; se o nome não bater, o script ABORTA em vez de exportar o errado.)
 *
 * Endpoints (todos GET, com header X-Shop-Host):
 *   /api/v2/discounts/{id}            → meta (name, description, enabled,
 *                                       valid_to, cumulative, start_at, end_at)
 *   /api/v2/discounts/{id}/rules/     → ARRAY de regras. Bulking Club/Team têm 1:
 *       { amount: 10, type: "percentage", apply_to: "subtotal",
 *         min_quantity: 1, min_subtotal: 0, shipping_method: null,
 *         shipping_rule: null, gift: null, ... }
 *   /api/v2/discounts/{id}/coupons/   → ARRAY paginado (X-Pagination header).
 *       Por cupom: { id, code, uses_per_code, uses_per_user, referrer_email,
 *                    user_id, updated_at, orders_count }
 *       - uses_per_code / uses_per_user: 0 = ILIMITADO.
 *       - referrer_email / user_id: o DONO/MEMBRO do cupom (quase sempre null na
 *         amostra — a comissão é resolvida por sistema externo, não por este
 *         campo; exportado mesmo assim quando existe).
 *
 * ⚠️ NUNCA usar `tags` como QUERY no search da VNDA (HTTP 500). Aqui só lemos
 *    discounts/coupons — sem search.
 */
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const CONTRACT_VERSION = 1;
const WORKSPACE_ID = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04"; // Bulking
const PER_PAGE = 100;
const THROTTLE_MS = 200;
const MAX_RETRIES = 5;
const OUT_DIR = path.join(process.cwd(), "output", "medusa");
const OUT_FILE = path.join(OUT_DIR, "coupons-export.json");

/**
 * As duas promoções de comunidade. `id` e `expectedName` foram descobertos via
 * GET /api/v2/discounts; a verificação de nome protege contra a VNDA renumerar.
 */
const PROMOS: Array<{ id: number; group: "club" | "team"; expectedName: string }> = [
  { id: 7, group: "club", expectedName: "Bulking Club" },
  { id: 5, group: "team", expectedName: "Team Bulking" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- tipos VNDA ----------
interface VndaDiscount {
  id?: number;
  name?: string | null;
  description?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  enabled?: boolean | null;
  valid_to?: string | null;
  cumulative?: boolean | null;
  email?: string | null;
  cpf?: string | null;
  tags?: unknown;
}

interface VndaDiscountRule {
  id?: number;
  amount?: number | null;
  type?: string | null; // "percentage" | "amount" | ...
  apply_to?: string | null; // "subtotal" | "shipping" | ...
  min_quantity?: number | null;
  min_subtotal?: number | null;
  shipping_method?: unknown;
  shipping_rule?: unknown;
  gift?: unknown;
}

interface VndaCoupon {
  id?: number;
  code?: string | null;
  uses_per_code?: number | null;
  uses_per_user?: number | null;
  referrer_email?: string | null;
  user_id?: number | string | null;
  orders_count?: number | null;
  updated_at?: string | null;
}

// ---------- contrato de saída ----------
interface DiscountShape {
  /** "percentage" (esperado) ou "amount". */
  type: string;
  /** valor da regra (10 = 10% quando percentage). */
  value: number;
  /** "subtotal" | "shipping" | ... */
  apply_to: string;
  min_quantity: number;
  min_subtotal: number;
  /** true quando a regra dá frete grátis (apply_to shipping ou shipping_method/rule setado). */
  free_shipping: boolean;
}

interface ExportPromotion {
  vnda_discount_id: number;
  group: "club" | "team";
  name: string;
  description: string | null;
  enabled: boolean;
  /** "cart" = vale pro carrinho todo. */
  valid_to: string | null;
  /** true = pode acumular com outras promoções. */
  cumulative: boolean;
  start_at: string | null;
  end_at: string | null;
  discount: DiscountShape;
  /** regras cruas da VNDA (fidelidade — o que não mapeamos fica aqui). */
  rules_raw: VndaDiscountRule[];
  coupon_count: number;
}

interface ExportCoupon {
  code: string;
  group: "club" | "team";
  vnda_discount_id: number;
  vnda_coupon_id: number | null;
  discount_type: string;
  discount_value: number;
  apply_to: string;
  min_quantity: number;
  min_subtotal: number;
  free_shipping: boolean;
  cumulative: boolean;
  /** 0 = ilimitado. */
  uses_per_code: number;
  /** 0 = ilimitado. Medusa não tem equivalente 1:1 (ver importador). */
  uses_per_user: number;
  /** dono/membro do cupom (comissão é externa; exportado quando existir). */
  owner_email: string | null;
  owner_user_id: string | null;
  orders_count: number;
  updated_at: string | null;
}

// ---------- credenciais ----------
function decryptToken(payload: string): string {
  const key = Buffer.from((process.env.ENCRYPTION_KEY || "").trim(), "hex");
  const [ivHex, tagHex, dataHex] = payload.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
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

// ---------- HTTP com retry/throttle ----------
interface Pagination {
  total_pages?: number;
  total_count?: number;
  current_page?: number;
  next_page?: boolean;
}

async function vndaGet(
  cfg: { token: string; host: string },
  urlPath: string,
): Promise<{ body: unknown; pagination: Pagination | null }> {
  const url = `https://api.vnda.com.br${urlPath}`;
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
          /* header malformado — seguimos pelo tamanho da página */
        }
      }
      return { body, pagination };
    }
    if (res.status < 500 && res.status !== 429) {
      throw new Error(`GET ${urlPath} → HTTP ${res.status}`);
    }
    lastErr = `HTTP ${res.status}`;
    await sleep(Math.min(8000, 500 * 2 ** (attempt - 1)));
  }
  throw new Error(`GET ${urlPath} falhou após ${MAX_RETRIES}: ${lastErr}`);
}

// ---------- normalização de regra ----------
function truthyObj(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return Boolean(v);
}

/** Interpreta as regras cruas da VNDA num shape de desconto simples. */
function shapeFromRules(rules: VndaDiscountRule[]): DiscountShape {
  // Preferimos a primeira regra sobre subtotal; senão a primeira que existir.
  const rule =
    rules.find((r) => (r.apply_to ?? "subtotal") === "subtotal") ?? rules[0] ?? {};
  const applyTo = (rule.apply_to ?? "subtotal").toString();
  const freeShipping =
    applyTo === "shipping" ||
    truthyObj(rule.shipping_method) ||
    truthyObj(rule.shipping_rule);
  return {
    type: (rule.type ?? "percentage").toString(),
    value: Number(rule.amount ?? 0),
    apply_to: applyTo,
    min_quantity: Number(rule.min_quantity ?? 0) || 0,
    min_subtotal: Number(rule.min_subtotal ?? 0) || 0,
    free_shipping: freeShipping,
  };
}

// ---------- CLI ----------
interface Args {
  limit: number | null;
  dry: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let limit: number | null = null;
  let dry = false;
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--dry") dry = true;
    else if (t === "--limit") limit = Number(argv[++i]);
    else if (t.startsWith("--limit=")) limit = Number(t.split("=")[1]);
    else throw new Error(`Argumento desconhecido: ${t}`);
  }
  if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error("--limit precisa ser inteiro > 0");
  }
  return { limit, dry };
}

// ---------- main ----------
async function main() {
  const { limit, dry } = parseArgs();
  const cfg = await getVndaConfig();
  console.log(
    `[coupons-export] host=${cfg.host} limit=${limit ?? "todos"}/grupo dry=${dry}`,
  );

  const promotions: ExportPromotion[] = [];
  const coupons: ExportCoupon[] = [];
  let withOwner = 0;

  for (const promo of PROMOS) {
    // --- meta ---
    const { body: metaBody } = await vndaGet(cfg, `/api/v2/discounts/${promo.id}`);
    const meta = (metaBody ?? {}) as VndaDiscount;
    const name = (meta.name ?? "").trim();
    if (name !== promo.expectedName) {
      throw new Error(
        `Discount ${promo.id} tem name="${name}", esperava "${promo.expectedName}". ` +
          `A VNDA pode ter renumerado — confira antes de exportar o cupom errado.`,
      );
    }
    await sleep(THROTTLE_MS);

    // --- regras ---
    const { body: rulesBody } = await vndaGet(
      cfg,
      `/api/v2/discounts/${promo.id}/rules/`,
    );
    const rules = (Array.isArray(rulesBody) ? rulesBody : []) as VndaDiscountRule[];
    const shape = shapeFromRules(rules);
    const cumulative = meta.cumulative === true;
    await sleep(THROTTLE_MS);

    if (shape.type !== "percentage" || shape.value !== 10) {
      console.warn(
        `  ⚠️ ${promo.expectedName}: desconto lido = ${shape.value} ${shape.type} ` +
          `(esperado 10 percentage). Exportando o valor REAL lido — confira.`,
      );
    }

    // --- cupons (paginado) ---
    const groupCoupons: ExportCoupon[] = [];
    let couponCount = 0;
    for (let page = 1; ; page++) {
      const { body, pagination } = await vndaGet(
        cfg,
        `/api/v2/discounts/${promo.id}/coupons/?page=${page}&per_page=${PER_PAGE}`,
      );
      const rows = (Array.isArray(body) ? body : []) as VndaCoupon[];
      couponCount = pagination?.total_count ?? couponCount + rows.length;

      for (const c of rows) {
        const code = (c.code ?? "").trim();
        if (!code) continue;
        const ownerEmail = (c.referrer_email ?? "").trim() || null;
        const ownerUserId = c.user_id != null ? String(c.user_id) : null;
        if (ownerEmail || ownerUserId) withOwner++;
        groupCoupons.push({
          code,
          group: promo.group,
          vnda_discount_id: promo.id,
          vnda_coupon_id: typeof c.id === "number" ? c.id : null,
          discount_type: shape.type,
          discount_value: shape.value,
          apply_to: shape.apply_to,
          min_quantity: shape.min_quantity,
          min_subtotal: shape.min_subtotal,
          free_shipping: shape.free_shipping,
          cumulative,
          uses_per_code: Number(c.uses_per_code ?? 0) || 0,
          uses_per_user: Number(c.uses_per_user ?? 0) || 0,
          owner_email: ownerEmail,
          owner_user_id: ownerUserId,
          orders_count: Number(c.orders_count ?? 0) || 0,
          updated_at: c.updated_at ?? null,
        });
      }

      const reachedLimit = limit !== null && groupCoupons.length >= limit;
      const done =
        rows.length === 0 || pagination?.next_page === false || reachedLimit;

      if (page % 10 === 0 || done) {
        console.log(
          `  [${promo.group}] página ${page}${
            pagination?.total_pages ? `/${pagination.total_pages}` : ""
          } — ${groupCoupons.length} códigos`,
        );
      }
      if (done) break;
      await sleep(THROTTLE_MS);
    }

    const trimmed =
      limit !== null ? groupCoupons.slice(0, limit) : groupCoupons;
    coupons.push(...trimmed);

    promotions.push({
      vnda_discount_id: promo.id,
      group: promo.group,
      name,
      description: (meta.description ?? "").trim() || null,
      enabled: meta.enabled === true,
      valid_to: meta.valid_to ?? null,
      cumulative,
      start_at: meta.start_at ?? null,
      end_at: meta.end_at ?? null,
      discount: shape,
      rules_raw: rules,
      coupon_count: couponCount,
    });
    console.log(
      `  ✓ ${promo.expectedName}: ${trimmed.length}${
        limit ? `/${couponCount}` : ""
      } códigos · ${shape.value}${shape.type === "percentage" ? "%" : ""} ${shape.apply_to}`,
    );
  }

  const payload = {
    version: CONTRACT_VERSION,
    exported_at: new Date().toISOString(),
    source: "vnda_api:/api/v2/discounts",
    store_host: cfg.host,
    stats: {
      total_codes: coupons.length,
      by_group: {
        club: coupons.filter((c) => c.group === "club").length,
        team: coupons.filter((c) => c.group === "team").length,
      },
      with_owner: withOwner,
      promotions: promotions.map((p) => ({
        group: p.group,
        vnda_discount_id: p.vnda_discount_id,
        name: p.name,
        coupon_count: p.coupon_count,
        discount: `${p.discount.value}${
          p.discount.type === "percentage" ? "%" : ""
        } ${p.discount.apply_to}`,
        cumulative: p.cumulative,
        free_shipping: p.discount.free_shipping,
      })),
    },
    promotions,
    coupons,
  };

  console.log(`\n[coupons-export] ${JSON.stringify(payload.stats, null, 2)}`);

  if (dry) {
    console.log("\n[dry] nada foi escrito em disco.");
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");
  console.log(`\n✓ ${OUT_FILE} (${coupons.length} códigos, ${promotions.length} promoções)`);
}

main().catch((err) => {
  console.error(`[coupons-export] ERRO: ${err?.message ?? err}`);
  process.exitCode = 1;
});

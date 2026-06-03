import type { SupabaseClient } from "@supabase/supabase-js";
import { cancelPendingGiftRequestFollowups } from "./followups";

const DEFAULT_WINDOW_DAYS = 14;
const DEFAULT_LOOKBACK_DAYS = 90;
const PAGE_SIZE = 1000;

type MatchType = "recipient_phone_product" | "requester_phone_product";

interface GiftRequestRow {
  id: string;
  workspace_id: string;
  requester_phone: string | null;
  recipient_phone: string | null;
  product_id: string | null;
  product_name: string | null;
  status: string | null;
  created_at: string;
}

interface ProductRow {
  product_id: string;
  sku: string | null;
  name: string | null;
}

interface SaleRow {
  id: string;
  cliente: string | null;
  telefone: string | null;
  valor: number | null;
  data_compra: string | null;
  creation_date: string | null;
  source_order_id: string | null;
  numero_pedido: string | null;
  ordem_compra: string | null;
  items: unknown;
}

interface ParsedSale extends SaleRow {
  orderAt: Date;
  normalizedPhone: string;
}

interface ConversionCandidate {
  request: GiftRequestRow;
  sale: ParsedSale;
  matchType: MatchType;
  matchedPhone: string;
  score: number;
}

export interface GiftRequestConversionMatch {
  request_id: string;
  order_id: string;
  order_at: string;
  match_type: MatchType;
  matched_phone: string;
  revenue: number;
  product_name: string | null;
}

export interface GiftRequestConversionSyncResult {
  workspaceId: string;
  scanned: number;
  matched: number;
  updated: number;
  skipped: number;
  totalRevenue: number;
  matches: GiftRequestConversionMatch[];
}

export interface SyncGiftRequestConversionOptions {
  admin: SupabaseClient;
  workspaceId: string;
  windowDays?: number;
  lookbackDays?: number;
  limit?: number;
  dryRun?: boolean;
}

export function normalizeGiftRequestPhone(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function phoneQueryVariants(raw: string | null | undefined): string[] {
  const digits = String(raw || "").replace(/\D/g, "");
  const normalized = normalizeGiftRequestPhone(raw);
  const variants = new Set<string>();
  if (digits) {
    variants.add(digits);
    variants.add(`+${digits}`);
  }
  if (normalized) {
    variants.add(normalized);
    variants.add(`+${normalized}`);
    if (normalized.startsWith("55") && normalized.length > 11) {
      variants.add(normalized.slice(2));
    }
  }
  return Array.from(variants).filter(Boolean);
}

function parseCrmDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  const nativeMs = Date.parse(value);
  if (Number.isFinite(nativeMs)) return new Date(nativeMs);

  const br = value.match(
    /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (!br) return null;

  const year = Number(br[3].length === 2 ? `20${br[3]}` : br[3]);
  const date = new Date(
    Date.UTC(
      year,
      Number(br[2]) - 1,
      Number(br[1]),
      Number(br[4] || 0),
      Number(br[5] || 0),
      Number(br[6] || 0)
    )
  );
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeText(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+-\s+bulking$/i, "")
    .replace(/\bbulking\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeSku(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function skuBases(value: unknown): string[] {
  const sku = normalizeSku(value);
  if (!sku) return [];
  const out = new Set([sku]);
  const base = sku.split("-")[0];
  if (base) out.add(base);
  return Array.from(out);
}

function orderCode(sale: SaleRow): string {
  return (
    sale.numero_pedido ||
    sale.source_order_id ||
    sale.ordem_compra ||
    sale.id
  );
}

function itemField(item: Record<string, unknown>, field: string): unknown {
  return Object.prototype.hasOwnProperty.call(item, field) ? item[field] : null;
}

function saleContainsRequestedProduct(
  sale: SaleRow,
  request: GiftRequestRow,
  product: ProductRow | undefined
): boolean {
  if (!Array.isArray(sale.items)) return false;

  const acceptedSkus = new Set<string>();
  for (const value of [product?.sku, request.product_id]) {
    for (const sku of skuBases(value)) acceptedSkus.add(sku);
  }

  const acceptedNames = new Set<string>();
  for (const value of [product?.name, request.product_name]) {
    const name = normalizeText(value);
    if (name.length >= 6) acceptedNames.add(name);
  }

  for (const rawItem of sale.items) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const item = rawItem as Record<string, unknown>;

    const itemSkuValues = [
      itemField(item, "sku"),
      itemField(item, "reference"),
      itemField(item, "product_id"),
      itemField(item, "id"),
      itemField(item, "external_id"),
      itemField(item, "variant_id"),
    ];
    for (const value of itemSkuValues) {
      for (const sku of skuBases(value)) {
        if (acceptedSkus.has(sku)) return true;
      }
    }

    const itemNames = [
      itemField(item, "name"),
      itemField(item, "product_name"),
      itemField(item, "title"),
      itemField(item, "variant_name"),
      itemField(item, "description"),
    ]
      .map(normalizeText)
      .filter((name) => name.length >= 6);

    for (const itemName of itemNames) {
      for (const acceptedName of acceptedNames) {
        if (
          itemName === acceptedName ||
          itemName.startsWith(`${acceptedName} `) ||
          itemName.includes(acceptedName) ||
          acceptedName.includes(itemName)
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

async function fetchPaged<T>(buildQuery: () => any): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(
      offset,
      offset + PAGE_SIZE - 1
    );
    if (error) throw new Error(error.message);
    const page = (data || []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchProducts(
  admin: SupabaseClient,
  workspaceId: string,
  productIds: string[]
): Promise<Map<string, ProductRow>> {
  if (productIds.length === 0) return new Map();
  const { data, error } = await admin
    .from("shelf_products")
    .select("product_id, sku, name")
    .eq("workspace_id", workspaceId)
    .in("product_id", productIds);
  if (error) throw new Error(error.message);
  return new Map(
    ((data || []) as ProductRow[]).map((row) => [row.product_id, row])
  );
}

async function fetchSalesForPhones(
  admin: SupabaseClient,
  workspaceId: string,
  phoneVariants: string[]
): Promise<ParsedSale[]> {
  if (phoneVariants.length === 0) return [];

  const byId = new Map<string, SaleRow>();
  for (let i = 0; i < phoneVariants.length; i += 50) {
    const chunk = phoneVariants.slice(i, i + 50);
    const sales = await fetchPaged<SaleRow>(() =>
      admin
        .from("crm_vendas")
        .select(
          "id, cliente, telefone, valor, data_compra, creation_date, source_order_id, numero_pedido, ordem_compra, items"
        )
        .eq("workspace_id", workspaceId)
        .in("telefone", chunk)
    );
    for (const sale of sales) byId.set(sale.id, sale);
  }

  return Array.from(byId.values())
    .map((sale) => {
      const orderAt = parseCrmDate(sale.data_compra) || parseCrmDate(sale.creation_date);
      const normalizedPhone = normalizeGiftRequestPhone(sale.telefone);
      if (!orderAt || !normalizedPhone) return null;
      return { ...sale, orderAt, normalizedPhone };
    })
    .filter((sale): sale is ParsedSale => Boolean(sale));
}

function bestCandidateForRequest(
  request: GiftRequestRow,
  salesByPhone: Map<string, ParsedSale[]>,
  productsById: Map<string, ProductRow>,
  windowDays: number
): ConversionCandidate | null {
  const requestAt = new Date(request.created_at);
  if (!Number.isFinite(requestAt.getTime())) return null;
  const windowEnd = new Date(requestAt.getTime() + windowDays * 24 * 3600_000);
  const product = request.product_id
    ? productsById.get(request.product_id)
    : undefined;

  const recipientPhone = normalizeGiftRequestPhone(request.recipient_phone);
  const requesterPhone = normalizeGiftRequestPhone(request.requester_phone);
  const phones: Array<{ type: MatchType; phone: string; score: number }> = [];
  if (recipientPhone) {
    phones.push({
      type: "recipient_phone_product",
      phone: recipientPhone,
      score: 100,
    });
  }
  if (requesterPhone && requesterPhone !== recipientPhone) {
    phones.push({
      type: "requester_phone_product",
      phone: requesterPhone,
      score: 80,
    });
  }

  const candidates: ConversionCandidate[] = [];
  for (const phone of phones) {
    for (const sale of salesByPhone.get(phone.phone) || []) {
      if (sale.orderAt < requestAt || sale.orderAt > windowEnd) continue;
      if (!saleContainsRequestedProduct(sale, request, product)) continue;
      candidates.push({
        request,
        sale,
        matchType: phone.type,
        matchedPhone: phone.phone,
        score: phone.score,
      });
    }
  }

  candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.sale.orderAt.getTime() - b.sale.orderAt.getTime();
  });

  return candidates[0] || null;
}

function candidateDelayMs(candidate: ConversionCandidate): number {
  const requestAt = new Date(candidate.request.created_at).getTime();
  const saleAt = candidate.sale.orderAt.getTime();
  if (!Number.isFinite(requestAt) || !Number.isFinite(saleAt)) return Infinity;
  return saleAt - requestAt;
}

export async function syncGiftRequestConversions(
  options: SyncGiftRequestConversionOptions
): Promise<GiftRequestConversionSyncResult> {
  const {
    admin,
    workspaceId,
    windowDays = DEFAULT_WINDOW_DAYS,
    lookbackDays = DEFAULT_LOOKBACK_DAYS,
    limit = 500,
    dryRun = false,
  } = options;

  const cutoff = new Date(Date.now() - lookbackDays * 24 * 3600_000).toISOString();
  const { data, error } = await admin
    .from("gift_requests")
    .select(
      "id, workspace_id, requester_phone, recipient_phone, product_id, product_name, status, created_at"
    )
    .eq("workspace_id", workspaceId)
    .is("converted_at", null)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);

  const { data: convertedRows, error: convertedError } = await admin
    .from("gift_requests")
    .select("converted_order_id")
    .eq("workspace_id", workspaceId)
    .not("converted_at", "is", null)
    .not("converted_order_id", "is", null)
    .gte("created_at", cutoff);

  if (convertedError) throw new Error(convertedError.message);

  const previouslyUsedOrderCodes = new Set(
    ((convertedRows || []) as Array<{ converted_order_id: string | null }>)
      .map((row) => row.converted_order_id)
      .filter((code): code is string => Boolean(code))
  );

  const requests = ((data || []) as GiftRequestRow[]).filter(
    (request) => request.status !== "failed"
  );
  if (requests.length === 0) {
    return {
      workspaceId,
      scanned: 0,
      matched: 0,
      updated: 0,
      skipped: 0,
      totalRevenue: 0,
      matches: [],
    };
  }

  const productIds = Array.from(
    new Set(requests.map((request) => request.product_id).filter(Boolean))
  ) as string[];
  const phoneVariants = Array.from(
    new Set(
      requests.flatMap((request) => [
        ...phoneQueryVariants(request.recipient_phone),
        ...phoneQueryVariants(request.requester_phone),
      ])
    )
  );

  const [productsById, sales] = await Promise.all([
    fetchProducts(admin, workspaceId, productIds),
    fetchSalesForPhones(admin, workspaceId, phoneVariants),
  ]);

  const salesByPhone = new Map<string, ParsedSale[]>();
  for (const sale of sales) {
    const bucket = salesByPhone.get(sale.normalizedPhone) || [];
    bucket.push(sale);
    salesByPhone.set(sale.normalizedPhone, bucket);
  }
  for (const bucket of salesByPhone.values()) {
    bucket.sort((a, b) => a.orderAt.getTime() - b.orderAt.getTime());
  }

  const candidates = requests
    .map((request) =>
      bestCandidateForRequest(request, salesByPhone, productsById, windowDays)
    )
    .filter((candidate): candidate is ConversionCandidate => Boolean(candidate))
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      const delay = candidateDelayMs(a) - candidateDelayMs(b);
      if (delay !== 0) return delay;
      return b.sale.orderAt.getTime() - a.sale.orderAt.getTime();
    });

  let updated = 0;
  let totalRevenue = 0;
  const matches: GiftRequestConversionMatch[] = [];
  const usedOrderCodes = new Set<string>(previouslyUsedOrderCodes);
  const usedRequestIds = new Set<string>();

  for (const candidate of candidates) {
    const code = orderCode(candidate.sale);
    if (usedOrderCodes.has(code) || usedRequestIds.has(candidate.request.id)) {
      continue;
    }
    const revenue = Number(candidate.sale.valor) || 0;
    const match: GiftRequestConversionMatch = {
      request_id: candidate.request.id,
      order_id: code,
      order_at: candidate.sale.orderAt.toISOString(),
      match_type: candidate.matchType,
      matched_phone: candidate.matchedPhone,
      revenue,
      product_name: candidate.request.product_name,
    };
    matches.push(match);
    usedOrderCodes.add(code);
    usedRequestIds.add(candidate.request.id);
    totalRevenue += revenue;

    if (dryRun) continue;

    const { error: updateError } = await admin
      .from("gift_requests")
      .update({
        status: "converted",
        converted_order_id: match.order_id,
        converted_at: match.order_at,
      })
      .eq("id", candidate.request.id)
      .is("converted_at", null);

    if (updateError) throw new Error(updateError.message);
    await cancelPendingGiftRequestFollowups({
      admin,
      workspaceId,
      requestIds: [candidate.request.id],
    }).catch((err) => {
      console.warn(
        `[GiftRequestConversions] failed to cancel pending follow-up for request ${candidate.request.id}:`,
        err
      );
    });
    updated++;
  }

  return {
    workspaceId,
    scanned: requests.length,
    matched: matches.length,
    updated,
    skipped: requests.length - matches.length,
    totalRevenue: Number(totalRevenue.toFixed(2)),
    matches,
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { getVndaConfigForWorkspace } from "@/lib/coupons/vnda-coupons";
import {
  normalizeCart,
  validateAbandonedCartPayloadForImport,
} from "@/lib/cart-recovery/payload";
import type { VndaAbandonedCartPayload } from "@/lib/cart-recovery/types";
import { normalizeBrazilianWhatsAppPhone } from "@/lib/phone";
import {
  normalizeBrazilianState,
  regionForState,
} from "@/lib/cart-recovery/location";

interface VndaCartListItem {
  id: number;
  token: string;
  code: string;
  email: string | null;
  total: number;
  items_count: number;
  updated_at: string;
}

interface VndaClientResponse {
  id?: number;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone_area?: string | null;
  phone?: string | null;
  cellphone_area?: string | null;
  cellphone?: string | null;
  recent_address?: {
    phone_area?: string | null;
    phone?: string | null;
    first_phone_area?: string | null;
    first_phone?: string | null;
    second_phone_area?: string | null;
    second_phone?: string | null;
    state?: string | null;
  } | null;
}

interface VndaClientContact {
  name: string | null;
  phone: string | null;
  state: string | null;
  region: string | null;
}

interface RecentOrder {
  email: string | null;
  phone: string | null;
  purchasedAtMs: number;
}

interface RecentOrderIndex {
  byEmail: Map<string, RecentOrder[]>;
  byPhone: Map<string, RecentOrder[]>;
}

export interface CartRecoveryImportStats {
  fetched: number;
  eligible: number;
  skipped_no_email: number;
  skipped_outside_window: number;
  skipped_existing: number;
  skipped_invalid: number;
  skipped_converted: number;
  imported: number;
  errors: number;
  sample_invalid: Array<Record<string, unknown>>;
}

export interface ImportMissingCartsOptions {
  admin: SupabaseClient;
  workspaceId: string;
  hours: number;
  maxPages?: number;
  perPage?: number;
  rateLimitMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function vndaGet<T>(
  path: string,
  apiToken: string,
  storeHost: string
): Promise<T> {
  const res = await fetch(`https://api.vnda.com.br/api/v2/${path}`, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: "application/json",
      "X-Shop-Host": storeHost,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`VNDA ${res.status} ${path}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function importMissingCartsFromVnda(
  options: ImportMissingCartsOptions
): Promise<CartRecoveryImportStats> {
  const {
    admin,
    workspaceId,
    hours,
    maxPages = 5,
    perPage = 100,
    rateLimitMs = 150,
  } = options;

  const config = await getVndaConfigForWorkspace(workspaceId);
  if (!config) {
    throw new Error("VNDA não configurado pra esse workspace.");
  }

  const cutoff = new Date(Date.now() - hours * 3600 * 1000);

  const { data: existing } = await admin
    .from("abandoned_carts")
    .select("vnda_cart_token")
    .eq("workspace_id", workspaceId)
    .not("vnda_cart_token", "is", null)
    .limit(20000);

  const existingTokens = new Set(
    (existing || [])
      .map((r) => r.vnda_cart_token as string | null)
      .filter((t): t is string => !!t)
  );

  const stats: CartRecoveryImportStats = {
    fetched: 0,
    eligible: 0,
    skipped_no_email: 0,
    skipped_outside_window: 0,
    skipped_existing: 0,
    skipped_invalid: 0,
    skipped_converted: 0,
    imported: 0,
    errors: 0,
    sample_invalid: [],
  };

  const eligible: VndaCartListItem[] = [];
  const recentOrders = await loadRecentOrderIndex(admin, workspaceId, cutoff);

  pages: for (let page = 1; page <= maxPages; page++) {
    const list = await vndaGet<VndaCartListItem[]>(
      `carts/?per_page=${perPage}&page=${page}`,
      config.apiToken,
      config.storeHost
    );

    if (!Array.isArray(list) || list.length === 0) break;
    stats.fetched += list.length;

    for (const cart of list) {
      const updatedAt = new Date(cart.updated_at);
      if (updatedAt < cutoff) {
        stats.skipped_outside_window++;
        break pages;
      }
      if (!cart.email) {
        stats.skipped_no_email++;
        continue;
      }
      if (cart.items_count <= 0) {
        stats.skipped_invalid++;
        continue;
      }
      if (existingTokens.has(cart.token)) {
        stats.skipped_existing++;
        continue;
      }
      eligible.push(cart);
    }

    if (list.length < perPage) break;
  }

  stats.eligible = eligible.length;
  const stateByEmail = await loadCustomerStateIndex(
    admin,
    workspaceId,
    eligible.map((cart) => cart.email).filter((email): email is string => !!email)
  );

  for (const cart of eligible) {
    try {
      const detail = await vndaGet<VndaAbandonedCartPayload>(
        `carts/${cart.token}`,
        config.apiToken,
        config.storeHost
      );

      const detailNormalized = {
        ...detail,
        email: detail.email || cart.email || undefined,
        token: detail.token || cart.token,
        items: parseItems(detail.items as unknown),
      } as VndaAbandonedCartPayload;

      if (!validateAbandonedCartPayloadForImport(detailNormalized)) {
        stats.skipped_invalid++;
        if (stats.sample_invalid.length < 3) {
          const detailObj = detail as unknown as Record<string, unknown>;
          stats.sample_invalid.push({
            list_token: cart.token,
            list_email: cart.email,
            detail_keys: Object.keys(detailObj),
            detail_email: detailObj.email,
            detail_token: detailObj.token,
            detail_id: detailObj.id,
            detail_code: detailObj.code,
            detail_items_type: typeof detailObj.items,
            detail_items_value:
              typeof detailObj.items === "string"
                ? (detailObj.items as string).slice(0, 200)
                : Array.isArray(detailObj.items)
                ? `array(${(detailObj.items as unknown[]).length})`
                : detailObj.items,
          });
        }
        continue;
      }

      const normalized = normalizeCart(detailNormalized);
      if (!normalized.recovery_url && normalized.vnda_cart_token) {
        normalized.recovery_url = `https://${config.storeHost}/carrinho/${normalized.vnda_cart_token}`;
      }
      const contact =
        (!normalized.customer_name || !normalized.customer_phone) &&
        normalized.vnda_client_id
          ? await fetchClientContact(
              normalized.vnda_client_id,
              config.apiToken,
              config.storeHost
            )
          : null;
      const customerPhone = normalized.customer_phone || contact?.phone || null;
      const customerName = normalized.customer_name || contact?.name || "cliente";
      const customerState =
        normalized.customer_state ||
        contact?.state ||
        stateByEmail.get(normalized.customer_email) ||
        null;
      const customerRegion = normalized.customer_region || regionForState(customerState);

      if (
        hasConvertedAfterAbandonment(recentOrders, {
          email: normalized.customer_email,
          phone: customerPhone,
          abandonedAt: normalized.abandoned_at,
        })
      ) {
        stats.skipped_converted++;
        continue;
      }

      const nowIso = new Date().toISOString();
      const { error } = await admin.from("abandoned_carts").upsert(
        {
          workspace_id: workspaceId,
          vnda_cart_token: normalized.vnda_cart_token,
          vnda_cart_id: normalized.vnda_cart_id,
          vnda_client_id: normalized.vnda_client_id,
          customer_email: normalized.customer_email,
          customer_phone: customerPhone,
          customer_name: customerName,
          customer_state: customerState,
          customer_region: customerRegion,
          items: normalized.items,
          cart_total: normalized.cart_total,
          recovery_url: normalized.recovery_url,
          coupon_code: normalized.coupon_code,
          abandoned_at: normalized.abandoned_at,
          recovery_started_at: nowIso,
          raw_payload: JSON.parse(JSON.stringify(detail)),
          updated_at: nowIso,
        },
        {
          onConflict: "workspace_id,vnda_cart_token",
          ignoreDuplicates: false,
        }
      );

      if (error) {
        stats.errors++;
        console.error(
          `[CartRecovery Import] Upsert failed for ${cart.token}:`,
          error.message
        );
      } else {
        existingTokens.add(cart.token);
        stats.imported++;
      }
    } catch (err) {
      stats.errors++;
      console.error(
        `[CartRecovery Import] Failed to import ${cart.token}:`,
        err instanceof Error ? err.message : err
      );
    }

    if (rateLimitMs > 0) await sleep(rateLimitMs);
  }

  return stats;
}

function parseItems(raw: unknown): unknown[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function loadRecentOrderIndex(
  admin: SupabaseClient,
  workspaceId: string,
  cutoff: Date
): Promise<RecentOrderIndex> {
  const empty = {
    byEmail: new Map<string, RecentOrder[]>(),
    byPhone: new Map<string, RecentOrder[]>(),
  };

  const { data, error } = await admin
    .from("crm_vendas")
    .select("email, telefone, data_compra")
    .eq("workspace_id", workspaceId)
    .eq("source", "vnda_webhook")
    .gte("data_compra", cutoff.toISOString())
    .limit(5000);

  if (error) {
    console.warn("[CartRecovery Import] Failed to load recent orders:", error.message);
    return empty;
  }

  for (const row of data || []) {
    const purchasedAtMs = parseDateMs(row.data_compra as string | null);
    if (!purchasedAtMs) continue;

    const email = String(row.email || "").toLowerCase().trim() || null;
    const phone = normalizeBrazilianWhatsAppPhone(row.telefone as string | null);
    const order: RecentOrder = { email, phone, purchasedAtMs };

    if (email) appendIndex(empty.byEmail, email, order);
    if (phone) appendIndex(empty.byPhone, phone, order);
  }

  return empty;
}

async function loadCustomerStateIndex(
  admin: SupabaseClient,
  workspaceId: string,
  emails: string[]
): Promise<Map<string, string>> {
  const uniqueEmails = Array.from(
    new Set(emails.map((email) => email.toLowerCase().trim()).filter(Boolean))
  );
  const out = new Map<string, string>();
  if (uniqueEmails.length === 0) return out;

  for (let i = 0; i < uniqueEmails.length; i += 200) {
    const batch = uniqueEmails.slice(i, i + 200);
    const { data } = await admin
      .from("crm_vendas")
      .select("email, state, data_compra")
      .eq("workspace_id", workspaceId)
      .in("email", batch)
      .not("state", "is", null)
      .order("data_compra", { ascending: false })
      .limit(2000);

    for (const row of data || []) {
      const email = String(row.email || "").toLowerCase().trim();
      if (!email || out.has(email)) continue;
      const state = normalizeBrazilianState(row.state);
      if (state) out.set(email, state);
    }
  }

  return out;
}

function hasConvertedAfterAbandonment(
  orders: RecentOrderIndex,
  cart: { email: string; phone: string | null; abandonedAt: string }
): boolean {
  const abandonedAtMs = parseDateMs(cart.abandonedAt);
  if (!abandonedAtMs) return false;

  const email = cart.email.toLowerCase().trim();
  const candidates = [
    ...(email ? orders.byEmail.get(email) || [] : []),
    ...(cart.phone ? orders.byPhone.get(cart.phone) || [] : []),
  ];

  return candidates.some((order) => order.purchasedAtMs >= abandonedAtMs);
}

function appendIndex(
  index: Map<string, RecentOrder[]>,
  key: string,
  order: RecentOrder
) {
  const current = index.get(key) || [];
  current.push(order);
  index.set(key, current);
}

function parseDateMs(raw: string | null | undefined): number | null {
  const value = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(value) ? value : null;
}

async function fetchClientContact(
  clientId: number,
  apiToken: string,
  storeHost: string
): Promise<VndaClientContact | null> {
  try {
    const client = await vndaGet<VndaClientResponse>(
      `clients/${clientId}`,
      apiToken,
      storeHost
    );
    const name =
      client.name?.trim() ||
      [client.first_name, client.last_name].filter(Boolean).join(" ").trim() ||
      null;
    const phone = normalizeBrazilianWhatsAppPhone(
      firstPresent(
        joinPhone(client.phone_area, client.phone),
        joinPhone(client.cellphone_area, client.cellphone),
        joinPhone(client.recent_address?.phone_area, client.recent_address?.phone),
        joinPhone(
          client.recent_address?.first_phone_area,
          client.recent_address?.first_phone
        ),
        joinPhone(
          client.recent_address?.second_phone_area,
          client.recent_address?.second_phone
        )
      )
    );
    const state = normalizeBrazilianState(client.recent_address?.state);
    return { name, phone, state, region: regionForState(state) };
  } catch (err) {
    console.warn(
      `[CartRecovery Import] Failed to enrich client ${clientId}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

function joinPhone(
  area?: string | null,
  phone?: string | null
): string | null {
  if (!phone) return null;
  return `${area || ""}${phone}`.trim();
}

function firstPresent(...values: Array<string | null | undefined>): string | null {
  return values.find((v) => !!v?.trim()) || null;
}

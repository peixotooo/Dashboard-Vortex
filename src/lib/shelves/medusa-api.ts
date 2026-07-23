/**
 * Cliente mínimo da loja Medusa (app.bulking.com.br) para o motor de
 * prateleiras. Fonte paralela à VNDA — mesma lógica, torneiras diferentes.
 *
 * Envs (Vercel + .env.local):
 * - MEDUSA_BACKEND_URL        ex.: https://vague-value-wander.medusajs.app
 * - MEDUSA_PUBLISHABLE_KEY    pk_… (Store API pública)
 * - MEDUSA_ADMIN_API_KEY      sk_… (opcional — só p/ bestsellers por vendas;
 *                             sem ela o algoritmo cai no fallback da cadeia)
 * - MEDUSA_STOREFRONT_URL     opcional, default https://app.bulking.com.br
 * - MEDUSA_REGION_ID          opcional, default: região BRL auto-detectada
 */

export interface MedusaEnv {
  backendUrl: string;
  publishableKey: string;
  adminApiKey: string | null;
  storefrontUrl: string;
  regionId: string | null;
}

export interface MedusaCalculatedPrice {
  calculated_amount?: number | null;
  original_amount?: number | null;
  currency_code?: string | null;
}

export interface MedusaVariant {
  id: string;
  title?: string | null;
  sku?: string | null;
  metadata?: Record<string, unknown> | null;
  inventory_quantity?: number | null;
  manage_inventory?: boolean | null;
  allow_backorder?: boolean | null;
  calculated_price?: MedusaCalculatedPrice | null;
}

export interface MedusaImage {
  url?: string | null;
  rank?: number | null;
}

export interface MedusaCategory {
  name?: string | null;
  handle?: string | null;
  rank?: number | null;
  is_active?: boolean | null;
  is_internal?: boolean | null;
}

export interface MedusaProduct {
  id: string;
  handle?: string | null;
  title: string;
  thumbnail?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  metadata?: Record<string, unknown> | null;
  images?: MedusaImage[] | null;
  categories?: MedusaCategory[] | null;
  variants?: MedusaVariant[] | null;
}

export interface MedusaOrderItem {
  product_title?: string | null;
  title?: string | null;
  quantity?: number | null;
  total?: number | null;
  unit_price?: number | null;
}

export interface MedusaOrder {
  id: string;
  created_at?: string | null;
  payment_status?: string | null;
  status?: string | null;
  items?: MedusaOrderItem[] | null;
}

export function getMedusaEnv(): MedusaEnv | null {
  const backendUrl = (process.env.MEDUSA_BACKEND_URL || "").trim().replace(/\/$/, "");
  const publishableKey = (process.env.MEDUSA_PUBLISHABLE_KEY || "").trim();
  if (!backendUrl || !publishableKey) return null;

  return {
    backendUrl,
    publishableKey,
    adminApiKey: (process.env.MEDUSA_ADMIN_API_KEY || "").trim() || null,
    storefrontUrl:
      (process.env.MEDUSA_STOREFRONT_URL || "https://app.bulking.com.br")
        .trim()
        .replace(/\/$/, ""),
    regionId: (process.env.MEDUSA_REGION_ID || "").trim() || null,
  };
}

/** Hostname da loja nova (usado no filtro de GA4). */
export function getMedusaStoreHostname(): string {
  const env = getMedusaEnv();
  try {
    return new URL(env?.storefrontUrl || "https://app.bulking.com.br").hostname;
  } catch {
    return "app.bulking.com.br";
  }
}

async function medusaStoreFetch(
  env: MedusaEnv,
  path: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const url = new URL(`${env.backendUrl}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "x-publishable-api-key": env.publishableKey,
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Medusa Store API ${res.status} ${path}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

/** Região BRL (necessária p/ calculated_price). Cache por invocação. */
let regionPromise: Promise<string | null> | null = null;

export async function getMedusaRegionId(env: MedusaEnv): Promise<string | null> {
  if (env.regionId) return env.regionId;
  if (!regionPromise) {
    regionPromise = (async () => {
      try {
        const data = await medusaStoreFetch(env, "/store/regions", { limit: "20" });
        const regions = (data.regions as Array<{ id: string; currency_code?: string }>) || [];
        const brl = regions.find((r) => (r.currency_code || "").toLowerCase() === "brl");
        return brl?.id || regions[0]?.id || null;
      } catch {
        regionPromise = null;
        return null;
      }
    })();
  }
  return regionPromise;
}

const PRODUCT_FIELDS = [
  "id",
  "handle",
  "title",
  "thumbnail",
  "status",
  "created_at",
  "updated_at",
  "metadata",
  "images.url",
  "images.rank",
  "categories.name",
  "categories.handle",
  "categories.rank",
  "categories.is_active",
  "categories.is_internal",
  "variants.title",
  "variants.sku",
  "variants.metadata",
  "variants.inventory_quantity",
  "variants.manage_inventory",
  "variants.allow_backorder",
  "*variants.calculated_price",
].join(",");

/** Todos os produtos published da Store API (paginado). */
export async function fetchAllMedusaProducts(env: MedusaEnv): Promise<MedusaProduct[]> {
  const regionId = await getMedusaRegionId(env);
  const all: MedusaProduct[] = [];
  const limit = 100;
  let offset = 0;

  // ~237 produtos hoje; trava de segurança em 50 páginas.
  for (let page = 0; page < 50; page++) {
    const params: Record<string, string> = {
      limit: String(limit),
      offset: String(offset),
      fields: PRODUCT_FIELDS,
    };
    if (regionId) params.region_id = regionId;

    const data = await medusaStoreFetch(env, "/store/products", params);
    const products = (data.products as MedusaProduct[]) || [];
    all.push(...products);

    const count = typeof data.count === "number" ? data.count : null;
    offset += products.length;
    if (products.length < limit) break;
    if (count !== null && offset >= count) break;
  }

  return all;
}

/**
 * Pedidos dos últimos N dias via Admin API (vendas reais da loja Medusa).
 * Requer MEDUSA_ADMIN_API_KEY; sem ela (ou com erro), retorna null e o
 * chamador cai no fallback da cadeia — nunca derruba a prateleira.
 */
export async function fetchMedusaOrders(
  env: MedusaEnv,
  days = 7
): Promise<MedusaOrder[] | null> {
  if (!env.adminApiKey) return null;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const basic = Buffer.from(`${env.adminApiKey}:`).toString("base64");
  const all: MedusaOrder[] = [];
  const limit = 100;
  let offset = 0;

  try {
    for (let page = 0; page < 30; page++) {
      const url = new URL(`${env.backendUrl}/admin/orders`);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("order", "-created_at");
      url.searchParams.set(
        "fields",
        "id,created_at,status,payment_status,items.product_title,items.title,items.quantity,items.total,items.unit_price"
      );
      url.searchParams.set("created_at[$gte]", since);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let res: Response;
      try {
        res = await fetch(url.toString(), {
          headers: {
            Accept: "application/json",
            Authorization: `Basic ${basic}`,
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) {
        console.warn(`[MedusaShelves] Admin orders API ${res.status} — fallback`);
        return null;
      }

      const data = (await res.json()) as Record<string, unknown>;
      const orders = (data.orders as MedusaOrder[]) || [];
      all.push(...orders);

      const count = typeof data.count === "number" ? data.count : null;
      offset += orders.length;
      if (orders.length < limit) break;
      if (count !== null && offset >= count) break;
    }
  } catch (err) {
    console.warn(
      `[MedusaShelves] Admin orders fetch failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }

  return all;
}

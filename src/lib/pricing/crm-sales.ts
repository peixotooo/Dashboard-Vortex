import type { SupabaseClient } from "@supabase/supabase-js";
import { baseSkuOf } from "./sku-utils";

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;

export type PricingCrmSaleItem = {
  sku?: string | null;
  reference?: string | null;
  quantity?: number | null;
  price?: number | null;
  total?: number | null;
};

export type PricingCrmSaleRow = {
  data_compra: string | null;
  channel?: string | null;
  items: PricingCrmSaleItem[] | null;
};

export function parsePricingCrmDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("0000")) return null;

  const nativeMs = Date.parse(trimmed);
  if (Number.isFinite(nativeMs)) return new Date(nativeMs);

  const br = trimmed.match(
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

export function saleItemBaseSku(item: PricingCrmSaleItem): string {
  return baseSkuOf((item.sku ?? item.reference ?? "").toString().trim());
}

export function saleItemQuantity(item: PricingCrmSaleItem): number {
  const qty = Number(item.quantity ?? 0);
  return Number.isFinite(qty) && qty > 0 ? qty : 0;
}

export function saleItemRevenue(item: PricingCrmSaleItem): number {
  const qty = saleItemQuantity(item);
  const total = Number(item.total ?? 0);
  if (Number.isFinite(total) && total > 0) return total;
  const price = Number(item.price ?? 0);
  return Number.isFinite(price) && price > 0 && qty > 0 ? price * qty : 0;
}

export async function fetchRecentCrmSalesWithItems(
  client: SupabaseClient,
  workspaceId: string,
  days: number
): Promise<PricingCrmSaleRow[]> {
  const cutoffMs = Date.now() - Math.max(1, days) * DAY_MS;
  const rows: PricingCrmSaleRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await client
      .from("crm_vendas")
      .select("data_compra, channel, items")
      .eq("workspace_id", workspaceId)
      .eq("source", "vnda_webhook")
      .not("items", "is", null)
      .order("data_compra", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`crm_vendas load failed: ${error.message}`);

    const page = (data ?? []) as PricingCrmSaleRow[];
    let pageHasRecent = false;
    for (const row of page) {
      const purchasedAt = parsePricingCrmDate(row.data_compra);
      if (!purchasedAt) continue;
      if (purchasedAt.getTime() >= cutoffMs) {
        rows.push(row);
        pageHasRecent = true;
      }
    }

    if (page.length < PAGE_SIZE || !pageHasRecent) break;
    from += PAGE_SIZE;
  }

  return rows;
}

import { ml } from "./client";

/**
 * Apply promotional price via ML seller-promotions API (PRICE_DISCOUNT).
 * ML requires: publish item at full price first, then apply discount separately.
 *
 * @param delayMs - delay before first attempt (default 0; use 3000 for freshly-published items)
 */
export async function applyPromoPrice(
  mlItemId: string,
  dealPrice: number,
  workspaceId: string,
  { retries = 2, delayMs = 0 }: { retries?: number; delayMs?: number } = {}
): Promise<{ applied: boolean; error?: string }> {
  if (delayMs > 0) {
    await new Promise((r) => setTimeout(r, delayMs));
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // start_date = yesterday so ML activates immediately (status "started")
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const finish = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // max 14 days
      await ml.post(
        `/seller-promotions/items/${mlItemId}?app_version=v2`,
        {
          deal_price: dealPrice,
          promotion_type: "PRICE_DISCOUNT",
          start_date: yesterday.toISOString().split("T")[0] + "T00:00:00",
          finish_date: finish.toISOString().split("T")[0] + "T23:59:59",
        },
        workspaceId
      );
      return { applied: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro promo";
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
        continue;
      }
      return { applied: false, error: message };
    }
  }
  return { applied: false, error: "Exhausted retries" };
}

/**
 * Remove promotional price from an ML item.
 * Uses DELETE /seller-promotions/items/{mlItemId}.
 */
export async function removePromoPrice(
  mlItemId: string,
  workspaceId: string
): Promise<{ removed: boolean; error?: string }> {
  try {
    await ml.del(`/seller-promotions/items/${mlItemId}`, workspaceId);
    return { removed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao remover promo";
    return { removed: false, error: message };
  }
}

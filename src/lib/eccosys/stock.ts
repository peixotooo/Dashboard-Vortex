export const ECCOSYS_STOCK_BULK_COUNT = "5000";

export function eccosysStockBulkParams(
  params?: Record<string, string>
): Record<string, string> {
  return {
    ...params,
    $offset: "0",
    $count: ECCOSYS_STOCK_BULK_COUNT,
  };
}

export function parseEccosysStockBulkResponse<T>(payload: unknown): T[] {
  if (!Array.isArray(payload)) {
    throw new Error("Eccosys retornou um snapshot de estoque invalido.");
  }
  return payload as T[];
}

export function normalizeEccosysStockQuantity(value: unknown): number {
  const quantity = Number(value);
  return Number.isFinite(quantity) ? quantity : 0;
}

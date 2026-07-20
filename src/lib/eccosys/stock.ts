export const ECCOSYS_STOCK_BULK_PAGE_SIZE = 5000;

export function eccosysStockBulkParams(
  params?: Record<string, string>,
  offset = 0
): Record<string, string> {
  return {
    ...params,
    $offset: String(offset),
    $count: String(ECCOSYS_STOCK_BULK_PAGE_SIZE),
  };
}

export function shouldContinueEccosysStockBulk(rowCount: number): boolean {
  return rowCount === ECCOSYS_STOCK_BULK_PAGE_SIZE;
}

export function parseEccosysStockBulkResponse<T>(payload: unknown): T[] {
  if (!Array.isArray(payload)) {
    throw new Error("Eccosys retornou um snapshot de estoque invalido.");
  }
  return payload as T[];
}

export async function collectEccosysStockBulkPages<T>(
  fetchPage: (offset: number) => Promise<unknown>
): Promise<{ rows: T[]; requestCount: number }> {
  const rows: T[] = [];
  const seenBoundaries = new Set<string>();
  let offset = 0;
  let requestCount = 0;

  while (true) {
    const page = parseEccosysStockBulkResponse<T>(await fetchPage(offset));
    requestCount++;

    if (page.length > 0) {
      const boundary = JSON.stringify([page[0], page[page.length - 1], page.length]);
      if (seenBoundaries.has(boundary)) {
        throw new Error("Eccosys repetiu uma pagina do snapshot de estoque.");
      }
      seenBoundaries.add(boundary);
      rows.push(...page);
    }

    if (!shouldContinueEccosysStockBulk(page.length)) break;
    offset += ECCOSYS_STOCK_BULK_PAGE_SIZE;
  }

  return { rows, requestCount };
}

export function normalizeEccosysStockQuantity(value: unknown): number {
  const quantity = Number(value);
  return Number.isFinite(quantity) ? quantity : 0;
}

type EccosysStockRecordLike = {
  codigo?: unknown;
  estoqueDisponivel?: unknown;
  estoqueReal?: unknown;
  idProduto?: unknown;
  nome?: unknown;
};

function isInactiveStockRecord(record: EccosysStockRecordLike): boolean {
  const name = String(record.nome ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return name.includes("excluid") || name.includes("desativad");
}

function isPreferredStockRecord(
  candidate: EccosysStockRecordLike,
  current: EccosysStockRecordLike
): boolean {
  const candidateActive = !isInactiveStockRecord(candidate);
  const currentActive = !isInactiveStockRecord(current);
  if (candidateActive !== currentActive) return candidateActive;

  const candidateAvailable = normalizeEccosysStockQuantity(candidate.estoqueDisponivel);
  const currentAvailable = normalizeEccosysStockQuantity(current.estoqueDisponivel);
  if (candidateAvailable !== currentAvailable) return candidateAvailable > currentAvailable;

  const candidateReal = normalizeEccosysStockQuantity(candidate.estoqueReal);
  const currentReal = normalizeEccosysStockQuantity(current.estoqueReal);
  if (candidateReal !== currentReal) return candidateReal > currentReal;

  return Number(candidate.idProduto) > Number(current.idProduto);
}

export function indexEccosysStocks<T extends EccosysStockRecordLike>(stocks: T[]): {
  bySku: Map<string, T>;
  byProductId: Map<number, T>;
} {
  const bySku = new Map<string, T>();
  const byProductId = new Map<number, T>();

  for (const stock of stocks) {
    const sku = String(stock.codigo ?? "").trim();
    const rawProductId = String(stock.idProduto ?? "").trim();
    const productId = Number(rawProductId);
    if (rawProductId && Number.isFinite(productId)) byProductId.set(productId, stock);
    if (!sku) continue;

    const current = bySku.get(sku);
    if (!current || isPreferredStockRecord(stock, current)) {
      bySku.set(sku, stock);
    }
  }

  return { bySku, byProductId };
}

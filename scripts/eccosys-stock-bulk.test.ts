import assert from "node:assert/strict";
import test from "node:test";

import {
  ECCOSYS_STOCK_BULK_COUNT,
  eccosysStockBulkParams,
  normalizeEccosysStockQuantity,
  parseEccosysStockBulkResponse,
} from "../src/lib/eccosys/stock.ts";

test("builds one stock snapshot query from offset zero", () => {
  assert.deepEqual(
    eccosysStockBulkParams({ $offset: "800", $count: "100", data: "2026-07-19" }),
    {
      $offset: "0",
      $count: ECCOSYS_STOCK_BULK_COUNT,
      data: "2026-07-19",
    }
  );
});

test("keeps the complete bulk response without pagination or truncation", () => {
  const snapshot = Array.from({ length: 12_576 }, (_, index) => ({
    codigo: `SKU-${index + 1}`,
  }));

  const parsed = parseEccosysStockBulkResponse<{ codigo: string }>(snapshot);

  assert.equal(parsed.length, 12_576);
  assert.equal(parsed[12_575].codigo, "SKU-12576");
});

test("rejects malformed stock snapshots", () => {
  assert.throws(
    () => parseEccosysStockBulkResponse({ rows: [] }),
    /snapshot de estoque invalido/
  );
});

test("normalizes numeric strings returned by Eccosys", () => {
  assert.equal(normalizeEccosysStockQuantity("20"), 20);
  assert.equal(normalizeEccosysStockQuantity(-3), -3);
  assert.equal(normalizeEccosysStockQuantity("sem estoque"), 0);
});

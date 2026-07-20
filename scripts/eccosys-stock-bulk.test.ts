import assert from "node:assert/strict";
import test from "node:test";

import {
  ECCOSYS_STOCK_BULK_PAGE_SIZE,
  collectEccosysStockBulkPages,
  eccosysStockBulkParams,
  indexEccosysStocks,
  normalizeEccosysStockQuantity,
  parseEccosysStockBulkResponse,
  shouldContinueEccosysStockBulk,
} from "../src/lib/eccosys/stock.ts";

test("builds a large stock page query at the requested offset", () => {
  assert.deepEqual(
    eccosysStockBulkParams(
      { $offset: "800", $count: "100", data: "2026-07-19" },
      5000
    ),
    {
      $offset: "5000",
      $count: String(ECCOSYS_STOCK_BULK_PAGE_SIZE),
      data: "2026-07-19",
    }
  );
});

test("continues only while Eccosys fills an entire 5000-row page", () => {
  assert.equal(shouldContinueEccosysStockBulk(5000), true);
  assert.equal(shouldContinueEccosysStockBulk(2576), false);
  assert.equal(shouldContinueEccosysStockBulk(12_576), false);
});

test("collects 12576 rows in three large requests", async () => {
  const snapshot = Array.from({ length: 12_576 }, (_, index) => ({
    codigo: `SKU-${index + 1}`,
  }));
  const offsets: number[] = [];

  const result = await collectEccosysStockBulkPages<{ codigo: string }>((offset) => {
    offsets.push(offset);
    return Promise.resolve(snapshot.slice(offset, offset + ECCOSYS_STOCK_BULK_PAGE_SIZE));
  });

  assert.deepEqual(offsets, [0, 5000, 10000]);
  assert.equal(result.requestCount, 3);
  assert.equal(result.rows.length, 12_576);
  assert.equal(result.rows[12_575].codigo, "SKU-12576");
});

test("accepts an endpoint response larger than the requested page", async () => {
  const snapshot = Array.from({ length: 12_576 }, (_, index) => ({ codigo: String(index) }));
  let calls = 0;

  const result = await collectEccosysStockBulkPages<{ codigo: string }>(async () => {
    calls++;
    return snapshot;
  });

  assert.equal(calls, 1);
  assert.equal(result.rows.length, 12_576);
});

test("stops when Eccosys repeats the same full page", async () => {
  const page = Array.from({ length: ECCOSYS_STOCK_BULK_PAGE_SIZE }, (_, index) => ({
    codigo: String(index),
  }));

  await assert.rejects(
    collectEccosysStockBulkPages(async () => page),
    /repetiu uma pagina/
  );
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

test("indexes every product id and selects the active canonical row per SKU", () => {
  const activePositive = {
    codigo: "256390596-1",
    idProduto: "260275652",
    nome: "CAMISETA DRY FLEXING BLACK P",
    estoqueReal: "6",
    estoqueDisponivel: "5",
  };
  const excluded = {
    codigo: "256390596-1",
    idProduto: "259927712",
    nome: "excluido",
    estoqueReal: 0,
    estoqueDisponivel: 0,
  };
  const activeNegative = {
    codigo: "256392838-1",
    idProduto: "1758500497",
    nome: "CAMISETA OVERSIZED LEG DAY PRETA P",
    estoqueReal: -44,
    estoqueDisponivel: -44,
  };
  const disabledZero = {
    codigo: "256392838-1",
    idProduto: "1758423611",
    nome: "DESATIVADO",
    estoqueReal: 0,
    estoqueDisponivel: 0,
  };

  const indexed = indexEccosysStocks([
    activePositive,
    excluded,
    activeNegative,
    disabledZero,
  ]);

  assert.equal(indexed.bySku.get("256390596-1"), activePositive);
  assert.equal(indexed.bySku.get("256392838-1"), activeNegative);
  assert.equal(indexed.byProductId.size, 4);
  assert.equal(indexed.byProductId.get(259927712), excluded);
});

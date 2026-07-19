import assert from "node:assert/strict";
import test from "node:test";
import { buildPspPlan } from "../src/lib/psp/engine.ts";
import { PSP_DEFAULT_SETTINGS } from "../src/lib/psp/defaults.ts";
import type { PspEngineInput, PspSaleItem } from "../src/lib/psp/types.ts";

function sale(
  daysAgo: number,
  sku: string,
  quantity: number,
  price = 100,
  name = "CAMISETA TESTE PRETA",
  size = "M"
) {
  const item: PspSaleItem = {
    sku: `${sku}-2`,
    reference: sku,
    name,
    variant_name: `${name} ${size}`,
    attribute1: size,
    quantity,
    price,
    total: price * quantity,
  };
  return {
    data_compra: new Date(Date.UTC(2026, 6, 20) - daysAgo * 86_400_000).toISOString(),
    items: [item],
  };
}

function baseInput(overrides: Partial<PspEngineInput> = {}): PspEngineInput {
  return {
    now: new Date("2026-07-20T12:00:00.000Z"),
    settings: { ...PSP_DEFAULT_SETTINGS, family_yields: { ...PSP_DEFAULT_SETTINGS.family_yields } },
    productSettings: [],
    sales: [],
    inventory: [],
    hub: [],
    catalog: [],
    costs: [],
    launches: [],
    financial: { product_cost_pct: 25, tax_pct: 6, other_expenses_pct: 5 },
    ...overrides,
  };
}

test("uses the canonical Eccosys variation once instead of summing duplicate ML listings", () => {
  const input = baseInput({
    sales: [sale(1, "100", 30), sale(10, "100", 30)],
    hub: [
      { sku: "100-2", ecc_id: 2, ecc_pai_sku: "100", nome: "M", estoque: 20, sob_demanda: false, atributos: { Tamanho: "M" } },
      { sku: "ML-ONE", ecc_id: 2, ecc_pai_sku: "100", nome: "M", estoque: 20, sob_demanda: false, atributos: { size: "M" } },
      { sku: "ML-TWO", ecc_id: 2, ecc_pai_sku: "100", nome: "M", estoque: 20, sob_demanda: false, atributos: { size: "M" } },
    ],
  });

  const plan = buildPspPlan(input);
  const product = plan.products.find((row) => row.sku === "100");
  assert.equal(product?.stock_units, 20);
  assert.equal(plan.data_quality.inventory_source, "hub_fallback");
});

test("rounds a production recommendation to a full fabric roll and allocates its grade", () => {
  const input = baseInput({
    sales: [sale(1, "200", 5, 100, "CAMISETA TESTE PRETA", "P"), sale(8, "200", 10, 100, "CAMISETA TESTE PRETA", "G")],
    inventory: [
      { sku: "200-1", parent_sku: "200", name: "P", stock_real: 0, stock_available: 0, captured_at: "2026-07-20T11:00:00.000Z" },
      { sku: "200-3", parent_sku: "200", name: "G", stock_real: 0, stock_available: 0, captured_at: "2026-07-20T11:00:00.000Z" },
    ],
    costs: [{ sku: "200", cost: 25 }],
  });

  const action = buildPspPlan(input).actions.find((row) => row.kind === "produce");
  assert.ok(action);
  assert.equal(action.recommended_units % 60, 0);
  assert.equal(action.recommended_rolls, action.recommended_units / 60);
  assert.equal(action.grade.reduce((sum, row) => sum + row.units, 0), action.recommended_units);
});

test("surfaces a fast-growing launch even when it is not yet an A item", () => {
  const steady = Array.from({ length: 6 }, (_, index) => sale(index + 1, "A", 12, 100, "CAMISETA CAMPEA BRANCA"));
  const launchSales = [sale(1, "NEW", 8, 100, "CAMISETA LANCAMENTO ROSA")];
  const plan = buildPspPlan(baseInput({
    sales: [...steady, ...launchSales],
    inventory: [
      { sku: "A-2", parent_sku: "A", stock_real: 500, stock_available: 500, captured_at: "2026-07-20T11:00:00.000Z" },
      { sku: "NEW-2", parent_sku: "NEW", stock_real: 0, stock_available: 0, captured_at: "2026-07-20T11:00:00.000Z" },
    ],
    launches: [{ sku: "NEW", launch_date: "2026-07-15" }],
  }));

  const product = plan.products.find((row) => row.sku === "new");
  assert.equal(product?.momentum, true);
  assert.equal(product?.launch_age_days, 5);
  assert.ok(plan.actions.some((row) => row.sku === "new" && row.reasons.some((reason) => reason.includes("Lançamento"))));
});

test("keeps the selected plan inside both roll and cash limits", () => {
  const plan = buildPspPlan(baseInput({
    settings: {
      ...PSP_DEFAULT_SETTINGS,
      family_yields: { ...PSP_DEFAULT_SETTINGS.family_yields },
      max_rolls_per_order: 2,
      cash_budget_brl: 3_000,
    },
    sales: [sale(1, "300", 40), sale(2, "400", 30)],
    inventory: [
      { sku: "300-2", parent_sku: "300", stock_real: 0, stock_available: 0, captured_at: "2026-07-20T11:00:00.000Z" },
      { sku: "400-2", parent_sku: "400", stock_real: 0, stock_available: 0, captured_at: "2026-07-20T11:00:00.000Z" },
    ],
    costs: [{ sku: "300", cost: 25 }, { sku: "400", cost: 25 }],
  }));

  assert.ok(plan.summary.selected_rolls <= 2);
  assert.ok(plan.summary.selected_investment_brl <= 3_000);
  assert.ok(plan.summary.required_rolls > plan.summary.selected_rolls);
});

test("blocks an on-demand preproduction plan until its blank base is mapped", () => {
  const plan = buildPspPlan(baseInput({
    sales: [sale(1, "500", 12), sale(8, "500", 10)],
    hub: [
      { sku: "500-2", ecc_pai_sku: "500", nome: "CAMISETA SD PRETA M", estoque: 100, sob_demanda: true, atributos: { Tamanho: "M" } },
    ],
  }));
  const baseAction = plan.actions.find((row) => row.kind === "map_base");
  const preproduction = plan.actions.find((row) => row.kind === "preproduce");
  assert.ok(baseAction);
  assert.equal(baseAction.excluded_reason, "mapping");
  assert.equal(preproduction?.selected, false);
  assert.equal(preproduction?.excluded_reason, "mapping");
});

test("keeps different blank-base SKUs separate even for the same family and color", () => {
  const plan = buildPspPlan(baseInput({
    sales: [
      sale(1, "501", 12, 100, "CAMISETA OVERSIZED PRETA"),
      sale(1, "502", 10, 100, "CAMISETA CLASSIC PRETA"),
    ],
    hub: [
      { sku: "501-2", ecc_pai_sku: "501", nome: "CAMISETA OVERSIZED PRETA M", estoque: 100, sob_demanda: true, atributos: { Tamanho: "M" } },
      { sku: "502-2", ecc_pai_sku: "502", nome: "CAMISETA CLASSIC PRETA M", estoque: 100, sob_demanda: true, atributos: { Tamanho: "M" } },
    ],
    inventory: [
      { sku: "base-oversized", parent_sku: "base-oversized", name: "CAMISETA BASE OVERSIZED PRETA", stock_real: 0, stock_available: 0, captured_at: "2026-07-20T11:00:00.000Z" },
      { sku: "base-classic", parent_sku: "base-classic", name: "CAMISETA BASE CLASSIC PRETA", stock_real: 0, stock_available: 0, captured_at: "2026-07-20T11:00:00.000Z" },
    ],
    productSettings: [
      { sku: "501", family: "camiseta", color: "preto", units_per_roll: 60, lead_time_days: null, base_sku: "base-oversized", made_to_order_override: true, active: true },
      { sku: "502", family: "camiseta", color: "preto", units_per_roll: 60, lead_time_days: null, base_sku: "base-classic", made_to_order_override: true, active: true },
    ],
  }));

  const bases = plan.actions.filter((row) => row.kind === "prepare_base");
  assert.deepEqual(
    bases.map((row) => row.base_sku).sort(),
    ["base-classic", "base-oversized"]
  );
  assert.ok(bases.every((row) => row.allocations?.length === 1));
});

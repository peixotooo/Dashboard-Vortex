import type {
  PspAction,
  PspCatalogRow,
  PspEngineInput,
  PspFamily,
  PspGradeItem,
  PspHubRow,
  PspInventoryRow,
  PspPlan,
  PspProductSetting,
  PspSaleItem,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const STANDARD_SIZES = ["PP", "P", "M", "G", "GG", "XGG", "G1", "G2", "G3"];

type ProductSales = {
  sku: string;
  name: string;
  units7: number;
  units30: number;
  previous23: number;
  revenue30: number;
  sizeSales: Map<string, number>;
  exactSkuSales: Map<string, number>;
  priceRevenue: number;
  priceUnits: number;
};

type StockContext = {
  byParent: Map<string, number>;
  byExact: Map<string, number>;
  names: Map<string, string>;
  capturedAt: string | null;
};

type HubContext = {
  madeToOrder: Set<string>;
  stockByParent: Map<string, number>;
  sizeByExact: Map<string, string>;
  nameByParent: Map<string, string>;
};

type ProductDraft = {
  sku: string;
  name: string;
  family: PspFamily;
  color: string;
  abc: "A" | "B" | "C";
  madeToOrder: boolean;
  unitsPerRoll: number;
  leadDays: number;
  baseSku: string | null;
  stockSource: "eccosys" | "hub_fallback" | "none";
  stock: number | null;
  sizeStock: Map<string, number>;
  units7: number;
  units30: number;
  revenue30: number;
  forecastDaily: number;
  growthPct: number | null;
  momentum: boolean;
  launchAgeDays: number | null;
  avgPrice: number;
  unitCost: number | null;
  costTracked: boolean;
  unitMargin: number;
  sizeSales: Map<string, number>;
};

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizeSku(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function baseSku(value: string | null | undefined): string {
  return normalizeSku(value).replace(/-\d+$/, "");
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function inferPspFamily(name: string, category?: string | null): PspFamily {
  const text = normalizeText(`${name} ${category ?? ""}`);
  if (/\b(regata|tank)\b/.test(text)) return "regata";
  if (/\b(polo)\b/.test(text)) return "polo";
  if (/\b(bermuda|short|shorts)\b/.test(text)) return "bermuda";
  if (/\b(calca|jogger)\b/.test(text)) return "calca";
  if (/\b(blusao)\b/.test(text)) return "blusao";
  if (/\b(moletom|hoodie)\b/.test(text)) return "moletom";
  if (/\b(jaqueta|corta vento)\b/.test(text)) return "jaqueta";
  if (/\b(bone|meia|carteira|bolsa|mochila|acessorio)\b/.test(text)) return "acessorio";
  if (/\b(camiseta|camisa|cropped)\b/.test(text)) return "camiseta";
  return "outro";
}

export function isPspOnDemandFamily(
  family: PspFamily
): family is "camiseta" | "regata" {
  return family === "camiseta" || family === "regata";
}

const COLOR_PATTERNS: Array<[RegExp, string]> = [
  [/\boff white\b|\boff\b/, "off"],
  [/\bazul marinho\b|\bmarinho\b|\bnavy\b/, "marinho"],
  [/\bazul claro\b/, "azul claro"],
  [/\bazul diesel\b/, "azul diesel"],
  [/\bverde militar\b/, "verde militar"],
  [/\bverde oliva\b|\boliva\b/, "oliva"],
  [/\bcinza chumbo\b|\bchumbo\b/, "cinza"],
  [/\bcinza mescla\b|\bmescla\b/, "mescla"],
  [/\bbordo\b|\bbordeaux\b/, "bordo"],
  [/\bpret[oa]\b|\bblack\b|\bbk\b/, "preto"],
  [/\bbranc[oa]\b|\bwhite\b/, "branco"],
  [/\bcinz[ao]\b|\bgrey\b|\bgray\b/, "cinza"],
  [/\bbege\b|\bbeige\b/, "bege"],
  [/\bmarrom\b|\bbrown\b/, "marrom"],
  [/\bverde\b|\bgreen\b/, "verde"],
  [/\bazul\b|\bblue\b/, "azul"],
  [/\bvermelh[oa]\b|\bred\b/, "vermelho"],
  [/\brosa\b|\bpink\b/, "rosa"],
  [/\brox[oa]\b|\bpurple\b/, "roxo"],
  [/\blilas\b/, "lilas"],
  [/\blaranj[ao]\b|\borange\b/, "laranja"],
  [/\bamarel[oa]\b|\byellow\b/, "amarelo"],
  [/\bcamuflad[oa]\b/, "camuflado"],
];

export function normalizePspColor(value: string | null | undefined): string {
  const color = normalizeText(value);
  if (!color) return "sem cor";
  if (color === "chumbo" || color === "cinza chumbo") return "cinza";
  return color;
}

export function inferPspColor(name: string): string {
  const text = normalizeText(name);
  for (const [pattern, color] of COLOR_PATTERNS) {
    if (pattern.test(text)) return color;
  }
  return "sem cor";
}

function normalizeSize(value: unknown): string | null {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return null;
  const cleaned = raw.replace(/[^A-Z0-9]/g, "");
  if (STANDARD_SIZES.includes(cleaned)) return cleaned;
  return null;
}

function sizeFromAttributes(attributes: Record<string, unknown> | null | undefined): string | null {
  if (!attributes) return null;
  for (const [key, value] of Object.entries(attributes)) {
    if (/size|tamanho/i.test(key)) {
      const size = normalizeSize(value);
      if (size) return size;
    }
  }
  return null;
}

function sizeFromItem(item: PspSaleItem): string | null {
  for (const value of [item.attribute1, item.attribute2, item.attribute3]) {
    const size = normalizeSize(value);
    if (size) return size;
  }
  const variant = String(item.variant_name ?? "");
  const match = variant.match(/(?:^|\s)(PP|P|M|G|GG|XGG|G1|G2|G3)\s*$/i);
  return normalizeSize(match?.[1]);
}

function fallbackSizeFromSku(sku: string): string | null {
  const suffix = normalizeSku(sku).match(/-(\d+)$/)?.[1];
  const map: Record<string, string> = { "0": "PP", "1": "P", "2": "M", "3": "G", "4": "GG", "5": "XGG" };
  return suffix ? map[suffix] ?? null : null;
}

function productParentSku(item: PspSaleItem): string {
  const reference = baseSku(item.reference);
  return reference || baseSku(item.sku);
}

function itemQuantity(item: PspSaleItem): number {
  const quantity = finite(item.quantity);
  return quantity > 0 ? quantity : 0;
}

function itemRevenue(item: PspSaleItem): number {
  const quantity = itemQuantity(item);
  const total = finite(item.total);
  if (total > 0) return total;
  return Math.max(0, finite(item.price) * quantity);
}

function getCatalogMap(rows: PspCatalogRow[]): Map<string, PspCatalogRow> {
  const out = new Map<string, PspCatalogRow>();
  for (const row of rows) {
    const key = baseSku(row.sku);
    if (!key || row.active === false) continue;
    const current = out.get(key);
    if (!current || (!current.sale_price && row.sale_price)) out.set(key, row);
  }
  return out;
}

function getProductSettings(rows: PspProductSetting[]): Map<string, PspProductSetting> {
  const out = new Map<string, PspProductSetting>();
  for (const row of rows) {
    const key = baseSku(row.sku);
    if (key) out.set(key, row);
  }
  return out;
}

function buildHubContext(rows: PspHubRow[]): HubContext {
  type Group = {
    canonical: Map<string, number>;
    alternatives: Map<string, number>;
    parentStock: number | null;
  };

  const madeToOrder = new Set<string>();
  const sizeByExact = new Map<string, string>();
  const nameByParent = new Map<string, string>();
  const groups = new Map<string, Group>();

  for (const row of rows) {
    const exact = normalizeSku(row.sku);
    const parent = baseSku(row.ecc_pai_sku) || baseSku(exact);
    if (!parent) continue;
    if (row.sob_demanda) madeToOrder.add(parent);
    if (row.nome && !nameByParent.has(parent)) nameByParent.set(parent, row.nome);

    const size = sizeFromAttributes(row.atributos) || fallbackSizeFromSku(exact);
    if (size && exact) sizeByExact.set(exact, size);

    const group = groups.get(parent) ?? {
      canonical: new Map<string, number>(),
      alternatives: new Map<string, number>(),
      parentStock: null,
    };
    const stock = Math.max(0, finite(row.estoque));

    if (row.ecc_pai_sku) {
      const isCanonical = !exact.startsWith("ml-") && baseSku(exact) === parent;
      if (isCanonical) {
        group.canonical.set(exact, Math.max(group.canonical.get(exact) ?? 0, stock));
      } else {
        const dedupeKey = row.ecc_id != null ? `id:${row.ecc_id}` : size ? `size:${size}` : exact;
        group.alternatives.set(
          dedupeKey,
          Math.max(group.alternatives.get(dedupeKey) ?? 0, stock)
        );
      }
    } else {
      group.parentStock = Math.max(group.parentStock ?? 0, stock);
    }
    groups.set(parent, group);
  }

  const stockByParent = new Map<string, number>();
  for (const [parent, group] of groups) {
    if (group.canonical.size > 0) {
      stockByParent.set(parent, [...group.canonical.values()].reduce((sum, value) => sum + value, 0));
    } else if (group.alternatives.size > 0) {
      stockByParent.set(parent, [...group.alternatives.values()].reduce((sum, value) => sum + value, 0));
    } else if (group.parentStock != null) {
      stockByParent.set(parent, group.parentStock);
    }
  }

  return { madeToOrder, stockByParent, sizeByExact, nameByParent };
}

function buildInventoryContext(rows: PspInventoryRow[]): StockContext {
  const timestamps = rows
    .map((row) => parseDate(row.captured_at)?.getTime() ?? 0)
    .filter((value) => value > 0);
  const latest = timestamps.length > 0 ? Math.max(...timestamps) : 0;
  const batchFloor = latest - 2 * 60 * 60 * 1000;
  const currentRows = latest > 0
    ? rows.filter((row) => (parseDate(row.captured_at)?.getTime() ?? 0) >= batchFloor)
    : [];

  type Group = { parent: number | null; children: Map<string, number> };
  const groups = new Map<string, Group>();
  const byExact = new Map<string, number>();
  const names = new Map<string, string>();

  for (const row of currentRows) {
    const exact = normalizeSku(row.sku);
    const parent = baseSku(row.parent_sku) || baseSku(exact);
    if (!exact || !parent) continue;
    const stock = Math.max(0, finite(row.stock_available));
    byExact.set(exact, stock);
    if (row.name && !names.has(parent)) names.set(parent, row.name);

    const group = groups.get(parent) ?? { parent: null, children: new Map<string, number>() };
    if (exact !== parent) group.children.set(exact, stock);
    else group.parent = stock;
    groups.set(parent, group);
  }

  const byParent = new Map<string, number>();
  for (const [parent, group] of groups) {
    const value =
      group.children.size > 0
        ? [...group.children.values()].reduce((sum, stock) => sum + stock, 0)
        : group.parent;
    if (value != null) byParent.set(parent, value);
  }

  return {
    byParent,
    byExact,
    names,
    capturedAt: latest > 0 ? new Date(latest).toISOString() : null,
  };
}

function buildSales(input: PspEngineInput, exactSizeMap: Map<string, string>): Map<string, ProductSales> {
  const now = (input.now ?? new Date()).getTime();
  const start7 = now - 7 * DAY_MS;
  const start30 = now - 30 * DAY_MS;
  const out = new Map<string, ProductSales>();

  for (const row of input.sales) {
    const purchasedAt = parseDate(row.data_compra)?.getTime() ?? 0;
    if (purchasedAt < start30 || purchasedAt > now + DAY_MS) continue;
    for (const item of Array.isArray(row.items) ? row.items : []) {
      const sku = productParentSku(item);
      const quantity = itemQuantity(item);
      if (!sku || quantity <= 0) continue;

      const current = out.get(sku) ?? {
        sku,
        name: String(item.name ?? sku).trim() || sku,
        units7: 0,
        units30: 0,
        previous23: 0,
        revenue30: 0,
        sizeSales: new Map<string, number>(),
        exactSkuSales: new Map<string, number>(),
        priceRevenue: 0,
        priceUnits: 0,
      };
      const revenue = itemRevenue(item);
      current.units30 += quantity;
      current.revenue30 += revenue;
      current.priceRevenue += revenue;
      current.priceUnits += quantity;
      if (purchasedAt >= start7) current.units7 += quantity;
      else current.previous23 += quantity;

      const exact = normalizeSku(item.sku);
      const size = sizeFromItem(item) || exactSizeMap.get(exact) || fallbackSizeFromSku(exact);
      if (size) current.sizeSales.set(size, (current.sizeSales.get(size) ?? 0) + quantity);
      if (exact) current.exactSkuSales.set(exact, (current.exactSkuSales.get(exact) ?? 0) + quantity);
      out.set(sku, current);
    }
  }
  return out;
}

function classifyAbc(sales: Map<string, ProductSales>): Map<string, "A" | "B" | "C"> {
  const ordered = [...sales.values()].sort((a, b) => b.revenue30 - a.revenue30);
  const total = ordered.reduce((sum, row) => sum + row.revenue30, 0);
  let cumulative = 0;
  const out = new Map<string, "A" | "B" | "C">();
  for (const row of ordered) {
    cumulative += row.revenue30;
    const share = total > 0 ? cumulative / total : 1;
    out.set(row.sku, share <= 0.7 ? "A" : share <= 0.9 ? "B" : "C");
  }
  return out;
}

function getCost(
  sku: string,
  sales: ProductSales,
  costMap: Map<string, number>,
  fallbackPct: number
): { value: number | null; tracked: boolean } {
  const parent = costMap.get(sku);
  if (parent != null) return { value: parent, tracked: true };

  let weightedCost = 0;
  let weightedUnits = 0;
  for (const [exact, units] of sales.exactSkuSales) {
    const cost = costMap.get(exact);
    if (cost == null) continue;
    weightedCost += cost * units;
    weightedUnits += units;
  }
  if (weightedUnits > 0) return { value: weightedCost / weightedUnits, tracked: true };

  const avgPrice = sales.priceUnits > 0 ? sales.priceRevenue / sales.priceUnits : 0;
  return avgPrice > 0
    ? { value: avgPrice * clamp(fallbackPct / 100, 0, 1), tracked: false }
    : { value: null, tracked: false };
}

function sizeSort(a: string, b: string): number {
  const ai = STANDARD_SIZES.indexOf(a);
  const bi = STANDARD_SIZES.indexOf(b);
  if (ai >= 0 && bi >= 0) return ai - bi;
  if (ai >= 0) return -1;
  if (bi >= 0) return 1;
  return a.localeCompare(b, "pt-BR");
}

function allocateGrade(
  units: number,
  salesBySize: Map<string, number>,
  stockBySize: Map<string, number>
): PspGradeItem[] {
  if (units <= 0) return [];
  const observed = [...salesBySize.keys()].sort(sizeSort);
  const sizes = observed.length > 0 ? observed : ["P", "M", "G", "GG", "XGG"];
  const weights = sizes.map((size) => Math.max(0, salesBySize.get(size) ?? 0) + 0.25);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const raw = weights.map((weight) => (weight / totalWeight) * units);
  const allocated = raw.map(Math.floor);
  let remainder = units - allocated.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);
  for (let index = 0; index < remainder; index += 1) {
    allocated[order[index % order.length].index] += 1;
  }

  return sizes.map((size, index) => ({
    size,
    units: allocated[index],
    share_pct: round((weights[index] / totalWeight) * 100, 1),
    sold_30d: round(salesBySize.get(size) ?? 0, 0),
    stock_units: stockBySize.has(size) ? stockBySize.get(size)! : null,
  }));
}

function actionSeverity(coverage: number | null, leadDays: number, momentum: boolean) {
  if (coverage != null && coverage <= leadDays) return "critical" as const;
  if (coverage != null && coverage <= leadDays + 7) return "high" as const;
  if (momentum) return "high" as const;
  return "watch" as const;
}

function stockBySizeForProduct(
  sku: string,
  sales: ProductSales,
  stock: StockContext,
  exactSizeMap: Map<string, string>
): Map<string, number> {
  const out = new Map<string, number>();
  for (const exact of new Set([...sales.exactSkuSales.keys(), ...stock.byExact.keys()])) {
    if (baseSku(exact) !== sku) continue;
    const size = exactSizeMap.get(exact) || fallbackSizeFromSku(exact);
    if (!size || !stock.byExact.has(exact)) continue;
    out.set(size, (out.get(size) ?? 0) + (stock.byExact.get(exact) ?? 0));
  }
  return out;
}

function priorityScore(input: {
  abc: "A" | "B" | "C";
  coverage: number | null;
  leadDays: number;
  marginRisk: number;
  momentum: boolean;
  launch: boolean;
  madeToOrder: boolean;
}): number {
  let score = input.abc === "A" ? 18 : input.abc === "B" ? 12 : 5;
  if (input.coverage == null) score += 4;
  else if (input.coverage <= 0) score += 40;
  else if (input.coverage <= input.leadDays) score += 35;
  else if (input.coverage <= input.leadDays + 7) score += 25;
  else if (input.coverage <= 30) score += 12;
  score += Math.min(18, Math.log10(1 + Math.max(0, input.marginRisk)) * 5);
  if (input.momentum) score += 18;
  if (input.launch) score += 10;
  if (input.madeToOrder && input.abc === "A") score += 5;
  return round(clamp(score, 0, 100), 1);
}

function bestAbc(values: Array<"A" | "B" | "C">): "A" | "B" | "C" {
  if (values.includes("A")) return "A";
  if (values.includes("B")) return "B";
  return "C";
}

function mergeGrade(grades: PspGradeItem[]): PspGradeItem[] {
  const out = new Map<string, PspGradeItem>();
  for (const item of grades) {
    const current = out.get(item.size) ?? {
      size: item.size,
      units: 0,
      share_pct: 0,
      sold_30d: 0,
      stock_units: null,
    };
    current.units += item.units;
    current.sold_30d += item.sold_30d;
    out.set(item.size, current);
  }
  const total = [...out.values()].reduce((sum, item) => sum + item.units, 0);
  return [...out.values()]
    .sort((a, b) => sizeSort(a.size, b.size))
    .map((item) => ({ ...item, share_pct: total > 0 ? round((item.units / total) * 100, 1) : 0 }));
}

function pickAutoBase(
  family: PspFamily,
  color: string,
  stock: StockContext,
  soldSkus: Set<string>
): string | null {
  const candidates: Array<{ sku: string; score: number }> = [];
  for (const [sku, name] of stock.names) {
    if (soldSkus.has(sku)) continue;
    const text = normalizeText(name);
    if (!/\b(base|lisa|liso|blank)\b/.test(text)) continue;
    let score = 0;
    if (inferPspFamily(name) === family) score += 3;
    if (inferPspColor(name) === color) score += 4;
    if (/\bbase\b/.test(text)) score += 2;
    candidates.push({ sku, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length === 0 || candidates[0].score < 6) return null;
  if (candidates[1] && candidates[1].score === candidates[0].score) return null;
  return candidates[0].sku;
}

function selectPlan(actions: PspAction[], maxRolls: number, cashBudget: number | null): void {
  type Slot = { action: PspAction; cost: number | null; score: number };
  const slots: Slot[] = [];
  for (const action of actions) {
    if (!['produce', 'prepare_base'].includes(action.kind) || action.recommended_rolls <= 0) continue;
    for (let rollIndex = 0; rollIndex < action.recommended_rolls; rollIndex += 1) {
      const cost = action.unit_cost == null ? null : action.unit_cost * action.units_per_roll;
      slots.push({
        action,
        cost,
        score:
          action.priority_score - rollIndex * 2 +
          Math.min(12, Math.log10(1 + action.margin_at_risk_brl) * 3),
      });
    }
  }
  slots.sort((a, b) => b.score - a.score);

  let usedRolls = 0;
  let usedCash = 0;
  for (const slot of slots) {
    if (usedRolls >= maxRolls) continue;
    if (cashBudget != null && (slot.cost == null || usedCash + slot.cost > cashBudget)) continue;
    slot.action.selected_rolls += 1;
    slot.action.selected_units += slot.action.units_per_roll;
    slot.action.selected_investment_brl += slot.cost ?? 0;
    usedRolls += 1;
    usedCash += slot.cost ?? 0;
  }

  for (const action of actions) {
    if (action.kind === "map_base") {
      action.excluded_reason = "mapping";
      continue;
    }
    if (action.kind === "verify_stock") {
      action.excluded_reason = "stock";
      continue;
    }
    if (!['produce', 'prepare_base'].includes(action.kind)) continue;

    action.selected_units = Math.min(action.recommended_units, action.selected_units);
    action.selected = action.selected_units > 0;
    action.selected_investment_brl = round(action.selected_investment_brl);
    if (action.selected_units < action.recommended_units) {
      const nextCost = action.unit_cost == null ? null : action.unit_cost * action.units_per_roll;
      action.excluded_reason =
        cashBudget != null && (nextCost == null || usedCash + nextCost > cashBudget)
          ? "cash"
          : "capacity";
    }
  }
}

export function buildPspPlan(input: PspEngineInput): PspPlan {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const settingsBySku = getProductSettings(input.productSettings);
  const hub = buildHubContext(input.hub);
  const exactSizeMap = new Map(hub.sizeByExact);
  for (const row of input.sales) {
    for (const item of Array.isArray(row.items) ? row.items : []) {
      const exact = normalizeSku(item.sku);
      const size = sizeFromItem(item);
      if (exact && size && !exactSizeMap.has(exact)) exactSizeMap.set(exact, size);
    }
  }

  const inventory = buildInventoryContext(input.inventory);
  const sales = buildSales(input, exactSizeMap);
  const abcBySku = classifyAbc(sales);
  const catalogBySku = getCatalogMap(input.catalog);
  const costMap = new Map(
    input.costs
      .map((row) => [normalizeSku(row.sku), finite(row.cost)] as const)
      .filter(([sku, cost]) => sku && cost >= 0)
  );
  const launchBySku = new Map(
    input.launches.map((row) => [baseSku(row.sku), row.launch_date] as const)
  );

  const products: ProductDraft[] = [];
  let matchedStockProducts = 0;
  let trackedCostRevenue = 0;
  let totalRevenue = 0;

  for (const row of sales.values()) {
    const productSetting = settingsBySku.get(row.sku);
    if (productSetting?.active === false) continue;
    const catalog = catalogBySku.get(row.sku);
    const name = catalog?.name || hub.nameByParent.get(row.sku) || row.name || row.sku;
    const inferredFamily = inferPspFamily(name, catalog?.category);
    const family = (productSetting?.family as PspFamily | null) || inferredFamily;
    const configuredColor = productSetting?.color
      ? normalizePspColor(productSetting.color)
      : null;
    const inferredColor = inferPspColor(name);
    const requestedMadeToOrder =
      productSetting?.made_to_order_override ?? hub.madeToOrder.has(row.sku);
    const madeToOrder =
      requestedMadeToOrder &&
      isPspOnDemandFamily(inferredFamily) &&
      isPspOnDemandFamily(family);
    const color =
      configuredColor && configuredColor !== "sem cor"
        ? configuredColor
        : inferredColor !== "sem cor"
          ? inferredColor
          : madeToOrder
            ? "preto"
            : "sem cor";
    const unitsPerRoll = Math.max(
      1,
      Math.round(
        productSetting?.units_per_roll ??
          input.settings.family_yields[family] ??
          input.settings.family_yields.outro
      )
    );
    const leadDays = Math.max(
      1,
      Math.round(productSetting?.lead_time_days ?? input.settings.production_lead_days)
    );

    let stock: number | null = inventory.byParent.get(row.sku) ?? null;
    let stockSource: ProductDraft["stockSource"] = stock == null ? "none" : "eccosys";
    if (stock == null && !madeToOrder && hub.stockByParent.has(row.sku)) {
      stock = hub.stockByParent.get(row.sku)!;
      stockSource = "hub_fallback";
    }
    if (stock != null) matchedStockProducts += 1;

    const daily7 = row.units7 / 7;
    const daily30 = row.units30 / 30;
    const previousDaily = row.previous23 / 23;
    let growthPct: number | null = null;
    if (previousDaily > 0.02) growthPct = daily7 / previousDaily - 1;
    else if (row.units7 >= input.settings.min_momentum_units_7d) growthPct = 2;

    const confidence = clamp(row.units30 / 20, 0, 1);
    const trend = growthPct == null ? 0 : clamp(growthPct, -0.6, 1.5);
    const blendedRate = daily30 * 0.45 + daily7 * 0.55;
    const forecastDaily = Math.max(0, blendedRate * (1 + trend * confidence * 0.35));
    const momentum =
      row.units7 >= input.settings.min_momentum_units_7d &&
      (growthPct ?? 0) * 100 >= input.settings.growth_threshold_pct;

    const launchDate = parseDate(launchBySku.get(row.sku));
    const launchAgeDays = launchDate
      ? Math.max(0, Math.floor((nowMs - launchDate.getTime()) / DAY_MS))
      : null;
    const isLaunch = launchAgeDays != null && launchAgeDays <= input.settings.launch_window_days;
    const launchMomentum = isLaunch && row.units7 >= input.settings.min_momentum_units_7d;

    const avgPrice = row.priceUnits > 0
      ? row.priceRevenue / row.priceUnits
      : finite(catalog?.sale_price ?? catalog?.price);
    const cost = getCost(row.sku, row, costMap, input.financial.product_cost_pct);
    const unitCost = cost.value;
    const variablePct = clamp(
      (input.financial.tax_pct + input.financial.other_expenses_pct) / 100,
      0,
      1
    );
    const unitMargin = Math.max(0, avgPrice * (1 - variablePct) - (unitCost ?? 0));
    totalRevenue += row.revenue30;
    if (cost.tracked) trackedCostRevenue += row.revenue30;

    products.push({
      sku: row.sku,
      name,
      family,
      color,
      abc: abcBySku.get(row.sku) ?? "C",
      madeToOrder,
      unitsPerRoll,
      leadDays,
      baseSku: productSetting?.base_sku ? baseSku(productSetting.base_sku) : null,
      stockSource,
      stock,
      sizeStock: stockBySizeForProduct(row.sku, row, inventory, exactSizeMap),
      units7: row.units7,
      units30: row.units30,
      revenue30: row.revenue30,
      forecastDaily: round(forecastDaily, 4),
      growthPct: growthPct == null ? null : round(growthPct * 100, 1),
      momentum: momentum || launchMomentum,
      launchAgeDays,
      avgPrice,
      unitCost: unitCost == null ? null : round(unitCost),
      costTracked: cost.tracked,
      unitMargin,
      sizeSales: row.sizeSales,
    });
  }

  const productActions: PspAction[] = [];
  for (const product of products) {
    const coverage =
      product.stock != null && product.forecastDaily > 0
        ? product.stock / product.forecastDaily
        : product.stock === 0 && product.forecastDaily > 0
          ? 0
          : null;
    const launch =
      product.launchAgeDays != null &&
      product.launchAgeDays <= input.settings.launch_window_days;

    if (!product.madeToOrder && product.stock == null) {
      productActions.push({
        id: `stock:${product.sku}`,
        rank: 0,
        kind: "verify_stock",
        sku: product.sku,
        name: product.name,
        family: product.family,
        color: product.color,
        abc_class: product.abc,
        made_to_order: false,
        severity: "data",
        priority_score: priorityScore({
          abc: product.abc,
          coverage: null,
          leadDays: product.leadDays,
          marginRisk: 0,
          momentum: product.momentum,
          launch,
          madeToOrder: false,
        }),
        stock_source: "none",
        stock_units: null,
        coverage_days: null,
        sold_7d: product.units7,
        sold_30d: product.units30,
        forecast_daily: product.forecastDaily,
        growth_pct: product.growthPct,
        momentum: product.momentum,
        launch_age_days: product.launchAgeDays,
        units_per_roll: product.unitsPerRoll,
        recommended_units: 0,
        recommended_rolls: 0,
        selected_units: 0,
        selected_rolls: 0,
        unit_cost: product.unitCost,
        investment_brl: null,
        selected_investment_brl: 0,
        revenue_at_risk_brl: 0,
        margin_at_risk_brl: 0,
        selected: false,
        excluded_reason: "stock",
        reasons: ["Saldo físico não localizado no snapshot do Eccosys"],
        grade: [],
        base_sku: null,
        base_mapping: null,
      });
      continue;
    }

    if (product.madeToOrder) {
      const eligible = product.abc !== "C" || product.momentum || launch;
      if (!eligible || product.forecastDaily <= 0) continue;
      const target = Math.ceil(product.forecastDaily * input.settings.preproduction_days);
      const shortage = Math.max(0, target - (product.stock ?? 0));
      if (shortage <= 0) continue;
      const recommended = Math.ceil(shortage / 5) * 5;
      const priority = priorityScore({
        abc: product.abc,
        coverage,
        leadDays: product.leadDays,
        marginRisk: 0,
        momentum: product.momentum,
        launch,
        madeToOrder: true,
      });
      const reasons = [
        `${product.units7} un. vendidas nos últimos 7 dias`,
        `Pré-produzir ${input.settings.preproduction_days} dias para reduzir o prazo de expedição`,
      ];
      if (product.momentum && product.growthPct != null) {
        reasons.unshift(`Demanda acelerando ${product.growthPct > 0 ? "+" : ""}${product.growthPct}%`);
      }
      if (launch) reasons.unshift(`Lançamento com ${product.launchAgeDays} dias`);
      productActions.push({
        id: `preproduce:${product.sku}`,
        rank: 0,
        kind: "preproduce",
        sku: product.sku,
        name: product.name,
        family: product.family,
        color: product.color,
        abc_class: product.abc,
        made_to_order: true,
        severity: product.momentum || product.abc === "A" ? "high" : "watch",
        priority_score: priority,
        stock_source: product.stockSource,
        stock_units: product.stock,
        coverage_days: coverage == null ? null : round(coverage, 1),
        sold_7d: product.units7,
        sold_30d: product.units30,
        forecast_daily: product.forecastDaily,
        growth_pct: product.growthPct,
        momentum: product.momentum,
        launch_age_days: product.launchAgeDays,
        units_per_roll: product.unitsPerRoll,
        recommended_units: recommended,
        recommended_rolls: 0,
        selected_units: 0,
        selected_rolls: 0,
        unit_cost: product.unitCost,
        investment_brl: product.unitCost == null ? null : round(product.unitCost * recommended),
        selected_investment_brl: 0,
        revenue_at_risk_brl: 0,
        margin_at_risk_brl: 0,
        selected: false,
        excluded_reason: null,
        reasons,
        grade: allocateGrade(recommended, product.sizeSales, product.sizeStock),
        base_sku: product.baseSku,
        base_mapping: product.baseSku ? "configured" : "missing",
      });
      continue;
    }

    const targetDays = Math.max(
      input.settings.planning_horizon_days,
      product.leadDays + input.settings.safety_stock_days
    );
    const target = Math.ceil(product.forecastDaily * targetDays);
    const shortage = Math.max(0, target - (product.stock ?? 0));
    if (shortage <= 0) continue;
    const rolls = Math.max(1, Math.ceil(shortage / product.unitsPerRoll));
    const recommended = rolls * product.unitsPerRoll;
    const riskWindowDays = product.leadDays + input.settings.safety_stock_days;
    const atRiskUnits = Math.max(
      0,
      Math.ceil(product.forecastDaily * riskWindowDays - (product.stock ?? 0))
    );
    const revenueRisk = atRiskUnits * product.avgPrice;
    const marginRisk = atRiskUnits * product.unitMargin;
    const priority = priorityScore({
      abc: product.abc,
      coverage,
      leadDays: product.leadDays,
      marginRisk,
      momentum: product.momentum,
      launch,
      madeToOrder: false,
    });
    const severity = actionSeverity(coverage, product.leadDays, product.momentum);
    const reasons: string[] = [];
    if (coverage != null && coverage <= product.leadDays) {
      reasons.push(`Estoque acaba em ${round(coverage, 1)} dias; reposição leva ${product.leadDays}`);
    } else if (coverage != null) {
      reasons.push(`${round(coverage, 1)} dias de cobertura para meta de ${targetDays}`);
    }
    if (product.momentum && product.growthPct != null) {
      reasons.push(`Demanda acelerando ${product.growthPct > 0 ? "+" : ""}${product.growthPct}%`);
    }
    if (launch) reasons.push(`Lançamento com ${product.launchAgeDays} dias`);
    if (revenueRisk > 0) reasons.push(`${round(atRiskUnits, 0)} un. em risco antes da reposição`);

    productActions.push({
      id: `produce:${product.sku}`,
      rank: 0,
      kind: "produce",
      sku: product.sku,
      name: product.name,
      family: product.family,
      color: product.color,
      abc_class: product.abc,
      made_to_order: false,
      severity,
      priority_score: priority,
      stock_source: product.stockSource,
      stock_units: product.stock,
      coverage_days: coverage == null ? null : round(coverage, 1),
      sold_7d: product.units7,
      sold_30d: product.units30,
      forecast_daily: product.forecastDaily,
      growth_pct: product.growthPct,
      momentum: product.momentum,
      launch_age_days: product.launchAgeDays,
      units_per_roll: product.unitsPerRoll,
      recommended_units: recommended,
      recommended_rolls: rolls,
      selected_units: 0,
      selected_rolls: 0,
      unit_cost: product.unitCost,
      investment_brl: product.unitCost == null ? null : round(product.unitCost * recommended),
      selected_investment_brl: 0,
      revenue_at_risk_brl: round(revenueRisk),
      margin_at_risk_brl: round(marginRisk),
      selected: false,
      excluded_reason: null,
      reasons,
      grade: allocateGrade(recommended, product.sizeSales, product.sizeStock),
      base_sku: null,
      base_mapping: null,
    });
  }

  const soldSkus = new Set(sales.keys());
  const preproduction = productActions.filter((action) => action.kind === "preproduce");
  const baseGroups = new Map<string, PspAction[]>();
  const baseGroupByPreproductionId = new Map<string, string>();
  for (const action of preproduction) {
    // A mesma familia/cor pode existir em modelagens e tecidos diferentes.
    // Quando ha configuracao, o SKU da base e a identidade real do grupo.
    const key = action.base_sku
      ? `sku:${baseSku(action.base_sku)}`
      : action.color === "sem cor"
        ? `unmapped:${action.family}:sem-cor:${action.sku}`
        : `unmapped:${action.family}:${action.color}`;
    const list = baseGroups.get(key) ?? [];
    list.push(action);
    baseGroups.set(key, list);
    baseGroupByPreproductionId.set(action.id, key);
  }

  const baseActions: PspAction[] = [];
  const baseGroupByActionId = new Map<string, string>();
  const baseReadiness = new Map<string, { mapped: boolean; available: number; selected: number }>();
  for (const [key, children] of baseGroups) {
    const family = children[0].family;
    const color = children[0].color;
    const configured = children.map((child) => child.base_sku).find(Boolean) ?? null;
    const inferred = configured ? null : pickAutoBase(family, color, inventory, soldSkus);
    const mappedSku = configured || inferred;
    const mapping = configured ? "configured" : inferred ? "inferred" : "missing";
    if (inferred) {
      for (const child of children) {
        child.base_sku = inferred;
        child.base_mapping = "inferred";
      }
    }
    const requiredUnits = children.reduce((sum, child) => sum + child.recommended_units, 0);
    const baseStock = mappedSku ? inventory.byParent.get(mappedSku) ?? null : null;
    const shortage = Math.max(0, requiredUnits - (baseStock ?? 0));
    const unitsPerRoll = Math.max(
      1,
      Math.round(
        children.reduce((sum, child) => sum + child.units_per_roll, 0) / children.length
      )
    );
    const rolls = shortage > 0 ? Math.ceil(shortage / unitsPerRoll) : 0;
    const recommended = rolls * unitsPerRoll;
    const baseCost = mappedSku ? costMap.get(mappedSku) ?? null : null;
    const priority = Math.min(100, Math.max(...children.map((child) => child.priority_score)) + 4);
    const dependentProducts = children.length === 1
      ? "1 produto sob demanda depende desta base"
      : `${children.length} produtos sob demanda dependem desta base`;
    const reasons = [
      dependentProducts,
      `${requiredUnits} un. para cobrir a pré-produção recomendada`,
    ];
    if (!mappedSku) reasons.unshift("Vincule o SKU da base lisa para descontar o estoque real");
    else if (baseStock != null) reasons.unshift(`${baseStock} bases disponíveis no Eccosys`);
    else reasons.unshift("SKU da base não apareceu no snapshot atual do Eccosys");

    const action: PspAction = {
      id: `base:${key}`,
      rank: 0,
      kind: mappedSku ? "prepare_base" : "map_base",
      sku: mappedSku ?? "",
      name:
        color === "sem cor" && children.length === 1
          ? `Base a definir · ${children[0].name}`
          : `Base ${titleCase(family)} ${titleCase(color)}`,
      family,
      color,
      abc_class: bestAbc(children.map((child) => child.abc_class)),
      made_to_order: true,
      severity: !mappedSku ? "high" : shortage > 0 ? "high" : "watch",
      priority_score: priority,
      stock_source: mappedSku && baseStock != null ? "eccosys" : "none",
      stock_units: baseStock,
      coverage_days: null,
      sold_7d: children.reduce((sum, child) => sum + child.sold_7d, 0),
      sold_30d: children.reduce((sum, child) => sum + child.sold_30d, 0),
      forecast_daily: round(children.reduce((sum, child) => sum + child.forecast_daily, 0), 4),
      growth_pct: null,
      momentum: children.some((child) => child.momentum),
      launch_age_days: null,
      units_per_roll: unitsPerRoll,
      recommended_units: mappedSku ? recommended : requiredUnits,
      recommended_rolls: mappedSku ? rolls : Math.ceil(requiredUnits / unitsPerRoll),
      selected_units: 0,
      selected_rolls: 0,
      unit_cost: baseCost == null ? null : round(baseCost),
      investment_brl:
        baseCost == null || !mappedSku ? null : round(baseCost * recommended),
      selected_investment_brl: 0,
      revenue_at_risk_brl: 0,
      margin_at_risk_brl: 0,
      selected: mappedSku != null && shortage === 0,
      excluded_reason: mappedSku ? null : "mapping",
      reasons,
      grade: mergeGrade(children.flatMap((child) => child.grade)),
      base_sku: mappedSku,
      base_mapping: mapping,
      allocations: children.map((child) => ({
        sku: child.sku,
        name: child.name,
        units: child.recommended_units,
      })),
    };
    baseActions.push(action);
    baseGroupByActionId.set(action.id, key);
    baseReadiness.set(key, {
      mapped: Boolean(mappedSku),
      available: baseStock ?? 0,
      selected: shortage === 0 ? requiredUnits : 0,
    });
  }

  const actions = [...productActions.filter((action) => action.kind !== "preproduce"), ...baseActions, ...preproduction];
  selectPlan(actions, input.settings.max_rolls_per_order, input.settings.cash_budget_brl);

  for (const baseAction of baseActions) {
    const key = baseGroupByActionId.get(baseAction.id);
    if (!key) continue;
    const readiness = baseReadiness.get(key);
    if (readiness) readiness.selected += baseAction.selected_units;
  }
  for (const action of preproduction) {
    const groupKey = baseGroupByPreproductionId.get(action.id);
    const readiness = groupKey ? baseReadiness.get(groupKey) : null;
    if (!readiness?.mapped) {
      action.excluded_reason = "mapping";
      continue;
    }
    const available = Math.max(0, readiness.available + readiness.selected);
    const siblingActions = preproduction
      .filter((candidate) => baseGroupByPreproductionId.get(candidate.id) === groupKey)
      .sort((a, b) => b.priority_score - a.priority_score);
    let remaining = available;
    for (const sibling of siblingActions) {
      const selected = Math.min(sibling.recommended_units, remaining);
      sibling.selected_units = selected;
      sibling.selected = selected > 0;
      sibling.excluded_reason = selected < sibling.recommended_units ? "capacity" : null;
      remaining -= selected;
    }
  }

  const severityOrder = { critical: 0, high: 1, watch: 2, data: 3 } as const;
  actions.sort((a, b) => {
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    return b.priority_score - a.priority_score;
  });
  actions.forEach((action, index) => {
    action.rank = index + 1;
  });

  const capacityActions = actions.filter((action) => ['produce', 'prepare_base'].includes(action.kind));
  const requiredRolls = capacityActions.reduce((sum, action) => sum + action.recommended_rolls, 0);
  const selectedRolls = capacityActions.reduce((sum, action) => sum + action.selected_rolls, 0);
  const requiredInvestment = capacityActions.reduce(
    (sum, action) => sum + (action.investment_brl ?? 0),
    0
  );
  const selectedInvestment = capacityActions.reduce(
    (sum, action) => sum + action.selected_investment_brl,
    0
  );
  const revenueRisk = actions.reduce((sum, action) => sum + action.revenue_at_risk_brl, 0);
  const marginRisk = actions.reduce((sum, action) => sum + action.margin_at_risk_brl, 0);
  const revenueProtected = actions.reduce((sum, action) => {
    const fraction = action.recommended_units > 0
      ? clamp(action.selected_units / action.recommended_units, 0, 1)
      : 0;
    return sum + action.revenue_at_risk_brl * fraction;
  }, 0);
  const marginProtected = actions.reduce((sum, action) => {
    const fraction = action.recommended_units > 0
      ? clamp(action.selected_units / action.recommended_units, 0, 1)
      : 0;
    return sum + action.margin_at_risk_brl * fraction;
  }, 0);

  const inventoryAgeHours = inventory.capturedAt
    ? Math.max(0, (nowMs - new Date(inventory.capturedAt).getTime()) / (60 * 60 * 1000))
    : null;
  const inventorySource = inventory.byParent.size > 0
    ? "eccosys"
    : hub.stockByParent.size > 0
      ? "hub_fallback"
      : "none";
  const mtoProducts = products.filter((product) => product.madeToOrder);
  const registeredMtoSkus = new Set(
    input.productSettings
      .filter(
        (row) =>
          row.active !== false &&
          row.made_to_order_override === true &&
          (row.family === "camiseta" || row.family === "regata")
      )
      .map((row) => baseSku(row.sku))
      .filter(Boolean)
  );
  const unclassifiedMtoProducts = mtoProducts.filter((product) => product.color === "sem cor");
  const mtoUnits = preproduction.reduce((sum, action) => sum + action.recommended_units, 0);
  const mappedMtoUnits = preproduction
    .filter((action) => {
      const groupKey = baseGroupByPreproductionId.get(action.id);
      return groupKey ? baseReadiness.get(groupKey)?.mapped : false;
    })
    .reduce((sum, action) => sum + action.recommended_units, 0);
  const stockMatchPct = products.length > 0 ? (matchedStockProducts / products.length) * 100 : 0;
  const trackedCostPct = totalRevenue > 0 ? (trackedCostRevenue / totalRevenue) * 100 : 0;
  const mappedBasePct = mtoUnits > 0 ? (mappedMtoUnits / mtoUnits) * 100 : 100;
  const warnings: string[] = [];
  if (inventorySource !== "eccosys") {
    warnings.push("Snapshot deduplicado do Eccosys ainda não disponível; o Hub é apenas contingência.");
  } else if (inventoryAgeHours != null && inventoryAgeHours > 2) {
    warnings.push(`Estoque do Eccosys está há ${round(inventoryAgeHours, 1)}h sem atualização.`);
  }
  if (stockMatchPct < 80) warnings.push(`${round(100 - stockMatchPct, 0)}% dos produtos vendidos estão sem saldo físico associado.`);
  if (trackedCostPct < 80) warnings.push(`Custos rastreados cobrem ${round(trackedCostPct, 0)}% da receita; o restante usa CMV percentual.`);
  if (mappedBasePct < 100) warnings.push(`${round(100 - mappedBasePct, 0)}% da demanda sob demanda ainda não está ligada a uma base lisa.`);
  if (unclassifiedMtoProducts.length > 0) {
    warnings.push(
      `${unclassifiedMtoProducts.length} ${unclassifiedMtoProducts.length === 1 ? "produto sob demanda está" : "produtos sob demanda estão"} sem cor explícita no nome e não serão misturados em uma base genérica.`
    );
  }
  if (input.settings.cash_budget_brl == null) warnings.push("Defina o caixa disponível para o plano respeitar também o limite financeiro.");

  const monitor = products
    .map((product) => ({
      sku: product.sku,
      name: product.name,
      abc_class: product.abc,
      made_to_order: product.madeToOrder,
      family: product.family,
      color: product.color,
      stock_units: product.stock,
      coverage_days:
        product.stock != null && product.forecastDaily > 0
          ? round(product.stock / product.forecastDaily, 1)
          : null,
      sold_7d: product.units7,
      sold_30d: product.units30,
      growth_pct: product.growthPct,
      forecast_daily: product.forecastDaily,
      momentum: product.momentum,
      launch_age_days: product.launchAgeDays,
    }))
    .sort((a, b) => {
      if (a.momentum !== b.momentum) return a.momentum ? -1 : 1;
      const aCoverage = a.coverage_days ?? Number.POSITIVE_INFINITY;
      const bCoverage = b.coverage_days ?? Number.POSITIVE_INFINITY;
      if (aCoverage !== bCoverage) return aCoverage - bCoverage;
      return b.sold_30d - a.sold_30d;
    });

  return {
    generated_at: now.toISOString(),
    settings: input.settings,
    summary: {
      actionable_count: actions.length,
      selected_action_count: actions.filter((action) => action.selected).length,
      critical_count: actions.filter((action) => action.severity === "critical").length,
      momentum_count: products.filter((product) => product.momentum).length,
      required_rolls: requiredRolls,
      selected_rolls: selectedRolls,
      required_investment_brl: round(requiredInvestment),
      selected_investment_brl: round(selectedInvestment),
      revenue_at_risk_brl: round(revenueRisk),
      margin_at_risk_brl: round(marginRisk),
      revenue_protected_brl: round(revenueProtected),
      margin_protected_brl: round(marginProtected),
      opportunity_outside_plan_brl: round(Math.max(0, marginRisk - marginProtected)),
    },
    data_quality: {
      sales_orders: input.sales.length,
      products_with_sales: products.length,
      inventory_source: inventorySource,
      inventory_captured_at: inventory.capturedAt,
      inventory_age_hours: inventoryAgeHours == null ? null : round(inventoryAgeHours, 1),
      stock_match_pct: round(stockMatchPct, 1),
      tracked_cost_pct: round(trackedCostPct, 1),
      made_to_order_count: mtoProducts.length,
      made_to_order_registered_count: registeredMtoSkus.size,
      mapped_base_pct: round(mappedBasePct, 1),
      warnings,
    },
    actions,
    products: monitor,
  };
}

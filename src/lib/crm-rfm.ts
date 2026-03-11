// --- Types ---

export interface CrmVendaRow {
  cliente: string | null;
  compras_anteriores: number | null;
  cupom: string | null;
  data_compra: string | null;
  email: string | null;
  numero_pedido: string | null;
  ordem_compra: string | null;
  telefone: string | null;
  valor: number | null;
  creation_date: string | null;
  modified_date: string | null;
  slug: string | null;
  creator: string | null;
  bubble_unique_id: string | null;
}

export type RfmSegment =
  | "champions"
  | "loyal_customers"
  | "potential_loyalists"
  | "recent_customers"
  | "promising"
  | "need_attention"
  | "about_to_sleep"
  | "at_risk"
  | "cant_lose"
  | "hibernating"
  | "lost";

export interface RfmCustomer {
  email: string;
  name: string;
  phone: string;
  totalPurchases: number;
  totalSpent: number;
  avgTicket: number;
  firstPurchaseDate: string;
  lastPurchaseDate: string;
  daysSinceLastPurchase: number;
  couponsUsed: string[];
  recencyScore: number;
  frequencyScore: number;
  monetaryScore: number;
  rfmScore: string;
  rfmTotal: number;
  segment: RfmSegment;
}

export interface RfmSegmentSummary {
  segment: RfmSegment;
  label: string;
  description: string;
  customerCount: number;
  totalRevenue: number;
  avgTicket: number;
  avgRecency: number;
  color: string;
}

export interface CrmRfmResponse {
  customers: RfmCustomer[];
  segments: RfmSegmentSummary[];
  summary: {
    totalCustomers: number;
    totalRevenue: number;
    avgTicket: number;
    activeCustomers: number;
    avgPurchasesPerCustomer: number;
    medianRecency: number;
  };
  distributions: {
    recency: { bucket: string; count: number }[];
    frequency: { bucket: string; count: number }[];
    monetary: { bucket: string; count: number }[];
  };
}

// --- Segment metadata ---

export const SEGMENT_META: Record<RfmSegment, { label: string; description: string; color: string }> = {
  champions:          { label: "Campeoes",          description: "Compraram recentemente, compram frequentemente e gastam muito",    color: "#f59e0b" },
  loyal_customers:    { label: "Clientes Fieis",    description: "Gastam bem e compram com frequencia",                             color: "#22c55e" },
  potential_loyalists:{ label: "Potenciais Fieis",  description: "Clientes recentes com potencial de fidelizacao",                  color: "#3b82f6" },
  recent_customers:   { label: "Clientes Recentes", description: "Compraram recentemente mas apenas uma vez",                      color: "#06b6d4" },
  promising:          { label: "Promissores",       description: "Compradores recentes com baixa frequencia",                      color: "#8b5cf6" },
  need_attention:     { label: "Precisam Atencao",  description: "Clientes medianos que podem estar perdendo interesse",            color: "#f97316" },
  about_to_sleep:     { label: "Quase Dormindo",    description: "Abaixo da media em recencia e frequencia",                       color: "#eab308" },
  at_risk:            { label: "Em Risco",          description: "Costumavam comprar muito mas nao compram ha tempo",               color: "#ef4444" },
  cant_lose:          { label: "Nao Pode Perder",   description: "Grandes clientes que nao compram ha muito tempo",                 color: "#dc2626" },
  hibernating:        { label: "Hibernando",        description: "Ultima compra ha muito tempo, baixa frequencia e gasto",          color: "#6b7280" },
  lost:               { label: "Perdidos",          description: "Menor score em todas as dimensoes",                               color: "#4b5563" },
};

// --- Internal helpers ---

interface AggregatedCustomer {
  email: string;
  name: string;
  phone: string;
  totalPurchases: number;
  totalSpent: number;
  firstPurchaseTs: number;
  lastPurchaseTs: number;
  coupons: Set<string>;
}

function aggregateByCustomer(rows: CrmVendaRow[]): AggregatedCustomer[] {
  const map = new Map<string, AggregatedCustomer>();

  for (const row of rows) {
    const email = (row.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;

    const valor = row.valor ?? 0;
    let purchaseTs = 0;
    if (row.data_compra) {
      const d = new Date(row.data_compra);
      if (!isNaN(d.getTime())) purchaseTs = d.getTime();
    }

    const existing = map.get(email);
    if (existing) {
      existing.totalPurchases += 1;
      existing.totalSpent += valor;
      if (row.cliente && row.cliente.trim()) existing.name = row.cliente.trim();
      if (row.telefone && row.telefone.trim()) existing.phone = row.telefone.trim();
      if (purchaseTs > 0 && purchaseTs < existing.firstPurchaseTs) existing.firstPurchaseTs = purchaseTs;
      if (purchaseTs > 0 && purchaseTs > existing.lastPurchaseTs) existing.lastPurchaseTs = purchaseTs;
      if (row.cupom && row.cupom.trim()) existing.coupons.add(row.cupom.trim());
    } else {
      const coupons = new Set<string>();
      if (row.cupom && row.cupom.trim()) coupons.add(row.cupom.trim());
      map.set(email, {
        email,
        name: (row.cliente || "").trim(),
        phone: (row.telefone || "").trim(),
        totalPurchases: 1,
        totalSpent: valor,
        firstPurchaseTs: purchaseTs || Date.now(),
        lastPurchaseTs: purchaseTs || 0,
        coupons,
      });
    }
  }

  return [...map.values()];
}

function assignQuintileScores(values: number[], invert: boolean): number[] {
  const n = values.length;
  if (n === 0) return [];

  // Create indexed array for sorting while preserving original order
  const indexed = values.map((v, i) => ({ value: v, index: i }));
  indexed.sort((a, b) => a.value - b.value);

  const scores = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const percentile = i / n;
    let score: number;
    if (percentile < 0.2) score = 1;
    else if (percentile < 0.4) score = 2;
    else if (percentile < 0.6) score = 3;
    else if (percentile < 0.8) score = 4;
    else score = 5;

    scores[indexed[i].index] = invert ? 6 - score : score;
  }

  return scores;
}

function classifySegment(r: number, f: number, m: number): RfmSegment {
  if (r === 5 && f === 5 && m >= 4) return "champions";
  if (r >= 4 && f >= 3 && m >= 3) return "loyal_customers";
  if (r === 1 && f >= 4 && m >= 4) return "cant_lose";
  if (r <= 2 && f >= 3 && m >= 3) return "at_risk";
  if (r === 5 && f === 1 && m <= 2) return "recent_customers";
  if (r >= 4 && f <= 3 && m <= 3) return "potential_loyalists";
  if (r >= 3 && r <= 4 && f === 1 && m <= 2) return "promising";
  if (r === 3 && f >= 2 && f <= 3 && m >= 2 && m <= 3) return "need_attention";
  if (r >= 2 && r <= 3 && f <= 2 && m <= 2) return "about_to_sleep";
  if (r === 1 && f === 1 && m === 1) return "lost";
  return "hibernating";
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function buildRecencyDistribution(customers: RfmCustomer[]): { bucket: string; count: number }[] {
  const buckets = [
    { label: "0-7 dias", min: 0, max: 7 },
    { label: "8-30 dias", min: 8, max: 30 },
    { label: "31-60 dias", min: 31, max: 60 },
    { label: "61-90 dias", min: 61, max: 90 },
    { label: "91-180 dias", min: 91, max: 180 },
    { label: "180+ dias", min: 181, max: Infinity },
  ];
  return buckets.map((b) => ({
    bucket: b.label,
    count: customers.filter((c) => c.daysSinceLastPurchase >= b.min && c.daysSinceLastPurchase <= b.max).length,
  }));
}

function buildFrequencyDistribution(customers: RfmCustomer[]): { bucket: string; count: number }[] {
  const buckets = [
    { label: "1 compra", min: 1, max: 1 },
    { label: "2-3 compras", min: 2, max: 3 },
    { label: "4-5 compras", min: 4, max: 5 },
    { label: "6-10 compras", min: 6, max: 10 },
    { label: "10+ compras", min: 11, max: Infinity },
  ];
  return buckets.map((b) => ({
    bucket: b.label,
    count: customers.filter((c) => c.totalPurchases >= b.min && c.totalPurchases <= b.max).length,
  }));
}

function buildMonetaryDistribution(customers: RfmCustomer[]): { bucket: string; count: number }[] {
  if (customers.length === 0) return [];
  const values = customers.map((c) => c.totalSpent).sort((a, b) => a - b);
  const p20 = values[Math.floor(values.length * 0.2)] || 0;
  const p40 = values[Math.floor(values.length * 0.4)] || 0;
  const p60 = values[Math.floor(values.length * 0.6)] || 0;
  const p80 = values[Math.floor(values.length * 0.8)] || 0;

  const fmt = (v: number) => {
    if (v >= 1000) return `R$${(v / 1000).toFixed(1)}k`;
    return `R$${Math.round(v)}`;
  };

  const buckets = [
    { label: `Ate ${fmt(p20)}`, min: 0, max: p20 },
    { label: `${fmt(p20)}-${fmt(p40)}`, min: p20 + 0.01, max: p40 },
    { label: `${fmt(p40)}-${fmt(p60)}`, min: p40 + 0.01, max: p60 },
    { label: `${fmt(p60)}-${fmt(p80)}`, min: p60 + 0.01, max: p80 },
    { label: `Acima de ${fmt(p80)}`, min: p80 + 0.01, max: Infinity },
  ];

  return buckets.map((b) => ({
    bucket: b.label,
    count: customers.filter((c) => c.totalSpent >= b.min && c.totalSpent <= b.max).length,
  }));
}

// --- Main orchestrator ---

export function generateRfmReport(rows: CrmVendaRow[]): CrmRfmResponse {
  const aggregated = aggregateByCustomer(rows);
  const now = Date.now();

  if (aggregated.length === 0) {
    return {
      customers: [],
      segments: [],
      summary: {
        totalCustomers: 0,
        totalRevenue: 0,
        avgTicket: 0,
        activeCustomers: 0,
        avgPurchasesPerCustomer: 0,
        medianRecency: 0,
      },
      distributions: { recency: [], frequency: [], monetary: [] },
    };
  }

  // Calculate raw R, F, M values
  const recencyValues = aggregated.map((c) =>
    c.lastPurchaseTs > 0 ? Math.floor((now - c.lastPurchaseTs) / 86400000) : 9999
  );
  const frequencyValues = aggregated.map((c) => c.totalPurchases);
  const monetaryValues = aggregated.map((c) => c.totalSpent);

  // Assign quintile scores
  const rScores = assignQuintileScores(recencyValues, true);
  const fScores = assignQuintileScores(frequencyValues, false);
  const mScores = assignQuintileScores(monetaryValues, false);

  // Build RfmCustomer array
  const fmt = (ts: number) => (ts > 0 ? new Date(ts).toISOString().slice(0, 10) : "—");
  const customers: RfmCustomer[] = aggregated.map((c, i) => {
    const r = rScores[i];
    const f = fScores[i];
    const m = mScores[i];
    const days = recencyValues[i];

    return {
      email: c.email,
      name: c.name,
      phone: c.phone,
      totalPurchases: c.totalPurchases,
      totalSpent: parseFloat(c.totalSpent.toFixed(2)),
      avgTicket: c.totalPurchases > 0 ? parseFloat((c.totalSpent / c.totalPurchases).toFixed(2)) : 0,
      firstPurchaseDate: fmt(c.firstPurchaseTs),
      lastPurchaseDate: fmt(c.lastPurchaseTs),
      daysSinceLastPurchase: days === 9999 ? days : days,
      couponsUsed: [...c.coupons],
      recencyScore: r,
      frequencyScore: f,
      monetaryScore: m,
      rfmScore: `${r}-${f}-${m}`,
      rfmTotal: r + f + m,
      segment: classifySegment(r, f, m),
    };
  });

  // Sort by rfmTotal desc then totalSpent desc
  customers.sort((a, b) => b.rfmTotal - a.rfmTotal || b.totalSpent - a.totalSpent);

  // Build segment summaries
  const segmentGroups = new Map<RfmSegment, RfmCustomer[]>();
  for (const c of customers) {
    const list = segmentGroups.get(c.segment) || [];
    list.push(c);
    segmentGroups.set(c.segment, list);
  }

  const allSegments: RfmSegment[] = [
    "champions", "loyal_customers", "potential_loyalists", "recent_customers",
    "promising", "need_attention", "about_to_sleep", "at_risk", "cant_lose",
    "hibernating", "lost",
  ];

  const segments: RfmSegmentSummary[] = allSegments
    .map((seg) => {
      const meta = SEGMENT_META[seg];
      const group = segmentGroups.get(seg) || [];
      const totalRevenue = group.reduce((s, c) => s + c.totalSpent, 0);
      const avgRecency = group.length > 0
        ? group.reduce((s, c) => s + c.daysSinceLastPurchase, 0) / group.length
        : 0;
      return {
        segment: seg,
        label: meta.label,
        description: meta.description,
        customerCount: group.length,
        totalRevenue: parseFloat(totalRevenue.toFixed(2)),
        avgTicket: group.length > 0 ? parseFloat((totalRevenue / group.reduce((s, c) => s + c.totalPurchases, 0)).toFixed(2)) : 0,
        avgRecency: Math.round(avgRecency),
        color: meta.color,
      };
    })
    .filter((s) => s.customerCount > 0);

  // Summary
  const totalRevenue = customers.reduce((s, c) => s + c.totalSpent, 0);
  const totalPurchases = customers.reduce((s, c) => s + c.totalPurchases, 0);
  const recencyDays = customers.map((c) => c.daysSinceLastPurchase).filter((d) => d < 9999);
  const activeCustomers = customers.filter((c) => c.daysSinceLastPurchase <= 90).length;

  return {
    customers,
    segments,
    summary: {
      totalCustomers: customers.length,
      totalRevenue: parseFloat(totalRevenue.toFixed(2)),
      avgTicket: totalPurchases > 0 ? parseFloat((totalRevenue / totalPurchases).toFixed(2)) : 0,
      activeCustomers,
      avgPurchasesPerCustomer: customers.length > 0 ? parseFloat((totalPurchases / customers.length).toFixed(1)) : 0,
      medianRecency: median(recencyDays),
    },
    distributions: {
      recency: buildRecencyDistribution(customers),
      frequency: buildFrequencyDistribution(customers),
      monetary: buildMonetaryDistribution(customers),
    },
  };
}

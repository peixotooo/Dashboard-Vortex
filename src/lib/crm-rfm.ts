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
  // Webhook-enriched fields (nullable — absent for CSV imports)
  source?: string | null;
  source_order_id?: string | null;
  cpf?: string | null;
  birthdate?: string | null;
  state?: string | null;
  city?: string | null;
  zip?: string | null;
  neighborhood?: string | null;
  payment_method?: string | null;
  installments?: number | null;
  shipping_method?: string | null;
  shipping_price?: number | null;
  delivery_days?: number | null;
  subtotal?: number | null;
  discount_price?: number | null;
  channel?: string | null;
  items?: unknown[] | null;
  discounts?: unknown[] | null;
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

export type DayRange = "1-5" | "6-10" | "11-15" | "16-20" | "21-25" | "26-31";
export type DayOfWeekPref = "weekday" | "weekend";
export type Weekday = "seg" | "ter" | "qua" | "qui" | "sex" | "sab" | "dom";
export type HourPref = "madrugada" | "manha" | "tarde" | "noite";
export type CouponSensitivity = "never" | "occasional" | "frequent" | "always";
export type LifecycleStage = "new" | "returning" | "regular" | "vip";

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
  // Behavioral
  preferredDayRange: DayRange;
  preferredDayOfWeek: DayOfWeekPref;
  preferredWeekday: Weekday;
  preferredHour: HourPref;
  couponSensitivity: CouponSensitivity;
  lifecycleStage: LifecycleStage;
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
  behavioralDistributions: {
    dayOfMonth: { bucket: string; count: number }[];
    dayOfWeek: { bucket: string; count: number }[];
    weekday: { bucket: string; count: number; color: string }[];
    hourOfDay: { bucket: string; count: number }[];
    couponUsage: { bucket: string; count: number; color: string }[];
    lifecycle: { bucket: string; count: number; color: string }[];
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

export const LIFECYCLE_META: Record<LifecycleStage, { label: string; color: string }> = {
  new:       { label: "Novo",       color: "#06b6d4" },
  returning: { label: "Retornante", color: "#3b82f6" },
  regular:   { label: "Regular",    color: "#22c55e" },
  vip:       { label: "VIP",        color: "#f59e0b" },
};

export const COUPON_META: Record<CouponSensitivity, { label: string; color: string }> = {
  never:      { label: "Nunca usa",   color: "#6b7280" },
  occasional: { label: "Ocasional",   color: "#3b82f6" },
  frequent:   { label: "Frequente",   color: "#f97316" },
  always:     { label: "Sempre usa",  color: "#ef4444" },
};

export const WEEKDAY_META: Record<Weekday, { label: string; color: string }> = {
  seg: { label: "Segunda", color: "#3b82f6" },
  ter: { label: "Terca",   color: "#8b5cf6" },
  qua: { label: "Quarta",  color: "#06b6d4" },
  qui: { label: "Quinta",  color: "#22c55e" },
  sex: { label: "Sexta",   color: "#f59e0b" },
  sab: { label: "Sabado",  color: "#f97316" },
  dom: { label: "Domingo", color: "#ef4444" },
};

// --- Internal helpers ---

const JS_DOW_TO_WEEKDAY: Weekday[] = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];

interface AggregatedCustomer {
  email: string;
  name: string;
  phone: string;
  totalPurchases: number;
  totalSpent: number;
  firstPurchaseTs: number;
  lastPurchaseTs: number;
  coupons: Set<string>;
  // Behavioral counters
  dayRangeCounts: Record<DayRange, number>;
  weekdayCounts: Record<Weekday, number>;
  hourCounts: { madrugada: number; manha: number; tarde: number; noite: number };
  couponPurchases: number;
}

function getDayRange(day: number): DayRange {
  if (day <= 5) return "1-5";
  if (day <= 10) return "6-10";
  if (day <= 15) return "11-15";
  if (day <= 20) return "16-20";
  if (day <= 25) return "21-25";
  return "26-31";
}

function getHourPref(hour: number): HourPref {
  if (hour < 6) return "madrugada";
  if (hour < 12) return "manha";
  if (hour < 18) return "tarde";
  return "noite";
}

function aggregateByCustomer(rows: CrmVendaRow[]): AggregatedCustomer[] {
  const map = new Map<string, AggregatedCustomer>();

  for (const row of rows) {
    const email = (row.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;

    const valor = row.valor ?? 0;
    let purchaseTs = 0;
    let purchaseDate: Date | null = null;
    if (row.data_compra) {
      const d = new Date(row.data_compra);
      if (!isNaN(d.getTime())) {
        purchaseTs = d.getTime();
        purchaseDate = d;
      }
    }

    const hasCoupon = !!(row.cupom && row.cupom.trim());

    const existing = map.get(email);
    if (existing) {
      existing.totalPurchases += 1;
      existing.totalSpent += valor;
      if (row.cliente && row.cliente.trim()) existing.name = row.cliente.trim();
      if (row.telefone && row.telefone.trim()) existing.phone = row.telefone.trim();
      if (purchaseTs > 0 && purchaseTs < existing.firstPurchaseTs) existing.firstPurchaseTs = purchaseTs;
      if (purchaseTs > 0 && purchaseTs > existing.lastPurchaseTs) existing.lastPurchaseTs = purchaseTs;
      if (hasCoupon) {
        existing.coupons.add(row.cupom!.trim());
        existing.couponPurchases += 1;
      }
      if (purchaseDate) {
        existing.dayRangeCounts[getDayRange(purchaseDate.getDate())] += 1;
        existing.weekdayCounts[JS_DOW_TO_WEEKDAY[purchaseDate.getDay()]] += 1;
        existing.hourCounts[getHourPref(purchaseDate.getHours())] += 1;
      }
    } else {
      const coupons = new Set<string>();
      if (hasCoupon) coupons.add(row.cupom!.trim());
      const dayRangeCounts: Record<DayRange, number> = { "1-5": 0, "6-10": 0, "11-15": 0, "16-20": 0, "21-25": 0, "26-31": 0 };
      const hourCounts = { madrugada: 0, manha: 0, tarde: 0, noite: 0 };
      const weekdayCounts: Record<Weekday, number> = { seg: 0, ter: 0, qua: 0, qui: 0, sex: 0, sab: 0, dom: 0 };

      if (purchaseDate) {
        dayRangeCounts[getDayRange(purchaseDate.getDate())] = 1;
        weekdayCounts[JS_DOW_TO_WEEKDAY[purchaseDate.getDay()]] = 1;
        hourCounts[getHourPref(purchaseDate.getHours())] = 1;
      }

      map.set(email, {
        email,
        name: (row.cliente || "").trim(),
        phone: (row.telefone || "").trim(),
        totalPurchases: 1,
        totalSpent: valor,
        firstPurchaseTs: purchaseTs || Date.now(),
        lastPurchaseTs: purchaseTs || 0,
        coupons,
        dayRangeCounts,
        weekdayCounts,
        hourCounts,
        couponPurchases: hasCoupon ? 1 : 0,
      });
    }
  }

  return [...map.values()];
}

function assignQuintileScores(values: number[], invert: boolean): number[] {
  const n = values.length;
  if (n === 0) return [];

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

function getMaxKey<T extends string>(counts: Record<T, number>): T {
  let maxKey = Object.keys(counts)[0] as T;
  let maxVal = 0;
  for (const [k, v] of Object.entries(counts) as [T, number][]) {
    if (v > maxVal) { maxVal = v; maxKey = k; }
  }
  return maxKey;
}

function classifyCouponSensitivity(couponPurchases: number, totalPurchases: number): CouponSensitivity {
  if (totalPurchases === 0 || couponPurchases === 0) return "never";
  const pct = couponPurchases / totalPurchases;
  if (pct <= 0.4) return "occasional";
  if (pct <= 0.7) return "frequent";
  return "always";
}

function classifyLifecycle(totalPurchases: number): LifecycleStage {
  if (totalPurchases === 1) return "new";
  if (totalPurchases <= 3) return "returning";
  if (totalPurchases <= 10) return "regular";
  return "vip";
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

  const emptyBehavioral: CrmRfmResponse["behavioralDistributions"] = {
    dayOfMonth: [], dayOfWeek: [], weekday: [], hourOfDay: [], couponUsage: [], lifecycle: [],
  };

  if (aggregated.length === 0) {
    return {
      customers: [],
      segments: [],
      summary: {
        totalCustomers: 0, totalRevenue: 0, avgTicket: 0,
        activeCustomers: 0, avgPurchasesPerCustomer: 0, medianRecency: 0,
      },
      distributions: { recency: [], frequency: [], monetary: [] },
      behavioralDistributions: emptyBehavioral,
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
  const fmtDate = (ts: number) => (ts > 0 ? new Date(ts).toISOString().slice(0, 10) : "—");
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
      firstPurchaseDate: fmtDate(c.firstPurchaseTs),
      lastPurchaseDate: fmtDate(c.lastPurchaseTs),
      daysSinceLastPurchase: days,
      couponsUsed: [...c.coupons],
      recencyScore: r,
      frequencyScore: f,
      monetaryScore: m,
      rfmScore: `${r}-${f}-${m}`,
      rfmTotal: r + f + m,
      segment: classifySegment(r, f, m),
      // Behavioral
      preferredDayRange: getMaxKey(c.dayRangeCounts),
      preferredDayOfWeek: (c.weekdayCounts.sab + c.weekdayCounts.dom) > (c.weekdayCounts.seg + c.weekdayCounts.ter + c.weekdayCounts.qua + c.weekdayCounts.qui + c.weekdayCounts.sex) ? "weekend" : "weekday",
      preferredWeekday: getMaxKey(c.weekdayCounts),
      preferredHour: getMaxKey(c.hourCounts),
      couponSensitivity: classifyCouponSensitivity(c.couponPurchases, c.totalPurchases),
      lifecycleStage: classifyLifecycle(c.totalPurchases),
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

  // Behavioral distributions
  const dayRanges: DayRange[] = ["1-5", "6-10", "11-15", "16-20", "21-25", "26-31"];
  const behavioralDistributions: CrmRfmResponse["behavioralDistributions"] = {
    dayOfMonth: dayRanges.map((dr) => ({
      bucket: `Dia ${dr}`,
      count: customers.filter((c) => c.preferredDayRange === dr).length,
    })),
    dayOfWeek: [
      { bucket: "Dia de semana", count: customers.filter((c) => c.preferredDayOfWeek === "weekday").length },
      { bucket: "Fim de semana", count: customers.filter((c) => c.preferredDayOfWeek === "weekend").length },
    ],
    weekday: (["seg", "ter", "qua", "qui", "sex", "sab", "dom"] as Weekday[]).map((wd) => ({
      bucket: WEEKDAY_META[wd].label,
      count: customers.filter((c) => c.preferredWeekday === wd).length,
      color: WEEKDAY_META[wd].color,
    })),
    hourOfDay: [
      { bucket: "Madrugada (0-6h)", count: customers.filter((c) => c.preferredHour === "madrugada").length },
      { bucket: "Manha (6-12h)", count: customers.filter((c) => c.preferredHour === "manha").length },
      { bucket: "Tarde (12-18h)", count: customers.filter((c) => c.preferredHour === "tarde").length },
      { bucket: "Noite (18-24h)", count: customers.filter((c) => c.preferredHour === "noite").length },
    ],
    couponUsage: (["never", "occasional", "frequent", "always"] as CouponSensitivity[]).map((cs) => ({
      bucket: COUPON_META[cs].label,
      count: customers.filter((c) => c.couponSensitivity === cs).length,
      color: COUPON_META[cs].color,
    })),
    lifecycle: (["new", "returning", "regular", "vip"] as LifecycleStage[]).map((ls) => ({
      bucket: LIFECYCLE_META[ls].label,
      count: customers.filter((c) => c.lifecycleStage === ls).length,
      color: LIFECYCLE_META[ls].color,
    })),
  };

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
    behavioralDistributions,
  };
}

// --- Monthly Cohort Analysis ---

export interface MonthlyCohortRow {
  month: string;           // "Mar 2025"
  monthKey: string;        // "2025-03"
  totalClients: number;
  avgTicket: number;
  newClients: number;
  avgTicketNew: number;
  revenueNew: number;
  returningClients: number;
  avgTicketReturning: number;
  revenueReturning: number;
  totalOrders: number;
  totalRevenue: number;
  repurchaseRate: number;
}

export interface CrmMetricsSummary {
  arpu: number;
  avgOrdersPerClient: number;
  repurchaseRate: number;
  newClients: number;
  totalClients: number;
  totalRevenue: number;
  monthlyData: MonthlyCohortRow[];
}

const MONTH_NAMES_PT = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

export function generateMonthlyCohort(rows: CrmVendaRow[], months?: number): CrmMetricsSummary {
  // Sort rows by date
  const dated = rows
    .filter((r) => r.data_compra && r.email)
    .map((r) => {
      const date = new Date(r.data_compra!);
      return {
        email: (r.email || "").trim().toLowerCase(),
        valor: r.valor ?? 0,
        date,
        monthKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      };
    })
    .filter((r) => !isNaN(r.date.getTime()) && r.email.includes("@"))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (dated.length === 0) {
    return {
      arpu: 0, avgOrdersPerClient: 0, repurchaseRate: 0,
      newClients: 0, totalClients: 0, totalRevenue: 0, monthlyData: [],
    };
  }

  // Group orders by month
  const monthMap = new Map<string, typeof dated>();
  for (const row of dated) {
    const list = monthMap.get(row.monthKey) || [];
    list.push(row);
    monthMap.set(row.monthKey, list);
  }

  // Track seen emails globally (chronological)
  const seenEmails = new Set<string>();

  const sortedMonths = [...monthMap.keys()].sort();
  const monthlyData: MonthlyCohortRow[] = [];

  // Track cumulative unique clients and repeat buyers per month
  const cumulativeEmails = new Set<string>();
  const cumulativePurchases = new Map<string, number>();

  for (const monthKey of sortedMonths) {
    const orders = monthMap.get(monthKey)!;
    const [yearStr, monthStr] = monthKey.split("-");
    const year = parseInt(yearStr);
    const monthIdx = parseInt(monthStr) - 1;
    const monthLabel = `${MONTH_NAMES_PT[monthIdx] ?? monthStr} ${year}`;

    // Unique clients this month
    const monthEmails = new Set<string>();
    const newEmails = new Set<string>();
    const returningEmails = new Set<string>();

    let revenueNew = 0;
    let revenueReturning = 0;
    let ordersNew = 0;
    let ordersReturning = 0;

    for (const order of orders) {
      monthEmails.add(order.email);
      // Track cumulative purchases
      cumulativePurchases.set(order.email, (cumulativePurchases.get(order.email) || 0) + 1);

      if (seenEmails.has(order.email)) {
        returningEmails.add(order.email);
        revenueReturning += order.valor;
        ordersReturning++;
      } else {
        newEmails.add(order.email);
        revenueNew += order.valor;
        ordersNew++;
      }
    }

    // After processing, mark all as seen
    for (const email of monthEmails) {
      seenEmails.add(email);
      cumulativeEmails.add(email);
    }

    const totalClients = monthEmails.size;
    const totalRevenue = revenueNew + revenueReturning;
    const totalOrders = orders.length;

    // Repurchase rate: of all cumulative unique clients, how many have 2+ cumulative purchases
    let repeatBuyers = 0;
    for (const count of cumulativePurchases.values()) {
      if (count >= 2) repeatBuyers++;
    }
    const repurchaseRate = cumulativeEmails.size > 0
      ? (repeatBuyers / cumulativeEmails.size) * 100
      : 0;

    monthlyData.push({
      month: monthLabel,
      monthKey,
      totalClients,
      avgTicket: totalOrders > 0 ? parseFloat((totalRevenue / totalOrders).toFixed(2)) : 0,
      newClients: newEmails.size,
      avgTicketNew: ordersNew > 0 ? parseFloat((revenueNew / ordersNew).toFixed(2)) : 0,
      revenueNew: parseFloat(revenueNew.toFixed(2)),
      returningClients: returningEmails.size,
      avgTicketReturning: ordersReturning > 0 ? parseFloat((revenueReturning / ordersReturning).toFixed(2)) : 0,
      revenueReturning: parseFloat(revenueReturning.toFixed(2)),
      totalOrders,
      totalRevenue: parseFloat(totalRevenue.toFixed(2)),
      repurchaseRate: parseFloat(repurchaseRate.toFixed(2)),
    });
  }

  // Filter to requested period
  let filtered = monthlyData;
  if (months && months > 0 && monthlyData.length > months) {
    filtered = monthlyData.slice(-months);
  }

  // Compute summary from filtered period only
  const filteredMonthKeys = new Set(filtered.map((m) => m.monthKey));
  const periodEmails = new Set<string>();
  let periodOrders = 0;
  let periodRevenue = 0;
  for (const row of dated) {
    if (filteredMonthKeys.has(row.monthKey)) {
      periodEmails.add(row.email);
      periodOrders++;
      periodRevenue += row.valor;
    }
  }

  const periodNewClients = filtered.reduce((s, m) => s + m.newClients, 0);
  const periodUniqueClients = periodEmails.size;
  const lastMonth = filtered[filtered.length - 1];

  return {
    arpu: periodUniqueClients > 0 ? parseFloat((periodRevenue / periodUniqueClients).toFixed(2)) : 0,
    avgOrdersPerClient: periodUniqueClients > 0 ? parseFloat((periodOrders / periodUniqueClients).toFixed(2)) : 0,
    repurchaseRate: lastMonth?.repurchaseRate ?? 0,
    newClients: periodNewClients,
    totalClients: periodUniqueClients,
    totalRevenue: parseFloat(periodRevenue.toFixed(2)),
    monthlyData: filtered,
  };
}

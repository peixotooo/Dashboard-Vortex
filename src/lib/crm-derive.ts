// Re-derivação client-side de summary/segments/distributions/behavioral
// a partir de uma lista filtrada de RfmCustomer.
//
// Motivação: o snapshot pré-computa esses agregados sobre a base toda.
// Quando o usuário aplica filtros no /crm (estado, segmento, lifecycle,
// etc.), as outras tabs (Métricas, Visão Geral, Segmentos RFM,
// Comportamento) também precisam refletir o subconjunto filtrado —
// senão o filtro só afeta a aba Clientes.
//
// As regras de bucket/cor/label aqui são idênticas às do crm-rfm.ts
// pra que a UI seja consistente entre snapshot e visão filtrada.

import type {
  CrmRfmResponse,
  RfmCustomer,
  RfmSegment,
  RfmSegmentSummary,
  CouponSensitivity,
  HourPref,
  LifecycleStage,
  Weekday,
  DayRange,
} from "./crm-rfm";
import { SEGMENT_META, LIFECYCLE_META, COUPON_META, WEEKDAY_META } from "./crm-rfm";

const ALL_SEGMENTS: RfmSegment[] = [
  "champions", "loyal_customers", "potential_loyalists", "recent_customers",
  "promising", "need_attention", "about_to_sleep", "at_risk", "cant_lose",
  "hibernating", "lost",
];

const ALL_LIFECYCLES: LifecycleStage[] = ["new", "returning", "regular", "vip"];
const ALL_COUPONS: CouponSensitivity[] = ["never", "occasional", "frequent", "always"];
const ALL_HOURS: HourPref[] = ["madrugada", "manha", "tarde", "noite"];
const ALL_WEEKDAYS: Weekday[] = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];
const ALL_DAYRANGES: DayRange[] = ["1-5", "6-10", "11-15", "16-20", "21-25", "26-31"];

const HOUR_LABEL: Record<HourPref, string> = {
  madrugada: "Madrugada (0-6h)",
  manha: "Manha (6-12h)",
  tarde: "Tarde (12-18h)",
  noite: "Noite (18-24h)",
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function deriveSummary(
  customers: RfmCustomer[],
): CrmRfmResponse["summary"] {
  if (customers.length === 0) {
    return {
      totalCustomers: 0, totalRevenue: 0, avgTicket: 0,
      activeCustomers: 0, avgPurchasesPerCustomer: 0, medianRecency: 0,
    };
  }
  const totalRevenue = customers.reduce((s, c) => s + c.totalSpent, 0);
  const totalPurchases = customers.reduce((s, c) => s + c.totalPurchases, 0);
  const activeCustomers = customers.filter((c) => c.daysSinceLastPurchase <= 90).length;
  const recencyDays = customers.map((c) => c.daysSinceLastPurchase).filter((d) => d < 9999);
  return {
    totalCustomers: customers.length,
    totalRevenue: parseFloat(totalRevenue.toFixed(2)),
    avgTicket: totalPurchases > 0 ? parseFloat((totalRevenue / totalPurchases).toFixed(2)) : 0,
    activeCustomers,
    avgPurchasesPerCustomer: parseFloat((totalPurchases / customers.length).toFixed(1)),
    medianRecency: median(recencyDays),
  };
}

export function deriveSegments(
  customers: RfmCustomer[],
): RfmSegmentSummary[] {
  const byseg = new Map<RfmSegment, RfmCustomer[]>();
  for (const c of customers) {
    if (!byseg.has(c.segment)) byseg.set(c.segment, []);
    byseg.get(c.segment)!.push(c);
  }
  return ALL_SEGMENTS
    .map((seg) => {
      const meta = SEGMENT_META[seg];
      const list = byseg.get(seg) || [];
      const totalRevenue = list.reduce((s, c) => s + c.totalSpent, 0);
      const totalPurchases = list.reduce((s, c) => s + c.totalPurchases, 0);
      const avgRecency = list.length > 0
        ? list.reduce((s, c) => s + c.daysSinceLastPurchase, 0) / list.length
        : 0;
      return {
        segment: seg,
        label: meta.label,
        description: meta.description,
        customerCount: list.length,
        totalRevenue: parseFloat(totalRevenue.toFixed(2)),
        avgTicket: totalPurchases > 0 ? parseFloat((totalRevenue / totalPurchases).toFixed(2)) : 0,
        avgRecency: Math.round(avgRecency),
        color: meta.color,
      };
    })
    .filter((s) => s.customerCount > 0);
}

export function deriveDistributions(
  customers: RfmCustomer[],
): CrmRfmResponse["distributions"] {
  // Recency buckets
  const recencyBuckets = [
    { label: "0-7 dias", min: 0, max: 7 },
    { label: "8-30 dias", min: 8, max: 30 },
    { label: "31-60 dias", min: 31, max: 60 },
    { label: "61-90 dias", min: 61, max: 90 },
    { label: "91-180 dias", min: 91, max: 180 },
    { label: "180+ dias", min: 181, max: Infinity },
  ];
  const recency = recencyBuckets.map((b) => ({
    bucket: b.label,
    count: customers.filter((c) => c.daysSinceLastPurchase >= b.min && c.daysSinceLastPurchase <= b.max).length,
  }));

  // Frequency buckets
  const frequencyBuckets = [
    { label: "1 compra", min: 1, max: 1 },
    { label: "2-3 compras", min: 2, max: 3 },
    { label: "4-5 compras", min: 4, max: 5 },
    { label: "6-10 compras", min: 6, max: 10 },
    { label: "10+ compras", min: 11, max: Infinity },
  ];
  const frequency = frequencyBuckets.map((b) => ({
    bucket: b.label,
    count: customers.filter((c) => c.totalPurchases >= b.min && c.totalPurchases <= b.max).length,
  }));

  // Monetary buckets via percentis do filtrado
  let monetary: { bucket: string; count: number }[] = [];
  if (customers.length > 0) {
    const values = customers.map((c) => c.totalSpent).sort((a, b) => a - b);
    const p20 = values[Math.floor(values.length * 0.2)] || 0;
    const p40 = values[Math.floor(values.length * 0.4)] || 0;
    const p60 = values[Math.floor(values.length * 0.6)] || 0;
    const p80 = values[Math.floor(values.length * 0.8)] || 0;
    const fmt = (v: number) => v >= 1000 ? `R$${(v / 1000).toFixed(1)}k` : `R$${Math.round(v)}`;
    const monetaryBuckets = [
      { label: `Ate ${fmt(p20)}`, min: 0, max: p20 },
      { label: `${fmt(p20)}-${fmt(p40)}`, min: p20 + 0.01, max: p40 },
      { label: `${fmt(p40)}-${fmt(p60)}`, min: p40 + 0.01, max: p60 },
      { label: `${fmt(p60)}-${fmt(p80)}`, min: p60 + 0.01, max: p80 },
      { label: `Acima de ${fmt(p80)}`, min: p80 + 0.01, max: Infinity },
    ];
    monetary = monetaryBuckets.map((b) => ({
      bucket: b.label,
      count: customers.filter((c) => c.totalSpent >= b.min && c.totalSpent <= b.max).length,
    }));
  }

  return { recency, frequency, monetary };
}

export function deriveBehavioral(
  customers: RfmCustomer[],
): CrmRfmResponse["behavioralDistributions"] {
  const cDayRange = new Map<DayRange, number>();
  const cDow = new Map<"weekday" | "weekend", number>();
  const cWeekday = new Map<Weekday, number>();
  const cHour = new Map<HourPref, number>();
  const cCoupon = new Map<CouponSensitivity, number>();
  const cLifecycle = new Map<LifecycleStage, number>();

  for (const c of customers) {
    cDayRange.set(c.preferredDayRange, (cDayRange.get(c.preferredDayRange) ?? 0) + 1);
    cDow.set(c.preferredDayOfWeek, (cDow.get(c.preferredDayOfWeek) ?? 0) + 1);
    cWeekday.set(c.preferredWeekday, (cWeekday.get(c.preferredWeekday) ?? 0) + 1);
    cHour.set(c.preferredHour, (cHour.get(c.preferredHour) ?? 0) + 1);
    cCoupon.set(c.couponSensitivity, (cCoupon.get(c.couponSensitivity) ?? 0) + 1);
    cLifecycle.set(c.lifecycleStage, (cLifecycle.get(c.lifecycleStage) ?? 0) + 1);
  }

  return {
    dayOfMonth: ALL_DAYRANGES.map((dr) => ({
      bucket: `Dia ${dr}`,
      count: cDayRange.get(dr) ?? 0,
    })),
    dayOfWeek: [
      { bucket: "Dia de semana", count: cDow.get("weekday") ?? 0 },
      { bucket: "Fim de semana", count: cDow.get("weekend") ?? 0 },
    ],
    weekday: ALL_WEEKDAYS.map((wd) => ({
      bucket: WEEKDAY_META[wd].label,
      count: cWeekday.get(wd) ?? 0,
      color: WEEKDAY_META[wd].color,
    })),
    hourOfDay: ALL_HOURS.map((h) => ({
      bucket: HOUR_LABEL[h],
      count: cHour.get(h) ?? 0,
    })),
    couponUsage: ALL_COUPONS.map((cs) => ({
      bucket: COUPON_META[cs].label,
      count: cCoupon.get(cs) ?? 0,
      color: COUPON_META[cs].color,
    })),
    lifecycle: ALL_LIFECYCLES.map((ls) => ({
      bucket: LIFECYCLE_META[ls].label,
      count: cLifecycle.get(ls) ?? 0,
      color: LIFECYCLE_META[ls].color,
    })),
  };
}

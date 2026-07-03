import {
  parseClientTags,
  findExcludingTag,
  findCashbackBlockingMemberTag,
  extractVndaCouponDiscountId,
} from "../src/lib/cashback/api";

const cases: Array<{ raw: unknown; excluded: string[]; expected: string | null; label: string }> = [
  { raw: null, excluded: ["bulking-club"], expected: null, label: "tags null → eligible" },
  { raw: "", excluded: ["bulking-club"], expected: null, label: "tags empty string → eligible" },
  { raw: "bulking-club", excluded: ["bulking-club"], expected: "bulking-club", label: "exact tag match → excluded" },
  { raw: "bulking-club,optin-checkout", excluded: ["bulking-club"], expected: "bulking-club", label: "club + opt-in → excluded" },
  { raw: "optin-checkout", excluded: ["bulking-club"], expected: null, label: "opt-in only → eligible" },
  { raw: "BULKING-CLUB", excluded: ["bulking-club"], expected: "bulking-club", label: "case-insensitive → excluded" },
  { raw: " bulking-club ", excluded: ["bulking-club"], expected: "bulking-club", label: "trim spaces → excluded" },
  { raw: ["bulking-club", "vip"], excluded: ["bulking-club"], expected: "bulking-club", label: "array form → excluded" },
  { raw: "solicitacao-esquecimento", excluded: ["bulking-club"], expected: null, label: "LGPD tag, no exclusion → eligible (mas pedido nem deveria chegar)" },
  { raw: "promo,club", excluded: ["bulking-club", "vip"], expected: null, label: "no exclusion match → eligible" },
];

let fail = 0;
for (const c of cases) {
  const tags = parseClientTags(c.raw);
  const got = findExcludingTag(tags, c.excluded);
  const ok = got === c.expected;
  if (!ok) fail++;
  console.log(`${ok ? "✅" : "❌"}  ${c.label}\n   tags=${JSON.stringify(tags)} excluded=${JSON.stringify(c.excluded)} → ${JSON.stringify(got)} (esperado ${JSON.stringify(c.expected)})`);
}

const couponCases: Array<{
  raw: unknown;
  excluded: string[];
  couponDiscountId: number | null;
  expected: string | null;
  label: string;
}> = [
  {
    raw: "bulking-club,optin-checkout",
    excluded: ["bulking-club"],
    couponDiscountId: 189,
    expected: null,
    label: "club + cupom comum de outra promoção → elegível",
  },
  {
    raw: "bulking-club,optin-checkout",
    excluded: ["bulking-club"],
    couponDiscountId: null,
    expected: null,
    label: "club sem cupom → elegível",
  },
  {
    raw: "bulking-club,optin-checkout",
    excluded: ["bulking-club"],
    couponDiscountId: 7,
    expected: "bulking-club",
    label: "club + cupom da promoção VNDA 7 → bloqueado",
  },
  {
    raw: "bulking-club,optin-checkout",
    excluded: ["bulking-club"],
    couponDiscountId: 7,
    expected: "bulking-club",
    label: "club + outro cupom da promoção VNDA 7 → bloqueado",
  },
  {
    raw: "optin-checkout",
    excluded: ["bulking-club"],
    couponDiscountId: 7,
    expected: null,
    label: "não club + cupom da promoção VNDA 7 → elegível pela tag",
  },
];

for (const c of couponCases) {
  const tags = parseClientTags(c.raw);
  const got = findCashbackBlockingMemberTag(tags, c.excluded, c.couponDiscountId, 7);
  const ok = got === c.expected;
  if (!ok) fail++;
  console.log(`${ok ? "✅" : "❌"}  ${c.label}\n   tags=${JSON.stringify(tags)} couponDiscountId=${JSON.stringify(c.couponDiscountId)} → ${JSON.stringify(got)} (esperado ${JSON.stringify(c.expected)})`);
}

const discountIdCases: Array<{ body: unknown; expected: number | null; label: string }> = [
  {
    body: { id: 3081, code: "BKOFF12", discount_id: 189 },
    expected: 189,
    label: "VNDA coupon_codes response com discount_id",
  },
  {
    body: { code: "CLUB", discount: { id: 7 } },
    expected: 7,
    label: "VNDA response com discount.id aninhado",
  },
  {
    body: { code: "SEM-ID" },
    expected: null,
    label: "VNDA response sem promoção",
  },
];

for (const c of discountIdCases) {
  const got = extractVndaCouponDiscountId(c.body);
  const ok = got === c.expected;
  if (!ok) fail++;
  console.log(`${ok ? "✅" : "❌"}  ${c.label}\n   got=${JSON.stringify(got)} (esperado ${JSON.stringify(c.expected)})`);
}

const total = cases.length + couponCases.length + discountIdCases.length;
console.log(`\n${total - fail}/${total} ok`);
process.exit(fail > 0 ? 1 : 0);

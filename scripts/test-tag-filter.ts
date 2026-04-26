import { parseClientTags, findExcludingTag } from "../src/lib/cashback/api";

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
console.log(`\n${cases.length - fail}/${cases.length} ok`);
process.exit(fail > 0 ? 1 : 0);

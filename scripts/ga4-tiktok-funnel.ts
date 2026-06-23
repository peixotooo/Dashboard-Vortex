/** READ-ONLY: funil GA4 do tráfego TikTok (sessionSource=tiktok) — valida as conversões. */
import { config } from "dotenv";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
config({ path: ".env.local" });

function client() {
  const raw = process.env.GA4_CREDENTIALS_JSON!.trim();
  let cred: any;
  try { cred = JSON.parse(raw); } catch { cred = JSON.parse(raw.replace(/\n/g, "\\n")); }
  if (cred.private_key) cred.private_key = cred.private_key.replace(/\\n/g, "\n");
  return new BetaAnalyticsDataClient({ credentials: cred });
}

(async () => {
  const c = client();
  const property = `properties/${process.env.GA4_PROPERTY_ID}`;
  const START = "2026-06-15", END = "2026-06-21"; // desde que adicionei os UTMs

  // 1) Funil agregado do TikTok
  const [agg] = await c.runReport({
    property,
    dateRanges: [{ startDate: START, endDate: END }],
    dimensions: [{ name: "sessionSource" }],
    metrics: [
      { name: "sessions" }, { name: "addToCarts" }, { name: "checkouts" },
      { name: "ecommercePurchases" }, { name: "purchaseRevenue" },
    ],
    dimensionFilter: { filter: { fieldName: "sessionSource", stringFilter: { matchType: "CONTAINS", value: "tiktok", caseSensitive: false } } },
  });
  console.log(`=== FUNIL TikTok no site (GA4, ${START}→${END}) ===`);
  const r = agg.rows?.[0]?.metricValues?.map((m) => m.value) || [];
  if (!agg.rows?.length) console.log("Nenhuma sessão com sessionSource contendo 'tiktok'. (UTM não chegando? ou GA4 atrasado)");
  else {
    const [sessions, atc, checkouts, purchases, revenue] = r.map(Number);
    console.log(`Sessões:        ${sessions}`);
    console.log(`Add to cart:    ${atc}  (${sessions ? (atc / sessions * 100).toFixed(1) : 0}% das sessões)`);
    console.log(`Checkouts:      ${checkouts}`);
    console.log(`Compras (GA4):  ${purchases}`);
    console.log(`Receita (GA4):  R$ ${Number(revenue).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
    console.log(`CVR site:       ${sessions ? (purchases / sessions * 100).toFixed(2) : 0}% (compra/sessão)`);
  }

  // 2) Quebra por source/medium pra ver como o TikTok aparece
  const [bylist] = await c.runReport({
    property,
    dateRanges: [{ startDate: START, endDate: END }],
    dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
    metrics: [{ name: "sessions" }, { name: "ecommercePurchases" }, { name: "purchaseRevenue" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 12,
  });
  console.log(`\n=== Top fontes do site (referência) ===`);
  for (const row of bylist.rows || []) {
    const [src, med] = row.dimensionValues!.map((d) => d.value);
    const [s, p, rev] = row.metricValues!.map((m) => Number(m.value));
    console.log(`  ${src} / ${med}: ${s} sess, ${p} compras, R$ ${rev.toLocaleString("pt-BR")}`);
  }
})().catch((e) => console.error("ERRO:", e.message));

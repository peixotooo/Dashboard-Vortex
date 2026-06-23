/** READ-ONLY: (1) eventos GA4 do tráfego TikTok (tracking funciona?) (2) campos crus do pedido VNDA. */
import { config } from "dotenv";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { getVndaConfigAdmin } from "../src/lib/vnda-api";
config({ path: ".env.local" });

const WS = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";

function ga4() {
  const raw = process.env.GA4_CREDENTIALS_JSON!.trim();
  let cred: any; try { cred = JSON.parse(raw); } catch { cred = JSON.parse(raw.replace(/\n/g, "\\n")); }
  if (cred.private_key) cred.private_key = cred.private_key.replace(/\\n/g, "\n");
  return new BetaAnalyticsDataClient({ credentials: cred });
}

(async () => {
  // 1) Eventos disparados pelas sessões do TikTok (prova se o GA4 enxerga ou é cego)
  const c = ga4();
  const property = `properties/${process.env.GA4_PROPERTY_ID}`;
  const [ev] = await c.runReport({
    property,
    dateRanges: [{ startDate: "2026-06-15", endDate: "2026-06-21" }],
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: { filter: { fieldName: "sessionSource", stringFilter: { matchType: "CONTAINS", value: "tiktok", caseSensitive: false } } },
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit: 30,
  });
  console.log("=== EVENTOS das sessões TikTok (GA4) ===");
  for (const row of ev.rows || []) {
    console.log(`  ${row.dimensionValues![0].value.padEnd(24)} ${Number(row.metricValues![0].value).toLocaleString("pt-BR")}`);
  }
  console.log("Leitura: se aparecem view_item/select_item/scroll mas add_to_cart=0 → tracking OK, falta intenção.");
  console.log("         se só session_start/first_visit/page_view → in-app browser cega o GA4 (meu argumento cai).");

  // 2) Pedido cru VNDA — tem campo de origem/utm?
  const cfg = await getVndaConfigAdmin(WS);
  if (!cfg) { console.log("\n(sem VNDA config)"); return; }
  const res = await fetch(`https://${cfg.storeHost}/api/v2/orders?per_page=2`, {
    headers: { Authorization: `Bearer ${cfg.apiToken}`, "X-Shop-Host": cfg.storeHost, "Content-Type": "application/json" },
  });
  const data = await res.json();
  const order = Array.isArray(data) ? data[0] : (data.orders?.[0] || data.results?.[0]);
  console.log("\n=== Campos crus de um pedido VNDA ===");
  if (order) {
    const keys = Object.keys(order);
    console.log(keys.join(", "));
    const srcKeys = keys.filter((k) => /utm|source|track|referr|origin|channel|tag|campaign/i.test(k));
    console.log("Campos de origem/utm:", srcKeys.length ? JSON.stringify(srcKeys.map((k) => ({ [k]: order[k] }))) : "NENHUM");
  } else console.log("não consegui ler pedido:", JSON.stringify(data).slice(0, 200));
})().catch((e) => console.error("ERRO:", e.message));

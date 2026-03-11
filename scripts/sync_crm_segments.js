/**
 * sync_crm_segments.js
 *
 * Materializes CRM customer segments into `crm_customer_segments` table in Supabase.
 * This enables direct SQL export of contacts by segment without going through Vercel.
 *
 * Prerequisites:
 *   1. crm_customer_segments table with workspace_id + email as composite PK
 *   2. Ensure .env.local has NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/sync_crm_segments.js --workspace-id=YOUR_WORKSPACE_UUID
 *
 * Example Supabase queries after sync:
 *   SELECT * FROM crm_customer_segments WHERE segmento_rfm = 'champions';
 *   SELECT * FROM crm_customer_segments WHERE faixa_dia_mes = '1-5' AND segmento_rfm IN ('champions', 'loyal_customers');
 *   SELECT email, nome FROM crm_customer_segments WHERE estagio_lifecycle = 'vip';
 */

const { createClient } = require("@supabase/supabase-js");
const dotenv = require("dotenv");

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found in .env.local");
  process.exit(1);
}

// Parse --workspace-id argument
const wsArg = process.argv.find((a) => a.startsWith("--workspace-id="));
const WORKSPACE_ID = wsArg ? wsArg.split("=")[1] : null;

if (!WORKSPACE_ID) {
  console.error("Usage: node scripts/sync_crm_segments.js --workspace-id=YOUR_WORKSPACE_UUID");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const FETCH_PAGE_SIZE = 1000;
const UPSERT_BATCH_SIZE = 500;

// --- Inline RFM engine (mirrors src/lib/crm-rfm.ts logic) ---
// We inline the logic instead of importing TS to keep this a simple Node.js script.

function getDayRange(day) {
  if (day <= 5) return "1-5";
  if (day <= 10) return "6-10";
  if (day <= 15) return "11-15";
  if (day <= 20) return "16-20";
  if (day <= 25) return "21-25";
  return "26-31";
}

function getHourPref(hour) {
  if (hour < 6) return "madrugada";
  if (hour < 12) return "manha";
  if (hour < 18) return "tarde";
  return "noite";
}

const JS_DOW_TO_WEEKDAY = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];

function getMaxKey(counts) {
  let maxKey = Object.keys(counts)[0];
  let maxVal = 0;
  for (const [k, v] of Object.entries(counts)) {
    if (v > maxVal) { maxVal = v; maxKey = k; }
  }
  return maxKey;
}

function classifyCouponSensitivity(couponPurchases, totalPurchases) {
  if (totalPurchases === 0 || couponPurchases === 0) return "never";
  const pct = couponPurchases / totalPurchases;
  if (pct <= 0.4) return "occasional";
  if (pct <= 0.7) return "frequent";
  return "always";
}

function classifyLifecycle(totalPurchases) {
  if (totalPurchases === 1) return "new";
  if (totalPurchases <= 3) return "returning";
  if (totalPurchases <= 10) return "regular";
  return "vip";
}

function aggregateByCustomer(rows) {
  const map = new Map();

  for (const row of rows) {
    const email = (row.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;

    const valor = row.valor ?? 0;
    let purchaseTs = 0;
    let purchaseDate = null;
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
        existing.coupons.add(row.cupom.trim());
        existing.couponPurchases += 1;
      }
      if (purchaseDate) {
        existing.dayRangeCounts[getDayRange(purchaseDate.getDate())] += 1;
        existing.weekdayCounts[JS_DOW_TO_WEEKDAY[purchaseDate.getDay()]] += 1;
        existing.hourCounts[getHourPref(purchaseDate.getHours())] += 1;
      }
    } else {
      const coupons = new Set();
      if (hasCoupon) coupons.add(row.cupom.trim());
      const dayRangeCounts = { "1-5": 0, "6-10": 0, "11-15": 0, "16-20": 0, "21-25": 0, "26-31": 0 };
      const hourCounts = { madrugada: 0, manha: 0, tarde: 0, noite: 0 };
      const weekdayCounts = { seg: 0, ter: 0, qua: 0, qui: 0, sex: 0, sab: 0, dom: 0 };

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

function assignQuintileScores(values, invert) {
  const n = values.length;
  if (n === 0) return [];

  const indexed = values.map((v, i) => ({ value: v, index: i }));
  indexed.sort((a, b) => a.value - b.value);

  const scores = new Array(n);
  for (let i = 0; i < n; i++) {
    const percentile = i / n;
    let score;
    if (percentile < 0.2) score = 1;
    else if (percentile < 0.4) score = 2;
    else if (percentile < 0.6) score = 3;
    else if (percentile < 0.8) score = 4;
    else score = 5;

    scores[indexed[i].index] = invert ? 6 - score : score;
  }

  return scores;
}

function classifySegment(r, f, m) {
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

// --- Main ---

async function main() {
  console.log("=== CRM Segments Sync ===");
  console.log(`Workspace: ${WORKSPACE_ID}\n`);

  // 1. Fetch crm_vendas for this workspace (paginated)
  console.log("Fetching crm_vendas...");
  let allRows = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("crm_vendas")
      .select("cliente, email, telefone, valor, data_compra, cupom, numero_pedido, compras_anteriores")
      .eq("workspace_id", WORKSPACE_ID)
      .range(from, from + FETCH_PAGE_SIZE - 1);

    if (error) throw new Error(`Supabase fetch error: ${error.message}`);

    if (data && data.length > 0) {
      allRows = allRows.concat(data);
      from += FETCH_PAGE_SIZE;
      hasMore = data.length === FETCH_PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }

  console.log(`Fetched ${allRows.length} rows from crm_vendas\n`);

  if (allRows.length === 0) {
    console.log("No data found. Exiting.");
    return;
  }

  // 2. Aggregate and compute RFM + behavioral scores
  console.log("Computing RFM + behavioral segmentation...");
  const aggregated = aggregateByCustomer(allRows);
  const now = Date.now();

  const recencyValues = aggregated.map((c) =>
    c.lastPurchaseTs > 0 ? Math.floor((now - c.lastPurchaseTs) / 86400000) : 9999
  );
  const frequencyValues = aggregated.map((c) => c.totalPurchases);
  const monetaryValues = aggregated.map((c) => c.totalSpent);

  const rScores = assignQuintileScores(recencyValues, true);
  const fScores = assignQuintileScores(frequencyValues, false);
  const mScores = assignQuintileScores(monetaryValues, false);

  const fmtDate = (ts) => (ts > 0 ? new Date(ts).toISOString().slice(0, 10) : null);

  const records = aggregated.map((c, i) => {
    const r = rScores[i];
    const f = fScores[i];
    const m = mScores[i];
    const days = recencyValues[i];

    return {
      workspace_id: WORKSPACE_ID,
      email: c.email,
      nome: c.name || null,
      telefone: c.phone || null,
      total_compras: c.totalPurchases,
      total_gasto: parseFloat(c.totalSpent.toFixed(2)),
      ticket_medio: c.totalPurchases > 0 ? parseFloat((c.totalSpent / c.totalPurchases).toFixed(2)) : 0,
      primeira_compra: fmtDate(c.firstPurchaseTs),
      ultima_compra: fmtDate(c.lastPurchaseTs),
      dias_sem_comprar: days,
      score_recencia: r,
      score_frequencia: f,
      score_monetario: m,
      rfm_score: `${r}-${f}-${m}`,
      segmento_rfm: classifySegment(r, f, m),
      faixa_dia_mes: getMaxKey(c.dayRangeCounts),
      dia_semana_preferido: (c.weekdayCounts.sab + c.weekdayCounts.dom) > (c.weekdayCounts.seg + c.weekdayCounts.ter + c.weekdayCounts.qua + c.weekdayCounts.qui + c.weekdayCounts.sex) ? "weekend" : "weekday",
      dia_semana_individual: getMaxKey(c.weekdayCounts),
      turno_preferido: getMaxKey(c.hourCounts),
      sensibilidade_cupom: classifyCouponSensitivity(c.couponPurchases, c.totalPurchases),
      estagio_lifecycle: classifyLifecycle(c.totalPurchases),
      cupons_usados: [...c.coupons],
      updated_at: new Date().toISOString(),
    };
  });

  console.log(`Computed segments for ${records.length} customers\n`);

  // 3. Upsert into crm_customer_segments (batched)
  console.log("Upserting into crm_customer_segments...");
  let upsertedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < records.length; i += UPSERT_BATCH_SIZE) {
    const batch = records.slice(i, i + UPSERT_BATCH_SIZE);

    const { error } = await supabase
      .from("crm_customer_segments")
      .upsert(batch, { onConflict: "workspace_id, email" });

    if (error) {
      console.error(`Error upserting batch ${i}-${i + batch.length}: ${error.message}`);
      errorCount += batch.length;
    } else {
      upsertedCount += batch.length;
      process.stdout.write(`  Upserted ${upsertedCount}/${records.length}\r`);
    }
  }

  console.log(`\n\nDone! Upserted ${upsertedCount} customers, ${errorCount} errors.`);
  console.log("\nExample queries you can run in Supabase:");
  console.log("  SELECT * FROM crm_customer_segments WHERE segmento_rfm = 'champions';");
  console.log("  SELECT * FROM crm_customer_segments WHERE faixa_dia_mes = '1-5' AND segmento_rfm IN ('champions', 'loyal_customers');");
  console.log("  SELECT email, nome, telefone FROM crm_customer_segments WHERE estagio_lifecycle = 'vip';");
  console.log("  SELECT * FROM crm_customer_segments WHERE sensibilidade_cupom = 'always';");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

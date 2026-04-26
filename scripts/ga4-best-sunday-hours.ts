// Query GA4 for hour-of-day performance on Sundays.
// Returns sessions, transactions, revenue per hour averaged across the period.
// Run: npx tsx scripts/ga4-best-sunday-hours.ts

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { getGA4Report } from "../src/lib/ga4-api";

async function main() {
  const { rows } = await getGA4Report({
    dimensions: ["dayOfWeek", "hour"],
    metrics: ["sessions", "totalUsers", "transactions", "purchaseRevenue"],
    datePreset: "last_90d",
    limit: 200,
  });

  // dayOfWeek in GA4: '0' = Sunday, '1' = Monday, ... '6' = Saturday
  const sundays = rows.filter((r) => r.dimensions.dayOfWeek === "0");
  console.log(`(consultadas ${rows.length} linhas, ${sundays.length} de domingo)`);

  // Aggregate per hour (sum across the 13 Sundays in last 90d)
  const byHour = new Map<number, { sessions: number; users: number; tx: number; revenue: number }>();
  for (const r of sundays) {
    const h = parseInt(r.dimensions.hour, 10);
    if (!Number.isFinite(h)) continue;
    const acc = byHour.get(h) || { sessions: 0, users: 0, tx: 0, revenue: 0 };
    acc.sessions += Number(r.metrics.sessions || 0);
    acc.users += Number(r.metrics.totalUsers || 0);
    acc.tx += Number(r.metrics.transactions || 0);
    acc.revenue += Number(r.metrics.purchaseRevenue || 0);
    byHour.set(h, acc);
  }

  // Compute conversion rate and revenue/session
  type Row = {
    hour: number;
    sessions: number;
    users: number;
    tx: number;
    revenue: number;
    cvr: number;
    rps: number;
  };
  const result: Row[] = [];
  for (let h = 0; h < 24; h++) {
    const v = byHour.get(h) || { sessions: 0, users: 0, tx: 0, revenue: 0 };
    result.push({
      hour: h,
      sessions: v.sessions,
      users: v.users,
      tx: v.tx,
      revenue: v.revenue,
      cvr: v.sessions > 0 ? (v.tx / v.sessions) * 100 : 0,
      rps: v.sessions > 0 ? v.revenue / v.sessions : 0,
    });
  }

  // Print sorted by hour
  console.log("\n=== Domingos — performance por hora (últimos 90 dias, soma) ===\n");
  console.log(
    "Hora  | Sessões  | Usuários | Transações | Receita (R$) | CVR     | R$/sessão"
  );
  console.log("------+----------+----------+------------+--------------+---------+----------");
  for (const r of result) {
    console.log(
      `${String(r.hour).padStart(2, "0")}:00 | ${String(r.sessions).padStart(8)} | ${String(r.users).padStart(8)} | ${String(r.tx).padStart(10)} | ${r.revenue.toFixed(2).padStart(12)} | ${r.cvr.toFixed(2).padStart(5)}% | ${r.rps.toFixed(2).padStart(8)}`
    );
  }

  // Top 5 windows by revenue, transactions, sessions
  const ranked = [...result];

  console.log("\n=== Top 5 horas por RECEITA total ===");
  ranked
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
    .forEach((r, i) =>
      console.log(`${i + 1}. ${String(r.hour).padStart(2, "0")}:00 — R$ ${r.revenue.toFixed(2)} (${r.tx} pedidos, ${r.sessions} sessões)`)
    );

  console.log("\n=== Top 5 horas por TRANSAÇÕES ===");
  ranked
    .sort((a, b) => b.tx - a.tx)
    .slice(0, 5)
    .forEach((r, i) =>
      console.log(`${i + 1}. ${String(r.hour).padStart(2, "0")}:00 — ${r.tx} pedidos (CVR ${r.cvr.toFixed(2)}%)`)
    );

  console.log("\n=== Top 5 horas por SESSÕES (volume de tráfego) ===");
  ranked
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 5)
    .forEach((r, i) =>
      console.log(`${i + 1}. ${String(r.hour).padStart(2, "0")}:00 — ${r.sessions} sessões`)
    );

  console.log("\n=== Top 5 horas por CVR (entre as com >= 100 sessões) ===");
  ranked
    .filter((r) => r.sessions >= 100)
    .sort((a, b) => b.cvr - a.cvr)
    .slice(0, 5)
    .forEach((r, i) =>
      console.log(`${i + 1}. ${String(r.hour).padStart(2, "0")}:00 — CVR ${r.cvr.toFixed(2)}% (${r.tx}/${r.sessions})`)
    );

  console.log("\nTimezone do property GA4 = horário da loja (configurado no GA4).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

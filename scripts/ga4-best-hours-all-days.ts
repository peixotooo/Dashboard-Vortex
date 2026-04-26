// Heatmap textual: dia da semana × hora (sessoes, transacoes, receita, CVR).
// Run: npx tsx scripts/ga4-best-hours-all-days.ts [--days 30|60|90]
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { getGA4Report } from "../src/lib/ga4-api";

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];

async function main() {
  const arg = process.argv.find((a) => a.startsWith("--days="));
  const days = arg ? parseInt(arg.split("=")[1], 10) : 90;
  const preset = days === 30 ? "last_30d" : days === 60 ? "last_60d" : "last_90d";
  console.log(`Periodo: ultimos ${days} dias\n`);

  const { rows } = await getGA4Report({
    dimensions: ["dayOfWeek", "hour"],
    metrics: ["sessions", "totalUsers", "transactions", "purchaseRevenue"],
    datePreset: preset,
    limit: 200,
  });

  type Cell = { sessions: number; tx: number; revenue: number; cvr: number; rps: number };
  const grid: Cell[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ sessions: 0, tx: 0, revenue: 0, cvr: 0, rps: 0 }))
  );
  for (const r of rows) {
    const d = parseInt(r.dimensions.dayOfWeek, 10);
    const h = parseInt(r.dimensions.hour, 10);
    if (!Number.isFinite(d) || !Number.isFinite(h) || d < 0 || d > 6 || h < 0 || h > 23) continue;
    const c = grid[d][h];
    c.sessions = r.metrics.sessions || 0;
    c.tx = r.metrics.transactions || 0;
    c.revenue = r.metrics.purchaseRevenue || 0;
    c.cvr = c.sessions > 0 ? (c.tx / c.sessions) * 100 : 0;
    c.rps = c.sessions > 0 ? c.revenue / c.sessions : 0;
  }

  // Per-day top 3 hours by transactions
  console.log("=== Top 3 horarios por dia (por TRANSACOES) ===\n");
  for (let d = 0; d < 7; d++) {
    const ranked = grid[d]
      .map((c, h) => ({ ...c, hour: h }))
      .filter((c) => c.tx > 0)
      .sort((a, b) => b.tx - a.tx)
      .slice(0, 3);
    console.log(
      `${DAYS[d]}: ` +
        ranked
          .map(
            (r) =>
              `${String(r.hour).padStart(2, "0")}h (${r.tx} pedidos, CVR ${r.cvr.toFixed(2)}%, R$ ${r.revenue.toFixed(0)})`
          )
          .join("  |  ")
    );
  }

  // Top 5 horarios globais por receita
  console.log("\n=== Top 10 (dia, hora) por RECEITA total ===");
  const flat: Array<{ d: number; h: number; cell: Cell }> = [];
  for (let d = 0; d < 7; d++)
    for (let h = 0; h < 24; h++) flat.push({ d, h, cell: grid[d][h] });
  flat
    .sort((a, b) => b.cell.revenue - a.cell.revenue)
    .slice(0, 10)
    .forEach((s, i) =>
      console.log(
        `${i + 1}. ${DAYS[s.d]} ${String(s.h).padStart(2, "0")}h — R$ ${s.cell.revenue.toFixed(2)} (${s.cell.tx} pedidos, ${s.cell.sessions} sessoes, CVR ${s.cell.cvr.toFixed(2)}%)`
      )
    );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

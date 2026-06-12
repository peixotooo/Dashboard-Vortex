/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
/**
 * Google Ads write operations — Fase 1: pausar/ativar + orcamento.
 *
 * SEGURO POR PADRAO: mostra um preview (dry-run). So executa de verdade com --yes.
 *
 * Uso:
 *   npx tsx scripts/google-ads-mutate.ts list
 *   npx tsx scripts/google-ads-mutate.ts pause  <campaignId> [--yes]
 *   npx tsx scripts/google-ads-mutate.ts enable <campaignId> [--yes]
 *   npx tsx scripts/google-ads-mutate.ts budget <campaignId> <orcamentoDiario> [--yes]
 */
import { config } from "dotenv";

config({ path: ".env.local" });

// NOTE: google-ads-api.ts's only "@/..." import is `import type` (erased at
// runtime by tsx/esbuild), so importing it here via a relative path is safe.
import {
  getGoogleAdsCampaigns,
  getCampaignBasicInfo,
  setCampaignStatus,
  getCampaignBudgetInfo,
  setCampaignDailyBudget,
  listConversionGoals,
  setConversionGoalBiddable,
  type CampaignStatus,
} from "../src/lib/google-ads-api";

const argv = process.argv.slice(2);
const cmd = argv[0];
const YES = argv.includes("--yes");
const pos = argv.filter((a) => !a.startsWith("--"));

function bail(msg: string): never {
  console.error("\n❌ " + msg + "\n");
  process.exit(1);
}
function brl(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
/** Parse a pt-BR or plain number: "1.234,56" → 1234.56, "80,50" → 80.5, "80" → 80. */
function parseBRLNumber(raw?: string): number {
  const s = (raw || "").trim();
  if (s.includes(",")) return Number(s.replace(/\./g, "").replace(",", "."));
  return Number(s);
}
const DRY_NOTE = "\n   (DRY-RUN — nada foi alterado. Rode de novo com --yes para executar.)\n";

async function findCampaign(id: string) {
  const { campaigns } = await getGoogleAdsCampaigns({
    datePreset: "last_30d",
    statuses: ["ACTIVE", "PAUSED"],
  });
  return campaigns.find((c) => c.id === id);
}

async function cmdList() {
  const { campaigns } = await getGoogleAdsCampaigns({
    datePreset: "last_30d",
    statuses: ["ACTIVE", "PAUSED"],
  });
  const enabled = campaigns.filter((c) => c.status === "ACTIVE");
  const paused = campaigns.filter((c) => c.status === "PAUSED");
  console.log(`\n=== Campanhas ATIVAS (${enabled.length}) — gasto/orcamento 30d ===\n`);
  for (const c of enabled) {
    const bud = c.daily_budget ? brl(Number(c.daily_budget) / 100) : "—";
    console.log(`  ${c.id}  ${c.name}`);
    console.log(`        status=ATIVA  orcamento/dia=${bud}  gasto30d=${brl(c.spend)}  ROAS=${c.roas.toFixed(2)}x`);
  }
  console.log(`\n  (+ ${paused.length} pausadas — omitidas. Use 'enable <id>' para reativar uma.)`);
  console.log("\nAcoes:  pause <id> | enable <id> | budget <id> <orcamentoDiario>   (+ --yes para executar)\n");
}

async function cmdStatus(action: "pause" | "enable") {
  const id = pos[1];
  if (!id || !/^\d+$/.test(id)) bail(`Informe o campaignId (so digitos). Ex.: npx tsx scripts/google-ads-mutate.ts ${action} 123456789`);
  const status: CampaignStatus = action === "pause" ? "PAUSED" : "ENABLED";
  const target = action === "pause" ? "PAUSAR" : "ATIVAR";

  // Authoritative lookup (no date segment) so idle/paused campaigns resolve too.
  // Refuse to mutate an ID we couldn't confirm — guards against typos.
  const info = await getCampaignBasicInfo(id);
  if (!info) bail(`Nao encontrei a campanha ${id} nesta conta. Confira o ID com 'list'.`);
  const shown = info.status === "ACTIVE" ? "ATIVA" : info.status;
  console.log(`\n▶ ${target} "${info.name}" (atual: ${shown})`);

  const already = (action === "pause" && info.status !== "ACTIVE") || (action === "enable" && info.status === "ACTIVE");
  if (already) console.log(`   ⚠️  A campanha ja esta no estado desejado — a operacao nao tera efeito pratico.`);

  if (action === "pause") {
    const spendRow = await findCampaign(id); // best-effort 30d spend (idle campaigns won't appear)
    if (spendRow && spendRow.spend > 0) {
      console.log(`   ⚠️  Gastou ${brl(spendRow.spend)} nos ultimos 30d — pausar interrompe a entrega.`);
    }
  }

  if (!YES) {
    console.log(DRY_NOTE);
    return;
  }
  await setCampaignStatus(id, status);
  console.log(`\n✅ Feito: "${info.name}" (${id}) agora esta ${status === "PAUSED" ? "PAUSADA" : "ATIVA"}.\n`);
}

async function cmdBudget() {
  const id = pos[1];
  const amount = parseBRLNumber(pos[2]);
  if (!id || !/^\d+$/.test(id)) bail("Informe o campaignId (so digitos).");
  if (!(amount > 0)) bail("Informe o novo orcamento diario (> 0). Ex.: npx tsx scripts/google-ads-mutate.ts budget 123 80");

  const info = await getCampaignBudgetInfo(id);
  if (!info) bail(`Nao encontrei orcamento para a campanha ${id}. Confira o ID com 'list'.`);
  if (info.campaignStatus === "DELETED") bail(`A campanha ${id} ("${info.campaignName}") foi REMOVIDA — nao faz sentido alterar o orcamento dela.`);

  console.log(`\n▶ ORCAMENTO de "${info.campaignName}" (${info.campaignStatus})`);
  console.log(`   atual:  ${brl(info.currentDailyAmount)}/dia`);
  console.log(`   novo:   ${brl(amount)}/dia`);
  if (info.explicitlyShared || info.referenceCount > 1) {
    console.log(`   ⚠️  ATENCAO: este e um orcamento COMPARTILHADO por ${info.referenceCount} campanha(s).`);
    console.log(`       Alterar aqui muda o orcamento de TODAS elas.`);
  }

  if (!YES) {
    console.log(DRY_NOTE);
    return;
  }
  await setCampaignDailyBudget(info.budgetResourceName, amount);
  console.log(`\n✅ Feito: orcamento de "${info.campaignName}" agora e ${brl(amount)}/dia.\n`);
}

async function cmdGoals() {
  const goals = await listConversionGoals();
  console.log("\n=== Metas de conversao da conta (biddable = otimiza/lances) ===\n");
  for (const g of goals.sort((a, b) => Number(b.biddable) - Number(a.biddable))) {
    console.log(`   ${g.biddable ? "✅ ON " : "   off"}  ${g.category}~${g.origin}`);
  }
  console.log("\n  Mudar:  goal <CATEGORIA> <on|off>   (ex.: goal CONTACT off)   (+ --yes)\n");
}

async function cmdGoal() {
  const cat = (pos[1] || "").toUpperCase();
  const onoff = (pos[2] || "").toLowerCase();
  if (!cat) bail("Informe a categoria. Ex.: npx tsx scripts/google-ads-mutate.ts goal CONTACT off");
  if (onoff !== "on" && onoff !== "off") bail("Informe on|off. Ex.: goal CONTACT off");
  const biddable = onoff === "on";

  const goals = await listConversionGoals();
  const matches = goals.filter((g) => g.category === cat);
  if (!matches.length) bail(`Categoria "${cat}" nao encontrada. Rode 'goals' para ver as disponiveis.`);

  console.log(`\n▶ META "${cat}" → biddable=${biddable ? "ON (otimiza)" : "OFF (nao otimiza)"}`);
  for (const g of matches) {
    const from = g.biddable ? "ON" : "off";
    const to = biddable ? "ON" : "off";
    console.log(`   ${g.category}~${g.origin}:  ${from} → ${to}${from === to ? "  (sem mudanca)" : ""}`);
  }
  // Safety: don't let the user disable the LAST biddable purchase goal by accident.
  if (!biddable && cat === "PURCHASE") {
    console.log("   ⚠️  Desligar PURCHASE remove a venda como meta de otimizacao — tem certeza?");
  }
  if (biddable && cat !== "PURCHASE") {
    const purchaseOn = goals.some((g) => g.category === "PURCHASE" && g.biddable);
    if (!purchaseOn) console.log("   ⚠️  PURCHASE nao esta biddable — considere ativar a venda como meta.");
  }

  if (!YES) {
    console.log(DRY_NOTE);
    return;
  }
  for (const g of matches) await setConversionGoalBiddable(g.resourceName, biddable);
  console.log(`\n✅ Feito: meta ${cat} agora biddable=${biddable ? "ON" : "OFF"}.\n`);
}

async function main() {
  switch (cmd) {
    case "list":
      return cmdList();
    case "pause":
      return cmdStatus("pause");
    case "enable":
      return cmdStatus("enable");
    case "budget":
      return cmdBudget();
    case "goals":
      return cmdGoals();
    case "goal":
      return cmdGoal();
    default:
      bail(
        "Comando desconhecido.\nUse: list | pause <id> | enable <id> | budget <id> <orcamentoDiario> | " +
          "goals | goal <CATEGORIA> <on|off>   (+ --yes para executar)"
      );
  }
}

main().catch((e) => bail(e instanceof Error ? e.message : String(e)));

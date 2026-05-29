/**
 * Importacao historica VNDA -> CRM.
 *
 * O CRM RFM nasce de crm_vendas (pedidos), entao este script puxa todos
 * os pedidos confirmados da VNDA e insere apenas o que ainda nao existe
 * no CRM. Para evitar receita/frequencia duplicada, pedidos cujo codigo
 * ja aparece em crm_vendas sao ignorados quando ainda nao tem
 * source_order_id.
 *
 * Uso:
 *   npx tsx scripts/import-vnda-crm-full.ts --workspace=<uuid>
 *   npx tsx scripts/import-vnda-crm-full.ts --workspace=<uuid> --apply
 *   npx tsx scripts/import-vnda-crm-full.ts --workspace=<uuid> --apply --only-missing-customers
 *   npx tsx scripts/import-vnda-crm-full.ts --workspace=<uuid> --apply --sync-contact-list
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { runVndaCrmImport } from "../src/lib/crm/vnda-import";

type Args = {
  workspaceId?: string;
  apply: boolean;
  startDate?: string;
  endDate?: string;
  status?: string;
  includeClients: boolean;
  syncContactList: boolean;
  onlyMissingCustomers: boolean;
  contactListName?: string;
  maxOrderPages?: number;
  maxClientPages?: number;
};

function readArgs(): Args {
  const args: Args = {
    apply: false,
    includeClients: true,
    syncContactList: false,
    onlyMissingCustomers: false,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg === "--no-clients") args.includeClients = false;
    else if (arg === "--sync-contact-list") args.syncContactList = true;
    else if (arg === "--only-missing-customers") args.onlyMissingCustomers = true;
    else if (arg.startsWith("--workspace=")) args.workspaceId = arg.slice("--workspace=".length);
    else if (arg.startsWith("--start=")) args.startDate = arg.slice("--start=".length);
    else if (arg.startsWith("--end=")) args.endDate = arg.slice("--end=".length);
    else if (arg.startsWith("--status=")) args.status = arg.slice("--status=".length);
    else if (arg.startsWith("--contact-list-name=")) args.contactListName = arg.slice("--contact-list-name=".length);
    else if (arg.startsWith("--max-order-pages=")) args.maxOrderPages = Number(arg.slice("--max-order-pages=".length));
    else if (arg.startsWith("--max-client-pages=")) args.maxClientPages = Number(arg.slice("--max-client-pages=".length));
  }

  return args;
}

async function main() {
  const args = readArgs();
  if (!args.workspaceId) {
    console.error("Uso: npx tsx scripts/import-vnda-crm-full.ts --workspace=<uuid> [--apply]");
    process.exit(1);
  }

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios em .env.local");
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: workspace, error: workspaceError } = await admin
    .from("workspaces")
    .select("id, name")
    .eq("id", args.workspaceId)
    .single();
  if (workspaceError || !workspace) {
    throw new Error(`Workspace nao encontrado: ${workspaceError?.message ?? args.workspaceId}`);
  }

  console.log(`Workspace: ${workspace.name} (${workspace.id})`);
  console.log(args.apply ? "Modo: APPLY (vai escrever em crm_vendas)" : "Modo: DRY-RUN (nao escreve nada)");
  if (args.onlyMissingCustomers) {
    console.log("Escopo: somente emails que ainda nao existem em crm_vendas");
  }

  const result = await runVndaCrmImport(admin, {
    workspaceId: args.workspaceId,
    startDate: args.startDate,
    endDate: args.endDate,
    status: args.status || "confirmed",
    dryRun: !args.apply,
    includeClients: args.includeClients,
    syncContactList: args.syncContactList,
    onlyMissingCustomers: args.onlyMissingCustomers,
    contactListName: args.contactListName,
    maxOrderPages: args.maxOrderPages,
    maxClientPages: args.maxClientPages,
    onProgress: (message) => console.log(message),
  });

  console.log("\n=== Resultado ===");
  console.log(JSON.stringify(result, null, 2));
  if (!args.apply) {
    console.log("\nPara aplicar de verdade, rode novamente com --apply.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

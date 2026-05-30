/**
 * Importacao Eccosys -> CRM.
 *
 * O fluxo busca clientes em /clientes, filtra localmente por data >= 2020
 * e por emails que ainda nao existem no CRM, cruza pedidos via
 * /pedidos/documento/{cpf-cnpj}, busca itens em /pedidos/{id}/items e
 * grava em crm_vendas com source=eccosys_clientes_api.
 *
 * Uso:
 *   npx tsx scripts/import-eccosys-crm.ts --workspace=<uuid>
 *   npx tsx scripts/import-eccosys-crm.ts --workspace=<uuid> --max-clients=50
 *   npx tsx scripts/import-eccosys-crm.ts --workspace=<uuid> --apply --max-clients=50 --sync-contact-list
 *
 * Por padrao, itens so sao buscados para pedidos de 2025 em diante
 * (--items-from=2025-01-01), porque pedidos antigos entram no RFM pela
 * info basica de venda e produto antigo pode poluir preferencias atuais.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { runEccosysCrmImport } from "../src/lib/crm/eccosys-import";

type Args = {
  workspaceId?: string;
  apply: boolean;
  startDate?: string;
  onlyMissingCustomers: boolean;
  startOffset?: number;
  maxClientPages?: number;
  maxClients?: number;
  clientPageSize?: number;
  orderPageSize?: number;
  maxOrdersPerClient?: number;
  fetchItems: boolean;
  itemsFromDate?: string;
  syncContactList: boolean;
  contactListName?: string;
};

function numberArg(value: string): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function readArgs(): Args {
  const args: Args = {
    apply: false,
    onlyMissingCustomers: true,
    fetchItems: true,
    syncContactList: false,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg === "--include-existing-customers") args.onlyMissingCustomers = false;
    else if (arg === "--no-items") args.fetchItems = false;
    else if (arg === "--sync-contact-list") args.syncContactList = true;
    else if (arg.startsWith("--workspace=")) args.workspaceId = arg.slice("--workspace=".length);
    else if (arg.startsWith("--start=")) args.startDate = arg.slice("--start=".length);
    else if (arg.startsWith("--items-from=")) args.itemsFromDate = arg.slice("--items-from=".length);
    else if (arg.startsWith("--start-offset=")) args.startOffset = numberArg(arg.slice("--start-offset=".length));
    else if (arg.startsWith("--max-client-pages=")) args.maxClientPages = numberArg(arg.slice("--max-client-pages=".length));
    else if (arg.startsWith("--max-clients=")) args.maxClients = numberArg(arg.slice("--max-clients=".length));
    else if (arg.startsWith("--client-page-size=")) args.clientPageSize = numberArg(arg.slice("--client-page-size=".length));
    else if (arg.startsWith("--order-page-size=")) args.orderPageSize = numberArg(arg.slice("--order-page-size=".length));
    else if (arg.startsWith("--max-orders-per-client=")) {
      args.maxOrdersPerClient = numberArg(arg.slice("--max-orders-per-client=".length));
    } else if (arg.startsWith("--contact-list-name=")) {
      args.contactListName = arg.slice("--contact-list-name=".length);
    }
  }

  return args;
}

async function main() {
  const args = readArgs();
  if (!args.workspaceId) {
    console.error("Uso: npx tsx scripts/import-eccosys-crm.ts --workspace=<uuid> [--apply]");
    process.exit(1);
  }

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios em .env.local");
  }
  if (!process.env.ECCOSYS_API_TOKEN) {
    throw new Error("ECCOSYS_API_TOKEN e obrigatorio em .env.local");
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
  console.log("Identificacao: source=eccosys_clientes_api, channel=eccosys_clientes_api");
  console.log(`Itens: ${args.fetchItems ? `somente pedidos >= ${args.itemsFromDate || "2025-01-01"}` : "desativados"}`);
  if (args.onlyMissingCustomers) {
    console.log("Escopo: somente emails que ainda nao existem em crm_vendas");
  }
  if (args.syncContactList) {
    console.log(`Lista de contatos: ${args.contactListName || "Eccosys - Importados CRM 2020+"}`);
  }

  const result = await runEccosysCrmImport(admin, {
    workspaceId: args.workspaceId,
    startDate: args.startDate,
    dryRun: !args.apply,
    onlyMissingCustomers: args.onlyMissingCustomers,
    startOffset: args.startOffset,
    maxClientPages: args.maxClientPages,
    maxClients: args.maxClients,
    clientPageSize: args.clientPageSize,
    orderPageSize: args.orderPageSize,
    maxOrdersPerClient: args.maxOrdersPerClient,
    fetchItems: args.fetchItems,
    itemsFromDate: args.itemsFromDate,
    syncContactList: args.syncContactList,
    contactListName: args.contactListName,
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

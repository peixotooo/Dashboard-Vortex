// One-shot backfill de crm_vendas.state via VNDA Clients API.
//
// Motivação: ~90% dos clientes em crm_vendas não tem state setado
// (pedidos pré-webhook + CSV imports antigos). VNDA /api/v2/clients
// expõe recent_address.state direto, ~76% preenchido na amostra.
// Muito mais eficiente que paginar orders (que não tem address no
// list endpoint).
//
// Estratégia:
//   1. Paginar GET /api/v2/clients (100 por página, ~550 chamadas
//      pra ~55k clientes do Bulking)
//   2. Construir map email → state
//   3. Agrupar emails por state e fazer 1 UPDATE em crm_vendas por UF
//      com .in("email", chunks de 500). Só atualiza onde state IS NULL.
//
// Uso:
//   npx tsx scripts/backfill-state-from-vnda.ts --workspace=<uuid>
//   npx tsx scripts/backfill-state-from-vnda.ts --workspace=<uuid> --dry-run

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type VndaConfig = { apiToken: string; storeHost: string };

type VndaClient = {
  id: number;
  email: string | null;
  recent_address?: {
    state?: string | null;
    city?: string | null;
  } | null;
};

async function vndaListClients(
  config: VndaConfig,
  page: number,
  perPage: number,
): Promise<{ clients: VndaClient[]; totalPages: number; nextPage: number | null }> {
  const url = new URL("https://api.vnda.com.br/api/v2/clients");
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));

  // VNDA solta 5xx esporádicos no /clients quando rodando paginação
  // longa. Retry com backoff exponencial é suficiente.
  const MAX_ATTEMPTS = 5;
  let lastErr: string = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          Accept: "application/json",
          "X-Shop-Host": config.storeHost,
        },
      });
    } catch (netErr) {
      lastErr = netErr instanceof Error ? netErr.message : String(netErr);
      const wait = Math.min(8000, 500 * 2 ** (attempt - 1));
      console.warn(`  ↻ page ${page} network err, retry ${attempt}/${MAX_ATTEMPTS} em ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (res.ok) {
      const data = (await res.json()) as VndaClient[];
      let totalPages = 0;
      let nextPage: number | null = null;
      const pag = res.headers.get("X-Pagination");
      if (pag) {
        try {
          const p = JSON.parse(pag);
          totalPages = p?.total_pages ?? 0;
          nextPage = p?.next_page ? page + 1 : null;
        } catch {
          // ignore
        }
      }
      return { clients: data ?? [], totalPages, nextPage };
    }
    // 5xx transient → retry; 4xx → fatal
    if (res.status >= 500 && res.status < 600) {
      lastErr = `${res.status}`;
      const wait = Math.min(8000, 500 * 2 ** (attempt - 1));
      console.warn(`  ↻ page ${page} ${res.status}, retry ${attempt}/${MAX_ATTEMPTS} em ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    const body = await res.text().catch(() => "");
    throw new Error(`VNDA /clients ${res.status} page ${page}: ${body.slice(0, 200)}`);
  }
  throw new Error(`VNDA /clients page ${page} falhou após ${MAX_ATTEMPTS} tentativas: ${lastErr}`);
}

function parseArgs(): { workspaceId?: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  let workspaceId: string | undefined;
  let dryRun = false;
  for (const a of args) {
    if (a.startsWith("--workspace=")) workspaceId = a.slice("--workspace=".length);
    if (a === "--dry-run") dryRun = true;
  }
  return { workspaceId, dryRun };
}

async function getVndaConfig(
  admin: SupabaseClient,
  workspaceId: string,
): Promise<VndaConfig> {
  const { data, error } = await admin
    .from("vnda_connections")
    .select("api_token, store_host")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error || !data?.api_token || !data?.store_host) {
    throw new Error(`vnda_connections faltando: ${error?.message ?? "no row"}`);
  }
  const { decrypt } = await import("../src/lib/encryption");
  return { apiToken: decrypt(data.api_token), storeHost: data.store_host };
}

async function main() {
  const { workspaceId, dryRun } = parseArgs();
  if (!workspaceId) {
    console.error("Uso: npx tsx scripts/backfill-state-from-vnda.ts --workspace=<uuid> [--dry-run]");
    process.exit(1);
  }

  const admin = createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim(),
    (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
  );

  const { data: ws, error: wsErr } = await admin
    .from("workspaces").select("id, name").eq("id", workspaceId).single();
  if (wsErr || !ws) throw new Error(`workspace ${workspaceId} não encontrado`);
  console.log(`Workspace: ${ws.name} (${ws.id})${dryRun ? " (dry-run)" : ""}`);

  const config = await getVndaConfig(admin, workspaceId);
  console.log(`VNDA host: ${config.storeHost}`);

  // Contexto pré-backfill
  const { count: nullsBefore } = await admin
    .from("crm_vendas")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("state", null);
  console.log(`crm_vendas com state NULL antes do backfill: ${nullsBefore ?? 0}`);

  // Paginar /clients
  const PER_PAGE = 100;
  const emailToState = new Map<string, string>();
  let totalFetched = 0;
  let withState = 0;
  let noState = 0;
  let noEmail = 0;

  let page = 1;
  let totalPages = 0;
  while (true) {
    const { clients, totalPages: tp, nextPage } = await vndaListClients(config, page, PER_PAGE);
    if (page === 1 && tp > 0) totalPages = tp;
    totalFetched += clients.length;
    for (const c of clients) {
      const email = (c.email || "").trim().toLowerCase();
      if (!email) { noEmail++; continue; }
      const state = (c.recent_address?.state || "").trim().toUpperCase();
      if (state.length === 2) {
        emailToState.set(email, state);
        withState++;
      } else {
        noState++;
      }
    }
    if (page % 25 === 0 || page === totalPages) {
      console.log(`  page ${page}/${totalPages || "?"} — fetched ${totalFetched}, com state ${withState}, sem state ${noState}, sem email ${noEmail}`);
    }
    if (nextPage === null || clients.length < PER_PAGE) break;
    page = nextPage;
  }

  console.log(`\nVNDA /clients pagination completa:`);
  console.log(`  Clientes fetched:    ${totalFetched}`);
  console.log(`  Com state:           ${withState}`);
  console.log(`  Sem state:           ${noState}`);
  console.log(`  Sem email:           ${noEmail}`);
  console.log(`  Mapa final:          ${emailToState.size} emails únicos`);

  // Agrupa emails por state pra batch UPDATE
  const byState = new Map<string, string[]>();
  for (const [email, state] of emailToState) {
    if (!byState.has(state)) byState.set(state, []);
    byState.get(state)!.push(email);
  }
  console.log(`  UFs distintas:       ${byState.size}`);

  if (dryRun) {
    const top = [...byState.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 15);
    console.log(`\nTop UFs (dry-run):`);
    for (const [uf, emails] of top) console.log(`  ${uf}: ${emails.length} emails`);
    return;
  }

  // UPDATE em batch: 1 query por (UF, chunk de 500 emails). Só onde state IS NULL.
  const CHUNK = 500;
  const counters = { totalUpdated: 0, errors: 0 };
  for (const [uf, emails] of byState) {
    let updatedForUf = 0;
    for (let i = 0; i < emails.length; i += CHUNK) {
      const chunk = emails.slice(i, i + CHUNK);
      const { error, count } = await admin
        .from("crm_vendas")
        .update({ state: uf }, { count: "exact" })
        .eq("workspace_id", workspaceId)
        .in("email", chunk)
        .is("state", null);
      if (error) {
        counters.errors++;
        console.warn(`  ⚠ UPDATE ${uf} chunk ${i / CHUNK}: ${error.message}`);
        continue;
      }
      updatedForUf += count ?? 0;
    }
    counters.totalUpdated += updatedForUf;
    console.log(`  ${uf}: ${updatedForUf} linhas`);
  }

  const { count: nullsAfter } = await admin
    .from("crm_vendas")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("state", null);

  console.log("\nResumo:");
  console.log(`  Linhas atualizadas:   ${counters.totalUpdated}`);
  console.log(`  Errors:               ${counters.errors}`);
  console.log(`  state NULL antes:     ${nullsBefore ?? 0}`);
  console.log(`  state NULL depois:    ${nullsAfter ?? 0}`);
  console.log(`  Recuperados:          ${(nullsBefore ?? 0) - (nullsAfter ?? 0)}`);
  console.log(`\nPróximo passo: invalidar crm_rfm_snapshot pro filtro do /crm refletir.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

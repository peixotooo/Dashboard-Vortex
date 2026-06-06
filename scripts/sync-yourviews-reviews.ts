/* eslint-disable @typescript-eslint/no-explicit-any */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { getYourViewsConfig, iterateAllReviews } from "../src/lib/reviews/yourviews-api";
import {
  syncYourViewsReviews,
  mapYourViewsReview,
  type ProductFilter,
} from "../src/lib/reviews/sync";

// Extração em massa das avaliações da Yourviews → tabela `reviews`, vinculada
// ao catálogo VNDA (shelf_products).
//
//   Dry-run (não grava):     npx tsx scripts/sync-yourviews-reviews.ts --workspace=<uuid>
//   Importar (default):      ... --apply
//   Refazer do zero:         ... --apply --reset
//   Só produtos ativos:      ... --apply --active-only
//   Importar tudo (sem filtro VNDA):            ... --apply --all
//   Só os novos desde data:  ... --apply --date-from=2026-01-01
//
// Por padrão importa todo produto que EXISTE na VNDA (ativo ou inativo) — pois
// produtos esgotados ficam inativos e voltam. Descarta só o que não existe mais
// no catálogo. Use --active-only pra restringir aos ativos.

type Args = {
  workspaceId?: string;
  apply: boolean;
  reset: boolean;
  filter: ProductFilter;
  dateFrom?: string;
  count: number;
  maxPages?: number;
};

function readArgs(): Args {
  const args: Args = { apply: false, reset: false, filter: "known", count: 50 };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--apply") args.apply = true;
    else if (arg === "--reset") args.reset = true;
    else if (arg === "--active-only") args.filter = "active";
    else if (arg === "--include-inactive") args.filter = "known";
    else if (arg === "--all") args.filter = "all";
    else if (arg.startsWith("--workspace=")) args.workspaceId = arg.slice("--workspace=".length);
    else if (arg.startsWith("--date-from=")) args.dateFrom = arg.slice("--date-from=".length);
    else if (arg.startsWith("--count=")) args.count = Number(arg.slice("--count=".length)) || 50;
    else if (arg.startsWith("--max-pages=")) args.maxPages = Number(arg.slice("--max-pages=".length)) || undefined;
  }
  return args;
}

async function resolveWorkspace(admin: any, workspaceId?: string) {
  if (workspaceId) {
    const { data } = await admin.from("workspaces").select("id, name").eq("id", workspaceId).single();
    if (!data) throw new Error(`Workspace não encontrado: ${workspaceId}`);
    return data;
  }
  const { data } = await admin.from("workspaces").select("id, name").ilike("name", "%bulking%").limit(1).single();
  if (!data) throw new Error("Workspace não informado e Bulking não encontrado. Use --workspace=<uuid>.");
  return data;
}

const FILTER_LABEL: Record<ProductFilter, string> = {
  active: "só produtos ATIVOS na VNDA",
  known: "produtos que existem na VNDA (ativos + inativos)",
  all: "TUDO (sem filtro de catálogo)",
};

async function main() {
  const args = readArgs();

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios em .env.local");
  }
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const ws = await resolveWorkspace(admin, args.workspaceId);
  console.log(`Workspace: ${ws.name} (${ws.id})`);
  console.log(args.apply ? "Modo: APPLY (grava em reviews)" : "Modo: DRY-RUN (não grava nada)");
  console.log(`Filtro: ${FILTER_LABEL[args.filter]}`);
  if (args.reset) console.log("Reset: apaga as avaliações Yourviews atuais antes de importar.");
  if (args.dateFrom) console.log(`Incremental desde: ${args.dateFrom}`);

  const yvConfig = await getYourViewsConfig(ws.id);
  if (!yvConfig) {
    console.error("\nCredenciais da Yourviews não encontradas (yourviews_connections ou env YOURVIEWS_*).");
    process.exit(1);
  }

  if (!args.apply) {
    console.log("\nAmostra (até 2 páginas, sem gravar)...");
    let n = 0;
    for await (const raw of iterateAllReviews(yvConfig, { count: args.count, dateFrom: args.dateFrom, maxPages: args.maxPages ?? 2 })) {
      n++;
      if (n <= 3) {
        const m = mapYourViewsReview(ws.id, raw);
        console.log(`\n#${n} ReviewId=${m.external_id} ★${m.rating} ${m.verified_buyer ? "[verificado]" : ""}`);
        console.log(`  Produto: ${m.product_name ?? "?"} (yvId ${m.product_id ?? "?"})`);
        console.log(`  Autor:   ${m.author_name ?? "?"}`);
        console.log(`  Texto:   ${(m.body ?? "").slice(0, 100)}`);
        if (m.media.length) console.log(`  Fotos:   ${m.media.length} (${m.media[0].url})`);
      }
    }
    console.log(`\nAmostra: ${n} avaliações lidas. Rode com --apply pra importar (${FILTER_LABEL[args.filter]}).`);
    return;
  }

  const t0 = Date.now();
  const result = await syncYourViewsReviews(ws.id, {
    config: yvConfig,
    dateFrom: args.dateFrom,
    count: args.count,
    maxPages: args.maxPages,
    productFilter: args.filter,
    reset: args.reset,
    onProgress: (msg) => console.log(msg),
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log("\n=== Resultado ===");
  console.log(`  Lidas da Yourviews:     ${result.fetched}`);
  console.log(`  Vinculadas à VNDA:      ${result.matched}`);
  console.log(`  Inseridas (novas):      ${result.inserted}`);
  console.log(`  Com foto de cliente:    ${result.with_photos}`);
  console.log(`  Puladas (fora da VNDA): ${result.skipped_unknown}`);
  console.log(`  Puladas (inativas):     ${result.skipped_inactive}`);
  console.log(`  Páginas:                ${result.pages}`);
  console.log(`  Tempo:                  ${dt}s`);
  if (result.errors.length) console.log(`  Erros: ${result.errors.join("; ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

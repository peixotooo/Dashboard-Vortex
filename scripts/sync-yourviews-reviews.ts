/* eslint-disable @typescript-eslint/no-explicit-any */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import {
  getYourViewsConfig,
  iterateAllReviews,
} from "../src/lib/reviews/yourviews-api";
import { syncYourViewsReviews, mapYourViewsReview } from "../src/lib/reviews/sync";

// Extração em massa das avaliações da Yourviews → tabela `reviews`.
//
//   Dry-run (padrão, não grava): npx tsx scripts/sync-yourviews-reviews.ts --workspace=<uuid>
//   Aplicar de verdade:          npx tsx scripts/sync-yourviews-reviews.ts --workspace=<uuid> --apply
//   Só os novos desde uma data:  ... --apply --date-from=2026-01-01
//
// Credenciais: yourviews_connections (workspace) ou env YOURVIEWS_STORE_KEY /
// YOURVIEWS_API_USERNAME / YOURVIEWS_API_PASSWORD.

type Args = {
  workspaceId?: string;
  apply: boolean;
  dateFrom?: string;
  count: number;
  maxPages?: number;
};

function readArgs(): Args {
  const args: Args = { apply: false, count: 50 };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--apply") args.apply = true;
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
  // Default: Bulking (mesma convenção dos outros scripts de serviço).
  const { data } = await admin.from("workspaces").select("id, name").ilike("name", "%bulking%").limit(1).single();
  if (!data) throw new Error("Workspace não informado e Bulking não encontrado. Use --workspace=<uuid>.");
  return data;
}

async function main() {
  const args = readArgs();

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios em .env.local");
  }
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const ws = await resolveWorkspace(admin, args.workspaceId);
  console.log(`Workspace: ${ws.name} (${ws.id})`);
  console.log(args.apply ? "Modo: APPLY (grava em reviews)" : "Modo: DRY-RUN (não grava nada)");
  if (args.dateFrom) console.log(`Incremental desde: ${args.dateFrom}`);

  const yvConfig = await getYourViewsConfig(ws.id);
  if (!yvConfig) {
    console.error(
      "\nCredenciais da Yourviews não encontradas.\n" +
        "Configure em yourviews_connections (workspace) ou no .env.local:\n" +
        "  YOURVIEWS_STORE_KEY=...\n  YOURVIEWS_API_USERNAME=...\n  YOURVIEWS_API_PASSWORD=...\n"
    );
    process.exit(1);
  }

  if (!args.apply) {
    // Dry-run: busca uma amostra (até 2 páginas) e mostra como ficaria.
    console.log("\nBuscando amostra (até 2 páginas)...");
    let n = 0;
    for await (const raw of iterateAllReviews(yvConfig, {
      count: args.count,
      dateFrom: args.dateFrom,
      maxPages: args.maxPages ?? 2,
    })) {
      n++;
      if (n <= 3) {
        const mapped = mapYourViewsReview(ws.id, raw);
        console.log(`\n#${n} ReviewId=${mapped.external_id} ★${mapped.rating} ${mapped.verified_buyer ? "[verificado]" : ""}`);
        console.log(`  Produto: ${mapped.product_name ?? "?"} (id ${mapped.product_id ?? "?"})`);
        console.log(`  Autor:   ${mapped.author_name ?? "?"}`);
        console.log(`  Título:  ${mapped.title ?? "—"}`);
        console.log(`  Texto:   ${(mapped.body ?? "").slice(0, 120)}`);
        if (mapped.custom_fields.length) console.log(`  Campos:  ${mapped.custom_fields.map((c) => `${c.name}=${c.values.join("/")}`).join(", ")}`);
        if (mapped.media.length) console.log(`  Mídia:   ${mapped.media.length} foto(s)`);
      }
    }
    console.log(`\nAmostra: ${n} avaliações lidas (sem gravar). Rode com --apply pra importar tudo.`);
    return;
  }

  const t0 = Date.now();
  const result = await syncYourViewsReviews(ws.id, {
    config: yvConfig,
    dateFrom: args.dateFrom,
    count: args.count,
    maxPages: args.maxPages,
    onProgress: (msg) => console.log(msg),
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log("\n=== Resultado ===");
  console.log(`  Lidas:      ${result.fetched}`);
  console.log(`  Inseridas:  ${result.inserted} (novas; duplicadas ignoradas)`);
  console.log(`  Páginas:    ${result.pages}`);
  console.log(`  Tempo:      ${dt}s`);
  if (result.errors.length) console.log(`  Erros:      ${result.errors.join("; ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

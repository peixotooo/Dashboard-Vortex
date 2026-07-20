import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import { config as loadEnv } from "dotenv";
import {
  inferPspColor,
  inferPspFamily,
  isPspOnDemandFamily,
} from "../src/lib/psp/engine.ts";

type CsvRow = {
  SKU?: string;
  "Nome do Produto"?: string;
};

type ImportedProduct = {
  sku: string;
  name: string;
  family: "camiseta" | "regata";
  color: string | null;
};

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function usage(): never {
  throw new Error(
    "Uso: npm run import:psp-on-demand -- --file lista.csv --workspace-id UUID [--env .env.local] [--apply]"
  );
}

const file = argument("--file");
const workspaceId = argument("--workspace-id");
if (!file || !workspaceId) usage();

const envFile = argument("--env") ?? ".env.local";
loadEnv({ path: path.resolve(envFile), quiet: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
if (!supabaseUrl || !serviceKey) {
  throw new Error(`Credenciais do Supabase não encontradas em ${envFile}`);
}

const input = parse(fs.readFileSync(path.resolve(file)), {
  columns: true,
  delimiter: ";",
  bom: true,
  skip_empty_lines: true,
  trim: true,
}) as CsvRow[];

const productsBySku = new Map<string, ImportedProduct>();
for (const row of input) {
  const sku = String(row.SKU ?? "").trim().toLowerCase();
  const name = String(row["Nome do Produto"] ?? "").trim();
  if (!sku || !name) throw new Error("CSV contém uma linha sem SKU ou nome do produto");

  const family = inferPspFamily(name);
  if (!isPspOnDemandFamily(family)) {
    throw new Error(`${sku} (${name}) não é camiseta nem regata`);
  }

  const current = productsBySku.get(sku);
  if (current && current.name !== name) {
    throw new Error(`SKU duplicado com nomes diferentes: ${sku}`);
  }

  const inferredColor = inferPspColor(name);
  productsBySku.set(sku, {
    sku,
    name,
    family,
    color: inferredColor === "sem cor" ? null : inferredColor,
  });
}

const products = [...productsBySku.values()];
const duplicateCount = input.length - products.length;
const missingColor = products.filter((product) => product.color == null);
const sourceDate = path.basename(file).match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? "sem data";
const apply = process.argv.includes("--apply");

console.log(`Linhas: ${input.length}`);
console.log(`SKUs únicos: ${products.length}`);
console.log(`Duplicatas removidas: ${duplicateCount}`);
console.log(`Camisetas: ${products.filter((product) => product.family === "camiseta").length}`);
console.log(`Regatas: ${products.filter((product) => product.family === "regata").length}`);
console.log(`Sem cor explícita no nome: ${missingColor.length}`);
if (missingColor.length > 0) {
  console.log(missingColor.map((product) => `${product.sku} ${product.name}`).join("\n"));
}

if (!apply) {
  console.log("Simulação concluída. Use --apply para gravar no banco.");
  process.exit(0);
}

const db = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: existingRows, error: existingError } = await db
  .from("psp_product_settings")
  .select("sku, family, color, units_per_roll, lead_time_days, base_sku, made_to_order_override, active, notes")
  .eq("workspace_id", workspaceId)
  .in("sku", products.map((product) => product.sku));
if (existingError) throw existingError;

const existingBySku = new Map(
  (existingRows ?? []).map((row) => [String(row.sku).toLowerCase(), row])
);
const now = new Date().toISOString();
const rows = products.map((product) => {
  const current = existingBySku.get(product.sku);
  return {
    workspace_id: workspaceId,
    sku: product.sku,
    family: current?.family ?? product.family,
    color: current?.color ?? product.color,
    units_per_roll: current?.units_per_roll ?? null,
    lead_time_days: current?.lead_time_days ?? null,
    base_sku: current?.base_sku ?? null,
    made_to_order_override: true,
    active: true,
    notes: current?.notes || `Lista sob demanda ${sourceDate}: ${product.name}`,
    updated_at: now,
  };
});

for (let index = 0; index < rows.length; index += 100) {
  const { error } = await db
    .from("psp_product_settings")
    .upsert(rows.slice(index, index + 100), { onConflict: "workspace_id,sku" });
  if (error) throw error;
}

const { count, error: verificationError } = await db
  .from("psp_product_settings")
  .select("sku", { count: "exact", head: true })
  .eq("workspace_id", workspaceId)
  .eq("made_to_order_override", true)
  .in("sku", products.map((product) => product.sku));
if (verificationError) throw verificationError;
if (count !== products.length) {
  throw new Error(`Importação incompleta: ${count ?? 0}/${products.length} SKUs confirmados`);
}

console.log(`Importação concluída: ${count} produtos sob demanda gravados.`);

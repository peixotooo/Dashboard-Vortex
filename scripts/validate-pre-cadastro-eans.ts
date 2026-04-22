/**
 * Validate (and optionally fix) EAN-13 codes for every child product
 * created by pre-cadastro collections in Eccosys.
 *
 * Background: pre-cadastro used to generate EAN-14 codes (14 digits with a
 * leading "1" indicator). We switched to EAN-13. This script audits every
 * child product (`{parentCodigo}-{i}`) of every submitted item across all
 * pre-cadastro collections and either reports invalid EANs (default) or
 * regenerates them and PUTs the fix to Eccosys (--apply).
 *
 * Usage:
 *   npx tsx scripts/validate-pre-cadastro-eans.ts                 # dry-run, prints report
 *   npx tsx scripts/validate-pre-cadastro-eans.ts --apply         # actually fix in Eccosys
 *   npx tsx scripts/validate-pre-cadastro-eans.ts --collection X  # restrict to one collection id
 *
 * Required env (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ECCOSYS_API_TOKEN
 *   ECCOSYS_AMBIENTE
 */

import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";

// ---- Load .env.local then .env.cron (Eccosys creds live in .env.cron) ----
for (const fname of [".env.local", ".env.cron"]) {
  const p = path.resolve(__dirname, "..", fname);
  if (!fs.existsSync(p)) continue;
  fs.readFileSync(p, "utf8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    });
}

import { eccosys } from "../src/lib/eccosys/client";
import { generateEAN13, isValidEAN13 } from "../src/lib/pre-cadastro/ean13";

// ---- CLI ----
const APPLY = process.argv.includes("--apply");
const COLL_ARG_IDX = process.argv.indexOf("--collection");
const ONLY_COLLECTION = COLL_ARG_IDX > -1 ? process.argv[COLL_ARG_IDX + 1] : null;

// ---- Supabase admin ----
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

type Collection = {
  id: string;
  name: string;
  workspace_id: string;
  grade: string[] | null;
  status: string;
  total_items: number | null;
  submitted_items: number | null;
};

type Item = {
  id: string;
  collection_id: string;
  codigo: string | null;
  ecc_product_id: number | null;
  status: string;
};

type ChildProduct = {
  id?: number | string;
  codigo?: string;
  gtin?: string | null;
  gtinEmbalagem?: string | null;
};

type ChildResult = {
  parentCodigo: string;
  childCodigo: string;
  eccId: string | number | null;
  gtin: string | null;
  gtinEmbalagem: string | null;
  gtinValid: boolean;
  embalagemValid: boolean;
  newGtin?: string;
  applied?: boolean;
  error?: string;
};

async function fetchCollections(): Promise<Collection[]> {
  let q = supabase
    .from("product_collections")
    .select("id, name, workspace_id, grade, status, total_items, submitted_items")
    .order("created_at", { ascending: false });
  if (ONLY_COLLECTION) q = q.eq("id", ONLY_COLLECTION);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Collection[];
}

async function fetchSubmittedItems(collectionId: string): Promise<Item[]> {
  const { data, error } = await supabase
    .from("collection_items")
    .select("id, collection_id, codigo, ecc_product_id, status")
    .eq("collection_id", collectionId)
    .eq("status", "submitted");
  if (error) throw error;
  return (data ?? []).filter((it) => it.codigo) as Item[];
}

async function fetchChild(codigo: string): Promise<ChildProduct | null> {
  try {
    const res = await eccosys.get<ChildProduct | ChildProduct[]>(`/produtos/${codigo}`);
    if (Array.isArray(res)) return res[0] ?? null;
    return res ?? null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/404/.test(msg)) return null;
    throw e;
  }
}

async function fixChildEAN(child: ChildProduct, newGtin: string): Promise<void> {
  if (!child.id) throw new Error("child sem id");
  await eccosys.put("/produtos", {
    id: String(child.id),
    codigo: child.codigo,
    gtin: newGtin,
    gtinEmbalagem: newGtin,
  });
}

function freshEAN(): string {
  let ean = generateEAN13();
  while (!isValidEAN13(ean)) ean = generateEAN13();
  return ean;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (will write to Eccosys)" : "DRY RUN"}`);
  if (ONLY_COLLECTION) console.log(`Restricted to collection: ${ONLY_COLLECTION}`);

  const collections = await fetchCollections();
  console.log(`\nFound ${collections.length} pre-cadastro collection(s).`);

  let totalChildren = 0;
  let totalInvalid = 0;
  let totalFixed = 0;
  let totalErrors = 0;
  const allBadRows: ChildResult[] = [];

  for (const coll of collections) {
    const grade = (coll.grade && coll.grade.length > 0) ? coll.grade : ["P", "M", "G", "GG", "XGG"];
    const items = await fetchSubmittedItems(coll.id);
    console.log(
      `\n— Collection [${coll.name}] (${coll.id}) — submitted items: ${items.length}, grade size: ${grade.length}`
    );

    for (const item of items) {
      const parentCodigo = item.codigo!;
      for (let i = 0; i < grade.length; i++) {
        const childCodigo = `${parentCodigo}-${i + 1}`;
        let child: ChildProduct | null;
        try {
          child = await fetchChild(childCodigo);
        } catch (err) {
          totalErrors++;
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`  ! ${childCodigo}: fetch error: ${msg}`);
          continue;
        }
        if (!child) {
          // Likely children weren't created for this parent; skip silently
          continue;
        }
        totalChildren++;
        const gtin = child.gtin ?? null;
        const gtinEmb = child.gtinEmbalagem ?? null;
        const gtinValid = !!gtin && isValidEAN13(gtin);
        const embValid = !!gtinEmb && isValidEAN13(gtinEmb);
        const row: ChildResult = {
          parentCodigo,
          childCodigo,
          eccId: child.id ?? null,
          gtin,
          gtinEmbalagem: gtinEmb,
          gtinValid,
          embalagemValid: embValid,
        };

        if (!gtinValid || !embValid) {
          totalInvalid++;
          row.newGtin = freshEAN();
          if (APPLY) {
            try {
              await fixChildEAN(child, row.newGtin);
              row.applied = true;
              totalFixed++;
            } catch (err) {
              row.error = err instanceof Error ? err.message : String(err);
              totalErrors++;
            }
          }
          allBadRows.push(row);
          console.log(
            `  ${APPLY ? (row.applied ? "✓ FIXED" : "✗ FAIL ") : "·"} ${childCodigo}: ` +
              `gtin=${gtin ?? "∅"}(${gtinValid ? "ok" : "bad"}) ` +
              `gtinEmb=${gtinEmb ?? "∅"}(${embValid ? "ok" : "bad"})` +
              (row.newGtin ? ` → ${row.newGtin}` : "") +
              (row.error ? ` :: ${row.error}` : "")
          );
        }
      }
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Children inspected : ${totalChildren}`);
  console.log(`Invalid EAN-13     : ${totalInvalid}`);
  if (APPLY) {
    console.log(`Fixed in Eccosys   : ${totalFixed}`);
    console.log(`Errors             : ${totalErrors}`);
  } else {
    console.log(`(dry-run — re-run with --apply to write fixes to Eccosys)`);
  }

  // Persist a JSON report next to the script
  const reportPath = path.resolve(
    __dirname,
    `../pre-cadastro-ean-audit-${APPLY ? "applied" : "dryrun"}.json`
  );
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      { mode: APPLY ? "apply" : "dry-run", totalChildren, totalInvalid, totalFixed, totalErrors, rows: allBadRows },
      null,
      2
    )
  );
  console.log(`Report saved to: ${reportPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

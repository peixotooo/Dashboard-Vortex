// POST /api/pricing/import/cmv — importa CMV a partir de CSV.
//
// Aceita duas modalidades:
//   1. multipart/form-data com field 'file' (upload via UI)
//   2. JSON { source: 'public', filename: 'SENSE - BULKING - BD.csv' } — lê de
//      /public no servidor. Útil pra import inicial sem subir o arquivo de novo.
//
// Resposta: { total, imported, skipped, with_total, with_pl_only, empty }
//
// Inserções vão pra product_costs com source='csv'. Upsert por (workspace_id, sku)
// — sobrescreve valores anteriores marcados como csv ou manual sem cost.

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { requireAdmin } from "@/lib/pricing/supabase";
import { parseCogsCsv, type CsvCogsRow } from "@/lib/pricing/csv-import";

async function readCsvFromRequest(request: NextRequest): Promise<string | null> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (file instanceof File) {
      return await file.text();
    }
    return null;
  }
  // JSON path
  const body = await request.json().catch(() => ({}));
  if (body.source === "public" && typeof body.filename === "string") {
    const fullPath = path.join(process.cwd(), "public", body.filename);
    return fs.readFile(fullPath, "utf-8");
  }
  if (typeof body.csv === "string") return body.csv;
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const text = await readCsvFromRequest(request);
    if (!text) {
      return NextResponse.json(
        { error: "CSV não fornecido. Use multipart/form-data com 'file' ou JSON { source: 'public', filename }." },
        { status: 400 }
      );
    }

    const parsed = parseCogsCsv(text);
    const toInsert = parsed.rows.filter(
      (r): r is CsvCogsRow & { cogs: number } => r.cogs != null && r.cogs > 0
    );

    // Insere em chunks pra não estourar o limite de payload do Supabase
    const CHUNK = 500;
    let imported = 0;
    const errors: string[] = [];
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const chunk = toInsert.slice(i, i + CHUNK).map((r) => ({
        workspace_id: auth.workspaceId,
        sku: r.sku,
        cost: r.cogs,
        source: "csv",
        notes: `${r.source_field}${r.name ? ` · ${r.name}` : ""}`,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await auth.supabase
        .from("product_costs")
        .upsert(chunk, { onConflict: "workspace_id,sku" });
      if (error) {
        errors.push(`chunk ${i / CHUNK + 1}: ${error.message}`);
      } else {
        imported += chunk.length;
      }
    }

    return NextResponse.json({
      total: parsed.total,
      with_total: parsed.with_total,
      with_pl_only: parsed.with_pl_only,
      empty: parsed.empty,
      imported,
      errors: errors.slice(0, 5),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

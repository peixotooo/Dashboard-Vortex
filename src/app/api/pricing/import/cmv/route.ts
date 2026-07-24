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

const MAX_CSV_BYTES = 10 * 1024 * 1024;
const SAFE_PUBLIC_CSV = /^[a-z0-9][a-z0-9._ ()-]{0,180}\.csv$/i;

class CsvImportRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413
  ) {
    super(message);
  }
}

function assertBodySize(request: NextRequest) {
  const raw = request.headers.get("content-length");
  if (!raw) return;
  const size = Number(raw);
  if (!Number.isFinite(size) || size < 0 || size > MAX_CSV_BYTES) {
    throw new CsvImportRequestError("CSV excede o limite de 10 MB.", 413);
  }
}

async function readPublicCsv(filenameValue: string): Promise<string> {
  const filename = filenameValue.trim();
  if (
    !SAFE_PUBLIC_CSV.test(filename) ||
    filename !== path.basename(filename)
  ) {
    throw new CsvImportRequestError("Nome de arquivo CSV inválido.", 400);
  }

  const publicRoot = await fs.realpath(path.resolve(process.cwd(), "public"));
  const candidate = path.resolve(publicRoot, filename);
  if (path.dirname(candidate) !== publicRoot) {
    throw new CsvImportRequestError("Nome de arquivo CSV inválido.", 400);
  }

  let target: string;
  let stat;
  try {
    const linkStat = await fs.lstat(candidate);
    if (linkStat.isSymbolicLink()) {
      throw new CsvImportRequestError("Arquivo CSV inválido.", 400);
    }
    target = await fs.realpath(candidate);
    stat = await fs.stat(target);
  } catch (error) {
    if (error instanceof CsvImportRequestError) throw error;
    throw new CsvImportRequestError("Arquivo CSV não encontrado.", 400);
  }

  if (
    path.dirname(target) !== publicRoot ||
    !stat.isFile() ||
    stat.size > MAX_CSV_BYTES
  ) {
    throw new CsvImportRequestError(
      stat.size > MAX_CSV_BYTES
        ? "CSV excede o limite de 10 MB."
        : "Arquivo CSV inválido.",
      stat.size > MAX_CSV_BYTES ? 413 : 400
    );
  }
  return fs.readFile(target, "utf-8");
}

async function readCsvFromRequest(request: NextRequest): Promise<string | null> {
  assertBodySize(request);
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (file instanceof File) {
      if (
        file.size > MAX_CSV_BYTES ||
        !file.name.toLowerCase().endsWith(".csv")
      ) {
        throw new CsvImportRequestError(
          file.size > MAX_CSV_BYTES
            ? "CSV excede o limite de 10 MB."
            : "Envie um arquivo .csv válido.",
          file.size > MAX_CSV_BYTES ? 413 : 400
        );
      }
      return await file.text();
    }
    return null;
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_CSV_BYTES) {
    throw new CsvImportRequestError("CSV excede o limite de 10 MB.", 413);
  }
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    body =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
  } catch {
    throw new CsvImportRequestError("JSON inválido.", 400);
  }

  if (body.source === "public" && typeof body.filename === "string") {
    return readPublicCsv(body.filename);
  }
  if (typeof body.csv === "string") {
    if (Buffer.byteLength(body.csv, "utf8") > MAX_CSV_BYTES) {
      throw new CsvImportRequestError("CSV excede o limite de 10 MB.", 413);
    }
    return body.csv;
  }
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
    if (error instanceof CsvImportRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(
      "[pricing/import/cmv]",
      error instanceof Error ? error.message : "import_failed"
    );
    return NextResponse.json({ error: "Falha ao importar o CSV." }, { status: 500 });
  }
}

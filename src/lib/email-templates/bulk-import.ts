// src/lib/email-templates/bulk-import.ts
//
// Shared helper for the async bulk-import flow into a Locaweb list:
//
//   1. Build a CSV from the contacts
//   2. Upload to Supabase Storage on a public URL
//   3. POST /contact_imports with { contact_import: { list_ids, url } }
//   4. Poll the import status until "Finalizado" or "Erro inesperado"
//
// Used by:
//   • CRM "Criar lista de email" dialog (POST /lists/[id]/bulk-import)
//   • materializeSegmentList for the suggestion dispatch flow (RFM
//     cluster → Locaweb list)
//
// Important body shape gotcha (see lib/locaweb/email-marketing.ts):
// the `contact_import` wrapper accepts ONLY `list_ids` + `url`. Any
// other field (name, description, has_header) triggers 500.

import {
  createContactImport,
  getContactImport,
  normalizeImportStatus,
  type ContactImportStatus,
  type LocawebCreds,
} from "@/lib/locaweb/email-marketing";
import { createAdminClient } from "@/lib/supabase-admin";
import { randomUUID } from "crypto";

const BUCKET = "email-list-imports";

let bucketKnownToExist = false;

async function ensureBucket() {
  if (bucketKnownToExist) return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim().replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
  await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: true,
      file_size_limit: 50 * 1024 * 1024,
    }),
  }).catch(() => {});
  bucketKnownToExist = true;
}

function csvCell(v: string): string {
  if (!/[",\n\r]/.test(v)) return v;
  return `"${v.replace(/"/g, '""')}"`;
}

function buildCsv(rows: Array<{ email: string; name?: string | null }>): string {
  // Locaweb requires `email` as the first column header, lowercase.
  const lines = ["email,name"];
  for (const r of rows) {
    lines.push(`${csvCell(r.email)},${csvCell(r.name?.trim() ?? "")}`);
  }
  return lines.join("\n");
}

async function uploadCsv(path: string, csv: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim().replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
  const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "text/csv",
      "x-upsert": "true",
    },
    body: csv,
  });
  if (!r.ok) {
    throw new Error(`Falha ao subir CSV pro storage (HTTP ${r.status}).`);
  }
  return `${url}/storage/v1/object/public/${BUCKET}/${path}`;
}

export interface BulkImportResult {
  import_id: string;
  list_ids: Array<number | string>;
  total_lines: number;
  created_count: number;
  updated_count: number;
  errors_count: number;
  csv_path: string;
}

export interface BulkImportOptions {
  /** Locaweb credentials. */
  creds: LocawebCreds;
  /** List ids to bind contacts to. */
  list_ids: Array<number | string>;
  /** Contacts to import. Email is required; name optional. */
  contacts: Array<{ email: string; name?: string | null }>;
  /** Optional path prefix in storage (helps debugging). Defaults to a uuid. */
  storage_prefix?: string;
  /** Max time to wait for the import to finish, in ms. Default 60s. */
  timeout_ms?: number;
  /** Poll interval in ms. Default 2s. */
  poll_interval_ms?: number;
}

/**
 * Fire-and-wait bulk import. Builds CSV → uploads → calls Locaweb →
 * polls until the import settles. Throws on any failure.
 *
 * Caller is responsible for deduping/validating contacts — we trust
 * what we get and forward it to Locaweb. (Garbage in, errors_count out.)
 *
 * After the import finishes (success or error), the CSV is left in the
 * bucket — the caller can fetch it for diagnostics or schedule a sweep.
 */
export async function bulkImportContacts(
  opts: BulkImportOptions
): Promise<BulkImportResult> {
  if (opts.contacts.length === 0) {
    throw new Error("Nenhum contato para importar.");
  }
  if (opts.list_ids.length === 0) {
    throw new Error("Nenhum list_id alvo informado.");
  }

  await ensureBucket();
  const objectPath = `${opts.storage_prefix ?? "bulk"}/${Date.now()}-${randomUUID().slice(0, 8)}.csv`;
  const csv = buildCsv(opts.contacts);
  const publicUrl = await uploadCsv(objectPath, csv);

  let importRef;
  try {
    importRef = await createContactImport(opts.creds, {
      list_ids: opts.list_ids,
      url: publicUrl,
    });
  } catch (err) {
    // Cleanup the storage object — Locaweb never picked it up.
    const sb = createAdminClient();
    await sb.storage.from(BUCKET).remove([objectPath]).catch(() => {});
    throw new Error(`Locaweb rejeitou a importação: ${(err as Error).message}`);
  }

  // Poll until the import finishes. Locaweb status flow:
  //   "Aguardando" → "Processando" → "Avaliando lista" → "Finalizado"
  //                                                   → "Erro inesperado"
  const timeoutMs = opts.timeout_ms ?? 60_000;
  const pollMs = opts.poll_interval_ms ?? 2000;
  const start = Date.now();
  let last: ContactImportStatus | null = null;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollMs));
    try {
      last = await getContactImport(opts.creds, importRef.id);
    } catch (err) {
      // transient — keep polling unless we hit timeout
      console.warn(`[bulk-import] poll error: ${(err as Error).message}`);
      continue;
    }
    const norm = normalizeImportStatus(last.status);
    if (norm === "finished" || norm === "error") break;
  }

  if (!last) {
    throw new Error("Importação não retornou status no tempo esperado.");
  }
  if (normalizeImportStatus(last.status) === "error") {
    throw new Error(`Locaweb reportou erro na importação: ${last.status}`);
  }

  return {
    import_id: String(importRef.id),
    list_ids: last.list_ids ?? opts.list_ids,
    total_lines: last.total_lines ?? opts.contacts.length,
    created_count: last.created_count ?? 0,
    updated_count: last.updated_count ?? 0,
    errors_count: last.errors_count ?? 0,
    csv_path: objectPath,
  };
}

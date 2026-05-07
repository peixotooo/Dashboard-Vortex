// src/app/api/crm/email-templates/locaweb/lists/[id]/bulk-import/route.ts
//
// Async bulk import of contacts into an existing Locaweb list. The
// pre-existing /contacts batch endpoint hits Locaweb's `add contacts`
// (140ms per email — 7k contacts = ~16 min). This route uses Locaweb's
// own async import flow:
//
//   1. Build a CSV from the contacts payload.
//   2. Upload to Supabase Storage in the public `email-list-imports`
//      bucket. Locaweb fetches by URL, so it has to be public; the path
//      is unguessable + we delete it after the import finishes.
//   3. POST /contact_imports to Locaweb with the CSV URL. Returns an
//      import_id immediately.
//   4. Client polls /imports/[importId] for status.
//
// Probed end-to-end against the Bulking account: 7000 contacts finished
// in ~8 seconds.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { getReadyCreds } from "@/lib/locaweb/settings";
import { createContactImport } from "@/lib/locaweb/email-marketing";
import { createAdminClient } from "@/lib/supabase-admin";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "email-list-imports";

interface Body {
  contacts: Array<{ email: string; name?: string | null }>;
}

function isValidEmail(e: string | undefined | null): e is string {
  if (!e) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

/** RFC-4180 lite: wrap in quotes if the value contains a comma, quote
 *  or newline; double internal quotes. Names with commas are common
 *  ("Da Silva Jr., John") so this isn't decorative. */
function csvCell(v: string): string {
  if (!/[",\n\r]/.test(v)) return v;
  return `"${v.replace(/"/g, '""')}"`;
}

function buildCsv(rows: Array<{ email: string; name?: string | null }>): string {
  const lines = ["email,name"];
  for (const r of rows) {
    lines.push(`${csvCell(r.email)},${csvCell(r.name?.trim() ?? "")}`);
  }
  return lines.join("\n");
}

async function ensureBucket() {
  // Idempotent — Supabase returns 409 if the bucket already exists, which
  // we silently swallow.
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
      file_size_limit: 50 * 1024 * 1024, // 50MB hard cap; ~1M rows of CSV
    }),
  }).catch(() => {});
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "list id ausente." }, { status: 400 });

    const body = (await req.json()) as Body;

    // Dedup + validate up-front. The CSV has to be clean — every garbage
    // row gets counted as an error by Locaweb's importer.
    const seen = new Set<string>();
    const contacts: Array<{ email: string; name?: string | null }> = [];
    for (const c of body.contacts ?? []) {
      const email = typeof c?.email === "string" ? c.email.trim().toLowerCase() : "";
      if (!isValidEmail(email)) continue;
      if (seen.has(email)) continue;
      seen.add(email);
      contacts.push({
        email,
        name: typeof c.name === "string" && c.name.trim() ? c.name.trim() : null,
      });
    }
    if (contacts.length === 0) {
      return NextResponse.json(
        { error: "Nenhum email válido nos contatos enviados." },
        { status: 400 }
      );
    }

    let creds;
    try {
      creds = await getReadyCreds(workspaceId);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }

    // Upload the CSV to a public URL Locaweb can fetch.
    await ensureBucket();
    const objectPath = `${workspaceId}/${id}-${Date.now()}-${randomUUID().slice(0, 8)}.csv`;
    const csv = buildCsv(contacts);
    let publicUrl: string;
    try {
      publicUrl = await uploadCsv(objectPath, csv);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 502 });
    }

    // Kick off the import on Locaweb. We don't wait — they enqueue and
    // the client polls /imports/[id].
    let importRef;
    try {
      importRef = await createContactImport(creds.creds, {
        list_id: id,
        url: publicUrl,
        has_header: true,
        description: `vortex bulk · ${contacts.length} contatos`,
      });
    } catch (err) {
      // Cleanup the storage object — the import never started so the CSV
      // is dead weight.
      const sb = createAdminClient();
      await sb.storage.from(BUCKET).remove([objectPath]).catch(() => {});
      return NextResponse.json(
        { error: `Locaweb rejeitou a importação: ${(err as Error).message}` },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      import_id: String(importRef.id),
      total: contacts.length,
      csv_url: publicUrl,
      csv_path: objectPath,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}

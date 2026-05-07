// src/app/api/crm/email-templates/locaweb/lists/[id]/bulk-import/route.ts
//
// Async bulk-import of contacts into an existing Locaweb list. Returns
// immediately with import_id (the heavy lifting happens in Locaweb's
// queue); the client polls /imports/[id] for status.
//
// Implementation lives in lib/email-templates/bulk-import.ts so the
// suggestion-dispatch flow (RFM cluster → list) can reuse it.

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

// This endpoint kicks off the import without waiting for completion —
// the client polls /imports/[id] for live status. Different from
// bulkImportContacts() in the lib, which waits for completion (used by
// server-side flows like materializeSegmentList).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "list id ausente." }, { status: 400 });

    const body = (await req.json()) as Body;

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

    await ensureBucket();
    const objectPath = `${workspaceId}/${id}-${Date.now()}-${randomUUID().slice(0, 8)}.csv`;
    const csv = buildCsv(contacts);
    let publicUrl: string;
    try {
      publicUrl = await uploadCsv(objectPath, csv);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 502 });
    }

    let importRef;
    try {
      importRef = await createContactImport(creds.creds, {
        list_ids: [Number(id)],
        url: publicUrl,
      });
    } catch (err) {
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
      csv_path: objectPath,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}

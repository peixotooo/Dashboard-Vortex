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
import { createContactImport, listLists } from "@/lib/locaweb/email-marketing";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  EMAIL_IMPORT_BUCKET,
  uploadEmailImportCsv,
} from "@/lib/email-templates/import-storage";
import { upsertAudience } from "@/lib/email-templates/audiences";
import { randomUUID } from "crypto";
import {
  consumeSecurityRateLimit,
  getRequestClientIp,
} from "@/lib/security/rate-limit";
import { readLimitedJson } from "@/lib/security/webhook-request";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  contacts: Array<{ email: string; name?: string | null }>;
}

const MAX_CONTACTS = 50_000;
const MAX_BODY_BYTES = 10 * 1024 * 1024;

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
    if (!/^\d{1,20}$/.test(id)) {
      return NextResponse.json({ error: "list id inválido." }, { status: 400 });
    }

    const rateLimit = await consumeSecurityRateLimit({
      scope: "email-templates:bulk-import",
      key: `${workspaceId}:${getRequestClientIp(req)}`,
      limit: 10,
      windowSeconds: 3600,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    const parsed = await readLimitedJson(req, MAX_BODY_BYTES);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body =
      parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
        ? (parsed.value as Partial<Body>)
        : {};
    if (!Array.isArray(body.contacts) || body.contacts.length > MAX_CONTACTS) {
      return NextResponse.json(
        { error: `Envie no máximo ${MAX_CONTACTS} contatos por importação.` },
        { status: 400 }
      );
    }

    const seen = new Set<string>();
    const contacts: Array<{ email: string; name?: string | null }> = [];
    for (const c of body.contacts ?? []) {
      const email = typeof c?.email === "string" ? c.email.trim().toLowerCase() : "";
      if (!isValidEmail(email)) continue;
      if (seen.has(email)) continue;
      seen.add(email);
      contacts.push({
        email,
        name:
          typeof c.name === "string" && c.name.trim()
            ? c.name.trim().slice(0, 160)
            : null,
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

    const objectPath = `${workspaceId}/${id}-${Date.now()}-${randomUUID().slice(0, 8)}.csv`;
    const csv = buildCsv(contacts);
    let signedUrl: string;
    try {
      signedUrl = await uploadEmailImportCsv(objectPath, csv);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 502 });
    }

    let importRef;
    try {
      importRef = await createContactImport(creds.creds, {
        list_ids: [Number(id)],
        url: signedUrl,
      });
    } catch (err) {
      const sb = createAdminClient();
      await sb.storage
        .from(EMAIL_IMPORT_BUCKET)
        .remove([objectPath])
        .catch(() => {});
      return NextResponse.json(
        { error: `Locaweb rejeitou a importação: ${(err as Error).message}` },
        { status: 502 }
      );
    }

    // Persiste a audiência localmente — Locaweb não expõe GET de
    // contatos da lista (404), então mantemos uma cópia em
    // email_template_audiences pra que o dispatch via iPORTO consiga
    // resolver list_ids → recipients[].
    let audienceWarning: string | null = null;
    try {
      const sb = createAdminClient();
      let listName = `Lista ${id}`;
      try {
        const lists = await listLists(creds.creds);
        const match = lists.find((l) => String(l.id) === String(id));
        if (match?.name) listName = match.name;
      } catch {
        /* sem o nome, segue com fallback */
      }
      const result = await upsertAudience(sb, {
        workspace_id: workspaceId,
        locaweb_list_id: String(id),
        name: listName,
        contacts,
        source: "crm",
      });
      if ("error" in result) {
        audienceWarning = result.error;
        console.error(
          "[bulk-import] upsertAudience returned error:",
          result.error
        );
      } else {
        console.log(
          `[bulk-import] audience saved locally: ${contacts.length} contacts for list ${id}`
        );
      }
    } catch (err) {
      audienceWarning = (err as Error).message;
      console.error("[bulk-import] upsertAudience threw:", err);
    }

    return NextResponse.json({
      ok: true,
      import_id: String(importRef.id),
      total: contacts.length,
      csv_path: objectPath,
      audience_warning: audienceWarning,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}

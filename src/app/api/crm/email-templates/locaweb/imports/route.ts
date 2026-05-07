// src/app/api/crm/email-templates/locaweb/imports/route.ts
//
// GET → Lists every contact_import on the workspace's Locaweb account.
// Used by the CRM "criar lista de email" dialog as a fallback when the
// /bulk-import POST times out on Vercel — the import probably *did*
// reach Locaweb's queue, and the most recent entry whose URL matches
// the CSV we uploaded tells us the import_id so the dialog can pick up
// polling without bothering the user.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { getReadyCreds } from "@/lib/locaweb/settings";
import { listContactImports, normalizeImportStatus } from "@/lib/locaweb/email-marketing";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    let creds;
    try {
      creds = await getReadyCreds(workspaceId);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
    let imports;
    try {
      imports = await listContactImports(creds.creds);
    } catch (err) {
      return NextResponse.json(
        { error: `Falha ao listar imports: ${(err as Error).message}` },
        { status: 502 }
      );
    }
    return NextResponse.json({
      items: imports.map((i) => ({
        id: i.id,
        url: i.url,
        file_name: i.file_name ?? null,
        status: normalizeImportStatus(i.status),
        raw_status: i.status,
        total_lines: i.total_lines ?? null,
        created_count: i.created_count ?? null,
        errors_count: i.errors_count ?? null,
        created_at: i.created_at ?? null,
        updated_at: i.updated_at ?? null,
      })),
    });
  } catch (err) {
    return handleAuthError(err);
  }
}

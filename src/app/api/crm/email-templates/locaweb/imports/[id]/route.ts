// src/app/api/crm/email-templates/locaweb/imports/[id]/route.ts
//
// Proxies GET /accounts/{accountId}/contact_imports/{id} so the dialog
// can poll bulk-import status without leaking the workspace's Locaweb
// token to the browser. Normalizes the PT-BR status label.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { getReadyCreds } from "@/lib/locaweb/settings";
import {
  getContactImport,
  normalizeImportStatus,
} from "@/lib/locaweb/email-marketing";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "import id ausente." }, { status: 400 });

    let creds;
    try {
      creds = await getReadyCreds(workspaceId);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }

    let info;
    try {
      info = await getContactImport(creds.creds, id);
    } catch (err) {
      return NextResponse.json(
        { error: `Falha ao consultar import: ${(err as Error).message}` },
        { status: 502 }
      );
    }

    return NextResponse.json({
      id: info.id,
      status: normalizeImportStatus(info.status),
      raw_status: info.status,
      list_ids: info.list_ids ?? [],
      total_lines: info.total_lines ?? null,
      created_count: info.created_count ?? null,
      updated_count: info.updated_count ?? null,
      errors_count: info.errors_count ?? null,
      file_name: info.file_name ?? null,
      created_at: info.created_at ?? null,
      updated_at: info.updated_at ?? null,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}

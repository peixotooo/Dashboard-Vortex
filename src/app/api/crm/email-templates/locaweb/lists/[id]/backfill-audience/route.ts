// src/app/api/crm/email-templates/locaweb/lists/[id]/backfill-audience/route.ts
//
// Recupera a "cópia local" de uma audiência quando o bulk-import original
// falhou (ou rolou antes da migration-078). Recebe os contatos no body —
// não tenta ler de volta da Locaweb (que retorna 404 no GET de contatos).
//
// Uso esperado: usuário hit "Dispatch via iPORTO" e vê erro "Lista X não
// tem cópia local". A UI oferece um "Recuperar audiência" que pega a
// lista de contatos atual da página CRM e faz POST aqui pra registrar.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { getReadyCreds } from "@/lib/locaweb/settings";
import { listLists } from "@/lib/locaweb/email-marketing";
import { createAdminClient } from "@/lib/supabase-admin";
import { upsertAudience } from "@/lib/email-templates/audiences";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  contacts: Array<{ email: string; name?: string | null }>;
  /** Override do nome — se omitido, busca na Locaweb. */
  name?: string;
}

function isValidEmail(e: string | undefined | null): e is string {
  if (!e) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "list id ausente." }, { status: 400 });
    }
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

    // Tenta buscar o nome da lista na Locaweb pra denormalizar.
    let listName = body.name?.trim() || `Lista ${id}`;
    try {
      const creds = await getReadyCreds(workspaceId);
      const lists = await listLists(creds.creds);
      const match = lists.find((l) => String(l.id) === String(id));
      if (match?.name) listName = match.name;
    } catch {
      /* sem nome, segue com fallback */
    }

    const sb = createAdminClient();
    const result = await upsertAudience(sb, {
      workspace_id: workspaceId,
      locaweb_list_id: String(id),
      name: listName,
      contacts,
      source: "crm",
    });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      audience_id: result.id,
      list_id: String(id),
      list_name: listName,
      total: contacts.length,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}

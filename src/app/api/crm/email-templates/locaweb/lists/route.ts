// src/app/api/crm/email-templates/locaweb/lists/route.ts
//
// GET  → returns the workspace's Locaweb lists (id + name + count). Used by
//        the dispatch picker so the user chooses which list(s) the campaign
//        goes to.
// POST → creates a new list with the given name, then pushes the supplied
//        contacts in batches. Used by the CRM page so a user can pick a
//        filtered customer set and turn it into an email-marketing list in
//        one click (mirroring the "Campanha WhatsApp" flow).

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { getLocawebSettings, getReadyCreds } from "@/lib/locaweb/settings";
import {
  listLists,
  createList,
  addContactsToList,
  type ContactInput,
} from "@/lib/locaweb/email-marketing";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const s = await getLocawebSettings(workspaceId);
    if (!s.account_id || !s.token) {
      return NextResponse.json({ lists: [], reason: "not_configured" });
    }
    const lists = await listLists({
      base_url: s.base_url,
      account_id: s.account_id,
      token: s.token,
    });
    return NextResponse.json({ lists });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e.status) {
      return NextResponse.json(
        { error: e.message ?? "Locaweb error", status: e.status },
        { status: 502 }
      );
    }
    return handleAuthError(err);
  }
}

interface CreateListBody {
  name: string;
  /** Optional inline contacts. Kept for small lists that fit in one request.
   *  For large lists, omit this and POST chunks to /lists/[id]/contacts to
   *  avoid Vercel timeouts (10k contacts in one round-trip routinely 504'd). */
  contacts?: Array<{ email: string; name?: string | null }>;
}

const BATCH_SIZE = 200;

function isValidEmail(e: string | undefined | null): e is string {
  if (!e) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

export async function POST(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const body = (await req.json()) as CreateListBody;

    const name = (body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "Informe um nome para a lista." }, { status: 400 });
    }
    if (name.length > 120) {
      return NextResponse.json(
        { error: "Nome muito longo (máx 120 caracteres)." },
        { status: 400 }
      );
    }

    // Dedup + validate emails up-front (still cheap; if the inline payload
    // is huge we'd reject it earlier on Vercel anyway).
    const seen = new Set<string>();
    const contacts: ContactInput[] = [];
    for (const c of body.contacts ?? []) {
      const email = typeof c?.email === "string" ? c.email.trim().toLowerCase() : "";
      if (!isValidEmail(email)) continue;
      if (seen.has(email)) continue;
      seen.add(email);
      contacts.push({
        email,
        name: typeof c.name === "string" && c.name.trim() ? c.name.trim() : undefined,
      });
    }

    let creds;
    try {
      creds = await getReadyCreds(workspaceId);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }

    let list;
    try {
      list = await createList(creds.creds, name);
    } catch (err) {
      return NextResponse.json(
        { error: `Falha ao criar lista: ${(err as Error).message}` },
        { status: 502 }
      );
    }
    const listId =
      list.id ??
      (typeof list._location === "string"
        ? list._location.split("/").filter(Boolean).pop() ?? null
        : null);
    if (listId == null) {
      return NextResponse.json(
        { error: "Locaweb aceitou criar a lista mas não retornou um id." },
        { status: 502 }
      );
    }

    // Inline-contacts mode (small lists). Large flows go through the
    // dedicated /lists/[id]/contacts batch endpoint.
    let pushed = 0;
    let warning: string | null = null;
    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      const chunk = contacts.slice(i, i + BATCH_SIZE);
      try {
        await addContactsToList(creds.creds, listId, chunk);
        pushed += chunk.length;
      } catch (err) {
        if (i === 0) {
          return NextResponse.json(
            {
              error: `Lista criada, mas Locaweb rejeitou o primeiro lote: ${(err as Error).message}`,
              list_id: String(listId),
              list_name: name,
            },
            { status: 502 }
          );
        }
        warning = `Falha parcial: ${pushed}/${contacts.length} contatos enviados antes do erro — ${(err as Error).message}`;
        console.warn(
          `[create-list] batch ${i}-${i + chunk.length} falhou:`,
          (err as Error).message
        );
        break;
      }
    }

    return NextResponse.json({
      ok: true,
      list_id: String(listId),
      list_name: name,
      pushed,
      total: contacts.length,
      warning,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}

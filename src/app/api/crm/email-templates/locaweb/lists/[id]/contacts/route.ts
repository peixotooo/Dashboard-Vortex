// src/app/api/crm/email-templates/locaweb/lists/[id]/contacts/route.ts
//
// Streaming-friendly batch upload of contacts into an existing Locaweb
// list. The CRM "Lista de email" flow used to push 10k+ contacts in a
// single request through /lists POST and routinely 504'd on Vercel (the
// HTML error page came back as JSON parse error in the dialog). The
// solution: client splits the contact set into chunks of ~500, calls
// this endpoint per chunk with a progress bar, and we keep each request
// well under any timeout.
//
// Locaweb's add-contacts is itself idempotent on duplicate emails, so
// retries are safe.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { getReadyCreds } from "@/lib/locaweb/settings";
import { addContactsToList, type ContactInput } from "@/lib/locaweb/email-marketing";

export const runtime = "nodejs";
export const maxDuration = 60;

function isValidEmail(e: string | undefined | null): e is string {
  if (!e) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

interface Body {
  contacts: Array<{ email: string; name?: string | null }>;
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
    if (contacts.length === 0) {
      return NextResponse.json(
        { error: "Nenhum email válido na chunk." },
        { status: 400 }
      );
    }
    if (contacts.length > 1000) {
      return NextResponse.json(
        { error: "Máximo de 1000 contatos por chunk." },
        { status: 400 }
      );
    }

    let creds;
    try {
      creds = await getReadyCreds(workspaceId);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }

    try {
      await addContactsToList(creds.creds, id, contacts);
    } catch (err) {
      return NextResponse.json(
        { error: `Locaweb rejeitou o lote: ${(err as Error).message}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, pushed: contacts.length });
  } catch (err) {
    return handleAuthError(err);
  }
}

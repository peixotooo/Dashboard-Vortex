import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError, AuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

interface Contact {
  phone?: string;
  email?: string;
  name?: string;
}

// Normaliza pra E.164 sem '+' (formato esperado pela WhatsApp Cloud API).
// Brasil: 10 dígitos (fixo: DD+8) ou 11 (móvel: DD+9). Prefixa 55 nesses
// casos. Se já começa com 55 ou tem 12+ dígitos, assume que já vem
// internacionalizado e deixa como está.
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

function sanitizeContacts(input: unknown): Contact[] {
  if (!Array.isArray(input)) return [];
  const seenPhone = new Set<string>();
  const seenEmail = new Set<string>();
  const out: Contact[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const phone = typeof c.phone === "string" ? normalizePhone(c.phone) : "";
    const email = typeof c.email === "string" ? c.email.trim().toLowerCase() : "";
    const name = typeof c.name === "string" ? c.name.trim() : "";
    const validPhone = phone.length >= 10 ? phone : "";
    const validEmail = email && isValidEmail(email) ? email : "";
    if (!validPhone && !validEmail) continue;
    // Dedup por telefone OU email (qualquer match descarta)
    if (validPhone && seenPhone.has(validPhone)) continue;
    if (validEmail && seenEmail.has(validEmail)) continue;
    if (validPhone) seenPhone.add(validPhone);
    if (validEmail) seenEmail.add(validEmail);
    const contact: Contact = {};
    if (validPhone) contact.phone = validPhone;
    if (validEmail) contact.email = validEmail;
    if (name) contact.name = name;
    out.push(contact);
  }
  return out;
}

// GET = list all contact lists for the workspace
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const admin = createAdminClient();
    const { data: lists, error } = await admin
      .from("crm_contact_lists")
      .select("id, name, description, total_count, phone_count, email_count, locaweb_list_id, auto_segment, created_at, updated_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return NextResponse.json({ lists: lists || [] });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST = create a contact list
export async function POST(request: NextRequest) {
  try {
    const { workspaceId, userId } = await getWorkspaceContext(request);

    const body = await request.json();
    const { name, description, contacts } = body;

    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Nome da lista é obrigatório" }, { status: 400 });
    }
    if (name.trim().length > 200) {
      return NextResponse.json({ error: "Nome da lista é muito longo" }, { status: 400 });
    }

    const cleaned = sanitizeContacts(contacts);
    if (cleaned.length === 0) {
      return NextResponse.json(
        { error: "Nenhum contato válido. Pelo menos telefone ou email é obrigatório." },
        { status: 400 }
      );
    }

    const phoneCount = cleaned.filter((c) => c.phone).length;
    const emailCount = cleaned.filter((c) => c.email).length;

    const admin = createAdminClient();
    const { data: list, error } = await admin
      .from("crm_contact_lists")
      .insert({
        workspace_id: workspaceId,
        name: name.trim(),
        description: typeof description === "string" ? description.trim() : null,
        contacts: cleaned,
        total_count: cleaned.length,
        phone_count: phoneCount,
        email_count: emailCount,
        created_by: userId,
      })
      .select("id, name, description, total_count, phone_count, email_count, locaweb_list_id, created_at, updated_at")
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ list });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

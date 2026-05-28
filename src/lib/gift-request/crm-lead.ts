import type { SupabaseClient } from "@supabase/supabase-js";

// Captura cada solicitante de presente como contato em uma lista CRM
// dedicada ("Pedidos de presente"). Lista é criada lazy na primeira
// chamada, depois deduplica por phone normalizado.
//
// Modelo da lista (migration-090):
//   crm_contact_lists.contacts JSONB = [{ phone?, email?, name? }, ...]
//   total_count, phone_count, email_count são cacheados pra UI.
//
// O lead conserva o produto de interesse em gift_requests — pra "ouro
// pra trabalhar depois" cruzamos por phone quando precisarmos.

const LIST_NAME = "Pedidos de presente";
const LIST_DESCRIPTION =
  "Solicitantes que pediram um produto como presente via shelves.js. Atualiza automaticamente a cada nova solicitação.";

interface Contact {
  phone?: string;
  email?: string;
  name?: string;
}

// Normaliza pra E.164-ish em dígitos (igual o /api/crm/contact-lists faz)
// para garantir dedup consistente entre fontes.
function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export async function upsertGiftRequestLead(params: {
  admin: SupabaseClient;
  workspaceId: string;
  name: string;
  phone: string;
}): Promise<{ ok: boolean; listId?: string; total?: number; error?: string }> {
  const { admin, workspaceId, name, phone } = params;

  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone.length < 10) {
    return { ok: false, error: "invalid_phone" };
  }

  // 1) Acha ou cria a lista
  let { data: list } = await admin
    .from("crm_contact_lists")
    .select("id, contacts, total_count, phone_count, email_count")
    .eq("workspace_id", workspaceId)
    .eq("name", LIST_NAME)
    .maybeSingle();

  if (!list) {
    const { data: created, error: createErr } = await admin
      .from("crm_contact_lists")
      .insert({
        workspace_id: workspaceId,
        name: LIST_NAME,
        description: LIST_DESCRIPTION,
        contacts: [],
        total_count: 0,
        phone_count: 0,
        email_count: 0,
      })
      .select("id, contacts, total_count, phone_count, email_count")
      .single();
    if (createErr || !created) {
      return { ok: false, error: createErr?.message || "create_list_failed" };
    }
    list = created;
  }

  // 2) Dedup por phone normalizado. Se já existe, atualiza o nome (caso
  //    o solicitante tenha digitado diferente da primeira vez) e segue.
  const contacts: Contact[] = Array.isArray(list.contacts)
    ? (list.contacts as Contact[])
    : [];

  const idx = contacts.findIndex(
    (c) => normalizePhone(c.phone || "") === normalizedPhone
  );

  let changed = false;
  if (idx >= 0) {
    // Atualiza nome se vier mais completo do que o cadastrado
    const existing = contacts[idx];
    if (name && (!existing.name || existing.name.length < name.length)) {
      contacts[idx] = { ...existing, name };
      changed = true;
    }
  } else {
    contacts.push({
      phone: normalizedPhone,
      name: name || undefined,
    });
    changed = true;
  }

  if (!changed) {
    return { ok: true, listId: list.id, total: list.total_count };
  }

  const phoneCount = contacts.filter((c) => c.phone).length;
  const emailCount = contacts.filter((c) => c.email).length;

  const { error: updErr } = await admin
    .from("crm_contact_lists")
    .update({
      contacts,
      total_count: contacts.length,
      phone_count: phoneCount,
      email_count: emailCount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", list.id);

  if (updErr) {
    return { ok: false, error: updErr.message };
  }

  return { ok: true, listId: list.id, total: contacts.length };
}

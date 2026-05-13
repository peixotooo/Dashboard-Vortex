// src/lib/email-templates/audiences.ts
//
// Storage local de audiências (listas de e-mail). Existe porque a
// Locaweb não expõe GET pra ler de volta os contatos de uma lista —
// então mesmo quando ela é o canal de envio, precisamos guardar uma
// cópia local pra que o iPORTO consiga resolver list_ids em
// recipients[].
//
// Sempre que uma lista é criada via CRM (bulk-import) ou via
// segment materialization (RFM), chame upsertAudience() pra persistir
// uma cópia aqui. O dispatch iPORTO consulta via
// getAudienceByLocawebListId().

import type { SupabaseClient } from "@supabase/supabase-js";

export interface AudienceContact {
  email: string;
  name?: string | null;
}

export interface AudienceRow {
  id: string;
  workspace_id: string;
  locaweb_list_id: string | null;
  name: string;
  contacts: AudienceContact[];
  total_count: number;
  source: "crm" | "segment" | "manual";
  created_at: string;
  updated_at: string;
}

interface UpsertInput {
  workspace_id: string;
  locaweb_list_id: string;
  name: string;
  contacts: AudienceContact[];
  source?: "crm" | "segment" | "manual";
}

/**
 * Upsert by (workspace_id, locaweb_list_id). Re-running com o mesmo
 * list_id sobrescreve os contatos — útil quando o usuário recria uma
 * lista ou faz re-import pra mesma lista.
 */
export async function upsertAudience(
  sb: SupabaseClient,
  input: UpsertInput
): Promise<{ id: string } | { error: string }> {
  // Dedupe + normaliza email lowercase
  const seen = new Set<string>();
  const contacts: AudienceContact[] = [];
  for (const c of input.contacts) {
    const email =
      typeof c?.email === "string" ? c.email.trim().toLowerCase() : "";
    if (!email) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    contacts.push({ email, name: c.name?.trim() || null });
  }

  const payload = {
    workspace_id: input.workspace_id,
    locaweb_list_id: input.locaweb_list_id,
    name: input.name,
    contacts,
    total_count: contacts.length,
    source: input.source ?? "crm",
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await sb
    .from("email_template_audiences")
    .upsert(payload, { onConflict: "workspace_id,locaweb_list_id" })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: (data as { id: string }).id };
}

/**
 * Resolve uma lista Locaweb em contatos lendo do storage local.
 * Usado pelo dispatch iPORTO pra montar recipients[].
 */
export async function getAudienceByLocawebListId(
  sb: SupabaseClient,
  workspace_id: string,
  locaweb_list_id: string
): Promise<AudienceContact[]> {
  const { data, error } = await sb
    .from("email_template_audiences")
    .select("contacts")
    .eq("workspace_id", workspace_id)
    .eq("locaweb_list_id", locaweb_list_id)
    .maybeSingle();
  if (error) {
    throw new Error(`Falha ao ler audiência local: ${error.message}`);
  }
  if (!data) return [];
  const row = data as { contacts: unknown };
  if (!Array.isArray(row.contacts)) return [];
  return (row.contacts as AudienceContact[]).filter(
    (c) => typeof c?.email === "string" && c.email.length > 0
  );
}

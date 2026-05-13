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
 * Resolve uma lista Locaweb em contatos. Tenta na ordem:
 *  1. email_template_audiences (cópia local, populada por bulk-import)
 *  2. Supabase Storage bucket `email-list-imports` — CSV deixado pelo
 *     bulk-import na hora da criação. Self-healing: se cair pra storage,
 *     upserta na tabela pra próxima vez.
 *
 * Necessário porque a Locaweb não expõe GET de contatos da lista (404).
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
  if (data) {
    const row = data as { contacts: unknown };
    if (Array.isArray(row.contacts) && row.contacts.length > 0) {
      return (row.contacts as AudienceContact[]).filter(
        (c) => typeof c?.email === "string" && c.email.length > 0
      );
    }
  }
  // Fallback: tenta achar o CSV no storage que o bulk-import deixou.
  const fromStorage = await tryReadAudienceFromStorage(
    sb,
    workspace_id,
    locaweb_list_id
  );
  if (fromStorage.length > 0) {
    console.log(
      `[audiences] recovered ${fromStorage.length} contacts from storage CSV for list ${locaweb_list_id}; self-healing audience row`
    );
    // Self-heal — upsert pra próxima vez não precisar do CSV.
    await upsertAudience(sb, {
      workspace_id,
      locaweb_list_id,
      name: `Lista ${locaweb_list_id}`,
      contacts: fromStorage,
      source: "crm",
    }).catch((err) => {
      console.error("[audiences] self-heal upsert failed:", err);
    });
    return fromStorage;
  }
  return [];
}

/**
 * Procura no bucket email-list-imports pelo CSV mais recente da lista.
 * Path convention do bulk-import:
 *   ${workspaceId}/${listId}-${timestamp}-${uuid}.csv
 *
 * Lista os arquivos do bucket com prefix workspaceId/, filtra pelos que
 * começam com `${listId}-`, pega o mais novo (createdAt desc),
 * baixa e parseia (email,name).
 */
async function tryReadAudienceFromStorage(
  sb: SupabaseClient,
  workspace_id: string,
  locaweb_list_id: string
): Promise<AudienceContact[]> {
  const BUCKET = "email-list-imports";
  try {
    const { data: files, error } = await sb.storage
      .from(BUCKET)
      .list(workspace_id, {
        limit: 1000,
        sortBy: { column: "created_at", order: "desc" },
      });
    if (error || !Array.isArray(files)) return [];
    const prefix = `${locaweb_list_id}-`;
    const match = files.find((f) => f.name?.startsWith(prefix));
    if (!match) return [];

    const objectPath = `${workspace_id}/${match.name}`;
    const { data: blob, error: dlErr } = await sb.storage
      .from(BUCKET)
      .download(objectPath);
    if (dlErr || !blob) return [];
    const text = await blob.text();
    return parseCsvContacts(text);
  } catch (err) {
    console.error("[audiences] storage fallback failed:", err);
    return [];
  }
}

function parseCsvContacts(csv: string): AudienceContact[] {
  const lines = csv.split(/\r?\n/);
  if (lines.length <= 1) return [];
  const header = lines[0].split(",").map((c) => c.trim().toLowerCase());
  const emailIdx = header.indexOf("email");
  const nameIdx = header.indexOf("name");
  if (emailIdx < 0) return [];
  const out: AudienceContact[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = splitCsvLine(line);
    const email = (cells[emailIdx] ?? "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    const name = nameIdx >= 0 ? (cells[nameIdx] ?? "").trim() : "";
    out.push({ email, name: name || null });
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  // Suporte mínimo a CSV com aspas escapando vírgulas (formato gerado
  // pelo csvCell do bulk-import).
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === ",") {
        cells.push(cur);
        cur = "";
      } else if (c === '"') {
        inQuotes = true;
      } else {
        cur += c;
      }
    }
  }
  cells.push(cur);
  return cells;
}

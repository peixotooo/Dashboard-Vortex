// src/lib/locaweb/settings.ts
//
// Per-workspace Locaweb Email Marketing settings. Falls back to LOCAWEB_EM_*
// env vars when the workspace row is missing fields, so a single-tenant
// deploy (Bulking) can boot from env without touching the database.

import { createAdminClient } from "@/lib/supabase-admin";
import type { LocawebCreds } from "./email-marketing";

export interface LocawebSettings {
  workspace_id: string;
  enabled: boolean;
  base_url: string;
  account_id: string | null;
  token: string | null;
  default_sender_email: string | null;
  default_sender_name: string | null;
  default_domain_id: string | null;
  list_ids: Record<string, string>;
  created_at?: string;
  updated_at?: string;
}

const DEFAULT_BASE_URL = "https://emailmarketing.locaweb.com.br/api/v1";

function envFallback(): {
  base_url: string;
  account_id: string | null;
  token: string | null;
  default_sender_email: string | null;
  default_sender_name: string | null;
  default_domain_id: string | null;
} {
  return {
    base_url: process.env.LOCAWEB_EM_BASE_URL ?? DEFAULT_BASE_URL,
    account_id: process.env.LOCAWEB_EM_ACCOUNT_ID ?? null,
    token: process.env.LOCAWEB_EM_TOKEN ?? null,
    default_sender_email: process.env.LOCAWEB_EM_DEFAULT_SENDER ?? null,
    default_sender_name: process.env.LOCAWEB_EM_DEFAULT_SENDER_NAME ?? null,
    default_domain_id: process.env.LOCAWEB_EM_DEFAULT_DOMAIN_ID ?? null,
  };
}

export async function getLocawebSettings(workspace_id: string): Promise<LocawebSettings> {
  const sb = createAdminClient();
  const { data } = await sb
    .from("workspace_email_marketing")
    .select("*")
    .eq("workspace_id", workspace_id)
    .maybeSingle();
  const env = envFallback();
  if (!data) {
    return {
      workspace_id,
      enabled: false,
      base_url: env.base_url,
      account_id: env.account_id,
      token: env.token,
      default_sender_email: env.default_sender_email,
      default_sender_name: env.default_sender_name,
      default_domain_id: env.default_domain_id,
      list_ids: {},
    };
  }
  type Row = {
    workspace_id: string;
    enabled: boolean;
    locaweb_base_url: string | null;
    locaweb_account_id: string | null;
    locaweb_token: string | null;
    default_sender_email: string | null;
    default_sender_name: string | null;
    default_domain_id: string | null;
    list_ids: Record<string, string> | null;
    created_at?: string;
    updated_at?: string;
  };
  const r = data as Row;
  return {
    workspace_id: r.workspace_id,
    enabled: r.enabled,
    base_url: r.locaweb_base_url ?? env.base_url,
    account_id: r.locaweb_account_id ?? env.account_id,
    token: r.locaweb_token ?? env.token,
    default_sender_email: r.default_sender_email ?? env.default_sender_email,
    default_sender_name: r.default_sender_name ?? env.default_sender_name,
    default_domain_id: r.default_domain_id ?? env.default_domain_id,
    list_ids: r.list_ids ?? {},
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export interface CredsWithSender {
  creds: LocawebCreds;
  sender_email: string;
  sender_name: string;
  domain_id: string;
}

/** Loads settings + asserts every field needed to actually dispatch. Throws
 *  a descriptive error if anything is missing — caller surfaces to UI. */
export async function getReadyCreds(workspace_id: string): Promise<CredsWithSender> {
  const s = await getLocawebSettings(workspace_id);
  if (!s.enabled) {
    throw new Error(
      "Locaweb Email Marketing não está ativado. Habilite nas configurações."
    );
  }
  if (!s.account_id) throw new Error("Locaweb account_id não configurado.");
  if (!s.token) throw new Error("Locaweb token não configurado.");
  if (!s.default_sender_email)
    throw new Error("Email de remetente Locaweb não configurado.");
  if (!s.default_sender_name)
    throw new Error("Nome de remetente Locaweb não configurado.");
  if (!s.default_domain_id)
    throw new Error("Domínio Locaweb não configurado.");
  return {
    creds: { base_url: s.base_url, account_id: s.account_id, token: s.token },
    sender_email: s.default_sender_email,
    sender_name: s.default_sender_name,
    domain_id: s.default_domain_id,
  };
}

export interface UpdateSettingsInput {
  enabled?: boolean;
  base_url?: string;
  account_id?: string;
  token?: string;
  default_sender_email?: string;
  default_sender_name?: string;
  default_domain_id?: string;
  list_ids?: Record<string, string>;
}

export async function upsertLocawebSettings(
  workspace_id: string,
  patch: UpdateSettingsInput
): Promise<LocawebSettings> {
  const sb = createAdminClient();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.enabled !== undefined) update.enabled = patch.enabled;
  if (patch.base_url !== undefined) update.locaweb_base_url = patch.base_url;
  if (patch.account_id !== undefined) update.locaweb_account_id = patch.account_id;
  if (patch.token !== undefined) update.locaweb_token = patch.token;
  if (patch.default_sender_email !== undefined)
    update.default_sender_email = patch.default_sender_email;
  if (patch.default_sender_name !== undefined)
    update.default_sender_name = patch.default_sender_name;
  if (patch.default_domain_id !== undefined)
    update.default_domain_id = patch.default_domain_id;
  if (patch.list_ids !== undefined) update.list_ids = patch.list_ids;

  await sb
    .from("workspace_email_marketing")
    .upsert({ workspace_id, ...update }, { onConflict: "workspace_id" });
  return getLocawebSettings(workspace_id);
}

// src/lib/iporto/settings.ts
//
// Per-workspace iPORTO Email Marketing settings. Espelha a forma do
// lib/locaweb/settings.ts (mesma tabela workspace_email_marketing, só
// com colunas iporto_*). Mantém env fallback (IPORTO_*) pra single-tenant.

import { createAdminClient } from "@/lib/supabase-admin";
import type { IportoCreds } from "./email-marketing";

export interface IportoSettings {
  workspace_id: string;
  enabled: boolean;
  base_url: string;
  token: string | null;
  webhook_secret: string | null;
  default_sender_email: string | null;
  default_sender_name: string | null;
  created_at?: string;
  updated_at?: string;
}

const DEFAULT_BASE_URL = "https://api.iporto.com.br/api/panel/application";

function envFallback(): {
  base_url: string;
  token: string | null;
  webhook_secret: string | null;
} {
  return {
    base_url: process.env.IPORTO_BASE_URL ?? DEFAULT_BASE_URL,
    token: process.env.IPORTO_TOKEN ?? null,
    webhook_secret: process.env.IPORTO_WEBHOOK_SECRET ?? null,
  };
}

export async function getIportoSettings(workspace_id: string): Promise<IportoSettings> {
  const sb = createAdminClient();
  const { data } = await sb
    .from("workspace_email_marketing")
    .select(
      "workspace_id, enabled, provider, iporto_base_url, iporto_token, iporto_webhook_secret, iporto_default_sender_email, iporto_default_sender_name, default_sender_email, default_sender_name, created_at, updated_at"
    )
    .eq("workspace_id", workspace_id)
    .maybeSingle();
  const env = envFallback();
  if (!data) {
    return {
      workspace_id,
      enabled: false,
      base_url: env.base_url,
      token: env.token,
      webhook_secret: env.webhook_secret,
      default_sender_email: null,
      default_sender_name: null,
    };
  }
  type Row = {
    workspace_id: string;
    enabled: boolean;
    provider: string;
    iporto_base_url: string | null;
    iporto_token: string | null;
    iporto_webhook_secret: string | null;
    iporto_default_sender_email: string | null;
    iporto_default_sender_name: string | null;
    default_sender_email: string | null;
    default_sender_name: string | null;
    created_at?: string;
    updated_at?: string;
  };
  const r = data as Row;
  return {
    workspace_id: r.workspace_id,
    // "enabled" é por-workspace (não por-provider). O toggle do provider
    // é o campo provider; enabled = "esse workspace usa e-mail marketing".
    enabled: r.enabled && r.provider === "iporto",
    base_url: r.iporto_base_url ?? env.base_url,
    token: r.iporto_token ?? env.token,
    webhook_secret: r.iporto_webhook_secret ?? env.webhook_secret,
    // Sender específico do iPORTO ganha; cai pro default só se vazio
    // (mantém compat com workspaces que ainda não preencheram o
    // dedicated). Domínio do sender precisa estar autorizado no painel
    // iPORTO — caso contrário Gmail flagga o mismatch como spam.
    default_sender_email: r.iporto_default_sender_email ?? r.default_sender_email,
    default_sender_name: r.iporto_default_sender_name ?? r.default_sender_name,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export interface IportoCredsWithSender {
  creds: IportoCreds;
  sender_email: string;
  sender_name: string;
}

export async function getIportoReadyCreds(workspace_id: string): Promise<IportoCredsWithSender> {
  const s = await getIportoSettings(workspace_id);
  if (!s.enabled) {
    throw new Error(
      "iPORTO não está ativo. Habilite o e-mail marketing e selecione iPORTO como provider nas configurações."
    );
  }
  if (!s.token) throw new Error("iPORTO token não configurado.");
  if (!s.default_sender_email)
    throw new Error("Email de remetente iPORTO não configurado.");
  if (!s.default_sender_name)
    throw new Error("Nome de remetente iPORTO não configurado.");
  return {
    creds: { base_url: s.base_url, token: s.token },
    sender_email: s.default_sender_email,
    sender_name: s.default_sender_name,
  };
}

export interface UpdateIportoSettingsInput {
  base_url?: string;
  token?: string;
  webhook_secret?: string;
  default_sender_email?: string;
  default_sender_name?: string;
}

export async function upsertIportoSettings(
  workspace_id: string,
  patch: UpdateIportoSettingsInput
): Promise<IportoSettings> {
  const sb = createAdminClient();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.base_url !== undefined)
    update.iporto_base_url = patch.base_url?.trim() || null;
  if (patch.token !== undefined)
    update.iporto_token = patch.token?.trim() || null;
  if (patch.webhook_secret !== undefined)
    update.iporto_webhook_secret = patch.webhook_secret?.trim() || null;
  if (patch.default_sender_email !== undefined)
    update.iporto_default_sender_email = patch.default_sender_email?.trim() || null;
  if (patch.default_sender_name !== undefined)
    update.iporto_default_sender_name = patch.default_sender_name?.trim() || null;

  await sb
    .from("workspace_email_marketing")
    .upsert({ workspace_id, ...update }, { onConflict: "workspace_id" });
  return getIportoSettings(workspace_id);
}

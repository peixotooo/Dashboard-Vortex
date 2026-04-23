import { createAdminClient } from "@/lib/supabase-admin";
import { encrypt, decrypt } from "@/lib/encryption";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SmtpConfig {
  provider: "locaweb" | "resend" | "sendgrid" | "custom";
  apiToken: string;
  fromEmail: string;
  fromName?: string;
  replyTo?: string;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  bodyHtml: string;
}

export interface SendEmailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export async function getSmtpConfig(
  workspaceId: string,
  admin?: SupabaseClient
): Promise<SmtpConfig | null> {
  const client = admin ?? createAdminClient();
  const { data } = await client
    .from("smtp_config")
    .select("provider, api_token, from_email, from_name, reply_to")
    .eq("workspace_id", workspaceId)
    .single();

  if (!data?.api_token || !data?.from_email) return null;

  return {
    provider: data.provider as SmtpConfig["provider"],
    apiToken: decrypt(data.api_token),
    fromEmail: data.from_email,
    fromName: data.from_name || undefined,
    replyTo: data.reply_to || undefined,
  };
}

export async function saveSmtpConfig(
  workspaceId: string,
  input: {
    provider: SmtpConfig["provider"];
    apiToken: string;
    fromEmail: string;
    fromName?: string;
    replyTo?: string;
  }
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const { error } = await admin.from("smtp_config").upsert(
    {
      workspace_id: workspaceId,
      provider: input.provider,
      api_token: encrypt(input.apiToken),
      from_email: input.fromEmail,
      from_name: input.fromName || null,
      reply_to: input.replyTo || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" }
  );
  return { ok: !error, error: error?.message };
}

/**
 * Sends transactional email via Locaweb SMTP REST API.
 * Docs: https://api.smtplw.com.br/v1/messages
 * Other providers (resend/sendgrid) can be added via a provider switch below.
 */
export async function sendEmail(
  cfg: SmtpConfig,
  input: SendEmailInput
): Promise<SendEmailResult> {
  if (cfg.provider !== "locaweb") {
    return { ok: false, error: `unsupported_provider:${cfg.provider}` };
  }

  try {
    const body: Record<string, unknown> = {
      subject: input.subject,
      body: input.bodyHtml,
      from: cfg.fromName ? `${cfg.fromName} <${cfg.fromEmail}>` : cfg.fromEmail,
      to: input.to,
      headers: { "Content-Type": "text/html" },
    };
    if (cfg.replyTo) {
      (body.headers as Record<string, string>)["Reply-To"] = cfg.replyTo;
    }

    const res = await fetch("https://api.smtplw.com.br/v1/messages", {
      method: "POST",
      headers: {
        "x-auth-token": cfg.apiToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, messageId: json.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network_error" };
  }
}

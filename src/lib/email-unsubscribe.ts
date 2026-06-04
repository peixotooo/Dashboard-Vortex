import { createHmac, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const MISSING_TABLE_CODES = new Set(["42P01", "PGRST106", "PGRST205"]);

export function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}

function getSecret(): string {
  const secret =
    process.env.EMAIL_UNSUBSCRIBE_SECRET ||
    process.env.ENCRYPTION_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error("Missing EMAIL_UNSUBSCRIBE_SECRET/ENCRYPTION_KEY");
  }
  return secret;
}

function signaturePayload(input: {
  workspaceId: string;
  email: string;
  source: string;
}): string {
  return [
    input.workspaceId,
    normalizeEmailAddress(input.email),
    input.source || "email",
  ].join("\n");
}

export function createUnsubscribeToken(input: {
  workspaceId: string;
  email: string;
  source?: string;
}): string {
  return createHmac("sha256", getSecret())
    .update(
      signaturePayload({
        workspaceId: input.workspaceId,
        email: input.email,
        source: input.source || "email",
      })
    )
    .digest("base64url");
}

export function verifyUnsubscribeToken(input: {
  workspaceId: string;
  email: string;
  source?: string;
  token: string;
}): boolean {
  const expected = createUnsubscribeToken({
    workspaceId: input.workspaceId,
    email: input.email,
    source: input.source || "email",
  });
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(input.token || "");
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function appBaseUrl(): string {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  return (configured || "https://dash.bulking.com.br").trim().replace(/\/+$/, "");
}

export function buildUnsubscribeUrl(input: {
  workspaceId: string;
  email: string;
  source?: string;
}): string {
  const source = input.source || "email";
  const params = new URLSearchParams({
    w: input.workspaceId,
    e: normalizeEmailAddress(input.email),
    s: source,
    t: createUnsubscribeToken({
      workspaceId: input.workspaceId,
      email: input.email,
      source,
    }),
  });
  return `${appBaseUrl()}/api/email/unsubscribe?${params.toString()}`;
}

export function buildListUnsubscribeHeaders(url: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function appendUnsubscribeFooter(bodyHtml: string, url: string): string {
  const safeUrl = escapeAttr(url);
  const footer = `
<div style="margin:24px auto 0;padding:16px 24px;font-family:Arial,sans-serif;font-size:12px;line-height:1.5;color:#8a8a8a;text-align:center;">
  Nao quer receber estes lembretes por email?
  <a href="${safeUrl}" style="color:#666;text-decoration:underline;">Descadastrar</a>
</div>`;
  if (/<\/body>/i.test(bodyHtml)) {
    return bodyHtml.replace(/<\/body>/i, `${footer}\n</body>`);
  }
  return `${bodyHtml}${footer}`;
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    MISSING_TABLE_CODES.has(error.code || "") ||
    /Could not find the table|relation .* does not exist/i.test(error.message || "")
  );
}

export async function isEmailSuppressed(
  admin: SupabaseClient,
  workspaceId: string,
  email: string
): Promise<boolean> {
  const normalized = normalizeEmailAddress(email);
  const { data, error } = await admin
    .from("email_suppressions")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("email", normalized)
    .limit(1);

  if (!error) return (data || []).length > 0;
  if (!isMissingTable(error)) {
    console.error("[Email Suppression] Failed to check email_suppressions:", error.message);
    return false;
  }

  const { data: auditRows, error: auditError } = await admin
    .from("email_template_audit")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("event", "email_unsubscribed")
    .contains("payload", { email: normalized })
    .limit(1);

  if (auditError) {
    console.error("[Email Suppression] Failed to check audit fallback:", auditError.message);
    return false;
  }
  return (auditRows || []).length > 0;
}

export async function addEmailSuppression(
  admin: SupabaseClient,
  input: {
    workspaceId: string;
    email: string;
    source?: string;
    reason?: string;
    userAgent?: string | null;
  }
): Promise<{ ok: boolean; error?: string }> {
  const normalized = normalizeEmailAddress(input.email);
  const row = {
    workspace_id: input.workspaceId,
    email: normalized,
    reason: input.reason || "unsubscribe",
    source: input.source || "email",
    user_agent: input.userAgent || null,
  };

  const { error } = await admin
    .from("email_suppressions")
    .upsert(row, { onConflict: "workspace_id,email" });

  if (!error) return { ok: true };
  if (!isMissingTable(error)) return { ok: false, error: error.message };

  const { error: auditError } = await admin.from("email_template_audit").insert({
    workspace_id: input.workspaceId,
    suggestion_id: null,
    event: "email_unsubscribed",
    payload: {
      email: normalized,
      reason: row.reason,
      source: row.source,
      user_agent: row.user_agent,
    },
  });

  return { ok: !auditError, error: auditError?.message };
}

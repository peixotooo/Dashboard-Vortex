// src/lib/email-providers/index.ts
//
// Single source of truth pra qual provider de e-mail marketing o
// workspace está usando. O dispatch-core e a UI consultam essa função
// e ramificam o comportamento de acordo.
//
// Por design, mantemos providers como dois clientes independentes
// (lib/locaweb e lib/iporto) — não tentamos esconder as diferenças
// de API atrás de uma interface unificada porque os modelos são
// fundamentalmente diferentes (Locaweb = fan-out via list_ids;
// iPORTO = transacional 1-a-1). O que unificamos é:
//   - "qual provider o workspace usa?"
//   - "está habilitado?"
//   - "está pronto pra dispatch?" (com mensagem de erro humana)

import { createAdminClient } from "@/lib/supabase-admin";

/** Último recurso quando nem home_url nem sender estão configurados.
 *  Multi-tenant futuro: trocar por leitura do tenant default. */
const FALLBACK_HOME_URL = "https://www.bulking.com.br";

export type EmailProvider = "locaweb" | "iporto";

export interface ActiveProviderInfo {
  provider: EmailProvider;
  enabled: boolean;
}

export async function getActiveProvider(
  workspace_id: string
): Promise<ActiveProviderInfo> {
  const sb = createAdminClient();
  const { data } = await sb
    .from("workspace_email_marketing")
    .select("provider, enabled")
    .eq("workspace_id", workspace_id)
    .maybeSingle();
  if (!data) {
    return { provider: "locaweb", enabled: false };
  }
  const row = data as { provider?: string | null; enabled?: boolean };
  const provider: EmailProvider = row.provider === "iporto" ? "iporto" : "locaweb";
  return { provider, enabled: !!row.enabled };
}

export async function setActiveProvider(
  workspace_id: string,
  provider: EmailProvider
): Promise<void> {
  const sb = createAdminClient();
  await sb
    .from("workspace_email_marketing")
    .upsert(
      { workspace_id, provider, updated_at: new Date().toISOString() },
      { onConflict: "workspace_id" }
    );
}

/**
 * Home URL da marca, usado pra envelopar imagens "soltas" com link
 * clicável (logo, hero). Compartilhada entre Locaweb e iPORTO.
 *
 * Resolve nesta ordem:
 *   1. workspace_email_marketing.home_url, se preenchido
 *   2. derivar do domínio do iporto_default_sender_email ou
 *      default_sender_email (e.g., no-reply@bulking.com.br → https://bulking.com.br)
 *   3. FALLBACK_HOME_URL
 */
export async function getWorkspaceHomeUrl(workspace_id: string): Promise<string> {
  const sb = createAdminClient();
  const { data } = await sb
    .from("workspace_email_marketing")
    .select(
      "home_url, iporto_default_sender_email, default_sender_email"
    )
    .eq("workspace_id", workspace_id)
    .maybeSingle();

  if (!data) return FALLBACK_HOME_URL;
  const r = data as {
    home_url?: string | null;
    iporto_default_sender_email?: string | null;
    default_sender_email?: string | null;
  };

  const explicit = r.home_url?.trim();
  if (explicit) return explicit;

  const sender =
    r.iporto_default_sender_email?.trim() || r.default_sender_email?.trim();
  if (sender) {
    const at = sender.indexOf("@");
    if (at >= 0) {
      const domain = sender.slice(at + 1).trim().toLowerCase();
      if (domain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
        return `https://${domain}`;
      }
    }
  }
  return FALLBACK_HOME_URL;
}

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

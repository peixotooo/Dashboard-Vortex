import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeFreshFbc } from "@/lib/meta-capi";

export interface MetaAttributionSnapshotInput {
  workspaceId: string;
  email: string;
  consumerId?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
}

export function normalizeAttributionEmail(value?: string | null): string {
  return value?.trim().toLowerCase() || "";
}

export async function upsertMetaAttributionSnapshot(
  admin: SupabaseClient,
  input: MetaAttributionSnapshotInput
): Promise<{ ok: boolean; reason?: string; error?: string }> {
  const email = normalizeAttributionEmail(input.email);
  if (!email || !email.includes("@")) {
    return { ok: false, reason: "missing_email" };
  }

  let fbc = normalizeFreshFbc(input.fbc) || null;
  let fbp = input.fbp?.trim() || null;

  if (!fbc || !fbp) {
    const { data, error } = await admin
      .from("meta_attribution")
      .select("fbc, fbp")
      .eq("workspace_id", input.workspaceId)
      .eq("email", email)
      .maybeSingle();

    if (!error) {
      const existing = data as { fbc?: string | null; fbp?: string | null } | null;
      if (!fbc) fbc = normalizeFreshFbc(existing?.fbc) || null;
      if (!fbp) fbp = existing?.fbp?.trim() || null;
    }
  }

  // At least one browser identifier must be present; otherwise the row adds
  // no matching value to a future server-side Purchase event.
  if (!fbc && !fbp) {
    return { ok: false, reason: "no_signals" };
  }

  const { error } = await admin.from("meta_attribution").upsert(
    {
      workspace_id: input.workspaceId,
      email,
      consumer_id: input.consumerId || null,
      fbc,
      fbp,
      client_ip: input.clientIp || null,
      user_agent: input.userAgent || null,
      captured_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,email" }
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

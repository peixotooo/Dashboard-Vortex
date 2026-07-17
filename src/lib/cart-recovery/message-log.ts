import type { SupabaseClient } from "@supabase/supabase-js";

export async function reserveCartRecoveryMessage(
  admin: SupabaseClient,
  params: {
    workspaceId: string;
    cartId: string;
    stepId: string;
    channel: "whatsapp" | "email";
  },
) {
  const { data, error } = await admin
    .from("cart_recovery_messages")
    .insert({
      workspace_id: params.workspaceId,
      cart_id: params.cartId,
      step_id: params.stepId,
      channel: params.channel,
      status: "sending",
    })
    .select("id")
    .single();

  if (error?.code === "23505") return { reserved: false, id: "" };
  if (error || !data?.id) {
    console.error(
      `[Cart Recovery] Failed to reserve message for cart ${params.cartId}:`,
      error?.message || "missing reservation id",
    );
    return { reserved: false, id: "" };
  }

  return { reserved: true, id: data.id as string };
}

export async function deleteCartRecoveryMessageReservation(
  admin: SupabaseClient,
  workspaceId: string,
  id: string,
) {
  await admin
    .from("cart_recovery_messages")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", id);
}

export async function finalizeCartRecoveryMessage(
  admin: SupabaseClient,
  workspaceId: string,
  id: string,
  params: {
    ok: boolean;
    externalId?: string;
    error?: string;
    renderedPayload?: Record<string, unknown>;
  },
) {
  const { error } = await admin
    .from("cart_recovery_messages")
    .update({
      status: finalMessageStatus(params),
      external_id: params.externalId || null,
      error: params.error || null,
      rendered_payload: params.renderedPayload || null,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", id);

  if (error) {
    console.error(
      `[Cart Recovery] Failed to finalize message log ${id}:`,
      error.message,
    );
  }
}

function finalMessageStatus(params: { ok: boolean; error?: string }) {
  if (params.ok) return "sent";
  return params.error === "no_phone" ||
    params.error === "no_smtp_config" ||
    params.error === "missing_email_content"
    ? "skipped"
    : "failed";
}

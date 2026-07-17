import { NextRequest, NextResponse } from "next/server";
import {
  getWorkspaceAdminContext,
  getWorkspaceContext,
  handleAuthError,
} from "@/lib/api-auth";
import { buildPilotMonitoringPayload } from "@/lib/cart-recovery/pilot-monitoring";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const payload = await buildPilotMonitoringPayload({
      admin: createAdminClient(),
      workspaceId,
    });
    return NextResponse.json(payload);
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceAdminContext(request);
    const body = (await request.json()) as {
      enabled?: boolean;
      rollout_percentage?: number;
    };
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { error: "O campo enabled é obrigatório." },
        { status: 400 },
      );
    }
    const admin = createAdminClient();
    const { data: current, error: currentError } = await admin
      .from("cart_recovery_rules")
      .select(
        "id,enabled,intelligence_mode,rollout_percentage,holdout_percentage",
      )
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) {
      return NextResponse.json(
        { error: "Régua não encontrada" },
        { status: 404 },
      );
    }
    if (!current.enabled && body.enabled) {
      return NextResponse.json(
        { error: "Ative a régua de recuperação antes de iniciar o piloto." },
        { status: 409 },
      );
    }

    const enabled = Boolean(body.enabled);
    const rollout = enabled
      ? Math.max(
          1,
          Math.min(25, Math.round(Number(body.rollout_percentage) || 10)),
        )
      : 0;
    const holdout = 10;
    const unchanged =
      enabled &&
      current.intelligence_mode === "pilot" &&
      Number(current.rollout_percentage) === rollout &&
      Number(current.holdout_percentage) === holdout;

    if (!unchanged) {
      const { error } = await admin
        .from("cart_recovery_rules")
        .update({
          intelligence_mode: enabled ? "pilot" : "shadow",
          rollout_percentage: rollout,
          holdout_percentage: holdout,
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", workspaceId);
      if (error) throw error;
    }

    if (!enabled) {
      const { error } = await admin
        .from("cart_recovery_action_queue")
        .update({
          status: "canceled",
          last_error: "pilot_paused_by_admin",
          locked_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", workspaceId)
        .in("status", ["scheduled", "processing"]);
      if (error) throw error;
    }

    return NextResponse.json({
      ok: true,
      mode: enabled ? "pilot" : "shadow",
      rollout_percentage: rollout,
      holdout_percentage: holdout,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}

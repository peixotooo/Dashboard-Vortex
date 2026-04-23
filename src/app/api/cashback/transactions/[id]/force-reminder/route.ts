import { NextRequest, NextResponse } from "next/server";
import { authRoute } from "@/lib/cashback/route-helpers";
import { getOrCreateConfig, type CashbackStage } from "@/lib/cashback/api";
import { sendReminderForStage } from "@/lib/cashback/reminders";

export const maxDuration = 30;

const STAGES: CashbackStage[] = [
  "LEMBRETE_1",
  "LEMBRETE_2",
  "LEMBRETE_3",
  "REATIVACAO",
  "REATIVACAO_LEMBRETE",
];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { auth, error } = await authRoute(request, { requireAdmin: true });
  if (error) return error;
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as { stage?: string; reset?: boolean };
  const stage = body.stage as CashbackStage;
  if (!STAGES.includes(stage)) {
    return NextResponse.json({ error: "invalid_stage" }, { status: 400 });
  }

  const cfg = await getOrCreateConfig(auth!.workspaceId, auth!.admin);

  // Optionally clear the idempotency timestamp so the reminder fires again
  if (body.reset) {
    const col = {
      LEMBRETE_1: "lembrete1_enviado_em",
      LEMBRETE_2: "lembrete2_enviado_em",
      LEMBRETE_3: "lembrete3_enviado_em",
      REATIVACAO: "reativacao_enviado_em",
      REATIVACAO_LEMBRETE: "reativacao_lembrete2",
    }[stage];
    await auth!.admin.from("cashback_transactions").update({ [col]: null }).eq("id", id);
  }

  const { data: cb } = await auth!.admin
    .from("cashback_transactions")
    .select("*")
    .eq("workspace_id", auth!.workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (!cb) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const results = await sendReminderForStage(cb, stage, cfg, auth!.admin);
  return NextResponse.json({ ok: true, results });
}

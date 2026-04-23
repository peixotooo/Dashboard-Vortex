import { NextRequest, NextResponse } from "next/server";
import { authRoute } from "@/lib/cashback/route-helpers";
import { getOrCreateConfig, type CashbackStage, type CashbackTransactionRow } from "@/lib/cashback/api";
import { sendReminderForStage } from "@/lib/cashback/reminders";

export const maxDuration = 30;

const STAGES: CashbackStage[] = [
  "LEMBRETE_1",
  "LEMBRETE_2",
  "LEMBRETE_3",
  "REATIVACAO",
  "REATIVACAO_LEMBRETE",
];

/**
 * Fires a test reminder WITHOUT touching the database.
 * Builds an in-memory fake cashback_transaction row, runs the real
 * send-reminder pipeline (WhatsApp + email gates + template render), and
 * returns the results. Safe to call repeatedly — no persistence.
 */
export async function POST(request: NextRequest) {
  const { auth, error } = await authRoute(request, { requireAdmin: true });
  if (error) return error;

  const body = (await request.json().catch(() => ({}))) as {
    stage?: string;
    email?: string;
    telefone?: string;
    nome?: string;
    valor?: number;
  };

  const stage = body.stage as CashbackStage;
  if (!STAGES.includes(stage)) {
    return NextResponse.json({ error: "invalid_stage" }, { status: 400 });
  }
  if (!body.email) {
    return NextResponse.json({ error: "email_required" }, { status: 400 });
  }

  const cfg = await getOrCreateConfig(auth!.workspaceId, auth!.admin);

  const expira = new Date();
  expira.setUTCDate(expira.getUTCDate() + cfg.validity_days);

  const fake: CashbackTransactionRow = {
    id: "00000000-0000-0000-0000-000000000000",
    workspace_id: auth!.workspaceId,
    source_order_id: "DIAGNOSTIC-TEST",
    numero_pedido: "DIAG-TEST",
    email: body.email,
    nome_cliente: body.nome || "Teste Diagnóstico",
    telefone: body.telefone || null,
    valor_pedido: (body.valor || 25.9) * 10,
    valor_frete: 0,
    valor_cashback: body.valor || 25.9,
    status: "ATIVO",
    reativado: false,
    troca_abatida: false,
    valor_troca_abatida: null,
    confirmado_em: new Date().toISOString(),
    depositado_em: new Date().toISOString(),
    expira_em: expira.toISOString(),
    estornado_em: null,
    usado_em: null,
    lembrete1_enviado_em: null,
    lembrete2_enviado_em: null,
    lembrete3_enviado_em: null,
    reativacao_enviado_em: null,
    reativacao_lembrete2: null,
  };

  // Skip the update-idempotency-column branch by catching the update silently
  // (the fake id won't match anything in the DB, so the UPDATE is a noop).
  const results = await sendReminderForStage(fake, stage, cfg, auth!.admin);

  return NextResponse.json({
    ok: true,
    test: true,
    stage,
    sent_to: { email: body.email, telefone: body.telefone || null },
    results,
  });
}

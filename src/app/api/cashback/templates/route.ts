import { NextRequest, NextResponse } from "next/server";
import { authRoute } from "@/lib/cashback/route-helpers";

export const maxDuration = 15;

const STAGES = ["LEMBRETE_1", "LEMBRETE_2", "LEMBRETE_3", "REATIVACAO", "REATIVACAO_LEMBRETE"] as const;
const CHANNELS = ["whatsapp", "email"] as const;

export async function GET(request: NextRequest) {
  const { auth, error } = await authRoute(request);
  if (error) return error;

  const { data } = await auth!.admin
    .from("cashback_reminder_templates")
    .select("*")
    .eq("workspace_id", auth!.workspaceId)
    .order("estagio", { ascending: true });

  return NextResponse.json({ templates: data ?? [] });
}

export async function PUT(request: NextRequest) {
  const { auth, error } = await authRoute(request, { requireAdmin: true });
  if (error) return error;

  const body = (await request.json().catch(() => ({}))) as {
    templates?: Array<{
      canal: string;
      estagio: string;
      enabled?: boolean;
      wa_template_id?: string | null;
      wa_template_name?: string | null;
      wa_template_language?: string | null;
      email_subject?: string | null;
      email_body_html?: string | null;
    }>;
  };

  if (!Array.isArray(body.templates)) {
    return NextResponse.json({ error: "templates array required" }, { status: 400 });
  }

  const rows = body.templates
    .filter(
      (t) =>
        CHANNELS.includes(t.canal as (typeof CHANNELS)[number]) &&
        STAGES.includes(t.estagio as (typeof STAGES)[number])
    )
    .map((t) => ({
      workspace_id: auth!.workspaceId,
      canal: t.canal,
      estagio: t.estagio,
      enabled: t.enabled ?? true,
      wa_template_id: t.wa_template_id ?? null,
      wa_template_name: t.wa_template_name ?? null,
      wa_template_language: t.wa_template_language ?? "pt_BR",
      email_subject: t.email_subject ?? null,
      email_body_html: t.email_body_html ?? null,
      updated_at: new Date().toISOString(),
    }));

  const { error: upErr } = await auth!.admin
    .from("cashback_reminder_templates")
    .upsert(rows, { onConflict: "workspace_id, canal, estagio" });

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, count: rows.length });
}

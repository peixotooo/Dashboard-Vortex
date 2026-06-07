import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { getReviewSettings } from "@/lib/reviews/settings";
import { recheckTemplateOnMeta } from "@/lib/whatsapp-api";
import { createAdminClient } from "@/lib/supabase-admin";

// Consulta na Meta o status atual do template de avaliação (PENDING/APPROVED/
// REJECTED) e atualiza wa_templates. Usado pelo botão "Consultar status".
export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const settings = await getReviewSettings(workspaceId);
    if (!settings.wa_template_id) {
      return NextResponse.json({ error: "Nenhum template de avaliação criado ainda." }, { status: 400 });
    }

    const r = await recheckTemplateOnMeta(workspaceId, settings.wa_template_id);

    // Nome do template (pra exibir).
    const admin = createAdminClient();
    const { data: tpl } = await admin
      .from("wa_templates")
      .select("name, status, category")
      .eq("id", settings.wa_template_id)
      .maybeSingle();

    return NextResponse.json({
      ok: r.ok,
      name: tpl?.name ?? null,
      status: r.currentStatus ?? tpl?.status ?? null,
      category: r.currentCategory ?? tpl?.category ?? null,
      changed: r.changed,
      reason: r.reason ?? null,
    });
  } catch (e) {
    return handleAuthError(e);
  }
}

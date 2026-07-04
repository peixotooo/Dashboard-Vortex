import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { recheckTemplateOnMeta } from "@/lib/whatsapp-api";

// POST — busca status atual do template do gift-request direto na Meta API
// e atualiza wa_templates. Diferente do sync global (/api/crm/whatsapp/
// templates POST), só toca 1 template — não apaga/recria o resto, então
// não quebra outros vínculos (cart-recovery steps, etc.).
//
// Body: { template_id?: string } — se omitido, usa o template linkado no
// gift_request_configs do workspace.
export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const body = await request.json().catch(() => ({}));
    let templateId: string | null = body.template_id || null;

    const admin = createAdminClient();
    if (!templateId) {
      const { data: cfg } = await admin
        .from("gift_request_configs")
        .select("wa_template_id")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      templateId = cfg?.wa_template_id || null;
    }

    if (!templateId) {
      return NextResponse.json(
        { error: "Nenhum template vinculado." },
        { status: 400 }
      );
    }

    const result = await recheckTemplateOnMeta(workspaceId, templateId);

    // Busca a row atualizada pra devolver o status novo.
    const { data: template } = await admin
      .from("wa_templates")
      .select("id, name, language, category, status, synced_at, meta_id")
      .eq("id", templateId)
      .eq("workspace_id", workspaceId)
      .single();

    return NextResponse.json({ result, template });
  } catch (error) {
    return handleAuthError(error);
  }
}

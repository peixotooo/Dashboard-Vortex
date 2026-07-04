import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, AuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

// Verifica sessão + membership no workspace (getWorkspaceContext) e devolve
// o workspaceId confiável. Não confia no header x-workspace-id cru.
async function authorize(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    return { workspaceId };
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: error.message, status: error.status };
    }
    return { error: "Internal server error", status: 500 as const };
  }
}

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if ("error" in auth)
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("gift_request_configs")
    .select("*")
    .eq("workspace_id", auth.workspaceId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data || null });
}

export async function PUT(request: NextRequest) {
  const auth = await authorize(request);
  if ("error" in auth)
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json();
  const admin = createAdminClient();

  // Meta rejeita variáveis com \n, \t ou >4 espaços consecutivos.
  // Bloqueia salvamento pra evitar disparos falhos depois.
  const mapping = (body.wa_variable_mapping || {}) as Record<string, string>;
  const violations: string[] = [];
  for (const [pos, raw] of Object.entries(mapping)) {
    if (typeof raw !== "string") continue;
    // O valor real após resolveMappingValue interpola {{var_name}}, mas a
    // string crua já é o que vai virar texto literal pro slot. Se ela tem
    // \n/\t/4+espaços, vai falhar na Meta.
    if (/\n|\t/.test(raw)) violations.push(`{{${pos}}}: contém quebra de linha ou tab`);
    if (/ {5,}/.test(raw)) violations.push(`{{${pos}}}: contém mais de 4 espaços consecutivos`);
  }
  if (violations.length > 0) {
    return NextResponse.json(
      {
        error:
          "Mapping inválido: a Meta não aceita quebras de linha, tab ou >4 espaços dentro das variáveis. " +
          violations.join("; "),
      },
      { status: 400 }
    );
  }

  const { data, error } = await admin
    .from("gift_request_configs")
    .upsert(
      {
        workspace_id: auth.workspaceId,
        enabled: body.enabled ?? false,
        wa_template_id: body.wa_template_id || null,
        wa_variable_mapping: body.wa_variable_mapping || {},
        button_label: body.button_label || "Pedir de presente",
        button_bg_color: body.button_bg_color || "#000000",
        button_text_color: body.button_text_color || "#ffffff",
        button_border_radius: body.button_border_radius || "4px",
        button_icon: body.button_icon || "gift",
        modal_title: body.modal_title || "Pedir de presente",
        modal_subtitle:
          body.modal_subtitle ||
          "Avise alguém especial que você quer ganhar este produto",
        modal_name_label: body.modal_name_label || "Seu nome",
        modal_phone_label: body.modal_phone_label || "WhatsApp da pessoa",
        modal_message_label: body.modal_message_label || "Mensagem (opcional)",
        modal_cta_label: body.modal_cta_label || "Enviar pedido",
        modal_success_title: body.modal_success_title || "Pedido enviado!",
        modal_success_message:
          body.modal_success_message ||
          "Aguarde — assim que a pessoa responder, você fica sabendo.",
        collect_requester_phone: body.collect_requester_phone ?? false,
        pdp_anchor_selector: body.pdp_anchor_selector || null,
        hide_on_pages: Array.isArray(body.hide_on_pages)
          ? body.hide_on_pages
          : ["cart", "checkout", "home", "category"],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data });
}

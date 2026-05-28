import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/shelves/api-key";
import { createAdminClient } from "@/lib/supabase-admin";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const pageType = (searchParams.get("page_type") || "other").toLowerCase();

  const auth = await validateApiKey(key);
  if (!auth) {
    return NextResponse.json(
      { error: "Invalid API key" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  const admin = createAdminClient();
  const { data: config, error } = await admin
    .from("gift_request_configs")
    .select("*")
    .eq("workspace_id", auth.workspaceId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  if (!config || !config.enabled) {
    return NextResponse.json(
      { gift_request: null },
      {
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  }

  const hideOn: string[] = config.hide_on_pages || [
    "cart",
    "checkout",
    "home",
    "category",
  ];
  if (hideOn.includes(pageType)) {
    return NextResponse.json(
      { gift_request: null, reason: "page_hidden" },
      {
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  }

  // Sem template aprovado vinculado, o botão não tem o que fazer.
  if (!config.wa_template_id) {
    return NextResponse.json(
      { gift_request: null, reason: "no_template" },
      {
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  }

  // Detecta se o mapping atual envia {{personal_message}} pra Meta. Se
  // NÃO envia, o front esconde o campo do modal — não faz sentido pedir
  // uma mensagem que vai pro lixo.
  const mapping = (config.wa_variable_mapping || {}) as Record<string, string>;
  const acceptsPersonalMessage = Object.values(mapping).some(
    (v) => typeof v === "string" && v.includes("personal_message")
  );

  return NextResponse.json(
    {
      gift_request: {
        button_label: config.button_label || "Pedir de presente",
        button_bg_color: config.button_bg_color || "#000000",
        button_text_color: config.button_text_color || "#ffffff",
        button_border_radius: config.button_border_radius || "4px",
        button_icon: config.button_icon || "gift",
        modal_title: config.modal_title || "Pedir de presente",
        modal_subtitle:
          config.modal_subtitle ||
          "Avise alguém especial que você quer ganhar este produto",
        modal_name_label: config.modal_name_label || "Seu nome",
        modal_phone_label: config.modal_phone_label || "WhatsApp da pessoa",
        modal_message_label:
          config.modal_message_label || "Mensagem (opcional)",
        modal_cta_label: config.modal_cta_label || "Enviar pedido",
        modal_success_title: config.modal_success_title || "Pedido enviado!",
        modal_success_message:
          config.modal_success_message ||
          "Aguarde — assim que a pessoa responder, você fica sabendo.",
        collect_requester_phone: !!config.collect_requester_phone,
        accepts_personal_message: acceptsPersonalMessage,
        pdp_anchor_selector: config.pdp_anchor_selector || null,
      },
    },
    {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      "Access-Control-Max-Age": "86400",
    },
  });
}

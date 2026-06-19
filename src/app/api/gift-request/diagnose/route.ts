import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";

function createSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {},
      },
    }
  );
}

interface Check {
  ok: boolean;
  label: string;
  detail?: string;
}

// GET /api/gift-request/diagnose
// Roda toda a checklist server-side: config existe, está ligada, template
// linkado e APPROVED, credenciais Meta presentes, API key pública existe.
// Retorna razões claras pra cada item OK/falha + pedidos recentes pra ver
// se o botão tá sendo clicado pelos visitantes.
export async function GET(request: NextRequest) {
  const supabase = createSupabase(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId)
    return NextResponse.json(
      { error: "Workspace not specified" },
      { status: 400 }
    );

  const admin = createAdminClient();

  const [cfgRes, waCfgRes, apiKeyRes, recentReqRes] = await Promise.all([
    admin
      .from("gift_request_configs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    admin
      .from("wa_config")
      .select("phone_number_id, waba_id, display_phone")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    admin
      .from("shelf_api_keys")
      .select("id, key, active, name")
      .eq("workspace_id", workspaceId)
      .eq("active", true),
    admin
      .from("gift_requests")
      .select(
        `id, status, created_at, recipient_phone, error_message, wa_message_id,
         wa_messages:wa_message_id (
           status, sent_at, delivered_at, read_at, error_message,
           meta_message_id, variable_values
         )`
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const config = cfgRes.data;
  const waConfig = waCfgRes.data;
  const apiKeys = apiKeyRes.data || [];
  const rawRequests = recentReqRes.data || [];

  // Achata o JOIN com wa_messages: status real do envio vem de lá,
  // gift_requests.status pode estar desatualizado se trigger não rodou.
  const recentRequests = rawRequests.map((r) => {
    const wm = Array.isArray(r.wa_messages) ? r.wa_messages[0] : r.wa_messages;
    return {
      id: r.id,
      status: r.status,
      created_at: r.created_at,
      recipient_phone: r.recipient_phone,
      error_message: r.error_message || wm?.error_message || null,
      wa_status: wm?.status || null,
      wa_meta_message_id: wm?.meta_message_id || null,
      wa_sent_at: wm?.sent_at || null,
      wa_delivered_at: wm?.delivered_at || null,
      wa_read_at: wm?.read_at || null,
      wa_variables: wm?.variable_values || null,
    };
  });

  // Template
  let template: {
    id: string;
    name: string;
    status: string;
    category: string;
    components: unknown;
  } | null = null;

  if (config?.wa_template_id) {
    const { data } = await admin
      .from("wa_templates")
      .select("id, name, status, category, components")
      .eq("id", config.wa_template_id)
      .maybeSingle();
    template = data;
  }

  const checks: Check[] = [];

  checks.push({
    ok: !!config,
    label: "Config existe pra esse workspace",
    detail: config ? undefined : "Salve a aba Configuração ao menos 1 vez.",
  });

  checks.push({
    ok: !!config?.enabled,
    label: "Feature está ativada (switch on)",
    detail: config?.enabled
      ? undefined
      : "Ative o switch 'Ativo' no topo da aba Configuração e clique em Salvar configuração.",
  });

  checks.push({
    ok: !!config?.wa_template_id,
    label: "Template WhatsApp vinculado no config",
    detail: config?.wa_template_id
      ? undefined
      : "Selecione um template no dropdown (ou use 'Criar agora') e Salvar configuração.",
  });

  checks.push({
    ok: !!template,
    label: "Template existe no banco (wa_templates)",
    detail: template
      ? undefined
      : "Template linkado mas não encontrado. Faça Sync em /crm/whatsapp ou crie um novo.",
  });

  if (template) {
    checks.push({
      ok: template.status === "APPROVED",
      label: `Template aprovado pela Meta (atual: ${template.status})`,
      detail:
        template.status === "APPROVED"
          ? undefined
          : template.status === "PENDING"
          ? "Aguardando aprovação. Clique 'Atualizar status' pra consultar."
          : `Status atual: ${template.status}. Crie um novo (botão 'Criar agora').`,
    });

    checks.push({
      ok: template.category === "UTILITY",
      label: `Template categorizado como UTILITY (atual: ${template.category})`,
      detail:
        template.category === "UTILITY"
          ? undefined
          : `Meta classificou como ${template.category}. O módulo bloqueia templates fora de UTILITY. Crie um novo com 'Criar agora'.`,
    });
  }

  checks.push({
    ok: !!waConfig,
    label: "WhatsApp Business (credenciais Meta) configurado",
    detail: waConfig
      ? `Conectado: ${waConfig.display_phone || waConfig.phone_number_id}`
      : "Configure as credenciais em /crm/whatsapp aba Configuração.",
  });

  checks.push({
    ok: apiKeys.length > 0,
    label: "API key pública existe (pra o script da loja chamar o endpoint)",
    detail:
      apiKeys.length > 0
        ? `${apiKeys.length} chave(s) ativa(s).`
        : "Gere uma API key em /shelves aba 'Chaves de API'.",
  });

  const hideOn: string[] = config?.hide_on_pages || [
    "cart",
    "checkout",
    "home",
    "category",
  ];
  checks.push({
    ok: !hideOn.includes("product"),
    label: "Página 'product' NÃO está em hide_on_pages",
    detail: hideOn.includes("product")
      ? `'product' está em hide_on_pages: [${hideOn.join(", ")}]. Remova pra mostrar.`
      : `Esconde em: [${hideOn.join(", ")}].`,
  });

  const allOk = checks.every((c) => c.ok);

  return NextResponse.json({
    all_ok: allOk,
    checks,
    config_summary: config
      ? {
          enabled: config.enabled,
          wa_template_id: config.wa_template_id,
          mapping_slots: Object.keys(config.wa_variable_mapping || {}).length,
          hide_on_pages: hideOn,
          pdp_anchor_selector: config.pdp_anchor_selector,
        }
      : null,
    template_summary: template
      ? {
          name: template.name,
          status: template.status,
          category: template.category,
        }
      : null,
    api_key_sample: apiKeys[0]
      ? {
          id: apiKeys[0].id,
          name: apiKeys[0].name,
          // só os 4 primeiros + 4 últimos pra não vazar
          key_preview:
            apiKeys[0].key.slice(0, 4) + "…" + apiKeys[0].key.slice(-4),
        }
      : null,
    recent_requests: recentRequests,
  });
}

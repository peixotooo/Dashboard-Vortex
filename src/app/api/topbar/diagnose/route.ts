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

interface CampaignDiagnostic {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  reasons_blocked: string[];
  matches_now: boolean;
}

/**
 * GET /api/topbar/diagnose?page_type=home
 * Roda exatamente a mesma lógica do public-config mas retorna porque cada
 * campanha está ou não ativa agora.
 */
export async function GET(request: NextRequest) {
  const supabase = createSupabase(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId)
    return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

  const pageType = (new URL(request.url).searchParams.get("page_type") || "home").toLowerCase();

  const admin = createAdminClient();

  const [cfgRes, campsRes] = await Promise.all([
    admin.from("topbar_configs").select("*").eq("workspace_id", workspaceId).maybeSingle(),
    admin
      .from("topbar_campaigns")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("priority", { ascending: false })
      .order("updated_at", { ascending: false }),
  ]);

  const config = cfgRes.data;
  const campaigns = campsRes.data || [];

  // 1. Config global
  const globalChecks: { ok: boolean; label: string; detail?: string }[] = [];
  globalChecks.push({
    ok: !!config,
    label: "Existe topbar_configs para a workspace",
    detail: config ? undefined : "Salve a aba 'Configurações' pra criar o registro.",
  });
  globalChecks.push({
    ok: !!config?.enabled,
    label: "Topbar habilitada (toggle global)",
    detail: config?.enabled ? undefined : "Ative o switch 'Topbar ativada' em Configurações.",
  });
  const hideOn: string[] = config?.hide_on_pages || ["cart", "checkout"];
  globalChecks.push({
    ok: !hideOn.includes(pageType),
    label: `Página '${pageType}' não está na lista de hide_on_pages`,
    detail: hideOn.includes(pageType)
      ? `'${pageType}' está em hide_on_pages: [${hideOn.join(", ")}]. Cart/checkout são sempre escondidas.`
      : undefined,
  });

  // 2. Por campanha
  const now = new Date();
  const dow = now.getDay();
  const dom = now.getDate();
  const minutesNow = now.getHours() * 60 + now.getMinutes();

  function withinTime(s: string | null, e: string | null): boolean {
    if (!s || !e) return true;
    const [sh, sm] = s.split(":").map(Number);
    const [eh, em] = e.split(":").map(Number);
    const a = sh * 60 + sm;
    const b = eh * 60 + em;
    if (a <= b) return minutesNow >= a && minutesNow <= b;
    return minutesNow >= a || minutesNow <= b;
  }

  const perCampaign: CampaignDiagnostic[] = campaigns.map((c) => {
    const reasons: string[] = [];

    if (!c.enabled) reasons.push("Campanha pausada (enabled=false)");
    if (c.starts_at && new Date(c.starts_at).getTime() > now.getTime())
      reasons.push(`Não começou ainda (starts_at=${c.starts_at})`);
    if (c.ends_at && new Date(c.ends_at).getTime() < now.getTime())
      reasons.push(`Já acabou (ends_at=${c.ends_at})`);

    if (c.recurrence === "daily") {
      if (!withinTime(c.recurrence_window_start, c.recurrence_window_end))
        reasons.push(
          `Fora da janela diária (${c.recurrence_window_start}-${c.recurrence_window_end})`
        );
    } else if (c.recurrence === "weekly") {
      const days: number[] = c.recurrence_days || [];
      if (!days.length) reasons.push("Recorrência semanal sem dias selecionados");
      else if (!days.includes(dow)) reasons.push(`Hoje (DOW=${dow}) não está nos dias: ${days.join(",")}`);
      if (!withinTime(c.recurrence_window_start, c.recurrence_window_end))
        reasons.push(`Fora da janela diária (${c.recurrence_window_start}-${c.recurrence_window_end})`);
    } else if (c.recurrence === "monthly") {
      const days: number[] = c.recurrence_days || [];
      if (!days.length) reasons.push("Recorrência mensal sem dias selecionados");
      else if (!days.includes(dom)) reasons.push(`Hoje (dia=${dom}) não está nos dias: ${days.join(",")}`);
      if (!withinTime(c.recurrence_window_start, c.recurrence_window_end))
        reasons.push(`Fora da janela diária (${c.recurrence_window_start}-${c.recurrence_window_end})`);
    }

    const pages: string[] | null = c.show_on_pages;
    if (pages && pages.length > 0 && !pages.includes("all") && !pages.includes(pageType)) {
      reasons.push(`'${pageType}' não está em show_on_pages: [${pages.join(", ")}]`);
    }

    return {
      id: c.id,
      name: c.name,
      enabled: c.enabled,
      priority: c.priority || 0,
      reasons_blocked: reasons,
      matches_now: reasons.length === 0,
    };
  });

  const winner = perCampaign.find((c) => c.matches_now) || null;

  return NextResponse.json({
    now: now.toISOString(),
    page_type: pageType,
    global_checks: globalChecks,
    global_ok: globalChecks.every((c) => c.ok),
    campaigns: perCampaign,
    winner_id: winner?.id || null,
    winner_name: winner?.name || null,
  });
}

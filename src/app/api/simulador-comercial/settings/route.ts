import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const SIM_DEFAULTS = {
  piso_margem_pct: 15,
  buffer_zona_verde_pct: 5,
  custo_frete_medio_brl: 25,
  ticket_minimo_frete_gratis_brl: 199,
};

const FIN_DEFAULTS = {
  product_cost_pct: 25,
  tax_pct: 6,
  other_expenses_pct: 5,
  annual_revenue_target: 8000000,
  monthly_seasonality: [6.48, 5.78, 7.53, 7.20, 8.65, 8.36, 8.71, 9.08, 8.39, 7.95, 12.88, 8.98],
};

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

export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const [simRes, finRes] = await Promise.all([
      supabase
        .from("commercial_simulator_settings")
        .select("piso_margem_pct, buffer_zona_verde_pct, custo_frete_medio_brl, ticket_minimo_frete_gratis_brl")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
      supabase
        .from("workspace_financial_settings")
        .select("product_cost_pct, tax_pct, other_expenses_pct, annual_revenue_target, monthly_seasonality")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    ]);

    const sim = simRes.data ?? SIM_DEFAULTS;
    const fin = finRes.data ?? FIN_DEFAULTS;

    return NextResponse.json({
      piso_margem_pct: Number(sim.piso_margem_pct ?? SIM_DEFAULTS.piso_margem_pct),
      buffer_zona_verde_pct: Number(sim.buffer_zona_verde_pct ?? SIM_DEFAULTS.buffer_zona_verde_pct),
      custo_frete_medio_brl: Number(sim.custo_frete_medio_brl ?? SIM_DEFAULTS.custo_frete_medio_brl),
      ticket_minimo_frete_gratis_brl: Number(
        sim.ticket_minimo_frete_gratis_brl ?? SIM_DEFAULTS.ticket_minimo_frete_gratis_brl
      ),
      product_cost_pct: Number(fin.product_cost_pct ?? FIN_DEFAULTS.product_cost_pct),
      tax_pct: Number(fin.tax_pct ?? FIN_DEFAULTS.tax_pct),
      other_expenses_pct: Number(fin.other_expenses_pct ?? FIN_DEFAULTS.other_expenses_pct),
      annual_revenue_target: Number(
        ("annual_revenue_target" in fin ? fin.annual_revenue_target : null) ??
          FIN_DEFAULTS.annual_revenue_target
      ),
      monthly_seasonality:
        ("monthly_seasonality" in fin && Array.isArray(fin.monthly_seasonality)
          ? (fin.monthly_seasonality as number[])
          : null) ?? FIN_DEFAULTS.monthly_seasonality,
      isDefault: !simRes.data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ...SIM_DEFAULTS, ...FIN_DEFAULTS, isDefault: true, error: message });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const { data: membership } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();

    const { data, error } = await supabase
      .from("commercial_simulator_settings")
      .upsert(
        {
          workspace_id: workspaceId,
          piso_margem_pct: body.piso_margem_pct ?? SIM_DEFAULTS.piso_margem_pct,
          buffer_zona_verde_pct: body.buffer_zona_verde_pct ?? SIM_DEFAULTS.buffer_zona_verde_pct,
          custo_frete_medio_brl: body.custo_frete_medio_brl ?? SIM_DEFAULTS.custo_frete_medio_brl,
          ticket_minimo_frete_gratis_brl:
            body.ticket_minimo_frete_gratis_brl ?? SIM_DEFAULTS.ticket_minimo_frete_gratis_brl,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id" }
      )
      .select()
      .single();

    if (error) {
      console.error("[Commercial Simulator Settings] Upsert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ...data, isDefault: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

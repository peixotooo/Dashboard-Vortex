import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const DEFAULTS = {
  monthly_fixed_costs: 160000,
  tax_pct: 6,
  product_cost_pct: 25,
  other_expenses_pct: 5,
  monthly_seasonality: [6.48, 5.78, 7.53, 7.20, 8.65, 8.36, 8.71, 9.08, 8.39, 7.95, 12.88, 8.98],
  target_profit_monthly: 0,
  safety_margin_pct: 5,
  annual_revenue_target: 8000000,
  invest_pct: 12,
  frete_pct: 6,
  desconto_pct: 3,
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

    const { data, error } = await supabase
      .from("workspace_financial_settings")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (error) {
      console.error("[Financial Settings] Error:", error);
      return NextResponse.json({ ...DEFAULTS, isDefault: true });
    }

    if (!data) {
      return NextResponse.json({ ...DEFAULTS, isDefault: true });
    }

    return NextResponse.json({ ...data, isDefault: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ...DEFAULTS, isDefault: true, error: message });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const body = await request.json();

    const { data, error } = await supabase
      .from("workspace_financial_settings")
      .upsert(
        {
          workspace_id: workspaceId,
          monthly_fixed_costs: body.monthly_fixed_costs ?? DEFAULTS.monthly_fixed_costs,
          tax_pct: body.tax_pct ?? DEFAULTS.tax_pct,
          product_cost_pct: body.product_cost_pct ?? DEFAULTS.product_cost_pct,
          other_expenses_pct: body.other_expenses_pct ?? DEFAULTS.other_expenses_pct,
          monthly_seasonality: body.monthly_seasonality ?? DEFAULTS.monthly_seasonality,
          target_profit_monthly: body.target_profit_monthly ?? DEFAULTS.target_profit_monthly,
          safety_margin_pct: body.safety_margin_pct ?? DEFAULTS.safety_margin_pct,
          annual_revenue_target: body.annual_revenue_target ?? DEFAULTS.annual_revenue_target,
          invest_pct: body.invest_pct ?? DEFAULTS.invest_pct,
          frete_pct: body.frete_pct ?? DEFAULTS.frete_pct,
          desconto_pct: body.desconto_pct ?? DEFAULTS.desconto_pct,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id" }
      )
      .select()
      .single();

    if (error) {
      console.error("[Financial Settings] Upsert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ...data, isDefault: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { generateMonthlyCohort } from "@/lib/crm-rfm";
import type { CrmVendaRow } from "@/lib/crm-rfm";
import { getInsights } from "@/lib/meta-api";
import { getAuthenticatedContext } from "@/lib/api-auth";

export const maxDuration = 60;

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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) {
      return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });
    }

    const months = parseInt(request.nextUrl.searchParams.get("months") || "12");

    // Fetch all orders from crm_vendas
    let allRows: CrmVendaRow[] = [];
    const PAGE_SIZE = 1000;
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from("crm_vendas")
        .select("email, valor, data_compra, cupom")
        .eq("workspace_id", workspaceId)
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw new Error(`Supabase error: ${error.message}`);

      if (data && data.length > 0) {
        allRows = allRows.concat(data as CrmVendaRow[]);
        from += PAGE_SIZE;
        hasMore = data.length === PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }

    const cohort = generateMonthlyCohort(allRows);

    // Filter to requested months
    if (months > 0 && cohort.monthlyData.length > months) {
      cohort.monthlyData = cohort.monthlyData.slice(-months);
    }

    // Try to get ad spend from Meta (optional)
    let adSpend: Record<string, number> | null = null;
    try {
      await getAuthenticatedContext(request);

      // Calculate date range from cohort data
      const monthKeys = cohort.monthlyData.map((m) => m.monthKey);
      if (monthKeys.length > 0) {
        const startDate = `${monthKeys[0]}-01`;
        const lastMonth = monthKeys[monthKeys.length - 1];
        const [y, m] = lastMonth.split("-").map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        const endDate = `${lastMonth}-${String(lastDay).padStart(2, "0")}`;

        const result = await getInsights({
          time_range: { since: startDate, until: endDate },
          time_increment: "monthly",
          fields: ["spend"],
        }) as { insights?: Array<{ date_start?: string; spend?: string }> };

        if (result?.insights) {
          adSpend = {};
          for (const row of result.insights) {
            if (row.date_start) {
              const key = row.date_start.slice(0, 7);
              adSpend[key] = (adSpend[key] || 0) + parseFloat(row.spend || "0");
            }
          }
        }
      }
    } catch {
      // Meta not configured — adSpend stays null
    }

    return NextResponse.json({
      metrics: {
        arpu: cohort.arpu,
        avgOrdersPerClient: cohort.avgOrdersPerClient,
        repurchaseRate: cohort.repurchaseRate,
        newClients: cohort.newClients,
        totalClients: cohort.totalClients,
        totalRevenue: cohort.totalRevenue,
      },
      monthlyData: cohort.monthlyData,
      adSpend,
    }, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[CRM Cohort] Error:", message);
    return NextResponse.json(
      { metrics: null, monthlyData: [], adSpend: null, error: message },
      { status: 500 }
    );
  }
}

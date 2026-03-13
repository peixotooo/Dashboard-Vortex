import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { generateRfmReport } from "@/lib/crm-rfm";
import type { CrmVendaRow } from "@/lib/crm-rfm";

export const maxDuration = 60;

const EMPTY_RESPONSE = {
  customers: [],
  segments: [],
  summary: {
    totalCustomers: 0,
    totalRevenue: 0,
    avgTicket: 0,
    activeCustomers: 0,
    avgPurchasesPerCustomer: 0,
    medianRecency: 0,
  },
  distributions: { recency: [], frequency: [], monetary: [] },
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

    const fields = request.nextUrl.searchParams.get("fields");

    // Try to read from snapshot first
    interface Snapshot {
      summary: unknown; segments: unknown; distributions: unknown;
      behavioral: unknown; customers: unknown; computed_at: string;
    }

    const { data: snapshot } = await supabase
      .from("crm_rfm_snapshots")
      .select("*")
      .eq("workspace_id", workspaceId)
      .single() as unknown as { data: Snapshot | null };

    if (snapshot) {
      if (fields === "summary") {
        return NextResponse.json({
          segments: snapshot.segments,
          summary: snapshot.summary,
          distributions: snapshot.distributions,
          behavioralDistributions: snapshot.behavioral,
          computedAt: snapshot.computed_at,
        }, {
          headers: { "Cache-Control": "private, max-age=300" },
        });
      }

      return NextResponse.json({
        customers: snapshot.customers,
        segments: snapshot.segments,
        summary: snapshot.summary,
        distributions: snapshot.distributions,
        behavioralDistributions: snapshot.behavioral,
        computedAt: snapshot.computed_at,
      }, {
        headers: { "Cache-Control": "private, max-age=300" },
      });
    }

    // Fallback: no snapshot exists — compute from raw data (legacy path)
    console.log("[CRM RFM] No snapshot found, computing from raw data...");

    let allRows: CrmVendaRow[] = [];
    const PAGE_SIZE = 1000;
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from("crm_vendas")
        .select("cliente, email, telefone, valor, data_compra, cupom, numero_pedido, compras_anteriores")
        .eq("workspace_id", workspaceId)
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw new Error(`Supabase error: ${error.message}`);

      if (data && data.length > 0) {
        allRows.push(...(data as CrmVendaRow[]));
        from += PAGE_SIZE;
        hasMore = data.length === PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }

    if (allRows.length === 0) {
      return NextResponse.json(EMPTY_RESPONSE);
    }

    const report = generateRfmReport(allRows);

    if (fields === "summary") {
      return NextResponse.json({
        segments: report.segments,
        summary: report.summary,
        distributions: report.distributions,
        behavioralDistributions: report.behavioralDistributions,
      }, {
        headers: { "Cache-Control": "private, max-age=300" },
      });
    }

    return NextResponse.json(report, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[CRM RFM] Error:", message);
    return NextResponse.json(
      { ...EMPTY_RESPONSE, error: message },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
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

export async function GET() {
  try {
    const supabase = createAdminClient();

    // Paginated fetch to handle 78k+ rows
    // Supabase default limit is 1000 rows per request
    let allRows: CrmVendaRow[] = [];
    const PAGE_SIZE = 1000;
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from("crm_vendas")
        .select("cliente, email, telefone, valor, data_compra, cupom, numero_pedido, compras_anteriores")
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

    if (allRows.length === 0) {
      return NextResponse.json(EMPTY_RESPONSE);
    }

    const report = generateRfmReport(allRows);

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

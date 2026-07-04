import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { syncGiftRequestConversions } from "@/lib/gift-request/conversions";

// GET /api/gift-request/leads-insights
// Agrega gift_requests pra dar visão de "lead × produtos desejados".
// O ouro pra trabalhar depois — quem pediu, o que pediu, há quanto tempo,
// se converteu, e top produtos com mais pedidos.
//
// Retorna leads agrupados por solicitante (phone), com lista de produtos
// que cada um pediu (com data), e ranking dos produtos mais "desejados".
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const admin = createAdminClient();

    try {
      await syncGiftRequestConversions({
        admin,
        workspaceId,
      });
    } catch (err) {
      console.error("[GiftRequest Leads] conversion sync failed:", err);
    }

    const { data: requests, error } = await admin
      .from("gift_requests")
      .select(
        "id, requester_name, requester_phone, recipient_phone, product_id, product_name, product_url, product_image_url, product_price, status, converted_at, created_at"
      )
      .eq("workspace_id", workspaceId)
      .not("requester_phone", "is", null)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Agrega por solicitante (phone)
    type LeadAgg = {
      requester_name: string;
      requester_phone: string;
      first_request_at: string;
      last_request_at: string;
      request_count: number;
      converted_count: number;
      total_desired_value: number;
      products: Array<{
        id: string;
        name: string | null;
        url: string | null;
        image_url: string | null;
        price: number | null;
        requested_at: string;
        status: string;
      }>;
    };

    const byPhone = new Map<string, LeadAgg>();
    const productCounts = new Map<
      string,
      {
        product_id: string;
        product_name: string | null;
        product_url: string | null;
        product_image_url: string | null;
        product_price: number | null;
        count: number;
        unique_requesters: Set<string>;
      }
    >();

    for (const r of requests || []) {
      if (!r.requester_phone) continue;

      // Lead agg
      const phone = r.requester_phone;
      const existing = byPhone.get(phone);
      if (!existing) {
        byPhone.set(phone, {
          requester_name: r.requester_name,
          requester_phone: phone,
          first_request_at: r.created_at,
          last_request_at: r.created_at,
          request_count: 1,
          converted_count: r.converted_at ? 1 : 0,
          total_desired_value: r.product_price || 0,
          products: [
            {
              id: r.product_id,
              name: r.product_name,
              url: r.product_url,
              image_url: r.product_image_url,
              price: r.product_price,
              requested_at: r.created_at,
              status: r.status,
            },
          ],
        });
      } else {
        existing.request_count++;
        if (r.converted_at) existing.converted_count++;
        existing.total_desired_value += r.product_price || 0;
        if (r.created_at > existing.last_request_at)
          existing.last_request_at = r.created_at;
        if (r.created_at < existing.first_request_at)
          existing.first_request_at = r.created_at;
        existing.products.push({
          id: r.product_id,
          name: r.product_name,
          url: r.product_url,
          image_url: r.product_image_url,
          price: r.product_price,
          requested_at: r.created_at,
          status: r.status,
        });
      }

      // Product ranking
      const pkey = r.product_id;
      const pexisting = productCounts.get(pkey);
      if (!pexisting) {
        productCounts.set(pkey, {
          product_id: r.product_id,
          product_name: r.product_name,
          product_url: r.product_url,
          product_image_url: r.product_image_url,
          product_price: r.product_price,
          count: 1,
          unique_requesters: new Set([phone]),
        });
      } else {
        pexisting.count++;
        pexisting.unique_requesters.add(phone);
      }
    }

    const leads = Array.from(byPhone.values()).sort(
      (a, b) => b.request_count - a.request_count
    );

    const topProducts = Array.from(productCounts.values())
      .map((p) => ({
        product_id: p.product_id,
        product_name: p.product_name,
        product_url: p.product_url,
        product_image_url: p.product_image_url,
        product_price: p.product_price,
        request_count: p.count,
        unique_requesters: p.unique_requesters.size,
      }))
      .sort((a, b) => b.request_count - a.request_count)
      .slice(0, 20);

    // Acha a lista CRM linkada (se já existe)
    const { data: crmList } = await admin
      .from("crm_contact_lists")
      .select("id, name, total_count, phone_count, updated_at")
      .eq("workspace_id", workspaceId)
      .eq("name", "Pedidos de presente")
      .maybeSingle();

    return NextResponse.json({
      total_leads: leads.length,
      total_requests: requests?.length || 0,
      leads: leads.slice(0, 100),
      top_products: topProducts,
      crm_list: crmList || null,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}

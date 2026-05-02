// src/app/api/crm/email-templates/drafts/route.ts
//
// POST  → create a draft (typically from a layout preset)
// GET   → list workspace drafts (most-recent first)

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { buildDraftFromLayout } from "@/lib/email-templates/editor/presets";
import type { Slot, ProductSnapshot } from "@/lib/email-templates/types";
import type { Draft } from "@/lib/email-templates/editor/schema";

export const runtime = "nodejs";

interface CreateBody {
  layout_id?: string;
  slot?: Slot;
  product_id?: string;
  /** Manual block list takes precedence over preset generation if provided */
  draft?: Omit<Draft, "id" | "created_at" | "updated_at" | "workspace_id">;
}

function abs(u: string | null): string {
  if (!u) return "";
  return u.startsWith("//") ? `https:${u}` : u;
}

export async function GET(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const sb = createAdminClient();
    const { data, error } = await sb
      .from("email_template_drafts")
      .select("id, name, layout_id, meta, updated_at, created_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ drafts: data ?? [] });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const body = (await req.json()) as CreateBody;
    const sb = createAdminClient();

    let row: Omit<Draft, "id" | "created_at" | "updated_at">;

    if (body.draft) {
      row = { workspace_id: workspaceId, ...body.draft };
    } else if (body.layout_id) {
      const slot = (body.slot ?? 1) as Slot;
      // Look up the seed product. Fall back to the latest in-stock product.
      type Row = {
        product_id: string;
        name: string;
        price: number | null;
        sale_price: number | null;
        image_url: string | null;
        product_url: string | null;
      };
      const toSnap = (r: Row): ProductSnapshot => ({
        vnda_id: r.product_id,
        name: r.name,
        price: Number(r.sale_price ?? r.price ?? 0),
        old_price:
          r.sale_price != null && r.price != null && Number(r.price) > Number(r.sale_price)
            ? Number(r.price)
            : undefined,
        image_url: abs(r.image_url),
        url: r.product_url ?? "",
      });
      let primary: ProductSnapshot | null = null;
      if (body.product_id) {
        const { data } = await sb
          .from("shelf_products")
          .select("product_id, name, price, sale_price, image_url, product_url")
          .eq("workspace_id", workspaceId)
          .eq("product_id", body.product_id)
          .maybeSingle();
        if (data) primary = toSnap(data as Row);
      }
      if (!primary) {
        const { data } = await sb
          .from("shelf_products")
          .select("product_id, name, price, sale_price, image_url, product_url")
          .eq("workspace_id", workspaceId)
          .eq("active", true)
          .eq("in_stock", true)
          .not("image_url", "is", null)
          .order("created_at", { ascending: false })
          .limit(1);
        if (data && data[0]) primary = toSnap(data[0] as Row);
      }
      if (!primary) {
        return NextResponse.json(
          { error: "no products available to seed the draft" },
          { status: 400 }
        );
      }
      const { data: relRows } = await sb
        .from("shelf_products")
        .select("product_id, name, price, sale_price, image_url, product_url")
        .eq("workspace_id", workspaceId)
        .eq("active", true)
        .eq("in_stock", true)
        .not("image_url", "is", null)
        .neq("product_id", primary.vnda_id)
        .order("created_at", { ascending: false })
        .limit(3);
      const related = (relRows ?? []).map((r) => toSnap(r as Row));

      const seed = buildDraftFromLayout({
        layoutId: body.layout_id,
        slot,
        primary,
        related,
        workspace_id: workspaceId,
        coupon:
          slot === 2
            ? {
                code: `EMAIL-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
                discount_percent: 10,
                expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000),
              }
            : undefined,
      });
      row = seed;
    } else {
      return NextResponse.json(
        { error: "either draft or layout_id is required" },
        { status: 400 }
      );
    }

    const { data, error } = await sb
      .from("email_template_drafts")
      .insert({
        workspace_id: row.workspace_id,
        layout_id: row.layout_id ?? null,
        name: row.name,
        meta: row.meta,
        blocks: row.blocks,
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ draft: data });
  } catch (err) {
    return handleAuthError(err);
  }
}

// src/app/api/crm/email-templates/layouts/[id]/preview/route.ts
//
// Returns rendered HTML for a layout id using the preview fixture. Used by
// the Layout Library page's iframe srcdoc. Optional ?slot= query (1|2|3)
// chooses which slot context to render with — defaults to the first slot
// the layout supports.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { LAYOUTS } from "@/lib/email-templates/layouts";
import type { LayoutId } from "@/lib/email-templates/layouts/types";
import { buildPreviewContext } from "@/lib/email-templates/preview-fixture";
import { ensureHero } from "@/lib/email-templates/hero/generate";
import type { Slot } from "@/lib/email-templates/types";

export const maxDuration = 180;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const { id } = await params;
    const layout = LAYOUTS[id as LayoutId];
    if (!layout) {
      return new Response("not found", { status: 404 });
    }

    const url = new URL(req.url);
    const slotParam = url.searchParams.get("slot");
    const requested = slotParam ? (parseInt(slotParam, 10) as Slot) : layout.slots[0];
    const slot = layout.slots.includes(requested) ? requested : layout.slots[0];
    const useHero = url.searchParams.get("hero") !== "off";
    const productId = url.searchParams.get("product_id");

    let primary;
    let related;
    if (productId) {
      const { createAdminClient } = await import("@/lib/supabase-admin");
      const sb = createAdminClient();
      type Row = {
        product_id: string;
        name: string;
        price: number | null;
        sale_price: number | null;
        image_url: string | null;
        product_url: string | null;
        tags: unknown;
      };
      const toAbs = (u: string | null): string =>
        !u ? "" : u.startsWith("//") ? `https:${u}` : u;
      const toSnap = (r: Row) => ({
        vnda_id: r.product_id,
        name: r.name,
        price: Number(r.sale_price ?? r.price ?? 0),
        old_price:
          r.sale_price != null && r.price != null && Number(r.price) > Number(r.sale_price)
            ? Number(r.price)
            : undefined,
        image_url: toAbs(r.image_url),
        url: r.product_url ?? "",
      });
      // Fetch the specific product (might be deeper than the latest-8) so the
      // preview doesn't silently fall back to the fixture.
      const { data: targetRow } = await sb
        .from("shelf_products")
        .select("product_id, name, price, sale_price, image_url, product_url, tags")
        .eq("workspace_id", workspaceId)
        .eq("product_id", productId)
        .maybeSingle();
      if (targetRow) {
        primary = toSnap(targetRow as Row);
        const { data: relatedRows } = await sb
          .from("shelf_products")
          .select("product_id, name, price, sale_price, image_url, product_url, tags")
          .eq("workspace_id", workspaceId)
          .eq("active", true)
          .eq("in_stock", true)
          .neq("product_id", productId)
          .order("created_at", { ascending: false })
          .limit(3);
        related = ((relatedRows ?? []) as Row[]).map(toSnap);
      }
    }

    const ctx = buildPreviewContext(slot, { primary, related });

    // Generate (or read from cache) a hero image for the layout. ensureHero
    // returns null if KIE_API_KEY is missing or the call fails — preview just
    // falls back to the fixture product image.
    if (useHero) {
      try {
        const hero_url = await ensureHero({
          workspace_id: workspaceId,
          layout_id: layout.id,
          slot,
          product: ctx.product,
        });
        if (hero_url) ctx.hero_url = hero_url;
      } catch {
        // swallow — fall back to product image
      }
    }

    const html = layout.render(ctx);
    return NextResponse.json({
      id: layout.id,
      slot,
      html,
      hero_url: ctx.hero_url ?? null,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}

// src/app/api/crm/email-templates/[id]/reactivate/route.ts
//
// Reactivates a historical suggestion as a fresh editable draft. Reuses the
// product, copy, and layout from the original, but REFRESHES the
// time-bound stuff so the email actually works when sent today:
//   - new coupon code (random; the old code may be expired or already
//     attributed to past purchases)
//   - new countdown expiry (default 48h from now; configurable via
//     `coupon_hours` body param)
//
// Result: a draft in email_template_drafts the user can open in the
// editor, tweak, and dispatch — without the original suggestion being
// touched (its rendered_html stays as historical record).

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { buildTreeDraftFromSuggestion } from "@/lib/email-templates/tree/presets";
import type { ProductSnapshot, Slot } from "@/lib/email-templates/types";

export const runtime = "nodejs";

interface Body {
  coupon_hours?: number;
  /** Optional discount override; otherwise reuses the original. */
  coupon_discount_percent?: number;
}

interface ShelfRow {
  product_id: string;
  name: string;
  price: number | null;
  sale_price: number | null;
  image_url: string | null;
  product_url: string | null;
}

function abs(u: string | null): string {
  if (!u) return "";
  return u.startsWith("//") ? `https:${u}` : u;
}

function toSnap(r: ShelfRow): ProductSnapshot {
  return {
    vnda_id: r.product_id,
    name: r.name,
    price: Number(r.sale_price ?? r.price ?? 0),
    old_price:
      r.sale_price != null && r.price != null && Number(r.price) > Number(r.sale_price)
        ? Number(r.price)
        : undefined,
    image_url: abs(r.image_url),
    url: r.product_url ?? "",
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Body;
    const sb = createAdminClient();

    const { data: sug, error: sugErr } = await sb
      .from("email_template_suggestions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .maybeSingle();
    if (sugErr) {
      console.error("[reactivate] suggestion select failed:", sugErr);
      return NextResponse.json({ error: sugErr.message }, { status: 500 });
    }
    if (!sug) {
      return NextResponse.json({ error: "suggestion not found" }, { status: 404 });
    }

    type SugRow = {
      slot: number;
      layout_id: string | null;
      product_snapshot: ProductSnapshot;
      copy: {
        subject: string;
        headline: string;
        lead: string;
        cta_text: string;
        cta_url: string;
      };
      coupon_code: string | null;
      coupon_discount_percent: number | null;
      coupon_expires_at: string | null;
    };
    const s = sug as unknown as SugRow;

    // Refresh related-products from the live shelf so the grid renders
    // current items, not whatever was in stock when the suggestion was
    // generated weeks ago.
    const { data: relRows } = await sb
      .from("shelf_products")
      .select("product_id, name, price, sale_price, image_url, product_url")
      .eq("workspace_id", workspaceId)
      .eq("active", true)
      .eq("in_stock", true)
      .not("image_url", "is", null)
      .neq("product_id", s.product_snapshot.vnda_id)
      .order("created_at", { ascending: false })
      .limit(9);
    const related: ProductSnapshot[] = ((relRows ?? []) as ShelfRow[]).map(toSnap);

    // Refresh time-bound stuff. If the original had a coupon OR the request
    // body asks for a coupon, generate a new code + new deadline so the
    // email actually works today.
    const hadCoupon = !!s.coupon_code;
    const wantsCoupon = hadCoupon || body.coupon_discount_percent != null;
    const coupon = wantsCoupon
      ? {
          code: `EMAIL-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
          discount_percent: Number(
            body.coupon_discount_percent ?? s.coupon_discount_percent ?? 10
          ),
          expires_at: new Date(
            Date.now() + (body.coupon_hours ?? 48) * 60 * 60 * 1000
          ),
        }
      : undefined;

    const tree = buildTreeDraftFromSuggestion({
      workspace_id: workspaceId,
      layoutId: s.layout_id ?? "classic",
      slot: s.slot as Slot,
      primary: s.product_snapshot,
      related,
      copy: s.copy,
      coupon,
    });

    const { data: inserted, error: insErr } = await sb
      .from("email_template_drafts")
      .insert({
        workspace_id: workspaceId,
        layout_id: tree.layout_id ?? null,
        name: `Reativado · ${tree.name}`,
        meta: { ...tree.meta, engine: "tree" },
        blocks: tree.sections,
      })
      .select()
      .single();
    if (insErr) {
      console.error("[reactivate] insert failed:", insErr);
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    return NextResponse.json({
      draft: inserted,
      coupon_refreshed: wantsCoupon,
      new_coupon_code: coupon?.code ?? null,
      new_expires_at: coupon?.expires_at?.toISOString() ?? null,
    });
  } catch (err) {
    console.error("[reactivate] unhandled:", err);
    return handleAuthError(err);
  }
}

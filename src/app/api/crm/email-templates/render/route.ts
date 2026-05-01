// src/app/api/crm/email-templates/render/route.ts
//
// Receives a partial TemplateRenderContext from the compose page and returns
// the rendered HTML. The compose page calls this on every input edit (debounced)
// so the iframe srcdoc updates live.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { LAYOUTS } from "@/lib/email-templates/layouts";
import type { LayoutId } from "@/lib/email-templates/layouts/types";
import type { Slot, TemplateRenderContext, ProductSnapshot } from "@/lib/email-templates/types";

interface ComposeBody {
  layout_id: LayoutId;
  slot: Slot;
  product: ProductSnapshot;
  related_products?: ProductSnapshot[];
  hero_url?: string;
  hook?: string;
  copy: {
    subject: string;
    headline: string;
    lead: string;
    cta_text: string;
    cta_url: string;
  };
  coupon?: {
    code: string;
    discount_percent: number;
    expires_at: string; // ISO; we re-hydrate to Date
    countdown_url: string;
  };
}

export async function POST(req: NextRequest) {
  try {
    await getWorkspaceContext(req);
    const body = (await req.json()) as ComposeBody;
    const layout = LAYOUTS[body.layout_id];
    if (!layout) {
      return NextResponse.json({ error: "unknown layout" }, { status: 400 });
    }
    if (!layout.slots.includes(body.slot)) {
      return NextResponse.json({ error: "slot not supported by this layout" }, { status: 400 });
    }

    const ctx: TemplateRenderContext = {
      slot: body.slot,
      product: body.product,
      related_products: body.related_products ?? [],
      copy: body.copy,
      workspace: { name: "Bulking" },
      hook: body.hook,
      hero_url: body.hero_url,
      coupon: body.coupon
        ? {
            code: body.coupon.code,
            discount_percent: body.coupon.discount_percent,
            expires_at: new Date(body.coupon.expires_at),
            countdown_url: body.coupon.countdown_url,
          }
        : undefined,
    };

    const html = layout.render(ctx);
    return NextResponse.json({ html });
  } catch (err) {
    return handleAuthError(err);
  }
}

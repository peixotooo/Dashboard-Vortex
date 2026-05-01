// src/app/api/crm/email-templates/compose-hero/route.ts
//
// Generates a hero image for the compose page. Two modes:
//   - mode: "auto"   → reuses ensureHero with the layout's stock prompt and
//                       cache key (workspace, product, layout, slot).
//   - mode: "manual" → bypasses the auto-prompt builder. Takes the user's
//                       free-form prompt + the product image (mandatory) and
//                       optional extra reference images. NEVER hits the cache
//                       (each manual gen is unique). Result is uploaded to B2.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { ensureHero } from "@/lib/email-templates/hero/generate";
import { generateImage } from "@/lib/email-templates/hero/client";
import { mirrorToB2, persistGeneratedHero } from "@/lib/email-templates/hero/storage";
import type { LayoutId } from "@/lib/email-templates/layouts/types";
import type { Slot, ProductSnapshot } from "@/lib/email-templates/types";

export const maxDuration = 240;

interface AutoBody {
  mode: "auto";
  layout_id: LayoutId;
  slot: Slot;
  product: ProductSnapshot;
}

interface ManualBody {
  mode: "manual";
  layout_id: LayoutId;
  slot: Slot;
  product: ProductSnapshot;
  prompt: string;
  reference_urls?: string[]; // optional extra refs
}

type Body = AutoBody | ManualBody;

export async function POST(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const body = (await req.json()) as Body;

    if (body.mode === "auto") {
      const url = await ensureHero({
        workspace_id: workspaceId,
        layout_id: body.layout_id,
        slot: body.slot,
        product: body.product,
      });
      if (!url) {
        return NextResponse.json(
          { error: "auto hero generation failed; check audit log" },
          { status: 502 }
        );
      }
      return NextResponse.json({ hero_url: url });
    }

    // Manual mode.
    const prompt = (body.prompt ?? "").trim();
    if (prompt.length < 10) {
      return NextResponse.json({ error: "prompt too short" }, { status: 400 });
    }

    if (!process.env.KIE_API_KEY) {
      return NextResponse.json({ error: "KIE_API_KEY not configured" }, { status: 503 });
    }

    // Mirror inputs to B2 first to sidestep kie.ai's flaky URL fetcher.
    const sources: string[] = [body.product.image_url, ...(body.reference_urls ?? [])].filter(
      Boolean
    );
    if (sources.length === 0) {
      return NextResponse.json(
        { error: "at least the product image is required" },
        { status: 400 }
      );
    }
    let mirrored: string[];
    try {
      mirrored = await Promise.all(sources.map((u) => mirrorToB2(absUrl(u))));
    } catch (err) {
      return NextResponse.json(
        { error: `mirror failed: ${(err as Error).message}` },
        { status: 502 }
      );
    }

    let kieResult;
    try {
      kieResult = await generateImage(
        {
          prompt,
          input_urls: mirrored,
          aspect_ratio: "3:4",
          resolution: "1K",
        },
        { pollIntervalMs: 4_000, timeoutMs: 180_000 }
      );
    } catch (err) {
      return NextResponse.json(
        { error: `kie.ai: ${(err as Error).message}` },
        { status: 502 }
      );
    }

    const sourceUrl = kieResult.urls[0];
    if (!sourceUrl) {
      return NextResponse.json({ error: "no image returned" }, { status: 502 });
    }

    let permanentUrl: string;
    try {
      permanentUrl = await persistGeneratedHero({
        workspace_id: workspaceId,
        vnda_product_id: body.product.vnda_id,
        layout_id: body.layout_id,
        slot: body.slot,
        source_url: sourceUrl,
      });
    } catch (err) {
      return NextResponse.json(
        { error: `B2 persist failed: ${(err as Error).message}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ hero_url: permanentUrl });
  } catch (err) {
    return handleAuthError(err);
  }
}

function absUrl(u: string): string {
  if (!u) return u;
  if (u.startsWith("//")) return `https:${u}`;
  return u;
}

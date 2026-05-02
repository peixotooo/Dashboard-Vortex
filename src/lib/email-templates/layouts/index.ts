// src/lib/email-templates/layouts/index.ts
//
// Layout registry + deterministic picker. The orchestrator asks for a
// LayoutDef given (workspace_id, generated_for_date, slot). The same triple
// always picks the same layout, so re-running the cron is idempotent. Across
// days the visual rotates so subscribers don't see the same composition twice
// in a row.

import { createAdminClient } from "@/lib/supabase-admin";
import type { Slot } from "../types";
import type { LayoutDef, LayoutId } from "./types";

import { classicLayout } from "./classic";
import { editorialOverlayLightLayout } from "./editorial-overlay-light";
import { editorialOverlayDarkLayout } from "./editorial-overlay-dark";
import { reviewsSideHeroLightLayout } from "./reviews-side-hero-light";
import { reviewsSideHeroDarkLayout } from "./reviews-side-hero-dark";
import { logoAsymNarrativeLightLayout } from "./logo-asym-narrative-light";
import { logoAsymNarrativeDarkLayout } from "./logo-asym-narrative-dark";
import { overlayDualCtaLightLayout } from "./overlay-dual-cta-light";
import { overlayDualCtaDarkLayout } from "./overlay-dual-cta-dark";
import { editionNarrativeLightLayout } from "./edition-narrative-light";
import { editionNarrativeDarkLayout } from "./edition-narrative-dark";
import { numberedGridLightLayout } from "./numbered-grid-light";
import { numberedGridDarkLayout } from "./numbered-grid-dark";
import { uniformGrid3x3LightLayout } from "./uniform-grid-3x3-light";
import { uniformGrid3x3DarkLayout } from "./uniform-grid-3x3-dark";
import { singleDetailLightLayout } from "./single-detail-light";
import { singleDetailDarkLayout } from "./single-detail-dark";
import { slashLabelsLightLayout } from "./slash-labels-light";
import { slashLabelsDarkLayout } from "./slash-labels-dark";
import { blurBestsellersLightLayout } from "./blur-bestsellers-light";
import { blurBestsellersDarkLayout } from "./blur-bestsellers-dark";

export const LAYOUTS: Record<LayoutId, LayoutDef> = {
  classic: classicLayout,
  "editorial-overlay-light": editorialOverlayLightLayout,
  "editorial-overlay-dark": editorialOverlayDarkLayout,
  "reviews-side-hero-light": reviewsSideHeroLightLayout,
  "reviews-side-hero-dark": reviewsSideHeroDarkLayout,
  "logo-asym-narrative-light": logoAsymNarrativeLightLayout,
  "logo-asym-narrative-dark": logoAsymNarrativeDarkLayout,
  "overlay-dual-cta-light": overlayDualCtaLightLayout,
  "overlay-dual-cta-dark": overlayDualCtaDarkLayout,
  "edition-narrative-light": editionNarrativeLightLayout,
  "edition-narrative-dark": editionNarrativeDarkLayout,
  "numbered-grid-light": numberedGridLightLayout,
  "numbered-grid-dark": numberedGridDarkLayout,
  "uniform-grid-3x3-light": uniformGrid3x3LightLayout,
  "uniform-grid-3x3-dark": uniformGrid3x3DarkLayout,
  "single-detail-light": singleDetailLightLayout,
  "single-detail-dark": singleDetailDarkLayout,
  "slash-labels-light": slashLabelsLightLayout,
  "slash-labels-dark": slashLabelsDarkLayout,
  "blur-bestsellers-light": blurBestsellersLightLayout,
  "blur-bestsellers-dark": blurBestsellersDarkLayout,
};

export const LAYOUT_IDS: LayoutId[] = Object.keys(LAYOUTS) as LayoutId[];

/** FNV-1a 32-bit hash. Pure, no deps, stable across Node and browsers. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function familyOf(layoutId: string): string {
  return layoutId.replace(/-(light|dark)$/, "");
}

/**
 * Returns the families used by the workspace in the last `days` days. Used
 * to enforce a layout-rotation cooldown — even if the deterministic hash
 * would land on the same family, we skip it when fresh families are
 * available, so subscribers don't see the same composition every week.
 */
async function recentLayoutFamilies(workspace_id: string, days: number): Promise<Set<string>> {
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  try {
    const sb = createAdminClient();
    const { data } = await sb
      .from("email_template_suggestions")
      .select("layout_id")
      .eq("workspace_id", workspace_id)
      .gte("generated_for_date", sinceIso);
    const out = new Set<string>();
    for (const row of data ?? []) {
      const lid = row.layout_id as string | null;
      if (lid) out.add(familyOf(lid));
    }
    return out;
  } catch {
    // migration-069 not yet run, or DB blip — fall back to no cooldown.
    return new Set();
  }
}

export async function pickLayout(args: {
  workspace_id: string;
  date: string;
  slot: Slot;
}): Promise<LayoutDef> {
  const eligible = LAYOUT_IDS.map((id) => LAYOUTS[id]).filter((l) =>
    l.slots.includes(args.slot)
  );
  if (eligible.length === 0) return classicLayout;

  // Avoid layout families used in the last 10 days. If everything is "used"
  // (small workspace pool exhausted), fall through to the deterministic hash.
  const recentFamilies = await recentLayoutFamilies(args.workspace_id, 10);
  const fresh = eligible.filter((l) => !recentFamilies.has(familyOf(l.id)));
  const pool = fresh.length > 0 ? fresh : eligible;
  const h = fnv1a(`${args.workspace_id}|${args.date}|${args.slot}`);
  return pool[h % pool.length];
}

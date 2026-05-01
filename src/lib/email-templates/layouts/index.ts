// src/lib/email-templates/layouts/index.ts
//
// Layout registry + deterministic picker. The orchestrator asks for a
// LayoutDef given (workspace_id, generated_for_date, slot). The same triple
// always picks the same layout, so re-running the cron is idempotent. Across
// days the visual rotates so subscribers don't see the same composition twice
// in a row.

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

export function pickLayout(args: {
  workspace_id: string;
  date: string;
  slot: Slot;
}): LayoutDef {
  const eligible = LAYOUT_IDS.map((id) => LAYOUTS[id]).filter((l) =>
    l.slots.includes(args.slot)
  );
  if (eligible.length === 0) return classicLayout;
  const h = fnv1a(`${args.workspace_id}|${args.date}|${args.slot}`);
  return eligible[h % eligible.length];
}

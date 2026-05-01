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
import { numberedGridLightLayout } from "./numbered-grid-light";
import { slashLabelsDarkLayout } from "./slash-labels-dark";
import { singleDetailDarkLayout } from "./single-detail-dark";

export const LAYOUTS: Record<LayoutId, LayoutDef> = {
  classic: classicLayout,
  "editorial-overlay-light": editorialOverlayLightLayout,
  "numbered-grid-light": numberedGridLightLayout,
  "slash-labels-dark": slashLabelsDarkLayout,
  "single-detail-dark": singleDetailDarkLayout,
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

/**
 * Pick a layout deterministically from a (workspace, date, slot) triple. Only
 * layouts whose `slots` list includes the requested slot are eligible. Falls
 * back to the classic layout if no eligible layout exists (defensive — every
 * layout currently supports every slot).
 */
export function pickLayout(args: {
  workspace_id: string;
  date: string; // ISO YYYY-MM-DD
  slot: Slot;
}): LayoutDef {
  const eligible = LAYOUT_IDS
    .map((id) => LAYOUTS[id])
    .filter((l) => l.slots.includes(args.slot));
  if (eligible.length === 0) return classicLayout;
  const h = fnv1a(`${args.workspace_id}|${args.date}|${args.slot}`);
  return eligible[h % eligible.length];
}

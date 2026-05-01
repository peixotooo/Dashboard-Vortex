// src/lib/email-templates/layouts/_meta.ts
//
// Shared slot-aware copy helpers. Layouts compose these with their own
// structural HTML so that visual composition stays decoupled from per-slot
// text bits (badge, CTA fallback, two-line headline, etc.).

import type { Slot } from "../types";

export const SLOT_BADGE: Record<Slot, string> = {
  1: "Top 1 da semana",
  2: "Últimas peças",
  3: "Acabou de chegar",
};

/** Two-line split headline used by overlay-style layouts. */
export const SLOT_SPLIT_HEADLINE: Record<Slot, [string, string]> = {
  1: ["Top 1", "da semana"],
  2: ["Última", "chance"],
  3: ["Novo", "drop"],
};

/** Default eyebrow / hook by slot when ctx.hook is absent. */
export const SLOT_HOOK_DEFAULT: Record<Slot, string> = {
  1: "O top 1 da semana",
  2: "Estoque acabando",
  3: "Acabou de chegar",
};

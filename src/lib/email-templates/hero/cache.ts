// src/lib/email-templates/hero/cache.ts
//
// DB-backed cache. Keyed by (workspace_id, vnda_product_id, layout_id, slot).
// When the orchestrator asks for a hero and the row already exists, the
// generator pipeline is short-circuited.

import { createAdminClient } from "@/lib/supabase-admin";
import type { LayoutId } from "../layouts/types";
import type { Slot } from "../types";

export interface HeroCacheRow {
  workspace_id: string;
  vnda_product_id: string;
  layout_id: LayoutId;
  slot: Slot;
  hero_url: string;
  reference_image: string | null;
  prompt: string;
  kie_task_id: string | null;
  source_image_urls: string[];
  created_at: string;
}

interface KeyArgs {
  workspace_id: string;
  vnda_product_id: string;
  layout_id: LayoutId;
  slot: Slot;
}

export async function getHero(key: KeyArgs): Promise<HeroCacheRow | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("email_template_heroes")
    .select("*")
    .eq("workspace_id", key.workspace_id)
    .eq("vnda_product_id", key.vnda_product_id)
    .eq("layout_id", key.layout_id)
    .eq("slot", key.slot)
    .maybeSingle();
  return (data as HeroCacheRow | null) ?? null;
}

export async function saveHero(row: HeroCacheRow): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from("email_template_heroes")
    .upsert(row, { onConflict: "workspace_id,vnda_product_id,layout_id,slot" });
}

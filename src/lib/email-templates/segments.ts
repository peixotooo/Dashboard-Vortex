// src/lib/email-templates/segments.ts
import { createAdminClient } from "@/lib/supabase-admin";
import type { Slot, ResolvedSegment } from "./types";

// Maps internal slot to real RFM segment names from src/lib/crm-rfm.ts
const RFM_BY_SLOT: Record<Slot, string[]> = {
  1: ["champions", "loyal_customers"],
  2: ["loyal_customers", "potential_loyalists"],
  3: ["recent_customers", "champions"],
};

const LABELS: Record<Slot, string> = {
  1: "Champions + Loyal Customers (top compradores)",
  2: "Loyal + Potential Loyalists (compradores recorrentes)",
  3: "Recent Customers + Champions (novos + top)",
};

interface RfmSegmentSummary {
  segment: string;
  customerCount?: number;
}

async function readSegmentSummaries(workspace_id: string): Promise<RfmSegmentSummary[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("crm_rfm_snapshots")
    .select("segments")
    .eq("workspace_id", workspace_id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const arr = (data?.segments as RfmSegmentSummary[] | undefined) ?? [];
  return Array.isArray(arr) ? arr : [];
}

export async function resolveSegmentForSlot(
  workspace_id: string,
  slot: Slot
): Promise<ResolvedSegment> {
  const targetClasses = RFM_BY_SLOT[slot];
  const summaries = await readSegmentSummaries(workspace_id);
  const matched = summaries.filter((s) => targetClasses.includes(s.segment));
  const estimated_size = matched.reduce((sum, s) => sum + (s.customerCount ?? 0), 0);
  return {
    type: "rfm",
    payload: { rfm_classes: targetClasses },
    estimated_size,
    display_label: LABELS[slot],
  };
}

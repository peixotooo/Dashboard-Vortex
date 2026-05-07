// src/lib/email-templates/segment-list.ts
//
// Materializes an RFM cluster into a Locaweb list on the fly. Reads the
// workspace's RFM snapshot, filters customers by the slot's target
// rfm_classes, finds-or-creates a per-slot Locaweb list named after the
// cluster ("Vortex · Champions + Loyal (RFM)"), and ships every matching
// contact via the async bulk-import flow. Returns the list_id once
// import is finished so the caller can pass it straight into
// createMessage.list_ids.
//
// Performance: bulk-import via Locaweb's /contact_imports endpoint
// finishes ~7k contatos in ~10 seconds end-to-end. Previously we used
// chunked /lists/{id}/contacts at ~150ms per contact — a 7k cluster
// took ~4 minutes and routinely tripped Vercel timeouts.

import { createAdminClient } from "@/lib/supabase-admin";
import {
  createList,
  listLists,
  type LocawebCreds,
} from "@/lib/locaweb/email-marketing";
import { bulkImportContacts } from "./bulk-import";
import type { Slot } from "./types";
import type { RfmCustomer } from "@/lib/crm-rfm";

// Mirror of segments.ts — kept in sync. Duplicated rather than imported
// to avoid a circular dependency (segments.ts → segment-list.ts →
// segments.ts).
const RFM_BY_SLOT: Record<Slot, string[]> = {
  1: ["champions", "loyal_customers"],
  2: ["loyal_customers", "potential_loyalists"],
  3: ["recent_customers", "champions"],
};

const SLOT_LABELS: Record<Slot, string> = {
  1: "Champions + Loyal",
  2: "Loyal + Potential Loyalists",
  3: "Recent Customers + Champions",
};

interface SnapshotRow {
  customers: RfmCustomer[];
}

function isValidEmail(e: string | undefined | null): e is string {
  if (!e) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

function buildListName(slot: Slot): string {
  return `Vortex · ${SLOT_LABELS[slot]} (RFM)`;
}

export interface MaterializedSegmentList {
  list_id: string | number;
  list_name: string;
  count: number;
}

/**
 * Reads the workspace's RFM snapshot, filters customers by the slot's
 * target classes, finds-or-creates the cluster's Locaweb list, and
 * runs an async bulk-import. List names are stable per-slot so
 * re-dispatching to the same cluster reuses the existing list and
 * Locaweb dedups contacts on import.
 *
 * Throws if the snapshot is missing, the cluster has zero matching
 * customers, or the import errors out / times out (60s default).
 */
export async function materializeSegmentList(args: {
  workspace_id: string;
  slot: Slot;
  creds: LocawebCreds;
}): Promise<MaterializedSegmentList> {
  const { workspace_id, slot, creds } = args;
  const targetClasses = new Set(RFM_BY_SLOT[slot]);
  if (targetClasses.size === 0) {
    throw new Error(`Slot ${slot} não tem rfm_classes mapeadas.`);
  }

  const sb = createAdminClient();
  const { data, error } = await sb
    .from("crm_rfm_snapshots")
    .select("customers")
    .eq("workspace_id", workspace_id)
    .maybeSingle();
  if (error) {
    throw new Error(`Snapshot RFM indisponível: ${error.message}`);
  }
  const snapshot = data as SnapshotRow | null;
  const customers = Array.isArray(snapshot?.customers)
    ? (snapshot!.customers as RfmCustomer[])
    : [];

  // Filter + dedup by lowercase email. The RFM snapshot occasionally
  // carries duplicate rows when the same customer matches multiple
  // normalized phones.
  const seen = new Set<string>();
  const matched: Array<{ email: string; name?: string | null }> = [];
  for (const c of customers) {
    if (!targetClasses.has(c.segment)) continue;
    if (!isValidEmail(c.email)) continue;
    const key = c.email.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    matched.push({ email: key, name: c.name?.trim() || null });
  }

  if (matched.length === 0) {
    throw new Error(
      `O segmento sugerido (slot ${slot}) está vazio no snapshot RFM atual. Rode um sync de pedidos antes de disparar.`
    );
  }

  // Find-or-create per-slot list.
  const listName = buildListName(slot);
  let list_id: string | number | null = null;
  try {
    const lists = await listLists(creds);
    const existing = lists.find(
      (l) =>
        typeof l.name === "string" &&
        l.name.trim().toLowerCase() === listName.toLowerCase()
    );
    if (existing) list_id = existing.id;
  } catch {
    // tolerate listing failure — fall through to create()
  }
  if (list_id == null) {
    const list = await createList(creds, listName);
    list_id =
      list.id ??
      (typeof list._location === "string"
        ? list._location.split("/").filter(Boolean).pop() ?? null
        : null);
    if (list_id == null) {
      throw new Error("Locaweb aceitou criar a lista mas não retornou um id.");
    }
  }

  // Async bulk-import. ~10s for 7k contacts end-to-end.
  const result = await bulkImportContacts({
    creds,
    list_ids: [list_id],
    contacts: matched,
    storage_prefix: `${workspace_id}/segment-slot${slot}`,
    // Cap at 50s so the caller (dispatch route, maxDuration=60s on
    // Vercel pro) still has budget for createMessage afterward.
    // Empirical: 7k contacts finish in ~10s, so 50s leaves plenty of
    // headroom.
    timeout_ms: 50_000,
  });

  // Locaweb's `created_count` skips contacts that already existed in
  // the global pool but were re-bound to the list — so we report the
  // matched count as the "actual" target audience.
  return {
    list_id,
    list_name: listName,
    count: result.created_count + result.updated_count,
  };
}

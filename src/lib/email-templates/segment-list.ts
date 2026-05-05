// src/lib/email-templates/segment-list.ts
//
// Materializes an RFM cluster into a Locaweb list on the fly. The dispatch
// dialog used to require the user to pre-create lists in Locaweb that
// matched our RFM segments — but Locaweb doesn't know about RFM, so the
// "Champions + Loyal Customers" segmentação the cron suggests had no
// corresponding list, and the user couldn't dispatch to it.
//
// This helper reads the workspace's latest RFM snapshot, filters customers
// by the slot's target rfm_classes, creates a fresh Locaweb list named
// `_seg_slot{N}_{YYYYMMDD}_{short}`, and pushes every matching contact in
// chunks. Returns the list id + final count so the caller can pass it
// straight into createMessage.list_ids.

import { createAdminClient } from "@/lib/supabase-admin";
import {
  addContactsToList,
  createList,
  type LocawebCreds,
  type ContactInput,
} from "@/lib/locaweb/email-marketing";
import type { Slot } from "./types";
import type { RfmCustomer } from "@/lib/crm-rfm";

// Mirror of segments.ts — keep in sync. Duplicated rather than imported to
// avoid a circular import (segments.ts → segment-list.ts → segments.ts) and
// because the values are stable enough to live in two places.
const RFM_BY_SLOT: Record<Slot, string[]> = {
  1: ["champions", "loyal_customers"],
  2: ["loyal_customers", "potential_loyalists"],
  3: ["recent_customers", "champions"],
};

const BATCH_SIZE = 200;

interface SnapshotRow {
  customers: RfmCustomer[];
}

function isValidEmail(e: string | undefined | null): e is string {
  if (!e) return false;
  // Locaweb rejects malformed addresses outright. Cheap regex catches
  // obvious typos without being overly strict.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

function buildListName(slot: Slot, dispatchId: string): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const short = dispatchId.replace(/-/g, "").slice(0, 8);
  return `_seg_slot${slot}_${date}_${short}`;
}

export interface MaterializedSegmentList {
  list_id: string | number;
  list_name: string;
  count: number;
}

/**
 * Reads the workspace's RFM snapshot, filters customers by the slot's
 * target classes, creates a brand-new Locaweb list, and pushes every
 * matching contact. The list name is timestamped + suffixed with the
 * dispatch id so concurrent dispatches don't collide.
 *
 * Throws if the snapshot is missing, the cluster has zero matching
 * customers, or Locaweb rejects the list creation. Caller should surface
 * the error and let the user pick a regular list instead.
 */
export async function materializeSegmentList(args: {
  workspace_id: string;
  slot: Slot;
  dispatch_id: string;
  creds: LocawebCreds;
}): Promise<MaterializedSegmentList> {
  const { workspace_id, slot, dispatch_id, creds } = args;
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

  // Filter to the slot's clusters AND dedup by lowercase email — the
  // snapshot can carry duplicate rows when the same customer appears under
  // multiple normalized phones.
  const seen = new Set<string>();
  const matched: ContactInput[] = [];
  for (const c of customers) {
    if (!targetClasses.has(c.segment)) continue;
    if (!isValidEmail(c.email)) continue;
    const key = c.email.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    matched.push({ email: key, name: c.name?.trim() || undefined });
  }

  if (matched.length === 0) {
    throw new Error(
      `O segmento sugerido (slot ${slot}) está vazio no snapshot RFM atual. Rode um sync de pedidos antes de disparar.`
    );
  }

  const listName = buildListName(slot, dispatch_id);
  const list = await createList(creds, listName);
  const list_id =
    list.id ??
    (typeof list._location === "string"
      ? list._location.split("/").filter(Boolean).pop() ?? null
      : null);
  if (list_id == null) {
    throw new Error("Locaweb aceitou criar a lista mas não retornou um id.");
  }

  // Push contacts in chunks. Locaweb's per-call ceiling isn't formally
  // documented — 200 keeps us well under any reasonable cap and stays
  // responsive on slow workspaces. We swallow per-batch failures only when
  // a *later* batch fails (so the user gets a partial list rather than no
  // list); the first batch failing is fatal because it likely indicates a
  // schema / auth issue that won't fix itself.
  let pushed = 0;
  for (let i = 0; i < matched.length; i += BATCH_SIZE) {
    const chunk = matched.slice(i, i + BATCH_SIZE);
    try {
      await addContactsToList(creds, list_id, chunk);
      pushed += chunk.length;
    } catch (err) {
      if (i === 0) {
        throw new Error(
          `Locaweb rejeitou o primeiro lote de contatos: ${(err as Error).message}`
        );
      }
      console.warn(
        `[email-templates/segment-list] batch ${i}-${i + chunk.length} falhou:`,
        (err as Error).message
      );
      break;
    }
  }

  return { list_id, list_name: listName, count: pushed };
}

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: process.env.WA_WORKER_ENV || ".env.worker", quiet: true });
dotenv.config({ path: ".env.local", quiet: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const APPLY = process.env.APPLY === "1";
const STALE_HOURS = Number(process.env.STALE_HOURS || 6);
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE || 100);
const cutoffIso = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000).toISOString();

async function fetchAll(queryFactory, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

function chunks(values, size = CHUNK_SIZE) {
  const batches = [];
  for (let i = 0; i < values.length; i += size) {
    batches.push(values.slice(i, i + size));
  }
  return batches;
}

async function updateByIds(table, ids, patch, refine = (query) => query) {
  let updated = 0;
  for (const batch of chunks(ids)) {
    if (batch.length === 0) continue;
    let query = db.from(table).update(patch).in("id", batch);
    query = refine(query);
    const { data, error } = await query.select("id");
    if (error) throw error;
    updated += data?.length || 0;
  }
  return updated;
}

async function updateCartRecoveryLogsByMessageIds(messageIds, patch) {
  let updated = 0;
  for (const batch of chunks(messageIds.map(String))) {
    if (batch.length === 0) continue;
    const { data, error } = await db
      .from("cart_recovery_messages")
      .update(patch)
      .eq("channel", "whatsapp")
      .in("external_id", batch)
      .select("id");
    if (error) throw error;
    updated += data?.length || 0;
  }
  return updated;
}

async function countDueByKind(kind) {
  const { count, error } = await db
    .from("wa_campaigns")
    .select("id", { count: "exact", head: true })
    .eq("kind", kind)
    .or("status.eq.queued,status.eq.sending,and(status.eq.scheduled,scheduled_at.lte.now())");
  if (error) throw error;
  return count || 0;
}

const staleCampaigns = await fetchAll(() =>
  db
    .from("wa_campaigns")
    .select("id, status, created_at")
    .eq("kind", "cart_recovery")
    .in("status", ["queued", "sending", "scheduled"])
    .lt("created_at", cutoffIso)
    .order("created_at", { ascending: true })
);

const staleCampaignIds = staleCampaigns.map((row) => row.id);
const staleMessages = [];
for (const batch of chunks(staleCampaignIds)) {
  const rows = await fetchAll(() =>
    db
      .from("wa_messages")
      .select("id, campaign_id, status, created_at")
      .in("campaign_id", batch)
      .in("status", ["queued", "sending"])
      .lt("created_at", cutoffIso)
  );
  staleMessages.push(...rows);
}

const staleMessageIds = staleMessages.map((row) => row.id);
const cancelCampaignIds = [
  ...new Set(staleMessages.map((row) => row.campaign_id).filter(Boolean)),
];

let canceledMessages = 0;
let canceledCampaigns = 0;
let markedLogs = 0;
let completedCampaigns = 0;

if (APPLY) {
  canceledMessages = await updateByIds(
    "wa_messages",
    staleMessageIds,
    {
      status: "canceled",
      error_message: `stale_cart_recovery_queue_expired_${STALE_HOURS}h`,
    },
    (query) => query.in("status", ["queued", "sending"])
  );

  canceledCampaigns = await updateByIds(
    "wa_campaigns",
    cancelCampaignIds,
    {
      status: "canceled",
      completed_at: new Date().toISOString(),
    },
    (query) => query.in("status", ["queued", "scheduled", "sending"])
  );

  markedLogs = await updateCartRecoveryLogsByMessageIds(staleMessageIds, {
    status: "failed",
    error: `stale_cart_recovery_queue_expired_${STALE_HOURS}h`,
  });
}

const remainingActiveCampaigns = await fetchAll(() =>
  db
    .from("wa_campaigns")
    .select("id, status")
    .eq("kind", "cart_recovery")
    .in("status", ["queued", "sending", "scheduled"])
);
const remainingCampaignIds = remainingActiveCampaigns.map((row) => row.id);
const activeMessages = [];
for (const batch of chunks(remainingCampaignIds)) {
  const rows = await fetchAll(() =>
    db
      .from("wa_messages")
      .select("id, campaign_id, status")
      .in("campaign_id", batch)
      .in("status", ["queued", "sending"])
  );
  activeMessages.push(...rows);
}

const campaignIdsWithActiveMessages = new Set(
  activeMessages.map((row) => row.campaign_id)
);
const completeCampaignIds = remainingCampaignIds.filter(
  (id) => !campaignIdsWithActiveMessages.has(id)
);

if (APPLY) {
  completedCampaigns = await updateByIds(
    "wa_campaigns",
    completeCampaignIds,
    {
      status: "completed",
      completed_at: new Date().toISOString(),
    },
    (query) => query.in("status", ["queued", "scheduled", "sending"])
  );
}

const finalDue = {
  gift_request: await countDueByKind("gift_request"),
  campaign: await countDueByKind("campaign"),
  cart_recovery: await countDueByKind("cart_recovery"),
};

console.log(
  JSON.stringify(
    {
      apply: APPLY,
      staleHours: STALE_HOURS,
      cutoffIso,
      staleCampaigns: staleCampaigns.length,
      staleMessages: staleMessages.length,
      cancelCampaigns: cancelCampaignIds.length,
      canceledMessages,
      canceledCampaigns,
      markedLogs,
      completeCampaigns: completeCampaignIds.length,
      completedCampaigns,
      finalDue,
    },
    null,
    2
  )
);

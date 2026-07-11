import type { SupabaseClient } from "@supabase/supabase-js";

type CheckoutEventRow = {
  workspace_id: string;
  session_id: string;
  consumer_id: string | null;
  event_type: string;
  step: string | null;
  field_key: string | null;
  payment_method: string | null;
  shipping_method: string | null;
  error_code: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type SessionAccumulator = {
  workspaceId: string;
  sessionId: string;
  consumerId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  eventCount: number;
  purchased: boolean;
  lastStep: string;
  lastFieldKey: string | null;
  paymentMethod: string | null;
  shippingMethod: string | null;
  stepsSeen: Map<string, number>;
  fieldsTouched: Set<string>;
  fieldsCompleted: Set<string>;
  fieldsErrored: Set<string>;
  errorPairs: Set<string>;
  errorCodes: Map<string, number>;
  trackerVersions: Map<string, number>;
};

export type CheckoutSessionRollupRow = {
  session_id: string;
  consumer_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  event_count: number;
  purchased: boolean;
  last_step: string | null;
  last_field_key: string | null;
  payment_method: string | null;
  shipping_method: string | null;
  steps_seen: Record<string, number> | null;
  fields_touched: Record<string, number> | null;
  fields_completed: Record<string, number> | null;
  fields_errored: Record<string, number> | null;
  error_codes: Record<string, number> | null;
  tracker_versions?: Record<string, number> | null;
};

export type RefreshCheckoutRollupsResult = {
  since: string;
  until: string;
  eventsScanned: number;
  sessionsUpserted: number;
};

function addCount(map: Map<string, number>, key: string | null | undefined, by = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + by);
}

function setToCountObject(set: Set<string>) {
  const out: Record<string, number> = {};
  for (const key of set) out[key] = 1;
  return out;
}

function mapToObject(map: Map<string, number>) {
  const out: Record<string, number> = {};
  for (const [key, count] of map.entries()) out[key] = count;
  return out;
}

function eventStep(event: CheckoutEventRow) {
  const metadataStep =
    typeof event.metadata?.last_step === "string" ? event.metadata.last_step : null;
  return metadataStep || event.step || "unknown";
}

function eventLastField(event: CheckoutEventRow) {
  const metadataField =
    typeof event.metadata?.last_field_key === "string"
      ? event.metadata.last_field_key
      : null;
  return metadataField || event.field_key || null;
}

function applyEvent(acc: SessionAccumulator, event: CheckoutEventRow) {
  acc.eventCount += 1;
  acc.consumerId = acc.consumerId || event.consumer_id || null;

  if (event.created_at < acc.firstSeenAt) acc.firstSeenAt = event.created_at;
  if (event.created_at >= acc.lastSeenAt) {
    acc.lastSeenAt = event.created_at;
    acc.lastStep = eventStep(event);
    acc.lastFieldKey = eventLastField(event);
  }

  const step = eventStep(event);
  addCount(acc.stepsSeen, step);
  if (typeof event.metadata?.tracker_version === "string") {
    addCount(acc.trackerVersions, event.metadata.tracker_version);
  }

  if (event.payment_method) acc.paymentMethod = event.payment_method;
  if (event.shipping_method) acc.shippingMethod = event.shipping_method;

  if (event.event_type === "checkout_purchase_completed") acc.purchased = true;
  if (event.event_type === "checkout_field_started" && event.field_key) {
    acc.fieldsTouched.add(event.field_key);
  }
  if (event.event_type === "checkout_field_completed" && event.field_key) {
    acc.fieldsCompleted.add(event.field_key);
  }
  if (event.event_type === "checkout_field_error" && event.field_key) {
    acc.fieldsErrored.add(event.field_key);
    const errorCode = event.error_code || "unknown";
    const pairKey = `${event.field_key}|${errorCode}`;
    if (!acc.errorPairs.has(pairKey)) {
      acc.errorPairs.add(pairKey);
      addCount(acc.errorCodes, errorCode);
    }
  }
}

function getAccumulator(
  sessions: Map<string, SessionAccumulator>,
  event: CheckoutEventRow
) {
  const key = `${event.workspace_id}|${event.session_id}`;
  let acc = sessions.get(key);
  if (!acc) {
    acc = {
      workspaceId: event.workspace_id,
      sessionId: event.session_id,
      consumerId: event.consumer_id || null,
      firstSeenAt: event.created_at,
      lastSeenAt: event.created_at,
      eventCount: 0,
      purchased: false,
      lastStep: eventStep(event),
      lastFieldKey: eventLastField(event),
      paymentMethod: null,
      shippingMethod: null,
      stepsSeen: new Map(),
      fieldsTouched: new Set(),
      fieldsCompleted: new Set(),
      fieldsErrored: new Set(),
      errorPairs: new Set(),
      errorCodes: new Map(),
      trackerVersions: new Map(),
    };
    sessions.set(key, acc);
  }
  return acc;
}

function toUpsertRow(acc: SessionAccumulator) {
  return {
    workspace_id: acc.workspaceId,
    session_id: acc.sessionId,
    consumer_id: acc.consumerId,
    first_seen_at: acc.firstSeenAt,
    last_seen_at: acc.lastSeenAt,
    event_count: acc.eventCount,
    purchased: acc.purchased,
    last_step: acc.lastStep || "unknown",
    last_field_key: acc.lastFieldKey,
    payment_method: acc.paymentMethod,
    shipping_method: acc.shippingMethod,
    steps_seen: mapToObject(acc.stepsSeen),
    fields_touched: setToCountObject(acc.fieldsTouched),
    fields_completed: setToCountObject(acc.fieldsCompleted),
    fields_errored: setToCountObject(acc.fieldsErrored),
    error_codes: mapToObject(acc.errorCodes),
    tracker_versions: mapToObject(acc.trackerVersions),
    refreshed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export async function refreshCheckoutSessionRollups(
  admin: SupabaseClient,
  opts: {
    sinceIso: string;
    untilIso?: string;
    workspaceId?: string;
    maxEvents?: number;
  }
): Promise<RefreshCheckoutRollupsResult> {
  const untilIso = opts.untilIso || new Date().toISOString();
  const maxEvents = Math.max(1000, Math.min(opts.maxEvents || 100000, 500000));
  const sessions = new Map<string, SessionAccumulator>();
  const pageSize = 1000;
  let eventsScanned = 0;

  for (let from = 0; from < maxEvents; from += pageSize) {
    let query = admin
      .from("checkout_events")
      .select(
        "workspace_id,session_id,consumer_id,event_type,step,field_key,payment_method,shipping_method,error_code,metadata,created_at"
      )
      .gte("created_at", opts.sinceIso)
      .lte("created_at", untilIso)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);

    if (opts.workspaceId) query = query.eq("workspace_id", opts.workspaceId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = (data || []) as CheckoutEventRow[];
    eventsScanned += rows.length;

    for (const event of rows) {
      if (!event.workspace_id || !event.session_id) continue;
      applyEvent(getAccumulator(sessions, event), event);
    }

    if (rows.length < pageSize) break;
  }

  const upsertRows = [...sessions.values()].map(toUpsertRow);
  for (let i = 0; i < upsertRows.length; i += 500) {
    const chunk = upsertRows.slice(i, i + 500);
    const { error } = await admin
      .from("checkout_session_rollups")
      .upsert(chunk, { onConflict: "workspace_id,session_id" });
    if (error) {
      const missingTrackerColumn =
        error.message.includes("tracker_versions") ||
        error.message.includes("schema cache");
      if (!missingTrackerColumn) throw new Error(error.message);
      const legacyChunk = chunk.map(({ tracker_versions: _ignored, ...row }) => row);
      const { error: legacyError } = await admin
        .from("checkout_session_rollups")
        .upsert(legacyChunk, { onConflict: "workspace_id,session_id" });
      if (legacyError) throw new Error(legacyError.message);
    }
  }

  return {
    since: opts.sinceIso,
    until: untilIso,
    eventsScanned,
    sessionsUpserted: upsertRows.length,
  };
}

export async function loadCheckoutSessionRollups(
  admin: SupabaseClient,
  workspaceId: string,
  sinceIso: string,
  untilIso: string
) {
  const rows: CheckoutSessionRollupRow[] = [];
  const pageSize = 1000;

  for (let from = 0; from < 50000; from += pageSize) {
    const { data, error } = await admin
      .from("checkout_session_rollups")
      .select(
        "session_id,consumer_id,first_seen_at,last_seen_at,event_count,purchased,last_step,last_field_key,payment_method,shipping_method,steps_seen,fields_touched,fields_completed,fields_errored,error_codes"
      )
      .eq("workspace_id", workspaceId)
      .gte("first_seen_at", sinceIso)
      .lte("first_seen_at", untilIso)
      .order("first_seen_at", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);
    rows.push(...((data || []) as CheckoutSessionRollupRow[]));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

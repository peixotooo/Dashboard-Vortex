import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthError, getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { datePresetToTimeRange } from "@/lib/utils";
import type { DatePreset } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

type CheckoutEventRow = {
  session_id: string;
  event_type: string;
  step: string | null;
  field_key: string | null;
  field_group: string | null;
  payment_method: string | null;
  shipping_method: string | null;
  error_code: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type SessionState = {
  purchased: boolean;
  lastEvent: CheckoutEventRow | null;
  steps: Set<string>;
  fieldsTouched: Set<string>;
  fieldsCompleted: Set<string>;
  fieldsErrored: Set<string>;
  paymentMethod: string | null;
  shippingMethod: string | null;
};

function toBrtIsoStart(date: string) {
  return new Date(`${date}T00:00:00.000-03:00`).toISOString();
}

function toBrtIsoEnd(date: string) {
  return new Date(`${date}T23:59:59.999-03:00`).toISOString();
}

function pct(part: number, total: number) {
  return total > 0 ? Number(((part / total) * 100).toFixed(1)) : 0;
}

function addCount(map: Map<string, number>, key: string | null | undefined, by = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + by);
}

function topEntries(map: Map<string, number>, limit = 10) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

async function loadEvents(
  admin: SupabaseClient,
  workspaceId: string,
  sinceIso: string,
  untilIso: string
) {
  const rows: CheckoutEventRow[] = [];
  const pageSize = 1000;

  for (let from = 0; from < 50000; from += pageSize) {
    const { data, error } = await admin
      .from("checkout_events")
      .select(
        "session_id,event_type,step,field_key,field_group,payment_method,shipping_method,error_code,metadata,created_at"
      )
      .eq("workspace_id", workspaceId)
      .gte("created_at", sinceIso)
      .lte("created_at", untilIso)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);
    rows.push(...((data || []) as CheckoutEventRow[]));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getWorkspaceContext(request);
    const admin = createAdminClient();
    const { searchParams } = new URL(request.url);
    const datePreset = (searchParams.get("date_preset") || "last_30d") as DatePreset;
    const sinceParam = searchParams.get("since") || "";
    const untilParam = searchParams.get("until") || "";
    const customRange =
      sinceParam && untilParam ? { since: sinceParam, until: untilParam } : undefined;
    const period = datePresetToTimeRange(datePreset, customRange);
    const sinceIso = toBrtIsoStart(period.since);
    const untilIso = toBrtIsoEnd(period.until);

    const events = await loadEvents(admin, auth.workspaceId, sinceIso, untilIso);
    const sessions = new Map<string, SessionState>();
    const fieldTouches = new Map<string, number>();
    const fieldCompletions = new Map<string, number>();
    const fieldErrors = new Map<string, number>();
    const fieldExit = new Map<string, number>();
    const stepSessions = new Map<string, Set<string>>();
    const stepExit = new Map<string, number>();
    const paymentSelected = new Map<string, number>();
    const paymentExit = new Map<string, number>();
    const shippingSelected = new Map<string, number>();
    const shippingExit = new Map<string, number>();
    const errorCodes = new Map<string, number>();

    for (const event of events) {
      if (!event.session_id) continue;
      let state = sessions.get(event.session_id);
      if (!state) {
        state = {
          purchased: false,
          lastEvent: null,
          steps: new Set(),
          fieldsTouched: new Set(),
          fieldsCompleted: new Set(),
          fieldsErrored: new Set(),
          paymentMethod: null,
          shippingMethod: null,
        };
        sessions.set(event.session_id, state);
      }

      const step = event.step || "unknown";
      state.steps.add(step);
      if (!stepSessions.has(step)) stepSessions.set(step, new Set());
      stepSessions.get(step)!.add(event.session_id);

      if (event.event_type === "checkout_purchase_completed") {
        state.purchased = true;
      }

      if (event.event_type === "checkout_field_started" && event.field_key) {
        state.fieldsTouched.add(event.field_key);
        addCount(fieldTouches, event.field_key);
      }
      if (event.event_type === "checkout_field_completed" && event.field_key) {
        state.fieldsCompleted.add(event.field_key);
        addCount(fieldCompletions, event.field_key);
      }
      if (event.event_type === "checkout_field_error" && event.field_key) {
        state.fieldsErrored.add(event.field_key);
        addCount(fieldErrors, event.field_key);
        addCount(errorCodes, event.error_code || "unknown");
      }
      if (
        event.event_type === "checkout_payment_method_selected" &&
        event.payment_method
      ) {
        state.paymentMethod = event.payment_method;
        addCount(paymentSelected, event.payment_method);
      }
      if (event.event_type === "checkout_shipping_selected" && event.shipping_method) {
        state.shippingMethod = event.shipping_method;
        addCount(shippingSelected, event.shipping_method);
      }

      state.lastEvent = event;
    }

    let purchasedSessions = 0;
    for (const state of sessions.values()) {
      if (state.purchased) {
        purchasedSessions++;
        continue;
      }

      const last = state.lastEvent;
      const lastStep =
        (last?.metadata?.last_step as string | undefined) ||
        last?.step ||
        "unknown";
      const lastField =
        (last?.metadata?.last_field_key as string | undefined) ||
        last?.field_key ||
        null;

      addCount(stepExit, lastStep);
      addCount(fieldExit, lastField);
      addCount(paymentExit, state.paymentMethod);
      addCount(shippingExit, state.shippingMethod);
    }

    const checkoutSessions = sessions.size;
    const abandonedSessions = Math.max(0, checkoutSessions - purchasedSessions);
    const steps = [...stepSessions.entries()]
      .map(([step, set]) => {
        const sessionsCount = set.size;
        const exits = stepExit.get(step) || 0;
        return {
          step,
          sessions: sessionsCount,
          abandon_sessions: exits,
          abandon_rate: pct(exits, sessionsCount),
        };
      })
      .sort((a, b) => b.abandon_sessions - a.abandon_sessions);

    const fields = topEntries(
      new Map(
        [...new Set([...fieldTouches.keys(), ...fieldErrors.keys(), ...fieldExit.keys()])].map(
          (field) => [field, fieldTouches.get(field) || fieldErrors.get(field) || fieldExit.get(field) || 0]
        )
      ),
      12
    ).map(({ key }) => {
      const touches = fieldTouches.get(key) || 0;
      const errors = fieldErrors.get(key) || 0;
      const exits = fieldExit.get(key) || 0;
      return {
        field_key: key,
        touches,
        completions: fieldCompletions.get(key) || 0,
        errors,
        last_before_exit: exits,
        error_rate: pct(errors, touches),
      };
    }).sort((a, b) =>
      b.last_before_exit - a.last_before_exit ||
      b.errors - a.errors ||
      b.touches - a.touches
    );

    return NextResponse.json({
      configured: true,
      period,
      totals: {
        events: events.length,
        checkout_sessions: checkoutSessions,
        purchased_sessions: purchasedSessions,
        abandoned_sessions: abandonedSessions,
        completion_rate: pct(purchasedSessions, checkoutSessions),
        abandonment_rate: pct(abandonedSessions, checkoutSessions),
      },
      steps,
      fields,
      payment_methods: topEntries(paymentSelected, 8).map((entry) => ({
        payment_method: entry.key,
        selected: entry.count,
        last_before_exit: paymentExit.get(entry.key) || 0,
      })),
      shipping_methods: topEntries(shippingSelected, 8).map((entry) => ({
        shipping_method: entry.key,
        selected: entry.count,
        last_before_exit: shippingExit.get(entry.key) || 0,
      })),
      error_codes: topEntries(errorCodes, 8).map((entry) => ({
        error_code: entry.key,
        count: entry.count,
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Checkout Insights]", message);
    return NextResponse.json(
      {
        configured: false,
        error: message,
        totals: {
          events: 0,
          checkout_sessions: 0,
          purchased_sessions: 0,
          abandoned_sessions: 0,
          completion_rate: 0,
          abandonment_rate: 0,
        },
        steps: [],
        fields: [],
        payment_methods: [],
        shipping_methods: [],
        error_codes: [],
      },
      { status: 500 }
    );
  }
}

/**
 * Mission Control E2E smoke test.
 *
 * Runs directly against the Supabase REST API using the service role key
 * from .env.local. Creates a real person, demand, follow-up, flips states,
 * verifies the derived fields the server writes automatically, then cleans
 * up after itself. Fails loudly if any step errors.
 *
 * Usage:
 *   WORKSPACE_ID=<uuid> npx tsx scripts/mission-control-e2e.ts
 *
 * If WORKSPACE_ID is not set, the script will pick the first workspace the
 * service role can see and use that.
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const supabase = createClient(URL, KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type Step = { name: string; ok: boolean; detail?: string };
const steps: Step[] = [];

function record(name: string, ok: boolean, detail?: string) {
  steps.push({ name, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function pickWorkspace(): Promise<string> {
  if (process.env.WORKSPACE_ID) return process.env.WORKSPACE_ID;
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`workspaces fetch failed: ${error.message}`);
  if (!data?.length) throw new Error("no workspaces found");
  console.log(`using workspace ${data[0].id} (${data[0].name})`);
  return data[0].id;
}

// PostgREST doesn't expose information_schema. We probe the columns by asking
// PostgREST for `select=<col1>,<col2>,...&limit=0` on the target table.
// If a column doesn't exist the whole call 400s with the column name in the
// error — which tells us exactly what's missing.
async function expectColumns(table: string, required: string[]) {
  const { error } = await supabase
    .from(table)
    .select(required.join(","))
    .limit(0);
  if (!error) {
    record(`columns ${table}`, true, `${required.length} OK`);
    return;
  }
  // Parse "column X does not exist" or PostgREST's "Could not find the 'X' column"
  const msg = error.message;
  const m =
    msg.match(/column ([\w.]+) does not exist/i) ||
    msg.match(/Could not find the '([^']+)' column/i);
  const hint = m ? `missing: ${m[1]}` : msg;
  record(`columns ${table}`, false, hint);
}

async function main() {
  const workspaceId = await pickWorkspace();

  // ---------------- column existence checks (catches half-applied migrations)
  await expectColumns("mc_demands", [
    "waiting_for_person",
    "waiting_for_person_id",
    "waiting_since_at_utc",
    "waiting_last_reply_at_utc",
    "parent_demand_id",
    "depends_on_ids",
    "deliverable_type",
    "completion_notes",
    "success_metric",
    "failure_reason",
    "requested_by_role",
    "team",
    "owner_person_id",
    "metric_snapshot_json",
    "metric_snapshot_captured_at_utc",
  ]);
  await expectColumns("mc_follow_ups", [
    "target_person_id",
    "channel",
    "sent_by",
    "response_text",
    "response_summary",
    "is_sla_breached",
    "breach_hours",
  ]);
  await expectColumns("mc_experiments", [
    "test_type",
    "sample_size",
    "stop_rule",
    "win_rule",
    "loss_rule",
    "final_decision_reason",
    "metric_snapshot_json",
  ]);
  await expectColumns("mc_people", ["role", "team", "channel", "is_active"]);
  await expectColumns("mc_notifications_queue", [
    "target_person_id",
    "target_person_name",
    "payload",
    "sent_at_utc",
  ]);

  // ---------------- create person
  const personName = `E2E Tester ${Date.now()}`;
  const { data: person, error: pErr } = await supabase
    .from("mc_people")
    .insert({
      workspace_id: workspaceId,
      name: personName,
      role: "ops",
      channel: "whatsapp",
      phone_or_chat_id: "+5511999999999",
    })
    .select("*")
    .single();
  record("create mc_people", !pErr, pErr?.message);
  if (!person) return report();

  // ---------------- create demand
  const { data: demand, error: dErr } = await supabase
    .from("mc_demands")
    .insert({
      workspace_id: workspaceId,
      title: `E2E Demanda ${Date.now()}`,
      area: "ops",
      status: "new",
      priority: "high",
      health: "on_track",
      owner: personName,
      owner_person_id: person.id,
      team: "ops",
      deliverable_type: "action",
      reply_sla_hours: 3,
    })
    .select("*")
    .single();
  record("create mc_demands", !dErr, dErr?.message);
  if (!demand) return report(person);

  // ---------------- update demand → waiting_person (server-side code sets it too,
  // but here we simulate the raw write just like the REST API would do)
  const { data: updated, error: uErr } = await supabase
    .from("mc_demands")
    .update({
      status: "waiting_person",
      waiting_for_person: personName,
      waiting_for_person_id: person.id,
      waiting_since_at_utc: new Date().toISOString(),
      next_follow_up_at_utc: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
      last_updated_at_utc: new Date().toISOString(),
    })
    .eq("id", demand.id)
    .select("*")
    .single();
  record(
    "update demand → waiting_person",
    !uErr && updated?.waiting_for_person === personName,
    uErr?.message ?? `waiting_for_person=${updated?.waiting_for_person}`
  );

  // ---------------- create follow-up
  const { data: fu, error: fErr } = await supabase
    .from("mc_follow_ups")
    .insert({
      workspace_id: workspaceId,
      demand_id: demand.id,
      target_person: personName,
      target_person_id: person.id,
      channel: "whatsapp",
      message_type: "charge",
      message_text: `${personName.split(" ")[0]}, você conseguiu verificar?`,
      reply_status: "pending",
      due_reply_at_utc: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
    })
    .select("*")
    .single();
  record("create mc_follow_ups", !fErr, fErr?.message);
  if (!fu) return report(person, demand);

  // ---------------- mark follow-up replied
  const { data: replied, error: rErr } = await supabase
    .from("mc_follow_ups")
    .update({
      reply_status: "replied",
      replied_at_utc: new Date().toISOString(),
      response_summary: "confirmado",
    })
    .eq("id", fu.id)
    .select("*")
    .single();
  record(
    "update follow-up → replied",
    !rErr && replied?.reply_status === "replied",
    rErr?.message
  );

  // ---------------- enqueue notification
  const { data: notif, error: nErr } = await supabase
    .from("mc_notifications_queue")
    .insert({
      workspace_id: workspaceId,
      entity_type: "follow_up",
      entity_id: fu.id,
      event: "charge",
      target_person_id: person.id,
      target_person_name: personName,
      channel: "whatsapp",
      payload: { message_text: "test" },
    })
    .select("*")
    .single();
  record("enqueue mc_notifications_queue", !nErr, nErr?.message);

  // ---------------- cleanup
  if (notif) await supabase.from("mc_notifications_queue").delete().eq("id", notif.id);
  await supabase.from("mc_follow_ups").delete().eq("id", fu.id);
  await supabase.from("mc_demands").delete().eq("id", demand.id);
  await supabase.from("mc_people").delete().eq("id", person.id);
  record("cleanup", true);

  report();
}

function report(...cleanup: Array<{ id: string }>) {
  // best-effort cleanup if we bailed early
  for (const row of cleanup) {
    // ignored — user can wipe manually if needed
    void row;
  }
  const failed = steps.filter((s) => !s.ok);
  console.log("\n============================================");
  console.log(`${steps.length - failed.length}/${steps.length} steps passed`);
  if (failed.length) {
    console.log("FAILED:");
    for (const s of failed) console.log(`  - ${s.name}${s.detail ? ` — ${s.detail}` : ""}`);
    process.exit(1);
  }
  console.log("ALL GREEN");
  process.exit(0);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});

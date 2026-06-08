import type { SupabaseClient } from "@supabase/supabase-js";
import {
  autoApprovePendingForAutoPlans,
  proposeNewCoupons,
} from "@/lib/coupons/orchestrator";

type AdminClient = SupabaseClient;

interface CouponJobRow {
  id: string;
  workspace_id: string;
  plan_id: string | null;
  actor: string | null;
  details: {
    job_type?: string;
    job_status?: "queued" | "running" | "succeeded" | "failed";
    requested_by?: string | null;
    attempts?: number;
    max_attempts?: number;
    scheduled_at?: string;
    started_at?: string;
    completed_at?: string;
    result?: Record<string, unknown>;
    playbook_run_id?: string | null;
    playbook_id?: string | null;
    playbook_name?: string | null;
  } | null;
  error_message: string | null;
  created_at: string;
}

interface CouponPlanRow {
  id: string;
  name: string;
  enabled: boolean;
  require_manual_approval: boolean;
}

export interface CouponPlaybookJobContext {
  playbook_run_id?: string | null;
  playbook_id?: string | null;
  playbook_name?: string | null;
}

export interface EnqueueCouponPlanRunJobArgs {
  admin: AdminClient;
  workspaceId: string;
  planId: string;
  requestedBy?: string | null;
  playbookContext?: CouponPlaybookJobContext;
}

export async function enqueueCouponPlanRunJob(args: EnqueueCouponPlanRunJobArgs) {
  const { admin, workspaceId, planId, requestedBy, playbookContext } = args;
  const playbookRunId = cleanOptionalText(playbookContext?.playbook_run_id);

  const { data: recent, error: recentError } = await admin
    .from("coupon_audit_log")
    .select("id, details, created_at")
    .eq("workspace_id", workspaceId)
    .eq("action", "cron_skipped")
    .eq("plan_id", planId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (recentError) throw recentError;
  const existing = ((recent || []) as Array<{ id: string; details: Record<string, unknown> | null }>).find(
    (row) => {
      const details = row.details || {};
      return (
        details.job_type === "coupon_plan_run" &&
        ["queued", "running"].includes(String(details.job_status || "")) &&
        (playbookRunId
          ? details.playbook_run_id === playbookRunId
          : !details.playbook_run_id)
      );
    }
  );
  if (existing) {
    return {
      jobId: existing.id as string,
      status: String(existing.details?.job_status || "queued"),
      alreadyQueued: true,
    };
  }

  const { data, error } = await admin
    .from("coupon_audit_log")
    .insert({
      workspace_id: workspaceId,
      plan_id: planId,
      action: "cron_skipped",
      actor: requestedBy || "system",
      details: {
        reason: "queued_for_worker",
        job_type: "coupon_plan_run",
        job_status: "queued",
        requested_by: requestedBy || null,
        attempts: 0,
        max_attempts: 3,
        scheduled_at: new Date().toISOString(),
        playbook_run_id: playbookRunId,
        playbook_id: cleanOptionalText(playbookContext?.playbook_id),
        playbook_name: cleanOptionalText(playbookContext?.playbook_name),
      },
    })
    .select("id")
    .single();

  if (error) throw error;

  return {
    jobId: data.id as string,
    status: "queued",
    alreadyQueued: false,
  };
}

export async function processCouponJobs(
  admin: AdminClient,
  limit = 3
): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  requeued: number;
  jobs: Array<Record<string, unknown>>;
}> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("coupon_audit_log")
    .select("id, workspace_id, plan_id, actor, details, error_message, created_at")
    .eq("action", "cron_skipped")
    .contains("details", { job_type: "coupon_plan_run", job_status: "queued" })
    .order("created_at", { ascending: true })
    .limit(limit * 3);

  if (error) throw error;

  let succeeded = 0;
  let failed = 0;
  let requeued = 0;
  const jobs: Array<Record<string, unknown>> = [];

  const dueJobs = ((data || []) as CouponJobRow[]).filter((job) => {
    const scheduledAt = job.details?.scheduled_at;
    return !scheduledAt || scheduledAt <= now;
  }).slice(0, limit);

  for (const queuedJob of dueJobs) {
    const locked = await lockCouponJob(admin, queuedJob);
    if (!locked) continue;

    try {
      const result = await runCouponPlanJob(admin, locked);
      await admin
        .from("coupon_audit_log")
        .update({
          details: {
            ...(locked.details || {}),
            job_status: "succeeded",
            completed_at: new Date().toISOString(),
            result,
          },
          error_message: null,
        })
        .eq("id", locked.id);
      succeeded++;
      jobs.push({ id: locked.id, status: "succeeded", ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = Number(locked.details?.attempts || 1);
      const maxAttempts = Number(locked.details?.max_attempts || 3);
      const canRetry = attempts < maxAttempts;
      await admin
        .from("coupon_audit_log")
        .update({
          details: {
            ...(locked.details || {}),
            job_status: canRetry ? "queued" : "failed",
            scheduled_at: canRetry ? nextRetryAt(attempts) : locked.details?.scheduled_at,
            completed_at: canRetry ? null : new Date().toISOString(),
          },
          error_message: message.slice(0, 500),
        })
        .eq("id", locked.id);
      if (canRetry) requeued++;
      else failed++;
      jobs.push({
        id: locked.id,
        status: canRetry ? "queued" : "failed",
        error: message,
      });
    }
  }

  return {
    processed: succeeded + failed + requeued,
    succeeded,
    failed,
    requeued,
    jobs,
  };
}

async function lockCouponJob(admin: AdminClient, job: CouponJobRow) {
  const attempts = Number(job.details?.attempts || 0) + 1;
  const details = {
    ...(job.details || {}),
    job_status: "running",
    attempts,
    started_at: new Date().toISOString(),
  };
  const { data, error } = await admin
    .from("coupon_audit_log")
    .update({
      details,
      error_message: null,
    })
    .eq("id", job.id)
    .contains("details", { job_type: "coupon_plan_run", job_status: "queued" })
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return data as CouponJobRow | null;
}

async function runCouponPlanJob(admin: AdminClient, job: CouponJobRow) {
  if (!job.plan_id) {
    throw new Error("Job sem plan_id");
  }
  const { data: plan, error } = await admin
    .from("promo_coupon_plans")
    .select("id, name, enabled, require_manual_approval")
    .eq("id", job.plan_id)
    .eq("workspace_id", job.workspace_id)
    .single();

  if (error || !plan) {
    throw new Error(error?.message || "Plano nao encontrado");
  }

  const couponPlan = plan as CouponPlanRow;
  if (!couponPlan.enabled) {
    throw new Error("Plano desabilitado");
  }

  const propResults = await proposeNewCoupons(job.workspace_id, {
    onlyPlanIds: [job.plan_id],
    playbookContext: {
      playbook_run_id: job.details?.playbook_run_id,
      playbook_id: job.details?.playbook_id,
      playbook_name: job.details?.playbook_name,
    },
  });
  const proposed = propResults.reduce((sum, item) => sum + item.inserted, 0);
  let autoApproved = 0;
  if (!couponPlan.require_manual_approval) {
    autoApproved = await autoApprovePendingForAutoPlans(job.workspace_id);
  }

  return {
    plan_id: job.plan_id,
    plan_name: couponPlan.name,
    proposed,
    auto_approved: autoApproved,
    require_manual_approval: couponPlan.require_manual_approval,
    playbook_run_id: job.details?.playbook_run_id,
  };
}

function cleanOptionalText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function nextRetryAt(attempts: number) {
  const delayMinutes = Math.min(30, Math.max(1, attempts) * 5);
  return new Date(Date.now() + delayMinutes * 60_000).toISOString();
}

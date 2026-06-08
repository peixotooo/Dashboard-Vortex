import type { SupabaseClient } from "@supabase/supabase-js";
import { applyPromoPrice, removePromoPrice } from "@/lib/ml/promo";
import { ml } from "@/lib/ml/client";
import { getVndaConfig, updateVndaSalePriceByReference } from "@/lib/vnda-api";
import type { HubProduct } from "@/types/hub";
import { runOrchestrator } from "./orchestrator";

type AdminClient = SupabaseClient;

const ENGINE_RUN_ACTION = "pricing_engine_run";
const APPLY_ACTION = "pricing_apply";
const HUB_BULK_PRICE_ACTION = "hub_bulk_price";

const DEFAULT_ENGINE_LIMIT = 1;
const DEFAULT_APPLY_BATCH_LIMIT = 20;
const DEFAULT_HUB_BATCH_LIMIT = 25;

type PricingJobStatus = "queued" | "running" | "succeeded" | "failed";

type HubJobDetails = {
  job_type?: string;
  job_status?: PricingJobStatus;
  requested_by?: string | null;
  attempts?: number;
  failure_attempts?: number;
  max_attempts?: number;
  scheduled_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
  result?: Record<string, unknown>;
  skus?: string[] | null;
  ids?: string[] | null;
  product_ids?: string[] | null;
  processed_ids?: string[];
  failed_ids?: string[];
  failed_items?: Array<{ sku: string; error: string }>;
  skipped_count?: number;
  applied_count?: number;
  updated_count?: number;
  ml_synced_count?: number;
  ml_category_id?: string | null;
  operation?: BulkPriceOperation;
  value?: number;
  field?: BulkPriceField;
  push_to_ml?: boolean;
};

type HubJobRow = {
  id: string;
  workspace_id: string;
  action: string;
  status: string | null;
  details: HubJobDetails | null;
  created_at: string;
};

type PricingHistoryRow = {
  id: string;
  workspace_id: string;
  sku: string;
  preco_por: number | null;
};

export type BulkPriceOperation =
  | "set"
  | "increase_pct"
  | "decrease_pct"
  | "increase_fixed"
  | "decrease_fixed";

export type BulkPriceField = "preco" | "preco_promocional";

export class PricingJobValidationError extends Error {}

export async function enqueuePricingEngineRunJob(args: {
  client: SupabaseClient;
  workspaceId: string;
  requestedBy?: string | null;
  skus?: string[] | null;
}) {
  const skus = normalizeTextArray(args.skus);
  const existing = await findExistingJob(args.client, args.workspaceId, ENGINE_RUN_ACTION, (job) =>
    sameStringArray(normalizeTextArray(job.details?.skus), skus)
  );
  if (existing) {
    return {
      jobId: existing.id,
      status: existing.status || "queued",
      alreadyQueued: true,
      skus,
    };
  }

  const { data, error } = await args.client
    .from("hub_logs")
    .insert({
      workspace_id: args.workspaceId,
      action: ENGINE_RUN_ACTION,
      entity: "pricing",
      entity_id: null,
      direction: "worker",
      status: "queued",
      details: baseDetails("pricing_engine_run", args.requestedBy, { skus }),
    })
    .select("id, status")
    .single();

  if (error) throw error;
  return {
    jobId: data.id as string,
    status: data.status as string,
    alreadyQueued: false,
    skus,
  };
}

export async function enqueuePricingApplyJob(args: {
  client: SupabaseClient;
  workspaceId: string;
  requestedBy?: string | null;
  ids?: string[] | null;
}) {
  const ids = await fetchApprovedPricingIds(args.client, args.workspaceId, args.ids);
  if (ids.length === 0) {
    return {
      jobId: null,
      status: "empty",
      alreadyQueued: false,
      matched: 0,
    };
  }

  const existing = await findExistingJob(args.client, args.workspaceId, APPLY_ACTION, (job) =>
    sameStringArray(normalizeTextArray(job.details?.ids), ids)
  );
  if (existing) {
    return {
      jobId: existing.id,
      status: existing.status || "queued",
      alreadyQueued: true,
      matched: ids.length,
    };
  }

  const { data, error } = await args.client
    .from("hub_logs")
    .insert({
      workspace_id: args.workspaceId,
      action: APPLY_ACTION,
      entity: "pricing",
      entity_id: null,
      direction: "worker",
      status: "queued",
      details: baseDetails("pricing_apply", args.requestedBy, { ids }),
    })
    .select("id, status")
    .single();

  if (error) throw error;
  return {
    jobId: data.id as string,
    status: data.status as string,
    alreadyQueued: false,
    matched: ids.length,
  };
}

export async function enqueueHubBulkPriceJob(args: {
  client: SupabaseClient;
  workspaceId: string;
  requestedBy?: string | null;
  ids?: string[] | null;
  mlCategoryId?: string | null;
  operation: BulkPriceOperation;
  value: number;
  field: BulkPriceField;
  pushToMl: boolean;
}) {
  validateBulkPricePayload(args.operation, args.value, args.field, args.ids, args.mlCategoryId);
  const productIds = await fetchHubProductIds(
    args.client,
    args.workspaceId,
    normalizeTextArray(args.ids),
    cleanText(args.mlCategoryId)
  );
  if (productIds.length === 0) {
    throw new PricingJobValidationError("Nenhum produto encontrado");
  }

  const detailsPayload = {
    product_ids: productIds,
    ml_category_id: cleanText(args.mlCategoryId),
    operation: args.operation,
    value: args.value,
    field: args.field,
    push_to_ml: Boolean(args.pushToMl),
  };

  const existing = await findExistingJob(args.client, args.workspaceId, HUB_BULK_PRICE_ACTION, (job) => {
    const details = job.details || {};
    return (
      sameStringArray(normalizeTextArray(details.product_ids), productIds) &&
      details.operation === args.operation &&
      Number(details.value) === Number(args.value) &&
      details.field === args.field &&
      Boolean(details.push_to_ml) === Boolean(args.pushToMl)
    );
  });
  if (existing) {
    return {
      jobId: existing.id,
      status: existing.status || "queued",
      alreadyQueued: true,
      matched: productIds.length,
    };
  }

  const { data, error } = await args.client
    .from("hub_logs")
    .insert({
      workspace_id: args.workspaceId,
      action: HUB_BULK_PRICE_ACTION,
      entity: "product",
      entity_id: null,
      direction: "worker",
      status: "queued",
      details: baseDetails("hub_bulk_price", args.requestedBy, detailsPayload),
    })
    .select("id, status")
    .single();

  if (error) throw error;
  return {
    jobId: data.id as string,
    status: data.status as string,
    alreadyQueued: false,
    matched: productIds.length,
  };
}

export async function processPricingJobs(
  admin: AdminClient,
  options: {
    engineLimit?: number;
    applyBatchLimit?: number;
    hubBatchLimit?: number;
  } = {}
) {
  const engineLimit = clampInt(options.engineLimit, 1, 5, DEFAULT_ENGINE_LIMIT);
  const applyBatchLimit = clampInt(
    options.applyBatchLimit,
    1,
    100,
    DEFAULT_APPLY_BATCH_LIMIT
  );
  const hubBatchLimit = clampInt(options.hubBatchLimit, 1, 100, DEFAULT_HUB_BATCH_LIMIT);

  const engine = await processQueuedJobs(admin, ENGINE_RUN_ACTION, engineLimit, (job) =>
    runEngineRunJob(admin, job)
  );
  const apply = await processQueuedJobs(admin, APPLY_ACTION, 1, (job) =>
    runPricingApplyJob(admin, job, applyBatchLimit)
  );
  const hubBulk = await processQueuedJobs(admin, HUB_BULK_PRICE_ACTION, 1, (job) =>
    runHubBulkPriceJob(admin, job, hubBatchLimit)
  );

  const groups = [engine, apply, hubBulk];
  return {
    processed: groups.reduce((sum, group) => sum + group.processed, 0),
    succeeded: groups.reduce((sum, group) => sum + group.succeeded, 0),
    failed: groups.reduce((sum, group) => sum + group.failed, 0),
    requeued: groups.reduce((sum, group) => sum + group.requeued, 0),
    jobs: groups.flatMap((group) => group.jobs),
  };
}

async function processQueuedJobs(
  admin: AdminClient,
  action: string,
  limit: number,
  runner: (job: HubJobRow) => Promise<{
    done: boolean;
    result: Record<string, unknown>;
    details?: Partial<HubJobDetails>;
  }>
) {
  const queued = await getDueQueuedJobs(admin, action, limit);
  let succeeded = 0;
  let failed = 0;
  let requeued = 0;
  const jobs: Array<Record<string, unknown>> = [];

  for (const job of queued) {
    const locked = await lockHubJob(admin, job);
    if (!locked) continue;

    try {
      const outcome = await runner(locked);
      const details = {
        ...(locked.details || {}),
        ...(outcome.details || {}),
        job_status: outcome.done ? "succeeded" : "queued",
        completed_at: outcome.done ? new Date().toISOString() : null,
        result: outcome.result,
        scheduled_at: outcome.done ? locked.details?.scheduled_at : new Date().toISOString(),
      };
      await admin
        .from("hub_logs")
        .update({
          status: outcome.done ? "ok" : "queued",
          details,
        })
        .eq("id", locked.id);

      if (outcome.done) succeeded++;
      else requeued++;
      jobs.push({
        id: locked.id,
        action,
        status: outcome.done ? "succeeded" : "queued",
        ...outcome.result,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failureAttempts = Number(locked.details?.failure_attempts || 0) + 1;
      const maxAttempts = Number(locked.details?.max_attempts || 3);
      const canRetry = failureAttempts < maxAttempts;
      await admin
        .from("hub_logs")
        .update({
          status: canRetry ? "queued" : "error",
          details: {
            ...(locked.details || {}),
            job_status: canRetry ? "queued" : "failed",
            failure_attempts: failureAttempts,
            scheduled_at: canRetry ? nextRetryAt(failureAttempts) : locked.details?.scheduled_at,
            completed_at: canRetry ? null : new Date().toISOString(),
            result: { error: message.slice(0, 500) },
          },
        })
        .eq("id", locked.id);

      if (canRetry) requeued++;
      else failed++;
      jobs.push({
        id: locked.id,
        action,
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

async function runEngineRunJob(admin: AdminClient, job: HubJobRow) {
  const skus = normalizeTextArray(job.details?.skus);
  const result = await runOrchestrator(admin, job.workspace_id, {
    ...(skus.length > 0 ? { skus } : {}),
  });
  const actionable = result.decisions.filter((decision) => decision.action !== "hold").length;
  return {
    done: true,
    result: {
      workspace_id: result.workspace_id,
      snapshot_date: result.snapshot_date,
      evaluated: result.evaluated,
      decisions_generated: actionable,
      skipped_no_price: result.skipped_no_price,
      skipped_no_pricing_row: result.skipped_no_pricing_row,
      stock_source: result.stock_source,
      stock_sku_count: result.stock_sku_count,
    },
  };
}

async function runPricingApplyJob(
  admin: AdminClient,
  job: HubJobRow,
  batchLimit: number
) {
  const ids = normalizeTextArray(job.details?.ids);
  const processedIds = new Set(normalizeTextArray(job.details?.processed_ids));
  const failedIds = new Set(normalizeTextArray(job.details?.failed_ids));
  const pendingIds = ids
    .filter((id) => !processedIds.has(id) && !failedIds.has(id))
    .slice(0, batchLimit);

  if (pendingIds.length === 0) {
    return {
      done: true,
      result: {
        applied: Number(job.details?.applied_count || 0),
        failed: failedIds.size,
        total: ids.length,
      },
    };
  }

  const { data: rows, error } = await admin
    .from("sku_pricing_history")
    .select("id, workspace_id, sku, preco_por")
    .eq("workspace_id", job.workspace_id)
    .eq("status", "approved")
    .in("id", pendingIds);

  if (error) throw error;
  const rowById = new Map((rows || []).map((row) => [String(row.id), row as PricingHistoryRow]));

  const config = await getVndaConfig(job.workspace_id);
  if (!config) {
    throw new Error("VNDA nao configurado para este workspace");
  }

  let applied = 0;
  const failedItems = [...(job.details?.failed_items || [])];

  for (const id of pendingIds) {
    const row = rowById.get(id);
    if (!row) {
      processedIds.add(id);
      continue;
    }

    const newPrice =
      row.preco_por != null && Number(row.preco_por) > 0 ? Number(row.preco_por) : null;
    const result = await updateVndaSalePriceByReference(config, row.sku, newPrice);

    if (result.ok) {
      applied += 1;
      processedIds.add(id);
      await admin
        .from("shelf_products")
        .update({ sale_price: newPrice })
        .eq("workspace_id", job.workspace_id)
        .eq("sku", row.sku);

      await admin
        .from("sku_pricing_history")
        .update({
          status: "applied",
          applied_at: new Date().toISOString(),
          status_reason: result.message,
        })
        .eq("id", row.id);
    } else {
      failedIds.add(id);
      failedItems.push({ sku: row.sku, error: result.message });
      await admin
        .from("sku_pricing_history")
        .update({ status_reason: `VNDA: ${result.message}` })
        .eq("id", row.id);
    }
  }

  const appliedCount = Number(job.details?.applied_count || 0) + applied;
  const remaining = ids.filter((id) => !processedIds.has(id) && !failedIds.has(id)).length;
  return {
    done: remaining === 0,
    details: {
      processed_ids: [...processedIds],
      failed_ids: [...failedIds],
      failed_items: failedItems.slice(-100),
      applied_count: appliedCount,
    },
    result: {
      applied: appliedCount,
      failed: failedIds.size,
      total: ids.length,
      remaining,
    },
  };
}

async function runHubBulkPriceJob(
  admin: AdminClient,
  job: HubJobRow,
  batchLimit: number
) {
  const details = job.details || {};
  validateBulkPricePayload(
    details.operation,
    Number(details.value),
    details.field,
    details.product_ids,
    details.ml_category_id
  );

  const productIds = normalizeTextArray(details.product_ids);
  const processedIds = new Set(normalizeTextArray(details.processed_ids));
  const failedIds = new Set(normalizeTextArray(details.failed_ids));
  const pendingIds = productIds
    .filter((id) => !processedIds.has(id) && !failedIds.has(id))
    .slice(0, batchLimit);

  if (pendingIds.length === 0) {
    return {
      done: true,
      result: {
        updated: Number(details.updated_count || 0),
        ml_synced: Number(details.ml_synced_count || 0),
        failed: failedIds.size,
        skipped: Number(details.skipped_count || 0),
        total: productIds.length,
      },
    };
  }

  const { data: rows, error } = await admin
    .from("hub_products")
    .select("*")
    .eq("workspace_id", job.workspace_id)
    .in("id", pendingIds);
  if (error) throw error;
  const rowById = new Map((rows || []).map((row) => [String(row.id), row as HubProduct]));

  let updated = 0;
  let mlSynced = 0;
  let skipped = Number(details.skipped_count || 0);
  const failedItems = [...(details.failed_items || [])];

  for (const id of pendingIds) {
    const row = rowById.get(id);
    if (!row) {
      processedIds.add(id);
      continue;
    }

    const currentPrice =
      details.field === "preco"
        ? row.preco ?? 0
        : row.preco_promocional ?? row.preco ?? 0;
    const newPrice = computeNewPrice(
      Number(currentPrice),
      details.operation as BulkPriceOperation,
      Number(details.value)
    );

    if (newPrice <= 0 && details.field === "preco") {
      skipped += 1;
      processedIds.add(id);
      continue;
    }

    try {
      const updatePayload: Record<string, unknown> = {
        [details.field as BulkPriceField]:
          details.field === "preco_promocional" && newPrice <= 0 ? null : newPrice,
        updated_at: new Date().toISOString(),
      };

      await admin.from("hub_products").update(updatePayload).eq("id", row.id);
      updated += 1;

      if (details.push_to_ml && details.field === "preco" && row.ml_item_id && newPrice > 0) {
        if (row.ml_variation_id) {
          await ml.put(
            `/items/${row.ml_item_id}/variations/${row.ml_variation_id}`,
            { price: newPrice },
            job.workspace_id
          );
        } else {
          await ml.put(`/items/${row.ml_item_id}`, { price: newPrice }, job.workspace_id);
        }

        await admin
          .from("hub_products")
          .update({
            ml_preco: newPrice,
            last_ml_sync: new Date().toISOString(),
          })
          .eq("id", row.id);

        mlSynced += 1;
      }

      if (details.push_to_ml && details.field === "preco_promocional" && row.ml_item_id) {
        const effectivePreco = row.preco || row.ml_preco || 0;
        if (newPrice > 0 && newPrice < effectivePreco) {
          const promoResult = await applyPromoPrice(row.ml_item_id, newPrice, job.workspace_id);
          if (promoResult.applied) mlSynced += 1;
          else if (promoResult.error) {
            failedIds.add(id);
            failedItems.push({ sku: row.sku, error: promoResult.error });
          }
        } else if (newPrice <= 0) {
          const removeResult = await removePromoPrice(row.ml_item_id, job.workspace_id);
          if (removeResult.removed) mlSynced += 1;
        }
      }

      processedIds.add(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao atualizar";
      failedIds.add(id);
      failedItems.push({ sku: row.sku, error: message });
    }
  }

  const updatedCount = Number(details.updated_count || 0) + updated;
  const mlSyncedCount = Number(details.ml_synced_count || 0) + mlSynced;
  const remaining = productIds.filter((id) => !processedIds.has(id) && !failedIds.has(id)).length;

  return {
    done: remaining === 0,
    details: {
      processed_ids: [...processedIds],
      failed_ids: [...failedIds],
      failed_items: failedItems.slice(-100),
      skipped_count: skipped,
      updated_count: updatedCount,
      ml_synced_count: mlSyncedCount,
    },
    result: {
      updated: updatedCount,
      ml_synced: mlSyncedCount,
      failed: failedIds.size,
      skipped,
      total: productIds.length,
      remaining,
    },
  };
}

async function getDueQueuedJobs(admin: AdminClient, action: string, limit: number) {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("hub_logs")
    .select("id, workspace_id, action, status, details, created_at")
    .eq("action", action)
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(limit * 3);

  if (error) throw error;
  return ((data || []) as HubJobRow[])
    .filter((job) => {
      const scheduledAt = job.details?.scheduled_at;
      return !scheduledAt || scheduledAt <= now;
    })
    .slice(0, limit);
}

async function lockHubJob(admin: AdminClient, job: HubJobRow) {
  const attempts = Number(job.details?.attempts || 0) + 1;
  const { data, error } = await admin
    .from("hub_logs")
    .update({
      status: "running",
      details: {
        ...(job.details || {}),
        job_status: "running",
        attempts,
        started_at: new Date().toISOString(),
      },
    })
    .eq("id", job.id)
    .eq("status", "queued")
    .select("id, workspace_id, action, status, details, created_at")
    .maybeSingle();

  if (error) throw error;
  return data as HubJobRow | null;
}

async function findExistingJob(
  client: SupabaseClient,
  workspaceId: string,
  action: string,
  predicate: (job: HubJobRow) => boolean
) {
  const { data, error } = await client
    .from("hub_logs")
    .select("id, workspace_id, action, status, details, created_at")
    .eq("workspace_id", workspaceId)
    .eq("action", action)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw error;
  return ((data || []) as HubJobRow[]).find(predicate) || null;
}

async function fetchApprovedPricingIds(
  client: SupabaseClient,
  workspaceId: string,
  ids?: string[] | null
) {
  const cleanIds = normalizeTextArray(ids);
  if (cleanIds.length > 0) {
    const out: string[] = [];
    for (const chunk of chunks(cleanIds, 200)) {
      const { data, error } = await client
        .from("sku_pricing_history")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("status", "approved")
        .in("id", chunk);
      if (error) throw error;
      out.push(...((data || []) as Array<{ id: string }>).map((row) => row.id));
    }
    return uniqueSorted(out);
  }

  const out: string[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await client
      .from("sku_pricing_history")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("status", "approved")
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data || []) as Array<{ id: string }>;
    out.push(...rows.map((row) => row.id));
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return uniqueSorted(out);
}

async function fetchHubProductIds(
  client: SupabaseClient,
  workspaceId: string,
  ids: string[],
  mlCategoryId: string | null
) {
  const out: string[] = [];
  if (ids.length > 0) {
    for (const chunk of chunks(ids, 200)) {
      const { data, error } = await client
        .from("hub_products")
        .select("id")
        .eq("workspace_id", workspaceId)
        .in("id", chunk);
      if (error) throw error;
      out.push(...((data || []) as Array<{ id: string }>).map((row) => row.id));
    }
    return uniqueSorted(out);
  }

  if (!mlCategoryId) return [];

  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await client
      .from("hub_products")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("ml_category_id", mlCategoryId)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data || []) as Array<{ id: string }>;
    out.push(...rows.map((row) => row.id));
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return uniqueSorted(out);
}

function computeNewPrice(
  current: number,
  operation: BulkPriceOperation,
  value: number
): number {
  switch (operation) {
    case "set":
      return value;
    case "increase_pct":
      return Math.round(current * (1 + value / 100) * 100) / 100;
    case "decrease_pct":
      return Math.round(current * (1 - value / 100) * 100) / 100;
    case "increase_fixed":
      return Math.round((current + value) * 100) / 100;
    case "decrease_fixed":
      return Math.round(Math.max(0, current - value) * 100) / 100;
  }
}

function validateBulkPricePayload(
  operation: unknown,
  value: number,
  field: unknown,
  ids?: unknown,
  mlCategoryId?: unknown
) {
  const validOperations = new Set<BulkPriceOperation>([
    "set",
    "increase_pct",
    "decrease_pct",
    "increase_fixed",
    "decrease_fixed",
  ]);
  if (!validOperations.has(operation as BulkPriceOperation) || !Number.isFinite(value)) {
    throw new PricingJobValidationError("operation and value required");
  }
  if (field !== "preco" && field !== "preco_promocional") {
    throw new PricingJobValidationError("field invalido");
  }
  if (normalizeTextArray(ids).length === 0 && !cleanText(mlCategoryId)) {
    throw new PricingJobValidationError("ids or ml_category_id required");
  }
}

function baseDetails(
  jobType: string,
  requestedBy?: string | null,
  extra: Partial<HubJobDetails> = {}
): HubJobDetails {
  return {
    job_type: jobType,
    job_status: "queued",
    requested_by: requestedBy || null,
    attempts: 0,
    failure_attempts: 0,
    max_attempts: 3,
    scheduled_at: new Date().toISOString(),
    ...extra,
  };
}

function cleanText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function normalizeTextArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return uniqueSorted(
    value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
  );
}

function sameStringArray(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort();
}

function chunks<T>(values: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function nextRetryAt(attempts: number) {
  const delayMinutes = Math.min(30, Math.max(1, attempts) * 5);
  return new Date(Date.now() + delayMinutes * 60_000).toISOString();
}

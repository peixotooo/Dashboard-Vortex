// src/lib/email-templates/hero/client.ts
//
// Thin client for kie.ai's GPT Image 2 image-to-image endpoint. Async by
// design: createTask returns a taskId, then poll recordInfo until success or
// timeout. URLs in the success payload expire 24h later, so callers must
// download + re-host (see storage.ts).
//
// Docs: https://docs.kie.ai/market/gpt/gpt-image-2-image-to-image
//       https://docs.kie.ai/market/common/get-task-detail

const KIE_BASE = "https://api.kie.ai/api/v1";
const MODEL = "gpt-image-2-image-to-image";

interface CreateTaskBody {
  model: string;
  input: {
    prompt: string;
    input_urls: string[];
    aspect_ratio?: "auto" | "1:1" | "9:16" | "16:9" | "4:3" | "3:4";
    resolution?: "1K" | "2K" | "4K";
  };
  callBackUrl?: string;
}

interface CreateTaskResponse {
  code: number;
  msg?: string;
  data?: { taskId: string };
}

interface RecordInfoResponse {
  code: number;
  msg?: string;
  data?: {
    taskId: string;
    state: "waiting" | "queuing" | "generating" | "success" | "fail";
    resultJson?: string;
    failCode?: string;
    failMsg?: string;
  };
}

function getApiKey(): string {
  const key = process.env.KIE_API_KEY;
  if (!key) throw new Error("KIE_API_KEY is not set");
  return key.trim();
}

export interface CreateImageArgs {
  prompt: string;
  input_urls: string[]; // 1..16, must be publicly accessible
  aspect_ratio?: CreateTaskBody["input"]["aspect_ratio"];
  resolution?: CreateTaskBody["input"]["resolution"];
}

export async function createImageTask(args: CreateImageArgs): Promise<string> {
  if (args.input_urls.length === 0 || args.input_urls.length > 16) {
    throw new Error("input_urls must contain 1..16 entries");
  }
  const body: CreateTaskBody = {
    model: MODEL,
    input: {
      prompt: args.prompt,
      input_urls: args.input_urls,
      aspect_ratio: args.aspect_ratio ?? "3:4",
      resolution: args.resolution ?? "1K",
    },
  };

  const res = await fetch(`${KIE_BASE}/jobs/createTask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`kie.ai createTask ${res.status}: ${text.slice(0, 240)}`);
  }
  const data = (await res.json()) as CreateTaskResponse;
  if (data.code !== 200 || !data.data?.taskId) {
    throw new Error(`kie.ai createTask failed: ${JSON.stringify(data).slice(0, 240)}`);
  }
  return data.data.taskId;
}

interface PollOptions {
  /** Per-attempt delay in ms. Defaults to 4_000. */
  pollIntervalMs?: number;
  /** Total timeout in ms. Defaults to 120_000 (2 min). */
  timeoutMs?: number;
}

export async function waitForImage(
  taskId: string,
  opts: PollOptions = {}
): Promise<string[]> {
  const interval = opts.pollIntervalMs ?? 4_000;
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);

  while (Date.now() < deadline) {
    const url = `${KIE_BASE}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${getApiKey()}` },
    });
    if (!res.ok) {
      // 404 right after createTask is occasionally seen — retry
      await sleep(interval);
      continue;
    }
    const data = (await res.json()) as RecordInfoResponse;
    const state = data.data?.state;
    if (state === "success" && data.data?.resultJson) {
      try {
        const parsed = JSON.parse(data.data.resultJson) as { resultUrls?: string[] };
        if (parsed.resultUrls && parsed.resultUrls.length > 0) {
          return parsed.resultUrls;
        }
      } catch {
        throw new Error("kie.ai returned malformed resultJson");
      }
      throw new Error("kie.ai success but no resultUrls");
    }
    if (state === "fail") {
      throw new Error(
        `kie.ai task failed: ${data.data?.failMsg ?? data.data?.failCode ?? "unknown"}`
      );
    }
    await sleep(interval);
  }
  throw new Error(`kie.ai task ${taskId} timed out`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One-shot: create a task and wait for the resulting image URLs.
 *
 * kie.ai surfaces a "Internal Error, Please try again later" failure that
 * fires intermittently (observed in production). We retry the whole
 * createTask + waitForImage roundtrip on those transient errors with a
 * short backoff before giving up.
 */
export async function generateImage(
  args: CreateImageArgs,
  opts?: PollOptions & { maxAttempts?: number }
): Promise<{ taskId: string; urls: string[] }> {
  const max = opts?.maxAttempts ?? 3;
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      const taskId = await createImageTask(args);
      const urls = await waitForImage(taskId, opts);
      return { taskId, urls };
    } catch (err) {
      lastErr = err as Error;
      const msg = lastErr.message;
      const transient =
        /Internal Error/i.test(msg) ||
        /Please try again/i.test(msg) ||
        /timed out/i.test(msg) ||
        /5\d\d/.test(msg);
      if (!transient || attempt === max) throw lastErr;
      // Aggressive backoff for kie.ai's "Internal Error" flakiness:
      // attempt 1 fails -> wait 10s, attempt 2 fails -> wait 20s, then give up.
      const backoffMs = 10_000 * attempt;
      await sleep(backoffMs);
    }
  }
  throw lastErr ?? new Error("kie.ai generateImage exhausted retries");
}

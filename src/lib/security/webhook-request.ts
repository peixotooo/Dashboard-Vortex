import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export type LimitedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; error: "invalid_json" | "payload_too_large" };

export type LimitedTextResult =
  | { ok: true; value: string }
  | { ok: false; status: 413; error: "payload_too_large" };

function cleanSecret(value: string | null): string | null {
  const secret = value?.trim() || "";
  if (!secret || secret.length > 512 || /[\u0000-\u001f\u007f]/.test(secret)) {
    return null;
  }
  return secret;
}

export function getWebhookSecret(
  request: NextRequest,
  options?: { queryParam?: string; headers?: string[] }
): string | null {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
  const headerNames = options?.headers ?? ["x-webhook-token", "x-webhook-secret"];
  for (const candidate of [
    bearer,
    ...headerNames.map((name) => request.headers.get(name)),
    request.nextUrl.searchParams.get(options?.queryParam ?? "token"),
  ]) {
    const cleaned = cleanSecret(candidate);
    if (cleaned) return cleaned;
  }
  return null;
}

export function secretsEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export async function readLimitedText(
  request: NextRequest,
  maxBytes: number
): Promise<LimitedTextResult> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (
      !Number.isFinite(contentLength) ||
      contentLength < 0 ||
      contentLength > maxBytes
    ) {
      return { ok: false, status: 413, error: "payload_too_large" };
    }
  }

  if (!request.body) return { ok: true, value: "" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413, error: "payload_too_large" };
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return { ok: true, value: chunks.join("") };
  } catch {
    await reader.cancel().catch(() => undefined);
    return { ok: false, status: 413, error: "payload_too_large" };
  }
}

export async function readLimitedJson(
  request: NextRequest,
  maxBytes: number
): Promise<LimitedJsonResult> {
  const result = await readLimitedText(request, maxBytes);
  if (!result.ok) return result;
  try {
    return { ok: true, value: JSON.parse(result.value) };
  } catch {
    return { ok: false, status: 400, error: "invalid_json" };
  }
}

import crypto from "node:crypto";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONCE_RE = /^[0-9a-f]{32}$/;

export function createOAuthState(workspaceId: string): {
  nonce: string;
  state: string;
} {
  if (!UUID_RE.test(workspaceId)) {
    throw new Error("Invalid workspace_id");
  }

  const nonce = crypto.randomBytes(16).toString("hex");
  return { nonce, state: `${nonce}:${workspaceId}` };
}

export function parseOAuthState(state: string): {
  nonce: string;
  workspaceId: string;
} | null {
  const separator = state.indexOf(":");
  if (separator < 1) return null;

  const nonce = state.slice(0, separator);
  const workspaceId = state.slice(separator + 1);
  if (!NONCE_RE.test(nonce) || !UUID_RE.test(workspaceId)) return null;

  return { nonce, workspaceId };
}

export function oauthNonceMatches(
  expected: string | null | undefined,
  received: string
): boolean {
  if (!expected || !NONCE_RE.test(expected) || !NONCE_RE.test(received)) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(expected, "utf8"),
    Buffer.from(received, "utf8")
  );
}

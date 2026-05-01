import { createHmac, timingSafeEqual } from "crypto";

function getSecret(): string {
  const raw = process.env.EMAIL_COUNTDOWN_SECRET;
  if (!raw) throw new Error("EMAIL_COUNTDOWN_SECRET is not set");
  // Trim whitespace/newlines — `vercel env add` fed from a piped echo
  // can persist a trailing \n, which would silently differ between sign
  // (Node serverless) and verify (Edge), producing 400s on every PNG load.
  return raw.trim();
}

export function sign(expiresIso: string): string {
  return createHmac("sha256", getSecret()).update(expiresIso).digest("hex");
}

export function verify(expiresIso: string, sig: string): boolean {
  try {
    const expected = sign(expiresIso);
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(sig, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function buildCountdownUrl(args: {
  base_url: string; // e.g. https://app.vortex.bulking.com.br
  expires_at: Date;
}): string {
  const expiresIso = args.expires_at.toISOString();
  const sig = sign(expiresIso);
  const url = new URL("/api/email-countdown.gif", args.base_url);
  url.searchParams.set("expires", expiresIso);
  url.searchParams.set("sig", sig);
  return url.toString();
}

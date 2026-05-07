// src/lib/email-templates/tracking.ts
//
// Universal UTM tracking. Every email this system sends — daily suggestions,
// manual drafts, AI-composed campaigns, reactivated past emails, the
// "copy HTML" flow — runs through applyUtmTracking before going out, so all
// click attribution converges on a single set of utm_* parameters that GA4
// + the storefront can read.
//
// UTM contract (locked):
//   utm_source   = "bulking-vortex"           — fixed, identifies the dashboard
//   utm_medium   = "email"                    — fixed
//   utm_campaign = caller-supplied slug       — e.g. "suggestion-2026-05-04-slot1"
//                                              or "draft-<uuid>" or
//                                              "ai-compose-<short-id>"
//   utm_content  = optional element role      — "cta", "hero", "product-card", etc.
//                                              we don't auto-detect; callers can
//                                              add it via the data-utm-content
//                                              attribute on <a> tags they care
//                                              about
//   utm_term     = optional segment cluster   — "champions", "loyal", etc.
//   utm_id       = unique dispatch id         — uuid, 1:1 with our dispatch row
//
// Only http(s) links pointing at the brand domain (bulking.com.br by default)
// get rewritten. mailto:, tel:, anchors, and external links (Instagram, etc.)
// are left alone.

const DEFAULT_TRACKED_HOSTS = [
  "bulking.com.br",
  "www.bulking.com.br",
  "loja.bulking.com.br",
];

export interface UtmContext {
  /** Fixed campaign identifier — propagated to GA4's sessionCampaignName. */
  campaign: string;
  /** Optional segment hint (RFM cluster). */
  term?: string;
  /** Unique dispatch id for 1:1 attribution. Generated server-side. */
  id?: string;
  /** Override the brand hosts that get rewritten. Default: Bulking. */
  tracked_hosts?: string[];
  /** Override the source. Default: "bulking-vortex". */
  source?: string;
}

const FIXED_SOURCE = "bulking-vortex";
const FIXED_MEDIUM = "email";

function isTrackedUrl(rawUrl: string, hosts: string[]): boolean {
  if (!rawUrl) return false;
  const trimmed = rawUrl.trim();
  // Skip non-http schemes and anchors.
  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:") ||
    trimmed.startsWith("javascript:")
  ) {
    return false;
  }
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase();
    return hosts.some(
      (h) => host === h.toLowerCase() || host.endsWith("." + h.toLowerCase())
    );
  } catch {
    return false;
  }
}

function appendUtm(rawUrl: string, ctx: UtmContext, contentOverride?: string): string {
  try {
    const u = new URL(rawUrl);
    // Don't clobber existing UTMs the caller intentionally set.
    if (!u.searchParams.has("utm_source"))
      u.searchParams.set("utm_source", ctx.source ?? FIXED_SOURCE);
    if (!u.searchParams.has("utm_medium")) u.searchParams.set("utm_medium", FIXED_MEDIUM);
    if (!u.searchParams.has("utm_campaign"))
      u.searchParams.set("utm_campaign", ctx.campaign);
    if (ctx.term && !u.searchParams.has("utm_term"))
      u.searchParams.set("utm_term", ctx.term);
    if (contentOverride && !u.searchParams.has("utm_content"))
      u.searchParams.set("utm_content", contentOverride);
    if (ctx.id && !u.searchParams.has("utm_id")) u.searchParams.set("utm_id", ctx.id);
    return u.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Walks the HTML, finds every <a href="..."> (and src="..." on tracking pixels
 * if any) and rewrites the href when it points at a tracked brand host. Returns
 * the modified HTML. Conservative: leaves text content, classes, styles,
 * everything else untouched. Only the href value changes.
 */
export function applyUtmTracking(html: string, ctx: UtmContext): string {
  const hosts = ctx.tracked_hosts ?? DEFAULT_TRACKED_HOSTS;
  // Match <a ... href="..."> or <a ... href='...'>. Captures: tag prefix,
  // quote, url, suffix.
  return html.replace(
    /<a\b([^>]*?)\shref=(["'])([^"']*)\2([^>]*)>/gi,
    (full, prefix: string, quote: string, url: string, suffix: string) => {
      if (!isTrackedUrl(url, hosts)) return full;
      // Pick up an opt-in data-utm-content="<role>" if the caller set one
      // on this anchor — useful for "primary-cta" vs "footer-link" etc.
      const m = (prefix + suffix).match(/data-utm-content=(["'])([^"']*)\1/i);
      const contentOverride = m ? m[2] : undefined;
      const next = appendUtm(url, ctx, contentOverride);
      return `<a${prefix} href=${quote}${next}${quote}${suffix}>`;
    }
  );
}

/**
 * Defensive HTML sanitization for email clients. Three transforms:
 *
 * 1. Protocol-relative URLs. Rewrites `src="//host/..."` and
 *    `href="//host/..."` → `https://host/...`. Gmail's image proxy and
 *    several Outlook builds treat `//host` as a relative path and fail to
 *    load the asset (the VNDA CDN returns protocol-relative URLs, which
 *    broke every related-product image).
 *
 * 2. Aspect-ratio div wrappers. Strips `<div style="padding-top:N%">` +
 *    nested `<img style="position:absolute">` patterns and replaces them
 *    with a plain `<img width height>`. The padding-top hack reserves
 *    height while letting an absolutely-positioned image fill it — works
 *    in browsers, breaks in Gmail/Outlook because they ignore
 *    `position:absolute` on inline styles, leaving an empty grey box
 *    above each image.
 *
 * 3. Broken `{{UNSUBSCRIBE_URL}}` placeholder. Older renders include an
 *    internal "Descadastrar" link with that literal placeholder as the
 *    href — clicking it lands on a junk URL. Locaweb appends its own
 *    compliant unsubscribe footer below the body, so we strip the
 *    redundant line entirely at dispatch time.
 *
 * Each transform fixes pattern at the source (new renders avoid the
 * issue) AND in already-cached rendered_html on dispatch — older
 * suggestions in the DB benefit without needing to re-render.
 */
export function sanitizeEmailHtml(html: string): string {
  if (!html) return html;
  return stripBrokenUnsubscribe(
    unwrapAspectRatioImages(
      html
        .replace(/(\bsrc=)(["'])\/\//gi, "$1$2https://")
        .replace(/(\bhref=)(["'])\/\//gi, "$1$2https://")
    )
  );
}

function stripBrokenUnsubscribe(html: string): string {
  // Match the legacy line "Você está recebendo este email porque é
  // cliente Bulking. <a href="{{UNSUBSCRIBE_URL}}">Descadastrar</a>."
  // along with the <br /> that precedes it (so we don't leave a
  // dangling <br>). Both lower- and uppercase URL placeholder are
  // accepted.
  return html.replace(
    /(?:\s*<br\s*\/?>\s*)?\s*Você está recebendo este email porque é cliente Bulking\.\s*<a\b[^>]*\{\{UNSUBSCRIBE_URL\}\}[^>]*>[^<]*<\/a>\.?/gi,
    ""
  );
}

function unwrapAspectRatioImages(html: string): string {
  // Match any <div style="...padding-top:N%..."> that wraps a single <img>,
  // and replace the wrapper with just the image styled to render naturally.
  // The original width attribute is preserved as max-width so the layout
  // doesn't reflow for clients that honor it.
  return html.replace(
    /<div\s+style="[^"]*padding-top:[^"]+"[^>]*>\s*(<img\b[^>]*?)\s*\/?>\s*<\/div>/gi,
    (_full, imgPrefix: string) => {
      const widthMatch = imgPrefix.match(/\swidth=["']?(\d+)["']?/i);
      const w = widthMatch ? widthMatch[1] : "600";
      const cleanedAttrs = imgPrefix.replace(/\sstyle="[^"]*"/i, "");
      return `${cleanedAttrs} style="display:block;width:100%;max-width:${w}px;height:auto;margin:0 auto;background:#F7F7F7;" />`;
    }
  );
}

/**
 * Slug builder for utm_campaign. Normalizes a free-form context (suggestion
 * date+slot, draft id, AI compose context) into a stable, GA4-friendly token.
 */
export function buildCampaignSlug(input: {
  kind: "suggestion" | "draft" | "ai" | "reactivated";
  /** ISO date the email was generated for. */
  date?: string;
  /** Slot 1/2/3 for cron suggestions. */
  slot?: number;
  /** Internal id (draft uuid, suggestion uuid). */
  source_id?: string;
}): string {
  const parts: string[] = [input.kind];
  if (input.date) parts.push(input.date);
  if (input.slot != null) parts.push(`slot${input.slot}`);
  if (input.source_id) parts.push(input.source_id.slice(0, 8));
  return parts.join("-").toLowerCase();
}

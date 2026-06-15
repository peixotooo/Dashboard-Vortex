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

/** Home da marca pra onde imagens "soltas" (logo, decorativas) vão.
 *  Multi-tenant: futuramente vem de workspaces.home_url. Por enquanto
 *  default Bulking — quando outro workspace usar e-mail marketing,
 *  passar `home_url` na call de wrapUnlinkedImages. */
const DEFAULT_HOME_URL = "https://www.bulking.com.br";

const RESPONSIVE_EMAIL_SENTINEL = "Vortex responsive email safety v2";

export const RESPONSIVE_EMAIL_CSS = `
  /* ${RESPONSIVE_EMAIL_SENTINEL} */
  .vtx-email-container { width: 100%; max-width: 600px; }
  .vtx-email-fluid { max-width: 100%; height: auto; }
  .vtx-email-button { box-sizing: border-box; }
  @media only screen and (max-width: 599px) {
    body { width: 100% !important; min-width: 100% !important; margin: 0 !important; padding: 0 !important; }
    .vtx-email-container, .container { width: 100% !important; max-width: 100% !important; min-width: 0 !important; }
    .vtx-email-mobile-pad, .pad, .pad-l, .pad-xl { padding-left: 24px !important; padding-right: 24px !important; }
    .vtx-email-stack, .vtx-email-grid-cell, .related-cell {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
    }
    .vtx-email-stack table, .vtx-email-grid-cell table { width: 100% !important; }
    .vtx-email-stack, .vtx-email-stack-tight, .vtx-email-grid-cell, .related-cell {
      padding-left: 0 !important;
      padding-right: 0 !important;
    }
    .vtx-email-stack-pad { padding-left: 24px !important; padding-right: 24px !important; }
    .vtx-email-product-cell { padding-left: 24px !important; padding-right: 24px !important; }
    .vtx-email-grid-cell, .related-cell { padding-bottom: 28px !important; }
    .vtx-email-grid-spacer { display: none !important; }
    .vtx-email-fluid, img { max-width: 100% !important; height: auto !important; }
    .vtx-email-h1, .h1 { font-size: 30px !important; line-height: 1.15 !important; }
    .vtx-email-lead, .lead { font-size: 15px !important; line-height: 1.65 !important; }
    .vtx-email-button { max-width: 100% !important; box-sizing: border-box !important; white-space: normal !important; text-align: center !important; }
  }
`.trim();

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
    if (contentOverride && !u.searchParams.has("utm_content")) {
      u.searchParams.set("utm_content", contentOverride);
    }
    if (ctx.term && !u.searchParams.has("utm_term")) {
      u.searchParams.set("utm_term", ctx.term);
    }
    if (ctx.id && !u.searchParams.has("utm_id")) {
      u.searchParams.set("utm_id", ctx.id);
    }
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
 * Wrappea qualquer <img> que NÃO está dentro de <a>...</a> com um link
 * pra home da marca. Garante que toda imagem do e-mail é clicável.
 *
 * Regra de UX: toda imagem deve ter link.
 *   - Logo → home do site (workspace.home_url, futuramente)
 *   - Hero/decorativas sem contexto → home
 *   - Imagens de produto: layouts já envolvem em <a href="${product.url}">,
 *     então o mask + wrap ignora.
 *
 * Como aplicar este antes do applyUtmTracking: os <a> novos pegam UTMs
 * pelo mesmo pipeline.
 */
export function wrapUnlinkedImages(html: string, homeUrl?: string): string {
  if (!html) return html;
  const home = homeUrl ?? DEFAULT_HOME_URL;
  // Sentinela legível pra debug; nada de byte invisível.
  const masked: string[] = [];
  const masker = html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (m) => {
    const i = masked.push(m) - 1;
    return `__VORTEX_A_MASK_${i}__`;
  });
  const wrapped = masker.replace(
    /<img\b[^>]*\/?>/gi,
    (img) =>
      `<a href="${home}" target="_blank" style="text-decoration:none;border:0;display:inline-block;">${img}</a>`
  );
  return wrapped.replace(
    /__VORTEX_A_MASK_(\d+)__/g,
    (_m, idx: string) => masked[Number(idx)]
  );
}

/**
 * Defensive HTML sanitization for email clients. Four transforms:
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
 * 4. Responsiveness hardening. Real campaign providers and clients strip
 *    or rewrite parts of modern HTML. We add email-safe mobile CSS plus
 *    explicit classes on the 600px wrapper, multi-column cells and images
 *    so campaign sends stack cleanly on narrow screens.
 *
 * Each transform fixes pattern at the source (new renders avoid the
 * issue) AND in already-cached rendered_html on dispatch — older
 * suggestions in the DB benefit without needing to re-render.
 */
export function sanitizeEmailHtml(html: string): string {
  if (!html) return html;
  return applyResponsiveEmailSafety(
    stripBrokenUnsubscribe(
      unwrapAspectRatioImages(
        html
          .replace(/(\bsrc=)(["'])\/\//gi, "$1$2https://")
          .replace(/(\bhref=)(["'])\/\//gi, "$1$2https://")
      )
    )
  );
}

function applyResponsiveEmailSafety(html: string): string {
  return injectResponsiveEmailCss(addResponsiveEmailClasses(html));
}

function injectResponsiveEmailCss(html: string): string {
  if (html.includes(RESPONSIVE_EMAIL_SENTINEL)) return html;

  const styleBlock = `<style>\n${RESPONSIVE_EMAIL_CSS}\n</style>`;
  if (/<head[\s>]/i.test(html)) {
    if (/<style\b[^>]*>[\s\S]*?<\/style>/i.test(html)) {
      return html.replace(/<\/style>/i, `\n${RESPONSIVE_EMAIL_CSS}\n</style>`);
    }
    return html.replace(/<\/head>/i, `${styleBlock}\n</head>`);
  }

  if (/<body\b/i.test(html)) {
    return html.replace(/<body\b/i, `<head>${styleBlock}</head>\n<body`);
  }

  return `${styleBlock}\n${html}`;
}

function addResponsiveEmailClasses(html: string): string {
  return (
    html
      // Main 600px wrappers from the legacy renderer and react-email Container.
      .replace(
        /<table\b(?=[^>]*(?:\bwidth=(["'])600\1|\bstyle=(["'])[^"']*(?:width\s*:\s*600px|max-width\s*:\s*600px)[^"']*\2))[^>]*>/gi,
        (tag) => addClassesToTag(tag, ["vtx-email-container"])
      )
      .replace(
        /<div\b(?=[^>]*\bstyle=(["'])[^"']*(?:width\s*:\s*600px|max-width\s*:\s*600px)[^"']*\1)[^>]*>/gi,
        (tag) => addClassesToTag(tag, ["vtx-email-container"])
      )
      // Legacy product cells already have related-cell; add the generic
      // responsive classes so the same mobile CSS covers old and new renders.
      .replace(
        /<(td|th)\b(?=[^>]*\bclass=(["'])[^"']*\brelated-cell\b[^"']*\2)[^>]*>/gi,
        (tag) => addClassesToTag(tag, ["vtx-email-stack", "vtx-email-grid-cell"])
      )
      // Campaign/layout columns use arbitrary percentage widths (42/58,
      // 46/54, 60/40, etc.). Stack any non-100% percentage cell; 100%
      // structural cells stay untouched.
      .replace(
        /<(td|th)\b(?=[^>]*\bstyle=(["'])[^"']*\bwidth\s*:\s*(?:[1-9](?:\.\d+)?|[1-9]\d(?:\.\d+)?)%[^"']*\2)[^>]*>/gi,
        (tag) => addClassesToTag(tag, ["vtx-email-stack", "vtx-email-grid-cell"])
      )
      .replace(
        /<(td|th)\b(?=[^>]*\bwidth=(["'])(?:[1-9](?:\.\d+)?|[1-9]\d(?:\.\d+)?)%\1)[^>]*>/gi,
        (tag) => addClassesToTag(tag, ["vtx-email-stack", "vtx-email-grid-cell"])
      )
      .replace(/<img\b[^>]*>/gi, (tag) => addClassesToTag(tag, ["vtx-email-fluid"]))
  );
}

function addClassesToTag(tag: string, classNames: string[]): string {
  return classNames.reduce((acc, className) => addClassToTag(acc, className), tag);
}

function addClassToTag(tag: string, className: string): string {
  const classRe = new RegExp(`\\b${escapeRegExp(className)}\\b`);
  if (classRe.test(tag)) return tag;

  if (/\sclass=(["'])/i.test(tag)) {
    return tag.replace(
      /\sclass=(["'])([^"']*)\1/i,
      (_m, quote: string, classes: string) =>
        ` class=${quote}${`${classes} ${className}`.trim()}${quote}`
    );
  }

  return tag.replace(/\s*\/?>$/, (end) => ` class="${className}"${end}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    (_m, imgOpen: string) => {
      // Drop any inline styles that anchor the image absolutely or fill its
      // wrapper — the natural image has nothing to anchor against now.
      const cleaned = imgOpen
        .replace(/style="[^"]*"/i, (s) => {
          const stripped = s
            .replace(/position\s*:\s*absolute\s*;?/gi, "")
            .replace(/top\s*:\s*\d+(?:px|%)\s*;?/gi, "")
            .replace(/left\s*:\s*\d+(?:px|%)\s*;?/gi, "")
            .replace(/width\s*:\s*100%\s*;?/gi, "")
            .replace(/height\s*:\s*100%\s*;?/gi, "")
            .replace(/object-fit\s*:\s*[a-z-]+\s*;?/gi, "");
          return stripped.replace(/style="\s*"/i, "");
        })
        .trim();
      return `${cleaned} style="display:block;width:100%;max-width:600px;height:auto;" />`;
    }
  );
}

/**
 * Compose a campaign slug. Used by both the daily-suggestion path and the
 * draft/AI-compose path so they share a naming convention in GA4.
 */
export function buildCampaignSlug(opts: {
  kind: "suggestion" | "draft" | "ai-compose";
  date?: string; // YYYY-MM-DD, only suggestion uses it
  slot?: number; // 1 | 2 | 3, suggestion only
  source_id: string; // suggestion id, draft id, or compose id
}): string {
  const short = opts.source_id.replace(/-/g, "").slice(0, 8);
  switch (opts.kind) {
    case "suggestion":
      return `suggestion-${opts.date}-slot${opts.slot}-${short}`;
    case "draft":
      return `draft-${short}`;
    case "ai-compose":
      return `ai-compose-${short}`;
  }
}

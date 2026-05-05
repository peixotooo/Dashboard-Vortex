// src/lib/email-templates/templates/shared.ts
//
// Aesthetic system: monochrome (white / black / grays only for text & UI).
// No saturated accents in copy or buttons. Inspired by editorial fashion email
// references in public/Hero Emails (Society Studios, Represent, Void, Asics x
// BEAMS, FAINE, Black Friday Email Templates). Generous whitespace. Type
// weights cap at 600 (no 700/800) to keep the layout elegant rather than loud.
// No em dashes anywhere in body copy or labels.

export const TOKENS = {
  // Surfaces
  bg: "#FFFFFF",
  bgAlt: "#F7F7F7",
  surfaceInverse: "#000000",

  // Text
  text: "#000000",
  textMuted: "#3A3A3A",
  textSecondary: "#6E6E6E",
  textFaint: "#A8A8A8",

  // Lines
  border: "#E6E6E6",
  borderStrong: "#000000",

  // Type families. Body sticks to Inter; headlines use Kanit but at moderate
  // weights — never above 600 — to match the editorial references.
  fontHead: "'Kanit', 'Inter', Arial, sans-serif",
  fontBody: "'Inter', 'Helvetica Neue', Arial, sans-serif",
  fontMono: "'JetBrains Mono', 'Courier New', monospace",
};

export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function htmlOpen(args: { subject: string; preview: string }): string {
  return `<!DOCTYPE html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light" />
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no" />
<title>${escapeHtml(args.subject)}</title>
<!--[if gte mso 9]>
<xml>
  <o:OfficeDocumentSettings>
    <o:AllowPNG/>
    <o:PixelsPerInch>96</o:PixelsPerInch>
  </o:OfficeDocumentSettings>
</xml>
<![endif]-->
<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
<style>
  html, body { margin:0 !important; padding:0 !important; background:${TOKENS.bgAlt}; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  body { width:100% !important; min-width:100% !important; mso-line-height-rule:exactly; }
  table { border-collapse:collapse !important; mso-table-lspace:0pt; mso-table-rspace:0pt; }
  td { mso-line-height-rule:exactly; }
  img { border:0; outline:none; text-decoration:none; display:block; -ms-interpolation-mode:bicubic; line-height:100%; }
  a { color:${TOKENS.text}; text-decoration:underline; }
  a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; font-size:inherit !important; font-family:inherit !important; font-weight:inherit !important; line-height:inherit !important; }
  u + #body a { color:inherit; text-decoration:none; font-size:inherit; font-family:inherit; font-weight:inherit; line-height:inherit; }
  @media (max-width: 599px) {
    .h1 { font-size: 32px !important; }
    .lead { font-size: 15px !important; }
    .container { width: 100% !important; }
    .pad { padding: 18px 24px !important; }
    .pad-l { padding: 28px 24px !important; }
    .pad-xl { padding: 40px 24px !important; }
    .related-cell { display:block !important; width:100% !important; padding:0 0 32px !important; }
  }
</style>
</head>
<body id="body" style="margin:0;padding:0;background:${TOKENS.bgAlt};width:100%;">
<div style="display:none;max-height:0;overflow:hidden;color:${TOKENS.bgAlt};font-size:1px;line-height:1px;mso-hide:all;">${escapeHtml(args.preview)}</div>
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">&#847; &zwnj; &nbsp; &#8199; &#65279; &#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${TOKENS.bgAlt};width:100%;">
  <tr><td align="center" style="padding:0;">
  <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${TOKENS.bg};">`;
}

export function htmlClose(): string {
  return `</table></td></tr></table></body></html>`;
}

const BULKING_LOGO_URL =
  "https://cdn.vnda.com.br/bulking/2023/12/01/18_12_2_290_logobulkingsite.svg?v=1701465320";

export function header(): string {
  return `
<tr><td align="center" class="pad-xl" style="padding:48px 32px 36px;border-bottom:1px solid ${TOKENS.border};">
  <a href="https://www.bulking.com.br" target="_blank" style="text-decoration:none;color:${TOKENS.text};">
    <img src="${BULKING_LOGO_URL}" alt="BULKING" width="148" height="30" style="display:inline-block;width:148px;height:auto;max-width:148px;border:0;outline:none;" />
  </a>
</td></tr>`;
}

// ---------- Dark mode framing primitives ----------

export const DARK = {
  bg: "#000000",
  fg: "#FFFFFF",
  muted: "#A8A8A8",
  faint: "#6E6E6E",
  border: "#1F1F1F",
  surfaceAlt: "#0E0E0E",
};

/** Wraps the body in a dark canvas. Pair with darkClose(). */
export function darkOpen(args: { subject: string; preview: string }): string {
  return `<!DOCTYPE html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark only" />
<meta name="supported-color-schemes" content="dark" />
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no" />
<title>${escapeHtml(args.subject)}</title>
<!--[if gte mso 9]>
<xml>
  <o:OfficeDocumentSettings>
    <o:AllowPNG/>
    <o:PixelsPerInch>96</o:PixelsPerInch>
  </o:OfficeDocumentSettings>
</xml>
<![endif]-->
<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
<style>
  html, body { margin:0 !important; padding:0 !important; background:${DARK.bg}; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  body { width:100% !important; min-width:100% !important; mso-line-height-rule:exactly; }
  table { border-collapse:collapse !important; mso-table-lspace:0pt; mso-table-rspace:0pt; }
  td { mso-line-height-rule:exactly; }
  img { border:0; outline:none; text-decoration:none; display:block; -ms-interpolation-mode:bicubic; line-height:100%; }
  a { color:${DARK.fg}; text-decoration:underline; }
  a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; font-size:inherit !important; font-family:inherit !important; font-weight:inherit !important; line-height:inherit !important; }
  u + #body a { color:inherit; text-decoration:none; font-size:inherit; font-family:inherit; font-weight:inherit; line-height:inherit; }
  @media (max-width: 599px) {
    .h1 { font-size: 30px !important; }
    .lead { font-size: 15px !important; }
    .container { width: 100% !important; }
    .pad { padding: 18px 24px !important; }
    .pad-l { padding: 28px 24px !important; }
    .pad-xl { padding: 40px 24px !important; }
    .related-cell { display:block !important; width:100% !important; padding:0 0 32px !important; }
  }
</style>
</head>
<body id="body" style="margin:0;padding:0;background:${DARK.bg};width:100%;">
<div style="display:none;max-height:0;overflow:hidden;color:${DARK.bg};font-size:1px;line-height:1px;mso-hide:all;">${escapeHtml(args.preview)}</div>
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">&#847; &zwnj; &nbsp; &#8199; &#65279; &#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${DARK.bg};width:100%;">
  <tr><td align="center" style="padding:0;">
  <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${DARK.bg};">`;
}

export const darkClose = htmlClose;

export function darkHeader(): string {
  return `
<tr><td align="center" class="pad-xl" style="padding:48px 32px 36px;background:${DARK.bg};border-bottom:1px solid ${DARK.border};">
  <a href="https://www.bulking.com.br" target="_blank" style="text-decoration:none;color:${DARK.fg};">
    <span style="display:inline-block;font-family:${TOKENS.fontHead};font-weight:500;font-size:18px;letter-spacing:0.32em;color:${DARK.fg};text-transform:uppercase;">BULKING</span>
  </a>
</td></tr>`;
}

export function darkFooter(): string {
  return `
<tr><td class="pad-xl" style="padding:56px 40px 48px;background:${DARK.bg};border-top:1px solid ${DARK.border};">
  <div style="font-family:${TOKENS.fontHead};font-weight:500;font-size:12px;letter-spacing:0.32em;color:${DARK.fg};text-transform:uppercase;margin-bottom:16px;text-align:center;">Respect the Hustle.</div>
  <div style="font-family:${TOKENS.fontBody};font-weight:400;font-size:12px;color:${DARK.muted};line-height:1.8;text-align:center;">
    Bulking · <a href="https://www.bulking.com.br" style="color:${DARK.muted};text-decoration:underline;">bulking.com.br</a><br />
    Você está recebendo este email porque é cliente Bulking. <a href="{{UNSUBSCRIBE_URL}}" style="color:${DARK.muted};text-decoration:underline;">Descadastrar</a>.
  </div>
</td></tr>`;
}

export function darkCtaBlock(args: { text: string; url: string }): string {
  return `
<tr><td class="pad-xl" align="center" style="padding:8px 40px 56px;background:${DARK.bg};">
  ${bulletproofButton({ text: args.text, url: args.url, bg: DARK.fg, fg: DARK.bg })}
</td></tr>`;
}

/**
 * Bulletproof email button. Outlook 2007–2019 ignores padding on inline `<a>`
 * elements, which is why our previous CTAs collapsed to ~14px height in those
 * clients. This pattern wraps the link in a single-cell `<table>` with
 * `mso-padding-alt` so Outlook (Word renderer) honors the padding via MSO,
 * while every other client uses the regular CSS padding on the `<a>`. Same
 * shape react-email's `<Button>` produces internally.
 *
 * Defaults match the brand: solid black background, white text, weight 600,
 * uppercase, 0.28em letter spacing, no border radius (squared edges per the
 * editorial references).
 */
export function bulletproofButton(args: {
  text: string;
  url: string;
  /** Background color of the button. Defaults to black. */
  bg?: string;
  /** Foreground (text) color of the button. Defaults to white. */
  fg?: string;
  /** Vertical / horizontal padding. */
  padY?: number;
  padX?: number;
  /** Optional `data-utm-content` for per-anchor attribution. */
  utmContent?: string;
}): string {
  const bg = args.bg ?? TOKENS.text;
  const fg = args.fg ?? TOKENS.bg;
  const py = args.padY ?? 20;
  const px = args.padX ?? 44;
  const utm = args.utmContent
    ? ` data-utm-content="${escapeHtml(args.utmContent)}"`
    : "";
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:separate;line-height:100%;">
  <tr>
    <td align="center" bgcolor="${bg}" role="presentation" valign="middle" style="border:none;border-radius:0;cursor:auto;mso-padding-alt:${py}px ${px}px;background:${bg};">
      <a href="${escapeHtml(args.url)}" target="_blank"${utm} style="background:${bg};color:${fg};display:inline-block;font-family:${TOKENS.fontHead};font-size:13px;font-weight:600;line-height:100%;letter-spacing:0.28em;margin:0;mso-padding-alt:0;padding:${py}px ${px}px;text-decoration:none;text-transform:uppercase;text-underline-color:${bg};">${escapeHtml(args.text)}</a>
    </td>
  </tr>
</table>`;
}

/** Spacer rows to compose vertical rhythm between sections. */
export function spacer(px: number): string {
  return `
<tr><td style="font-size:0;line-height:0;height:${px}px;">&nbsp;</td></tr>`;
}

type Mode = "light" | "dark";

export interface TextStyle {
  font_size?: number;
  font_weight?: 300 | 400 | 500 | 600;
  italic?: boolean;
  color?: string;
}

function styleString(
  style: TextStyle | undefined,
  defaults: { font_size: number; font_weight: number; color: string }
): string {
  const fs = style?.font_size ?? defaults.font_size;
  const fw = style?.font_weight ?? defaults.font_weight;
  const fi = style?.italic ? "italic" : "normal";
  const co = style?.color ?? defaults.color;
  return `font-size:${fs}px;font-weight:${fw};font-style:${fi};color:${co};`;
}

interface ModePalette {
  bg: string;
  text: string;
  textMuted: string;
  textSecondary: string;
  textFaint: string;
  border: string;
  badgeBg: string;
  badgeFg: string;
  surfaceAlt: string;
}

function pal(mode: Mode = "light"): ModePalette {
  if (mode === "dark") {
    return {
      bg: DARK.bg,
      text: DARK.fg,
      textMuted: "#D8D8D8",
      textSecondary: "#B8B8B8",
      textFaint: "#8A8A8A",
      border: DARK.border,
      badgeBg: DARK.fg,
      badgeFg: DARK.bg,
      surfaceAlt: DARK.surfaceAlt,
    };
  }
  return {
    bg: TOKENS.bg,
    text: TOKENS.text,
    textMuted: TOKENS.textMuted,
    textSecondary: TOKENS.textSecondary,
    textFaint: TOKENS.textFaint,
    border: TOKENS.border,
    badgeBg: TOKENS.text,
    badgeFg: TOKENS.bg,
    surfaceAlt: TOKENS.bgAlt,
  };
}

/** Tagline above the hero. Letter-spaced, gray, light weight, ALL CAPS. */
export function hookBlock(text: string, mode: Mode = "light", style?: TextStyle): string {
  const c = pal(mode);
  const inline = styleString(style, { font_size: 11, font_weight: 500, color: c.textSecondary });
  return `
<tr><td align="center" class="pad-l" style="padding:40px 32px 12px;">
  <div style="font-family:${TOKENS.fontBody};${inline}letter-spacing:0.32em;text-transform:uppercase;">${escapeHtml(text)}</div>
</td></tr>`;
}

/**
 * Static 5 star rating row. Real ratings still v2.
 * Weight 500 (not bold) to keep the editorial feel.
 */
export function ratingStarsBlock(rating = 5, count?: number, mode: Mode = "light"): string {
  const c = pal(mode);
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  const stars = "★".repeat(filled) + "☆".repeat(5 - filled);
  const tail = count
    ? ` <span style="color:${c.textFaint};font-weight:400;">(${count})</span>`
    : "";
  return `
<tr><td class="pad" align="center" style="padding:0 32px 16px;">
  <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:14px;color:${c.text};letter-spacing:0.14em;">${stars}${tail}</div>
</td></tr>`;
}

/** Bold-but-not-loud discount badge. Uppercase, weight 600, no accent color. */
export function discountBadgeBlock(discount_percent: number, mode: Mode = "light"): string {
  const c = pal(mode);
  return `
<tr><td align="center" class="pad" style="padding:8px 32px 24px;">
  <span style="display:inline-block;background:${c.badgeBg};color:${c.badgeFg};font-family:${TOKENS.fontHead};font-weight:600;font-size:13px;letter-spacing:0.28em;padding:12px 22px;text-transform:uppercase;">${discount_percent}% off exclusivo</span>
</td></tr>`;
}

export function hero(args: {
  image_url: string;
  alt: string;
  badge?: string;
  mode?: Mode;
}): string {
  const c = pal(args.mode);
  const badge = args.badge
    ? `
<tr><td class="pad" align="center" style="padding:24px 32px 16px;">
  <span style="display:inline-block;background:${c.badgeBg};color:${c.badgeFg};font-family:${TOKENS.fontHead};font-weight:500;font-size:11px;letter-spacing:0.32em;padding:10px 16px;text-transform:uppercase;">${escapeHtml(args.badge)}</span>
</td></tr>`
    : "";
  // Locked 3:4 portrait frame so swapping products never reflows the email.
  // Object-fit:cover crops anything off-ratio. Outlook desktop stretches to
  // the box (acceptable degradation; modern clients render correctly).
  return `${badge}
<tr><td style="padding:0;">
  <div style="position:relative;width:100%;max-width:600px;padding-top:133.33%;margin:0 auto;background:${TOKENS.bgAlt};overflow:hidden;">
    <img src="${escapeHtml(args.image_url)}" alt="${escapeHtml(args.alt)}" width="600" height="800" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;object-position:center;display:block;" />
  </div>
</td></tr>`;
}

/**
 * Hero headline. Weight 500 (medium) — the editorial references use medium
 * weights at large sizes rather than bold extruded letters.
 */
export function headlineBlock(text: string, mode: Mode = "light", style?: TextStyle): string {
  const c = pal(mode);
  const inline = styleString(style, { font_size: 38, font_weight: 500, color: c.text });
  return `
<tr><td class="pad-xl" align="center" style="padding:56px 40px 14px;">
  <h1 class="h1" style="margin:0;font-family:${TOKENS.fontHead};${inline}line-height:1.1;letter-spacing:-0.005em;">${escapeHtml(text)}</h1>
</td></tr>`;
}

export function leadBlock(text: string, mode: Mode = "light", style?: TextStyle): string {
  const c = pal(mode);
  const inline = styleString(style, { font_size: 16, font_weight: 400, color: c.textMuted });
  return `
<tr><td class="pad-l" align="center" style="padding:0 40px 40px;">
  <p class="lead" style="margin:0;font-family:${TOKENS.fontBody};${inline}line-height:1.7;max-width:480px;margin-left:auto;margin-right:auto;">${escapeHtml(text)}</p>
</td></tr>`;
}

/** Solid black CTA. No saturated colors anywhere in copy / interactive. */
export function ctaBlock(args: { text: string; url: string }): string {
  return `
<tr><td class="pad-xl" align="center" style="padding:8px 40px 56px;">
  ${bulletproofButton({ text: args.text, url: args.url, utmContent: "primary-cta" })}
</td></tr>`;
}

/** Product name, price, optional struck-through old price. Centered. */
export function productMetaBlock(args: {
  name: string;
  price: number;
  old_price?: number;
  mode?: Mode;
}): string {
  const c = pal(args.mode);
  const oldPrice = args.old_price
    ? `<span style="font-family:${TOKENS.fontBody};font-weight:400;font-size:14px;color:${c.textFaint};text-decoration:line-through;margin-right:12px;">R$ ${args.old_price.toFixed(2)}</span>`
    : "";
  return `
<tr><td class="pad-l" align="center" style="padding:0 40px 28px;">
  <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:15px;color:${c.textMuted};margin-bottom:8px;letter-spacing:0.04em;">${escapeHtml(args.name)}</div>
  <div>${oldPrice}<span style="font-family:${TOKENS.fontHead};font-weight:600;font-size:22px;color:${c.text};">R$ ${args.price.toFixed(2)}</span></div>
</td></tr>`;
}

function staticTimerAlt(expires_at: Date): string {
  const ms = expires_at.getTime() - Date.now();
  if (ms <= 0) return "Promoção encerrada";
  const totalMin = Math.floor(ms / 60000);
  const hh = String(Math.floor(totalMin / 60)).padStart(2, "0");
  const mm = String(totalMin % 60).padStart(2, "0");
  return `Última chance. Termina em ${hh}h${mm}.`;
}

/**
 * Top of email full bleed countdown banner. Animated server side GIF inside a
 * 600 wide cell. Background black so the image bleeds edge to edge.
 */
export function topCountdownBlock(args: {
  countdown_url: string;
  expires_at: Date;
}): string {
  const alt = staticTimerAlt(args.expires_at);
  return `
<tr><td style="padding:0;background:${TOKENS.text};">
  <img src="${escapeHtml(args.countdown_url)}" alt="${escapeHtml(alt)}" width="600" height="220" style="width:100%;max-width:600px;height:auto;display:block;border:0;outline:none;background:${TOKENS.text};" />
</td></tr>`;
}

/**
 * Coupon code box. Code rendered in mono, all weights kept at 500 to match
 * the rest of the system. The countdown lives in a separate top block, so
 * this section is intentionally quiet.
 */
export function couponBlock(args: {
  code: string;
  discount_percent: number;
  product_name: string;
  mode?: Mode;
}): string {
  const c = pal(args.mode);
  return `
<tr><td class="pad-l" style="padding:8px 40px 28px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${c.text};background:${c.bg};">
    <tr><td align="center" style="padding:30px 24px;">
      <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.32em;color:${c.textSecondary};text-transform:uppercase;margin-bottom:14px;">Cupom exclusivo</div>
      <div style="font-family:${TOKENS.fontMono};font-weight:500;font-size:22px;letter-spacing:0.18em;color:${c.text};background:${c.surfaceAlt};padding:16px 26px;display:inline-block;">${escapeHtml(args.code)}</div>
      <div style="font-family:${TOKENS.fontBody};font-weight:400;font-size:14px;color:${c.textSecondary};margin-top:18px;">${discount_percent_text(args.discount_percent)} ${escapeHtml(args.product_name)}</div>
    </td></tr>
  </table>
</td></tr>`;
}

function discount_percent_text(p: number): string {
  return `${p}% off em`;
}

/** 3 product grid below the hero. Editorial tight typography, no bold. */
export function relatedProductsGrid(
  products: Array<{
    name: string;
    price: number;
    old_price?: number;
    image_url: string;
    url: string;
  }>,
  mode: Mode = "light"
): string {
  if (!products || products.length === 0) return "";
  const c = pal(mode);
  const cols = products.slice(0, 3);
  const widthPct = `${Math.floor(100 / cols.length)}%`;

  const sectionTitle = `
<tr><td align="center" class="pad-xl" style="padding:64px 40px 12px;border-top:1px solid ${c.border};">
  <div style="font-family:${TOKENS.fontHead};font-weight:500;font-size:13px;letter-spacing:0.32em;color:${c.text};text-transform:uppercase;">Selecionados pra você</div>
</td></tr>
<tr><td align="center" class="pad" style="padding:0 40px 32px;">
  <div style="font-family:${TOKENS.fontBody};font-weight:400;font-size:14px;color:${c.textSecondary};">Mais peças que combinam com a sua rotina.</div>
</td></tr>`;

  const cells = cols
    .map((p) => {
      const oldPrice =
        p.old_price && p.old_price > p.price
          ? `<div style="font-family:${TOKENS.fontBody};font-weight:400;font-size:12px;color:${c.textFaint};text-decoration:line-through;margin-bottom:2px;">R$ ${p.old_price.toFixed(2)}</div>`
          : "";
      return `
<td valign="top" align="center" width="${widthPct}" class="related-cell" style="width:${widthPct};padding:0 10px 40px;">
  <a href="${escapeHtml(p.url)}" target="_blank" style="text-decoration:none;color:${c.text};">
    <div style="width:100%;max-width:180px;margin:0 auto 14px;">
      <div style="position:relative;width:100%;padding-top:125%;background:${c.surfaceAlt};overflow:hidden;">
        <img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.name)}" width="180" height="225" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;object-position:center;display:block;" />
      </div>
    </div>
    <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:14px;color:${c.text};line-height:1.4;margin-bottom:8px;min-height:38px;">${escapeHtml(p.name)}</div>
    ${oldPrice}
    <div style="font-family:${TOKENS.fontHead};font-weight:500;font-size:16px;color:${c.text};margin-bottom:14px;">R$ ${p.price.toFixed(2)}</div>
    <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;color:${c.text};letter-spacing:0.28em;text-transform:uppercase;border-bottom:1px solid ${c.text};padding-bottom:3px;display:inline-block;">Ver produto</div>
  </a>
</td>`;
    })
    .join("");

  return `${sectionTitle}
<tr><td class="pad-l" style="padding:0 30px 32px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>${cells}</tr>
  </table>
</td></tr>`;
}

export function footer(): string {
  return `
<tr><td class="pad-xl" style="padding:56px 40px 48px;border-top:1px solid ${TOKENS.border};">
  <div style="font-family:${TOKENS.fontHead};font-weight:500;font-size:12px;letter-spacing:0.32em;color:${TOKENS.text};text-transform:uppercase;margin-bottom:16px;text-align:center;">Respect the Hustle.</div>
  <div style="font-family:${TOKENS.fontBody};font-weight:400;font-size:12px;color:${TOKENS.textSecondary};line-height:1.8;text-align:center;">
    Bulking · <a href="https://www.bulking.com.br" style="color:${TOKENS.textSecondary};text-decoration:underline;">bulking.com.br</a>
    <br />
    Você está recebendo este email porque é cliente Bulking. <a href="{{UNSUBSCRIBE_URL}}" style="color:${TOKENS.textSecondary};text-decoration:underline;">Descadastrar</a>.
  </div>
</td></tr>`;
}

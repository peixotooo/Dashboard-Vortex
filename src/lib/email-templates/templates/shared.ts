// src/lib/email-templates/templates/shared.ts
//
// Light, Adidas-style email layout: white background, black text,
// uppercase headlines with letter-spacing, generous whitespace, and
// a green CTA as the only color accent (Bulking distinctive asset).

export const TOKENS = {
  bg: "#FFFFFF",
  bgAlt: "#F5F5F5",
  text: "#000000",
  textMuted: "#383838",
  textSecondary: "#707070",
  accent: "#49E472",
  accentDark: "#3BC45E",
  border: "#E0E0E0",
  borderStrong: "#000000",
  fontHead: "'Kanit', Arial, Helvetica, sans-serif",
  fontBody: "'Inter', Arial, Helvetica, sans-serif",
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
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(args.subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
  body { margin:0; padding:0; background:${TOKENS.bgAlt}; }
  table { border-collapse:collapse; }
  img { border:0; outline:none; text-decoration:none; display:block; }
  a { color:${TOKENS.text}; }
  @media (max-width: 599px) {
    .h1 { font-size: 30px !important; }
    .lead { font-size: 15px !important; }
    .container { width: 100% !important; }
    .pad { padding: 16px 20px !important; }
    .pad-top { padding-top: 24px !important; }
    .pad-bottom { padding-bottom: 24px !important; }
    .related-cell { display:block !important; width:100% !important; padding:0 0 24px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${TOKENS.bgAlt};">
<div style="display:none;max-height:0;overflow:hidden;color:${TOKENS.bgAlt};">${escapeHtml(args.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${TOKENS.bgAlt};">
  <tr><td align="center">
  <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:${TOKENS.bg};">`;
}

export function htmlClose(): string {
  return `</table></td></tr></table></body></html>`;
}

const BULKING_LOGO_URL =
  "https://cdn.vnda.com.br/bulking/2023/12/01/18_12_2_290_logobulkingsite.svg?v=1701465320";

export function header(): string {
  return `
<tr><td align="center" class="pad" style="padding:32px 24px 24px;border-bottom:1px solid ${TOKENS.border};">
  <a href="https://www.bulking.com.br" target="_blank" style="text-decoration:none;color:${TOKENS.text};">
    <img src="${BULKING_LOGO_URL}" alt="BULKING" width="160" height="32" style="display:inline-block;width:160px;height:auto;max-width:160px;border:0;outline:none;" />
  </a>
</td></tr>`;
}

/** Centered tagline shown above the hero — sets the tone for the email. */
export function hookBlock(text: string): string {
  return `
<tr><td align="center" class="pad" style="padding:24px 32px 4px;">
  <div style="font-family:${TOKENS.fontHead};font-weight:600;font-size:13px;letter-spacing:0.22em;color:${TOKENS.textSecondary};text-transform:uppercase;">${escapeHtml(text)}</div>
</td></tr>`;
}

/** Static 5-star rating row — visual social proof. Real ratings are v2. */
export function ratingStarsBlock(rating = 5, count?: number): string {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  const stars = "★".repeat(filled) + "☆".repeat(5 - filled);
  const tail = count ? ` <span style="color:${TOKENS.textSecondary};font-weight:400;">(${count})</span>` : "";
  return `
<tr><td class="pad" align="center" style="padding:0 32px 12px;">
  <div style="font-family:${TOKENS.fontBody};font-size:14px;color:${TOKENS.text};letter-spacing:0.08em;">${stars}${tail}</div>
</td></tr>`;
}

/** Bold discount call-out used by slot 2 (slowmoving). */
export function discountBadgeBlock(discount_percent: number): string {
  return `
<tr><td align="center" class="pad" style="padding:0 32px 16px;">
  <span style="display:inline-block;background:${TOKENS.text};color:${TOKENS.bg};font-family:${TOKENS.fontHead};font-weight:800;font-size:18px;letter-spacing:0.16em;padding:10px 20px;text-transform:uppercase;">${discount_percent}% OFF · só hoje</span>
</td></tr>`;
}

/** 3-up product grid rendered with email-safe nested tables. */
export function relatedProductsGrid(products: Array<{
  name: string;
  price: number;
  old_price?: number;
  image_url: string;
  url: string;
}>): string {
  if (!products || products.length === 0) return "";
  const cols = products.slice(0, 3);
  // Equal-width columns, mobile media query collapses to single column.
  const widthPct = `${Math.floor(100 / cols.length)}%`;

  const sectionTitle = `
<tr><td align="center" class="pad" style="padding:48px 32px 8px;border-top:1px solid ${TOKENS.border};">
  <div style="font-family:${TOKENS.fontHead};font-weight:800;font-size:13px;letter-spacing:0.22em;color:${TOKENS.text};text-transform:uppercase;">Mais para vestir o trabalho</div>
</td></tr>
<tr><td align="center" class="pad" style="padding:0 32px 24px;">
  <div style="font-family:${TOKENS.fontBody};font-size:14px;color:${TOKENS.textSecondary};">Selecionados pra quem treina como você.</div>
</td></tr>`;

  const cells = cols.map((p) => {
    const oldPrice = p.old_price && p.old_price > p.price
      ? `<div style="font-family:${TOKENS.fontBody};font-size:12px;color:${TOKENS.textSecondary};text-decoration:line-through;">R$ ${p.old_price.toFixed(2)}</div>`
      : "";
    return `
<td valign="top" align="center" width="${widthPct}" class="related-cell" style="width:${widthPct};padding:0 8px 32px;">
  <a href="${escapeHtml(p.url)}" target="_blank" style="text-decoration:none;color:${TOKENS.text};">
    <img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.name)}" width="170" height="220" style="width:100%;max-width:180px;height:auto;display:block;margin:0 auto 10px;" />
    <div style="font-family:${TOKENS.fontHead};font-weight:600;font-size:14px;color:${TOKENS.text};line-height:1.3;margin-bottom:6px;min-height:34px;">${escapeHtml(p.name)}</div>
    ${oldPrice}
    <div style="font-family:${TOKENS.fontHead};font-weight:700;font-size:16px;color:${TOKENS.text};">R$ ${p.price.toFixed(2)}</div>
    <div style="font-family:${TOKENS.fontHead};font-weight:600;font-size:11px;color:${TOKENS.text};letter-spacing:0.16em;text-transform:uppercase;border-bottom:1px solid ${TOKENS.text};padding-bottom:2px;display:inline-block;margin-top:10px;">Ver produto</div>
  </a>
</td>`;
  }).join("");

  return `${sectionTitle}
<tr><td class="pad" style="padding:0 24px 24px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>${cells}</tr>
  </table>
</td></tr>`;
}

export function hero(args: { image_url: string; alt: string; badge?: string }): string {
  const badge = args.badge
    ? `
<tr><td class="pad" align="center" style="padding:24px 24px 0;">
  <span style="display:inline-block;background:${TOKENS.text};color:${TOKENS.bg};font-family:${TOKENS.fontHead};font-weight:700;font-size:11px;letter-spacing:0.22em;padding:8px 14px;text-transform:uppercase;">${escapeHtml(args.badge)}</span>
</td></tr>`
    : "";
  return `${badge}
<tr><td style="padding:0;">
  <img src="${escapeHtml(args.image_url)}" alt="${escapeHtml(args.alt)}" width="600" height="800" style="width:100%;max-width:600px;height:auto;display:block;" />
</td></tr>`;
}

export function headlineBlock(text: string): string {
  return `
<tr><td class="pad pad-top" align="center" style="padding:48px 32px 12px;">
  <h1 class="h1" style="margin:0;font-family:${TOKENS.fontHead};font-weight:800;font-size:34px;line-height:1.1;color:${TOKENS.text};letter-spacing:-0.005em;text-transform:uppercase;">${escapeHtml(text)}</h1>
</td></tr>`;
}

export function leadBlock(text: string): string {
  return `
<tr><td class="pad" align="center" style="padding:0 32px 32px;">
  <p class="lead" style="margin:0;font-family:${TOKENS.fontBody};font-weight:400;font-size:16px;line-height:1.6;color:${TOKENS.textMuted};max-width:480px;margin-left:auto;margin-right:auto;">${escapeHtml(text)}</p>
</td></tr>`;
}

export function ctaBlock(args: { text: string; url: string }): string {
  return `
<tr><td class="pad pad-bottom" align="center" style="padding:8px 32px 48px;">
  <a href="${escapeHtml(args.url)}" target="_blank" style="display:inline-block;background:${TOKENS.accent};color:${TOKENS.text};font-family:${TOKENS.fontHead};font-weight:700;font-size:14px;letter-spacing:0.18em;text-transform:uppercase;text-decoration:none;padding:18px 40px;">${escapeHtml(args.text)}</a>
</td></tr>`;
}

export function productMetaBlock(args: { name: string; price: number; old_price?: number }): string {
  const oldPrice = args.old_price
    ? `<span style="font-family:${TOKENS.fontBody};font-weight:400;font-size:14px;color:${TOKENS.textSecondary};text-decoration:line-through;margin-right:10px;">R$ ${args.old_price.toFixed(2)}</span>`
    : "";
  return `
<tr><td class="pad" align="center" style="padding:0 32px 24px;">
  <div style="font-family:${TOKENS.fontHead};font-weight:600;font-size:16px;color:${TOKENS.textMuted};margin-bottom:6px;letter-spacing:0.04em;">${escapeHtml(args.name)}</div>
  <div>${oldPrice}<span style="font-family:${TOKENS.fontHead};font-weight:700;font-size:22px;color:${TOKENS.text};">R$ ${args.price.toFixed(2)}</span></div>
</td></tr>`;
}

/**
 * Coupon block: code + product line + DYNAMIC countdown image.
 *
 * The countdown is rendered as a server-side PNG (`/api/email-countdown.png`)
 * that re-renders on every fetch. Email clients re-fetch images each open
 * (modulo their own cache), so the timer is effectively live without any JS.
 * Adidas / NiftyImages / Sendtric all use the same trick — JS is blocked in
 * Gmail / Outlook / Apple Mail inboxes.
 *
 * If a client blocks images, the alt text "Termina em HH:MM (snapshot)"
 * still reads correctly.
 */
function staticTimerAlt(expires_at: Date): string {
  const ms = expires_at.getTime() - Date.now();
  if (ms <= 0) return "Promoção encerrada";
  const totalMin = Math.floor(ms / 60000);
  const hh = String(Math.floor(totalMin / 60)).padStart(2, "0");
  const mm = String(totalMin % 60).padStart(2, "0");
  return `Termina em ${hh}:${mm}`;
}

export function couponBlock(args: {
  code: string;
  discount_percent: number;
  product_name: string;
  expires_at: Date;
  countdown_url: string;
}): string {
  const alt = staticTimerAlt(args.expires_at);
  return `
<tr><td class="pad" style="padding:8px 32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${TOKENS.text};background:${TOKENS.bg};">
    <tr><td align="center" style="padding:24px 20px;">
      <div style="font-family:${TOKENS.fontHead};font-weight:600;font-size:11px;letter-spacing:0.24em;color:${TOKENS.textSecondary};text-transform:uppercase;margin-bottom:12px;">Cupom Exclusivo</div>
      <div style="font-family:'Courier New', monospace;font-weight:700;font-size:22px;letter-spacing:0.12em;color:${TOKENS.text};background:${TOKENS.bgAlt};padding:14px 22px;display:inline-block;">${escapeHtml(args.code)}</div>
      <div style="font-family:${TOKENS.fontBody};font-size:14px;color:${TOKENS.textMuted};margin-top:14px;">${args.discount_percent}% off em ${escapeHtml(args.product_name)}</div>
    </td></tr>
  </table>
</td></tr>
<tr><td class="pad" align="center" style="padding:0 32px 32px;">
  <div style="font-family:${TOKENS.fontHead};font-weight:600;font-size:10px;letter-spacing:0.24em;color:${TOKENS.textSecondary};text-transform:uppercase;margin-bottom:14px;">Termina em</div>
  <img src="${escapeHtml(args.countdown_url)}" alt="${escapeHtml(alt)}" width="600" height="160" style="width:100%;max-width:600px;height:auto;display:block;" />
</td></tr>`;
}

export function footer(): string {
  return `
<tr><td class="pad" style="padding:40px 32px 32px;border-top:1px solid ${TOKENS.border};">
  <div style="font-family:${TOKENS.fontHead};font-weight:800;font-size:13px;letter-spacing:0.22em;color:${TOKENS.text};text-transform:uppercase;margin-bottom:14px;text-align:center;">Respect the Hustle.</div>
  <div style="font-family:${TOKENS.fontBody};font-size:12px;color:${TOKENS.textSecondary};line-height:1.7;text-align:center;">
    Bulking · <a href="https://www.bulking.com.br" style="color:${TOKENS.textSecondary};text-decoration:underline;">bulking.com.br</a>
    <br />
    Você está recebendo este email porque é cliente Bulking. <a href="{{UNSUBSCRIBE_URL}}" style="color:${TOKENS.textSecondary};text-decoration:underline;">Descadastrar</a>.
  </div>
</td></tr>`;
}

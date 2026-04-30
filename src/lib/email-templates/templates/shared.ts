// src/lib/email-templates/templates/shared.ts

export const TOKENS = {
  bg: "#000000",
  bgSurface: "#0A0A0A",
  text: "#FFFFFF",
  textMuted: "#D9D9D9",
  textSecondary: "#707070",
  accent: "#49E472",
  accentDark: "#3BC45E",
  border: "#383838",
  fontHead: "'Kanit', Arial, Helvetica, sans-serif",
  fontBody: "'Inter', Arial, Helvetica, sans-serif",
};

export function escapeHtml(s: string): string {
  return s
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
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${escapeHtml(args.subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@400;600;700;800&family=Inter:wght@400;600&display=swap" rel="stylesheet" />
<style>
  body { margin:0; padding:0; background:${TOKENS.bg}; }
  table { border-collapse:collapse; }
  img { border:0; outline:none; text-decoration:none; display:block; }
  a { color:${TOKENS.accent}; }
  @media (max-width: 599px) {
    .h1 { font-size: 28px !important; }
    .lead { font-size: 16px !important; }
    .container { width: 100% !important; }
    .pad { padding: 16px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${TOKENS.bg};">
<div style="display:none;max-height:0;overflow:hidden;color:${TOKENS.bg};">${escapeHtml(args.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${TOKENS.bg};">
  <tr><td align="center">
  <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:${TOKENS.bg};">`;
}

export function htmlClose(): string {
  return `</table></td></tr></table></body></html>`;
}

export function header(): string {
  return `
<tr><td align="center" class="pad" style="padding:32px 24px 16px;">
  <span style="display:inline-block;font-family:${TOKENS.fontHead};font-weight:800;font-size:28px;letter-spacing:0.05em;color:${TOKENS.text};">BULKING</span>
</td></tr>`;
}

export function hero(args: { image_url: string; alt: string; badge?: string }): string {
  const badge = args.badge
    ? `<div style="position:relative;"><span style="position:absolute;top:16px;left:16px;background:${TOKENS.accent};color:${TOKENS.bg};font-family:${TOKENS.fontHead};font-weight:700;font-size:12px;letter-spacing:0.1em;padding:6px 12px;text-transform:uppercase;">${escapeHtml(args.badge)}</span></div>`
    : "";
  return `
<tr><td style="padding:0;">
  ${badge}
  <img src="${args.image_url}" alt="${escapeHtml(args.alt)}" width="600" height="800" style="width:100%;max-width:600px;height:auto;display:block;object-fit:cover;" />
</td></tr>`;
}

export function headlineBlock(text: string): string {
  return `
<tr><td class="pad" style="padding:32px 24px 8px;">
  <h1 class="h1" style="margin:0;font-family:${TOKENS.fontHead};font-weight:800;font-size:32px;line-height:1.2;color:${TOKENS.text};letter-spacing:-0.01em;">${escapeHtml(text)}</h1>
</td></tr>`;
}

export function leadBlock(text: string): string {
  return `
<tr><td class="pad" style="padding:8px 24px 24px;">
  <p class="lead" style="margin:0;font-family:${TOKENS.fontBody};font-weight:400;font-size:16px;line-height:1.5;color:${TOKENS.textMuted};">${escapeHtml(text)}</p>
</td></tr>`;
}

export function ctaBlock(args: { text: string; url: string }): string {
  return `
<tr><td class="pad" align="left" style="padding:8px 24px 32px;">
  <a href="${args.url}" target="_blank" style="display:inline-block;background:${TOKENS.accent};color:${TOKENS.bg};font-family:${TOKENS.fontHead};font-weight:600;font-size:14px;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:16px 32px;">${escapeHtml(args.text)}</a>
</td></tr>`;
}

export function productMetaBlock(args: { name: string; price: number; old_price?: number }): string {
  const oldPrice = args.old_price
    ? `<span style="font-family:${TOKENS.fontBody};font-weight:400;font-size:14px;color:${TOKENS.textSecondary};text-decoration:line-through;margin-right:8px;">R$ ${args.old_price.toFixed(2)}</span>`
    : "";
  return `
<tr><td class="pad" style="padding:8px 24px 24px;">
  <div style="font-family:${TOKENS.fontHead};font-weight:600;font-size:18px;color:${TOKENS.text};margin-bottom:4px;">${escapeHtml(args.name)}</div>
  <div>${oldPrice}<span style="font-family:${TOKENS.fontHead};font-weight:700;font-size:20px;color:${TOKENS.accent};">R$ ${args.price.toFixed(2)}</span></div>
</td></tr>`;
}

export function couponBlock(args: {
  code: string;
  discount_percent: number;
  product_name: string;
  countdown_url: string;
}): string {
  return `
<tr><td class="pad" style="padding:8px 24px 24px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid ${TOKENS.accent};background:${TOKENS.bgSurface};">
    <tr><td align="center" style="padding:20px 16px;">
      <div style="font-family:${TOKENS.fontHead};font-weight:600;font-size:11px;letter-spacing:0.2em;color:${TOKENS.textSecondary};text-transform:uppercase;margin-bottom:8px;">Cupom Exclusivo</div>
      <div style="font-family:'Courier New', monospace;font-size:22px;letter-spacing:0.1em;color:${TOKENS.text};background:${TOKENS.bg};padding:12px 20px;display:inline-block;border:1px dashed ${TOKENS.border};">${escapeHtml(args.code)}</div>
      <div style="font-family:${TOKENS.fontBody};font-size:14px;color:${TOKENS.textMuted};margin-top:12px;">${args.discount_percent}% off em ${escapeHtml(args.product_name)}</div>
    </td></tr>
  </table>
</td></tr>
<tr><td class="pad" align="center" style="padding:0 24px 24px;">
  <div style="font-family:${TOKENS.fontHead};font-weight:600;font-size:10px;letter-spacing:0.2em;color:${TOKENS.textSecondary};text-transform:uppercase;margin-bottom:8px;">Termina em</div>
  <img src="${args.countdown_url}" alt="Cronômetro" width="600" height="120" style="width:100%;max-width:600px;height:auto;display:block;" />
</td></tr>`;
}

export function footer(): string {
  return `
<tr><td class="pad" style="padding:32px 24px;border-top:1px solid ${TOKENS.border};">
  <div style="font-family:${TOKENS.fontHead};font-weight:700;font-size:14px;letter-spacing:0.1em;color:${TOKENS.accent};text-transform:uppercase;margin-bottom:12px;">Respect the Hustle.</div>
  <div style="font-family:${TOKENS.fontBody};font-size:12px;color:${TOKENS.textSecondary};line-height:1.6;">
    Bulking · <a href="https://www.bulking.com.br" style="color:${TOKENS.textSecondary};text-decoration:underline;">bulking.com.br</a>
    <br />
    Você está recebendo este email porque é cliente Bulking. <a href="{{UNSUBSCRIBE_URL}}" style="color:${TOKENS.textSecondary};text-decoration:underline;">Descadastrar</a>.
  </div>
</td></tr>`;
}

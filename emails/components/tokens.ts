// emails/components/tokens.ts
//
// Aesthetic tokens shared across react-email templates. Mirrors
// src/lib/email-templates/templates/shared.ts so the previewable templates and
// the production HTML renderer stay aligned.

export const TOKENS = {
  bg: "#FFFFFF",
  bgAlt: "#F7F7F7",
  text: "#000000",
  textMuted: "#3A3A3A",
  textSecondary: "#6E6E6E",
  textFaint: "#A8A8A8",
  border: "#E6E6E6",
  fontHead:
    "'Kanit', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  fontBody:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  fontMono: "'JetBrains Mono', 'Courier New', Consolas, monospace",
} as const;

export const DARK = {
  bg: "#000000",
  fg: "#FFFFFF",
  muted: "#A8A8A8",
  faint: "#6E6E6E",
  border: "#1F1F1F",
  surfaceAlt: "#0E0E0E",
} as const;

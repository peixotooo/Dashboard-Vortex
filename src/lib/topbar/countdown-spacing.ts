const COUNTDOWN_SPACING_SEPARATOR = "__vtx_countdown_margin_v1__";

function cleanCssValue(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}

export function packCountdownSpacing(
  padding: unknown,
  margin: unknown,
  fallbackPadding = "3px 10px"
): string {
  const cleanPadding = cleanCssValue(padding) || fallbackPadding;
  const cleanMargin = cleanCssValue(margin);

  if (!cleanMargin || cleanMargin === "0") return cleanPadding;
  return `${cleanPadding}${COUNTDOWN_SPACING_SEPARATOR}${cleanMargin}`;
}

export function unpackCountdownSpacing(
  value: unknown,
  fallbackPadding = "3px 10px",
  fallbackMargin = "0"
): { padding: string; margin: string } {
  const raw = cleanCssValue(value);
  if (!raw) return { padding: fallbackPadding, margin: fallbackMargin };

  const [padding, margin] = raw.split(COUNTDOWN_SPACING_SEPARATOR);
  return {
    padding: cleanCssValue(padding) || fallbackPadding,
    margin: cleanCssValue(margin) || fallbackMargin,
  };
}

export function unpackOptionalCountdownSpacing(value: unknown): {
  padding: string | null;
  margin: string | null;
} {
  if (typeof value !== "string" || !value.trim()) {
    return { padding: null, margin: null };
  }

  const spacing = unpackCountdownSpacing(value, "", "0");
  return {
    padding: spacing.padding || null,
    margin: spacing.margin && spacing.margin !== "0" ? spacing.margin : null,
  };
}

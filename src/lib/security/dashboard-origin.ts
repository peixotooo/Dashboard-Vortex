const DEFAULT_DASHBOARD_ORIGIN = "https://dash.bulking.com.br";

function normalizeDashboardOrigin(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    const parsed = new URL(value);
    const localDevelopment =
      process.env.NODE_ENV !== "production" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
    if (
      (parsed.protocol !== "https:" && !localDevelopment) ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function getDashboardOrigin(requestOrigin?: string): string {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
    ...(process.env.DASHBOARD_ALLOWED_ORIGINS || "").split(","),
    process.env.NODE_ENV !== "production" ? requestOrigin : null,
    DEFAULT_DASHBOARD_ORIGIN,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeDashboardOrigin(candidate?.trim());
    if (normalized) return normalized;
  }

  return DEFAULT_DASHBOARD_ORIGIN;
}

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { normalizePublicBrowserUrl } from "@/lib/security/external-url";
import { sanitizeStorefrontRichHtml } from "@/lib/security/storefront-rich-html";
import { readLimitedJson } from "@/lib/security/webhook-request";

const MAX_BODY_BYTES = 64 * 1024;
const SAFE_COLOR_RE = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?(?:[0-9a-f]{2})?$/i;
const SAFE_SELECTOR_PART =
  "(?:#[A-Za-z][\\w-]*|\\.[A-Za-z][\\w-]*|\\[data-[a-z0-9_-]+(?:=(?:\"[^\"]{1,80}\"|'[^']{1,80}'|[A-Za-z0-9_-]+))?\\])";
const SAFE_SELECTOR_RE = new RegExp(
  `^${SAFE_SELECTOR_PART}(?:\\s+${SAFE_SELECTOR_PART}){0,3}$`,
  "i"
);
const VALID_PAGES = new Set(["all", "home", "product", "category", "cart"]);

function text(value: unknown, fallback: string, max = 500): string {
  if (typeof value !== "string") return fallback;
  const clean = value.trim().slice(0, max);
  return clean || fallback;
}

function color(value: unknown, fallback: string): string {
  return typeof value === "string" && SAFE_COLOR_RE.test(value.trim())
    ? value.trim()
    : fallback;
}

function numberInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(min, Math.min(max, number))
    : fallback;
}

function pixelSize(
  value: unknown,
  fallback: string,
  min: number,
  max: number
): string {
  if (typeof value !== "string") return fallback;
  const match = /^(\d{1,3}(?:\.\d+)?)px$/i.exec(value.trim());
  if (!match) return fallback;
  return `${numberInRange(match[1], Number.parseFloat(fallback), min, max)}px`;
}

function selector(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean.length <= 180 && SAFE_SELECTOR_RE.test(clean) ? clean : null;
}

function optionalDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function icon(value: unknown): string {
  const browserUrl = normalizePublicBrowserUrl(value);
  if (browserUrl) return browserUrl;
  return text(value, "gift", 40);
}

function sanitizeSteps(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((raw) => {
    const step =
      raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    return {
      label: text(step.label, "Benefício", 120),
      icon: icon(step.icon),
      threshold: numberInRange(step.threshold, 0, 0, 10_000_000),
      modal_title: text(step.modal_title, "", 160) || null,
      modal_body: sanitizeStorefrontRichHtml(step.modal_body) || null,
    };
  });
}

function sanitizeBenefits(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((raw) => {
    const benefit =
      raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    return {
      enabled: benefit.enabled !== false,
      icon: icon(benefit.icon),
      title: text(benefit.title, "Benefício", 160),
      link_label: text(benefit.link_label, "", 160) || null,
      modal_title: text(benefit.modal_title, "", 160) || null,
      modal_body: sanitizeStorefrontRichHtml(benefit.modal_body) || null,
      starts_at: optionalDate(benefit.starts_at),
      ends_at: optionalDate(benefit.ends_at),
    };
  });
}

function sanitizeConfig(body: Record<string, unknown>) {
  const showOnPages = Array.isArray(body.show_on_pages)
    ? body.show_on_pages
        .filter(
          (page): page is string =>
            typeof page === "string" && VALID_PAGES.has(page)
        )
        .slice(0, VALID_PAGES.size)
    : [];

  return {
    enabled: body.enabled === true,
    threshold: numberInRange(body.threshold, 299, 0, 10_000_000),
    gift_name: text(body.gift_name, "brinde exclusivo", 160),
    gift_description: text(body.gift_description, "", 1000) || null,
    gift_image_url: normalizePublicBrowserUrl(body.gift_image_url),
    message_progress: text(
      body.message_progress,
      "Faltam R$ {remaining} para ganhar {gift}!",
      500
    ),
    message_achieved: text(
      body.message_achieved,
      "Parabéns! Você ganhou {gift}!",
      500
    ),
    message_empty: text(
      body.message_empty,
      "Adicione R$ {threshold} em produtos e ganhe {gift}!",
      500
    ),
    bar_color: color(body.bar_color, "#10b981"),
    bar_bg_color: color(body.bar_bg_color, "#e5e7eb"),
    text_color: color(body.text_color, "#1f2937"),
    bg_color: color(body.bg_color, "#ffffff"),
    achieved_bg_color: color(body.achieved_bg_color, "#ecfdf5"),
    achieved_text_color: color(body.achieved_text_color, "#065f46"),
    font_size: pixelSize(body.font_size, "14px", 8, 32),
    bar_height: pixelSize(body.bar_height, "8px", 2, 32),
    position: body.position === "bottom" ? "bottom" : "top",
    show_on_pages: showOnPages.length > 0 ? showOnPages : ["all"],
    steps: sanitizeSteps(body.steps),
    message_next_step: text(
      body.message_next_step,
      "Faltam R$ {gap} para o proximo {next_label}!",
      500
    ),
    message_all_achieved: text(
      body.message_all_achieved,
      "Voce desbloqueou todos os mimos!",
      500
    ),
    show_product_benefits: body.show_product_benefits === true,
    product_benefits: sanitizeBenefits(body.product_benefits),
    product_benefits_title: text(
      body.product_benefits_title,
      "Nossos benefícios",
      160
    ),
    product_benefits_anchor: selector(body.product_benefits_anchor),
    pdp_inline: body.pdp_inline === true,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const admin = createAdminClient();

    const { data: config, error } = await admin
      .from("gift_bar_configs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      config: config
        ? {
            ...config,
            ...sanitizeConfig(config as Record<string, unknown>),
          }
        : null,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const parsed = await readLimitedJson(request, MAX_BODY_BYTES);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.error },
        { status: parsed.status }
      );
    }
    const body =
      parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
        ? (parsed.value as Record<string, unknown>)
        : {};
    const clean = sanitizeConfig(body);

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("gift_bar_configs")
      .upsert(
        {
          workspace_id: workspaceId,
          ...clean,
        },
        { onConflict: "workspace_id" }
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ config: data });
  } catch (error) {
    return handleAuthError(error);
  }
}

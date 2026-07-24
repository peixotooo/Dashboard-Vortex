// src/app/api/crm/email-templates/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  getWorkspaceAdminContext,
  getWorkspaceContext,
  handleAuthError,
} from "@/lib/api-auth";
import { getSettings, upsertSettings } from "@/lib/email-templates/settings";
import type { EmailTemplateSettings } from "@/lib/email-templates/types";
import { readLimitedJson } from "@/lib/security/webhook-request";

export async function GET(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const settings = await getSettings(workspaceId);
    return NextResponse.json(settings);
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceAdminContext(req);
    const parsed = await readLimitedJson(req, 32 * 1024);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
      return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    }
    const body = parsed.value as Partial<EmailTemplateSettings>;
    const allowed = {
      enabled: body.enabled,
      bestseller_lookback_days: body.bestseller_lookback_days,
      slowmoving_lookback_days: body.slowmoving_lookback_days,
      newarrival_lookback_days: body.newarrival_lookback_days,
      min_stock_bestseller: body.min_stock_bestseller,
      slowmoving_max_sales: body.slowmoving_max_sales,
      slowmoving_discount_percent: body.slowmoving_discount_percent,
      slowmoving_coupon_validity_hours: body.slowmoving_coupon_validity_hours,
      copy_provider: body.copy_provider,
      llm_agent_slug: body.llm_agent_slug,
      attribute1_label: body.attribute1_label,
      attribute2_label: body.attribute2_label,
      category_penalty_weight: body.category_penalty_weight,
      exploration_rate: body.exploration_rate,
      auto_relax_threshold: body.auto_relax_threshold,
      momentum_window_hours: body.momentum_window_hours,
      bestseller_revenue_weight: body.bestseller_revenue_weight,
      crm_validation_enabled: body.crm_validation_enabled,
    };
    const sanitized = Object.fromEntries(
      Object.entries(allowed).filter(([, value]) => value !== undefined)
    );
    try {
      const updated = await upsertSettings({
        ...sanitized,
        workspace_id: workspaceId,
      });
      return NextResponse.json(updated);
    } catch (err) {
      return NextResponse.json(
        { error: String((err as Error).message) },
        { status: 400 }
      );
    }
  } catch (err) {
    return handleAuthError(err);
  }
}

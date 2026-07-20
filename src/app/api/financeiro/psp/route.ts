import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/pricing/supabase";
import { fetchRecentCrmSalesWithItems } from "@/lib/pricing/crm-sales";
import { buildPspPlan } from "@/lib/psp/engine";
import { parsePspSettings, PSP_DEFAULT_SETTINGS, PSP_FAMILIES } from "@/lib/psp/defaults";
import { isMissingPspSchema } from "@/lib/psp/inventory";
import type {
  PspCatalogRow,
  PspCostRow,
  PspHubRow,
  PspInventoryRow,
  PspLaunchRow,
  PspProductSetting,
  PspSaleRow,
} from "@/lib/psp/types";

export const maxDuration = 60;

const PAGE_SIZE = 1000;

async function fetchPaged<T>(
  load: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await load(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function loadNewTables(client: SupabaseClient, workspaceId: string) {
  let migrationReady = true;
  let rawSettings: Record<string, unknown> | null = null;
  let productSettings: PspProductSetting[] = [];
  let inventory: PspInventoryRow[] = [];

  const settingsResult = await client
    .from("psp_settings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (settingsResult.error) {
    if (!isMissingPspSchema(settingsResult.error)) throw new Error(settingsResult.error.message);
    migrationReady = false;
  } else {
    rawSettings = settingsResult.data as Record<string, unknown> | null;
  }

  if (migrationReady) {
    const [productResult, inventoryResult] = await Promise.all([
      client
        .from("psp_product_settings")
        .select("sku, family, color, units_per_roll, lead_time_days, base_sku, made_to_order_override, active, notes")
        .eq("workspace_id", workspaceId),
      fetchPaged<PspInventoryRow>((from, to) =>
        client
          .from("psp_inventory_snapshots")
          .select("sku, parent_sku, product_id, name, stock_real, stock_available, captured_at")
          .eq("workspace_id", workspaceId)
          .range(from, to) as unknown as PromiseLike<{
            data: PspInventoryRow[] | null;
            error: { message: string } | null;
          }>
      ),
    ]);
    if (productResult.error) throw new Error(productResult.error.message);
    productSettings = (productResult.data ?? []) as PspProductSetting[];
    inventory = inventoryResult;
  }

  return {
    migrationReady,
    settings: rawSettings ? parsePspSettings(rawSettings) : PSP_DEFAULT_SETTINGS,
    productSettings,
    inventory,
  };
}

async function loadCoreData(client: SupabaseClient, workspaceId: string) {
  const [sales, hub, catalog, costs, launches, financial] = await Promise.all([
    fetchRecentCrmSalesWithItems(client, workspaceId, 31) as Promise<PspSaleRow[]>,
    fetchPaged<PspHubRow>((from, to) =>
      client
        .from("hub_products")
        .select("sku, ecc_id, ecc_pai_sku, nome, estoque, sob_demanda, atributos, preco, preco_promocional, last_ecc_sync")
        .eq("workspace_id", workspaceId)
        .range(from, to) as unknown as PromiseLike<{
          data: PspHubRow[] | null;
          error: { message: string } | null;
        }>
    ),
    fetchPaged<PspCatalogRow>((from, to) =>
      client
        .from("shelf_products")
        .select("sku, name, category, price, sale_price, active")
        .eq("workspace_id", workspaceId)
        .eq("active", true)
        .range(from, to) as unknown as PromiseLike<{
          data: PspCatalogRow[] | null;
          error: { message: string } | null;
        }>
    ),
    fetchPaged<PspCostRow>((from, to) =>
      client
        .from("product_costs")
        .select("sku, cost")
        .eq("workspace_id", workspaceId)
        .range(from, to) as unknown as PromiseLike<{
          data: PspCostRow[] | null;
          error: { message: string } | null;
        }>
    ),
    client
      .from("sku_launch_dates")
      .select("sku, launch_date, collection")
      .eq("workspace_id", workspaceId),
    client
      .from("workspace_financial_settings")
      .select("product_cost_pct, tax_pct, other_expenses_pct")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
  ]);

  if (launches.error) throw new Error(launches.error.message);
  if (financial.error) throw new Error(financial.error.message);
  return {
    sales,
    hub,
    catalog,
    costs,
    launches: (launches.data ?? []) as PspLaunchRow[],
    financial: {
      product_cost_pct: Number(financial.data?.product_cost_pct ?? 25),
      tax_pct: Number(financial.data?.tax_pct ?? 6),
      other_expenses_pct: Number(financial.data?.other_expenses_pct ?? 5),
    },
  };
}

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const admin = createAdminClient();
    const [configuration, core] = await Promise.all([
      loadNewTables(admin, workspaceId),
      loadCoreData(admin, workspaceId),
    ]);
    const plan = buildPspPlan({
      settings: configuration.settings,
      productSettings: configuration.productSettings,
      inventory: configuration.inventory,
      ...core,
    });
    return NextResponse.json(
      {
        ...plan,
        setup: {
          migration_ready: configuration.migrationReady,
          inventory_refresh_available: configuration.migrationReady,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return handleAuthError(error);
  }
}

function nullableText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (body.type === "settings") {
      const settings = parsePspSettings((body.settings ?? {}) as Record<string, unknown>);
      const { data, error } = await auth.supabase
        .from("psp_settings")
        .upsert(
          {
            workspace_id: auth.workspaceId,
            ...settings,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "workspace_id" }
        )
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ settings: parsePspSettings(data) });
    }

    if (body.type === "product") {
      const sku = nullableText(body.sku)?.toLowerCase();
      if (!sku) return NextResponse.json({ error: "SKU obrigatório" }, { status: 400 });
      const family = nullableText(body.family)?.toLowerCase() ?? null;
      if (family && !PSP_FAMILIES.includes(family as (typeof PSP_FAMILIES)[number])) {
        return NextResponse.json({ error: "Família inválida" }, { status: 400 });
      }
      const unitsPerRoll = nullableNumber(body.units_per_roll);
      const leadTimeDays = nullableNumber(body.lead_time_days);
      const madeToOrderOverride =
        typeof body.made_to_order_override === "boolean"
          ? body.made_to_order_override
          : null;
      if (madeToOrderOverride === true && family && family !== "camiseta" && family !== "regata") {
        return NextResponse.json(
          { error: "Somente camisetas e regatas podem ser marcadas como sob demanda" },
          { status: 400 }
        );
      }
      const { data, error } = await auth.supabase
        .from("psp_product_settings")
        .upsert(
          {
            workspace_id: auth.workspaceId,
            sku,
            family,
            color: nullableText(body.color)?.toLowerCase() ?? null,
            units_per_roll:
              unitsPerRoll == null ? null : Math.max(1, Math.round(unitsPerRoll)),
            lead_time_days:
              leadTimeDays == null ? null : Math.max(1, Math.round(leadTimeDays)),
            base_sku: nullableText(body.base_sku),
            made_to_order_override: madeToOrderOverride,
            active: body.active !== false,
            notes: nullableText(body.notes),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "workspace_id,sku" }
        )
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ product: data });
    }

    if (body.type === "base_group") {
      const skus = Array.isArray(body.skus)
        ? [...new Set(body.skus.map((value) => nullableText(value)?.toLowerCase()).filter(Boolean))]
        : [];
      if (skus.length === 0 || skus.length > 200) {
        return NextResponse.json({ error: "Produtos da base inválidos" }, { status: 400 });
      }
      const family = nullableText(body.family)?.toLowerCase() ?? null;
      if (family && !PSP_FAMILIES.includes(family as (typeof PSP_FAMILIES)[number])) {
        return NextResponse.json({ error: "Família inválida" }, { status: 400 });
      }
      const unitsPerRoll = nullableNumber(body.units_per_roll);
      const now = new Date().toISOString();
      const rows = skus.map((sku) => ({
        workspace_id: auth.workspaceId,
        sku,
        family,
        color: nullableText(body.color)?.toLowerCase() ?? null,
        units_per_roll:
          unitsPerRoll == null ? null : Math.max(1, Math.round(unitsPerRoll)),
        base_sku: nullableText(body.base_sku),
        active: true,
        updated_at: now,
      }));
      const { data, error } = await auth.supabase
        .from("psp_product_settings")
        .upsert(rows, { onConflict: "workspace_id,sku" })
        .select();
      if (error) throw error;
      return NextResponse.json({ products: data });
    }

    return NextResponse.json({ error: "Tipo de configuração inválido" }, { status: 400 });
  } catch (error) {
    if (isMissingPspSchema(error)) {
      return NextResponse.json(
        { error: "Rode a migration 142 antes de salvar as configurações." },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao salvar" },
      { status: 500 }
    );
  }
}

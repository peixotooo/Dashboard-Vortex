import { NextRequest, NextResponse } from "next/server";
import { getVndaConfig, getVndaProductReport, getVndaStockReport } from "@/lib/vnda-api";
import { getGA4Report } from "@/lib/ga4-api";
import { getPreviousPeriodDates } from "@/lib/utils";
import { generateIntelligenceReport } from "@/lib/products-intelligence";
import type { DatePreset } from "@/lib/types";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const datePreset = (searchParams.get("date_preset") || "last_30d") as DatePreset;
    const includeComparison = searchParams.get("include_comparison") === "true";
    const limit = parseInt(searchParams.get("limit") || "100", 10);
    const workspaceId = request.headers.get("x-workspace-id") || "";

    // Check configurations
    const vndaConfig = await getVndaConfig(workspaceId);
    const ga4Configured = !!process.env.GA4_PROPERTY_ID;

    if (!vndaConfig && !ga4Configured) {
      return NextResponse.json({
        products: [],
        summary: {
          totalProducts: 0,
          totalRevenue: 0,
          avgConversionRate: 0,
          productsNeedingAttention: 0,
          classificationCounts: { estrela: 0, oportunidade: 0, cash_cow: 0, alerta: 0 },
          recommendationCounts: { aumentar_preco: 0, manter_preco: 0, reduzir_preco: 0, promocionar: 0, sem_estoque: 0 },
        },
        vndaConfigured: false,
        ga4Configured: false,
      });
    }

    // Fetch all sources in parallel (stock is best-effort — failures don't break the page)
    const [vndaProducts, ga4Result, stockData] = await Promise.all([
      vndaConfig
        ? getVndaProductReport({ config: vndaConfig, datePreset, limit })
        : Promise.resolve([]),
      ga4Configured
        ? getGA4Report({
            datePreset,
            dimensions: ["itemName"],
            metrics: ["itemsPurchased", "itemRevenue", "itemsViewed", "itemsAddedToCart"],
            limit,
            orderBy: { metric: "itemRevenue", desc: true },
          })
        : Promise.resolve({ rows: [] }),
      vndaConfig
        ? getVndaStockReport(vndaConfig).catch((err) => {
            console.error("[Products Intelligence] Stock fetch failed (non-fatal):", err instanceof Error ? err.message : err);
            return [] as Awaited<ReturnType<typeof getVndaStockReport>>;
          })
        : Promise.resolve([]),
    ]);

    // Optionally fetch previous period for comparison
    let prevVndaProducts;
    let prevGA4Result;
    if (includeComparison && datePreset !== "today" && datePreset !== "yesterday") {
      const prev = getPreviousPeriodDates(datePreset);
      [prevVndaProducts, prevGA4Result] = await Promise.all([
        vndaConfig
          ? getVndaProductReport({
              config: vndaConfig,
              startDate: prev.since,
              endDate: prev.until,
              limit,
            })
          : Promise.resolve([]),
        ga4Configured
          ? getGA4Report({
              startDate: prev.since,
              endDate: prev.until,
              dimensions: ["itemName"],
              metrics: ["itemsPurchased", "itemRevenue", "itemsViewed", "itemsAddedToCart"],
              limit,
            })
          : Promise.resolve({ rows: [] }),
      ]);
    }

    const report = generateIntelligenceReport({
      vndaProducts,
      ga4Products: ga4Result.rows,
      prevVndaProducts,
      prevGA4Products: prevGA4Result?.rows,
      stockData,
    });

    return NextResponse.json({
      ...report,
      vndaConfigured: !!vndaConfig,
      ga4Configured,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Products Intelligence] Error:", message);
    return NextResponse.json({
      products: [],
      summary: {
        totalProducts: 0,
        totalRevenue: 0,
        avgConversionRate: 0,
        productsNeedingAttention: 0,
        classificationCounts: { estrela: 0, oportunidade: 0, cash_cow: 0, alerta: 0 },
        recommendationCounts: { aumentar_preco: 0, manter_preco: 0, reduzir_preco: 0, promocionar: 0, sem_estoque: 0 },
      },
      vndaConfigured: false,
      ga4Configured: false,
      error: message,
    });
  }
}

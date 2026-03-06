import { NextRequest, NextResponse } from "next/server";
import { getVndaConfig, getVndaProductReport } from "@/lib/vnda-api";
import type { DatePreset } from "@/lib/types";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const datePreset = (searchParams.get("date_preset") || "last_30d") as DatePreset;
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const workspaceId = request.headers.get("x-workspace-id") || "";

    const config = await getVndaConfig(workspaceId);
    if (!config) {
      return NextResponse.json({ products: [], configured: false });
    }

    const products = await getVndaProductReport({ config, datePreset, limit });

    return NextResponse.json({ products, configured: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[VNDA Products] Error:", message);
    return NextResponse.json({ products: [], configured: false, error: message });
  }
}

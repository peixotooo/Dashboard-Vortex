import { NextRequest, NextResponse } from "next/server";
import { getInsights, comparePerformance } from "@/lib/meta-api";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const object_id = searchParams.get("object_id") || "";
    const level = searchParams.get("level") || "account";
    const date_preset = searchParams.get("date_preset") || "last_30d";
    const breakdowns = searchParams.get("breakdowns") || "";
    const fields = searchParams.get("fields") || "";

    const result = await getInsights({
      object_id,
      level,
      date_preset,
      breakdowns: breakdowns ? breakdowns.split(",") : undefined,
      fields: fields ? fields.split(",") : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message, insights: [] }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, ...args } = body;

    let result;
    if (action === "compare") {
      result = await comparePerformance(args);
    } else {
      result = await getInsights(args);
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

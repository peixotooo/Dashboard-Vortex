import { NextRequest, NextResponse } from "next/server";
import {
  listCampaigns,
  createCampaign,
  pauseCampaign,
  resumeCampaign,
  deleteCampaign,
  updateCampaign,
} from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  try {
    await getAuthenticatedContext(request).catch(() => {});

    const { searchParams } = new URL(request.url);
    const account_id = searchParams.get("account_id") || "";
    const status = searchParams.get("status") || "";
    const limit = parseInt(searchParams.get("limit") || "25");

    const result = await listCampaigns({ account_id, status_filter: status, limit });
    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await getAuthenticatedContext(request).catch(() => {});

    const body = await request.json();
    const { action, ...args } = body;

    let result;
    switch (action) {
      case "pause":
        result = await pauseCampaign(args);
        break;
      case "resume":
        result = await resumeCampaign(args);
        break;
      case "delete":
        result = await deleteCampaign(args);
        break;
      case "update":
        result = await updateCampaign(args);
        break;
      default:
        result = await createCampaign(args);
    }

    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}

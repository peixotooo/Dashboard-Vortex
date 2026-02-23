import { NextResponse } from "next/server";
import { getAdAccounts } from "@/lib/meta-api";

export async function GET() {
  try {
    const result = await getAdAccounts();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message, accounts: [] }, { status: 500 });
  }
}

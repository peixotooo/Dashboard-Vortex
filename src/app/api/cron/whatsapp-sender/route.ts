import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 10;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    processed: 0,
    skipped: true,
    message: "WhatsApp delivery is handled exclusively by the dedicated worker.",
  });
}

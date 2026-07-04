import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { filterContacts } from "@/lib/wa-compliance";

export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const { phones, cooldownDays = 7 } = await request.json();
    if (!Array.isArray(phones)) {
      return NextResponse.json({ error: "Missing phones array" }, { status: 400 });
    }

    const contacts = phones.map((p: string) => ({ phone: p }));
    const result = await filterContacts(workspaceId, contacts, cooldownDays);

    return NextResponse.json({
      allowedCount: result.allowed.length,
      cooldownCount: result.cooldownCount,
      blockedCount: result.blockedCount,
      excludedCount: result.excludedCount,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}

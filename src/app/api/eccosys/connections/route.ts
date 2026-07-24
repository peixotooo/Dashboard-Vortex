import { NextRequest, NextResponse } from "next/server";
import { eccosys } from "@/lib/eccosys/client";
import {
  AuthError,
  getWorkspaceContext,
  handleAuthError,
} from "@/lib/api-auth";

/**
 * GET /api/eccosys/connections
 * Returns connection status based on env vars (read-only).
 * No sensitive data exposed — only boolean flags and ambiente name.
 * Token is configured directly in Vercel — never stored in the database.
 */
export async function GET(request: NextRequest) {
  try {
    await getWorkspaceContext(request);
    const config = eccosys.getConfig();

    return NextResponse.json({
      configured: !!config,
      ambiente: config?.ambiente ?? null,
    });
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError(err);
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json(
      { configured: false, ambiente: null, error: message },
      { status: 200 }
    );
  }
}

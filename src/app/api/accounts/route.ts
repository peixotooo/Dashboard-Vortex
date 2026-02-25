import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getAdAccounts } from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  try {
    const workspaceId =
      request.headers.get("x-workspace-id") ||
      request.nextUrl.searchParams.get("workspace_id") ||
      "";

    // Try to get saved accounts from Supabase first
    if (workspaceId) {
      try {
        const supabase = createServerClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            cookies: {
              getAll() {
                return request.cookies.getAll();
              },
              setAll() {},
            },
          }
        );

        const { data: savedAccounts } = await supabase
          .from("meta_accounts")
          .select("account_id, account_name, is_default")
          .eq("workspace_id", workspaceId)
          .order("account_name", { ascending: true });

        if (savedAccounts && savedAccounts.length > 0) {
          const accounts = savedAccounts.map((a) => ({
            id: a.account_id,
            name: a.account_name,
            is_default: a.is_default,
          }));
          return NextResponse.json({ accounts });
        }
      } catch {
        // Fall through to Meta API
      }
    }

    // Fallback: fetch from Meta API directly
    await getAuthenticatedContext(request).catch(() => {
      // Fallback: env token will be used
    });

    const result = await getAdAccounts();
    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}

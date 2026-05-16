// Helpers Supabase compartilhados pelo módulo de Pricing.
//
// Padrão idêntico ao usado em api/simulador-comercial/* e api/financial-settings:
//   - createSupabase(request): cliente SSR com cookies da requisição
//   - requireAdmin(): valida que o user é owner/admin do workspace antes de mutar

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export function createSupabase(request: NextRequest): SupabaseClient {
  return createServerClient(
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
}

export type AuthContext = {
  supabase: SupabaseClient;
  userId: string;
  workspaceId: string;
};

// Valida user autenticado + workspace no header. Retorna erro NextResponse
// quando inválido (404/401/403). Caller deve checar com instanceof.
export async function requireAuth(
  request: NextRequest
): Promise<AuthContext | NextResponse> {
  const supabase = createSupabase(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId) {
    return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });
  }
  return { supabase, userId: user.id, workspaceId };
}

// Valida que o user é owner/admin do workspace. Retorna erro 403 caso contrário.
export async function requireAdmin(
  request: NextRequest
): Promise<AuthContext | NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { data: membership } = await auth.supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", auth.workspaceId)
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return auth;
}

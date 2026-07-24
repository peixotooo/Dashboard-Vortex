import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const type = searchParams.get("type");
  const requestedNext = searchParams.get("next") ?? "/";
  const next =
    requestedNext.startsWith("/") &&
    !requestedNext.startsWith("//") &&
    !requestedNext.includes("\\") &&
    requestedNext.length <= 1024
      ? requestedNext
      : "/";

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    
    if (!error) {
      if (type === "recovery") {
        return NextResponse.redirect(new URL("/reset-password", origin));
      }
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  // return the user to an error page with instructions
  const loginUrl = new URL("/login", origin);
  loginUrl.searchParams.set("error", "O link de login expirou ou é inválido.");
  return NextResponse.redirect(loginUrl);
}

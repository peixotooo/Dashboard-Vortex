import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  consumeSecurityRateLimit,
  getRequestClientIp,
} from "@/lib/security/rate-limit";
import { readLimitedJson } from "@/lib/security/webhook-request";

const TOKEN_RE = /^[a-f0-9]{64}$/i;
const MAX_BODY_BYTES = 16 * 1024;

// GET /api/invite?token=xxx — Validate invitation token
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token || !TOKEN_RE.test(token)) {
    return NextResponse.json({ valid: false, error: "Convite nao encontrado" }, { status: 404 });
  }

  const rateLimit = await consumeSecurityRateLimit({
    scope: "invite:lookup",
    key: `${token}:${getRequestClientIp(request)}`,
    limit: 60,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json({ valid: false, error: "Muitas tentativas" }, { status: 429 });
  }

  const supabase = createAdminClient();

  const { data: invitation, error } = await supabase
    .from("workspace_invitations")
    .select("id, email, status, expires_at, workspace:workspaces(name)")
    .eq("token", token)
    .single();

  if (error || !invitation) {
    return NextResponse.json({ valid: false, error: "Convite nao encontrado" }, { status: 404 });
  }

  if (invitation.status !== "pending") {
    return NextResponse.json({ valid: false, error: "Convite ja utilizado" }, { status: 400 });
  }

  if (new Date(invitation.expires_at) < new Date()) {
    return NextResponse.json({ valid: false, error: "Convite expirado" }, { status: 400 });
  }

  // Check if email already has an account
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", String(invitation.email).toLowerCase())
    .maybeSingle();
  const hasAccount = Boolean(existingProfile);

  const workspace = invitation.workspace as unknown as { name: string } | null;

  return NextResponse.json({
    valid: true,
    email: invitation.email,
    workspace_name: workspace?.name ?? "Workspace",
    has_account: hasAccount,
  });
}

// POST /api/invite — Accept invitation (create account if needed + add to workspace)
export async function POST(request: NextRequest) {
  try {
    const parsed = await readLimitedJson(request, MAX_BODY_BYTES);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body =
      parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
        ? (parsed.value as Record<string, unknown>)
        : {};
    const token = typeof body.token === "string" ? body.token : "";
    const fullName =
      typeof body.full_name === "string"
        ? body.full_name.trim().slice(0, 120)
        : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!TOKEN_RE.test(token)) {
      return NextResponse.json({ error: "Convite nao encontrado" }, { status: 404 });
    }

    const rateLimit = await consumeSecurityRateLimit({
      scope: "invite:accept",
      key: `${token}:${getRequestClientIp(request)}`,
      limit: 10,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: "Muitas tentativas" }, { status: 429 });
    }

    const supabase = createAdminClient();

    // Fetch invitation
    const { data: invitation, error: invError } = await supabase
      .from("workspace_invitations")
      .select("id, email, workspace_id, role, features, status, expires_at")
      .eq("token", token)
      .single();

    if (invError || !invitation) {
      return NextResponse.json({ error: "Convite nao encontrado" }, { status: 404 });
    }

    if (invitation.status !== "pending") {
      return NextResponse.json({ error: "Convite ja utilizado" }, { status: 400 });
    }

    if (new Date(invitation.expires_at) < new Date()) {
      return NextResponse.json({ error: "Convite expirado" }, { status: 400 });
    }

    // Check if user already exists
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", String(invitation.email).toLowerCase())
      .maybeSingle();

    let userId: string;

    if (existingProfile) {
      // User already has an account — just add to workspace
      userId = existingProfile.id;
    } else {
      // Create new user
      if (password.length < 6 || password.length > 128) {
        return NextResponse.json({ error: "Senha deve ter pelo menos 6 caracteres" }, { status: 400 });
      }

      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: invitation.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });

      if (createError || !newUser.user) {
        console.error(
          "[invite] create user failed:",
          createError?.message || "missing_user"
        );
        return NextResponse.json(
          { error: "Erro ao criar conta" },
          { status: 500 }
        );
      }

      userId = newUser.user.id;
    }

    // Add to workspace (check if not already a member)
    const { data: existingMember } = await supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", invitation.workspace_id)
      .eq("user_id", userId)
      .single();

    if (!existingMember) {
      const invitationRole = invitation.role === "admin" ? "admin" : "member";
      const { error: memberError } = await supabase
        .from("workspace_members")
        .insert({
          workspace_id: invitation.workspace_id,
          user_id: userId,
          role: invitationRole,
          features:
            invitationRole === "member" && Array.isArray(invitation.features)
              ? invitation.features
              : null,
        });

      if (memberError) {
        console.error("[invite] Error adding member:", memberError);
        return NextResponse.json({ error: "Erro ao adicionar ao workspace" }, { status: 500 });
      }
    }

    // Mark invitation as accepted
    await supabase
      .from("workspace_invitations")
      .update({ status: "accepted" })
      .eq("id", invitation.id);

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[invite] Error:", message);
    return NextResponse.json({ error: "Erro ao aceitar convite" }, { status: 500 });
  }
}

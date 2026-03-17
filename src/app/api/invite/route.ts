import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

// GET /api/invite?token=xxx — Validate invitation token
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ valid: false, error: "Token ausente" }, { status: 400 });
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
  const { data: existingUser } = await supabase.auth.admin.listUsers();
  const hasAccount = existingUser?.users?.some((u) => u.email === invitation.email) ?? false;

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
    const body = await request.json();
    const { token, full_name, password } = body;

    if (!token) {
      return NextResponse.json({ error: "Token ausente" }, { status: 400 });
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
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find((u) => u.email === invitation.email);

    let userId: string;

    if (existingUser) {
      // User already has an account — just add to workspace
      userId = existingUser.id;
    } else {
      // Create new user
      if (!password || password.length < 6) {
        return NextResponse.json({ error: "Senha deve ter pelo menos 6 caracteres" }, { status: 400 });
      }

      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: invitation.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: full_name || "" },
      });

      if (createError || !newUser.user) {
        return NextResponse.json(
          { error: createError?.message || "Erro ao criar conta" },
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
      const { error: memberError } = await supabase
        .from("workspace_members")
        .insert({
          workspace_id: invitation.workspace_id,
          user_id: userId,
          role: invitation.role,
          features: invitation.features ?? null,
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

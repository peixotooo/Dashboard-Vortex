import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isIP } from "node:net";
import { createAdminClient } from "@/lib/supabase-admin";
import { encrypt, decrypt } from "@/lib/encryption";
import { getAdAccounts, runWithToken } from "@/lib/meta-api";
import { testVndaConnection } from "@/lib/vnda-api";
import { generateWebhookToken } from "@/lib/vnda-webhook";
import {
  assertTrustedMutationOrigin,
  AuthError,
  handleAuthError,
} from "@/lib/api-auth";
import {
  consumeSecurityRateLimit,
  getRequestClientIp,
} from "@/lib/security/rate-limit";
import { readLimitedJson } from "@/lib/security/webhook-request";
import {
  addDomainToVercel,
  verifyDomainOnVercel,
  removeDomainFromVercel,
  getDomainConfig,
  isValidDomain,
} from "@/lib/vercel-domains";
import { getDashboardOrigin } from "@/lib/security/dashboard-origin";

function getSupabase(request: NextRequest) {
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

async function getWorkspaceRole(
  workspaceId: string,
  userId: string
): Promise<"owner" | "admin" | "member" | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  return (data?.role as "owner" | "admin" | "member" | undefined) || null;
}

function isAdminRole(role: string | null): boolean {
  return role === "owner" || role === "admin";
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 256 * 1024;
const ASSIGNABLE_ROLES = new Set(["member", "admin"]);

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : null;
}

function normalizeVndaStoreHost(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 255) return null;
  try {
    const raw = value.trim().toLowerCase();
    const parsed = new URL(
      raw.includes("://") ? raw : `https://${raw}`
    );
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      (parsed.pathname !== "/" && parsed.pathname !== "") ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    const hostname = parsed.hostname.toLowerCase();
    return isIP(hostname) === 0 && isValidDomain(hostname) ? hostname : null;
  } catch {
    return null;
  }
}

const ADMIN_ACTIONS = new Set([
  "invite_member",
  "cancel_invite",
  "resend_invite",
  "remove_member",
  "update_role",
  "update_workspace",
  "save_meta_connection",
  "fetch_all_meta_accounts",
  "save_selected_accounts",
  "set_default_account",
  "save_vnda_connection",
  "test_vnda_connection",
  "delete_vnda_connection",
  "regenerate_vnda_webhook_token",
  "set_custom_domain",
  "verify_domain",
  "remove_domain",
  "update_member_features",
]);

// GET — fetch workspace data (saved accounts, connection status)
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const workspaceId = request.nextUrl.searchParams.get("workspace_id");
    if (!workspaceId) {
      return NextResponse.json({ error: "workspace_id required" }, { status: 400 });
    }

    const role = await getWorkspaceRole(workspaceId, user.id);
    if (!role) {
      return NextResponse.json({ error: "Not a workspace member" }, { status: 403 });
    }

    // Get saved accounts
    const { data: accounts } = await supabase
      .from("meta_accounts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("account_name", { ascending: true });

    // Get connection status — all connections (multi-connection support)
    const { data: connections } = await supabase
      .from("meta_connections")
      .select("id, app_id, label, created_at, token_expires_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    const connection = connections?.[0] || null; // latest, kept for compat

    // Get VNDA connection status
    const { data: vndaConnection } = await supabase
      .from("vnda_connections")
      .select("id, store_host, store_name, created_at, webhook_token")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // O webhook_token é um segredo que autentica webhooks de pedido/cashback.
    // Só owner/admin podem vê-lo — membro comum recebe a conexão sem o token.
    if (vndaConnection && !isAdminRole(role)) {
      vndaConnection.webhook_token = null;
    }

    // Get workspace custom domain
    const { data: wsData } = await supabase
      .from("workspaces")
      .select("custom_domain")
      .eq("id", workspaceId)
      .single();

    return NextResponse.json({
      accounts: accounts || [],
      connection: connection || null,
      connections: connections || [],
      vndaConnection: vndaConnection || null,
      customDomain: wsData?.custom_domain || null,
    });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[workspaces]", message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST — manage workspace members, connections, accounts
export async function POST(request: NextRequest) {
  try {
    assertTrustedMutationOrigin(request);
    const supabase = getSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const parsed = await readLimitedJson(request, MAX_BODY_BYTES);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.error },
        { status: parsed.status }
      );
    }
    if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const body = parsed.value as Record<string, unknown>;
    const { action, workspace_id, ...args } = body;

    if (typeof workspace_id !== "string" || !UUID_RE.test(workspace_id)) {
      return NextResponse.json({ error: "workspace_id required" }, { status: 400 });
    }
    if (typeof action !== "string" || action.length > 80) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const role = await getWorkspaceRole(workspace_id, user.id);
    if (!role) {
      return NextResponse.json({ error: "Not a workspace member" }, { status: 403 });
    }
    const admin = createAdminClient();

    if (ADMIN_ACTIONS.has(action) && !isAdminRole(role)) {
      return NextResponse.json({ error: "Admin role required" }, { status: 403 });
    }

    const actionRateLimit = await consumeSecurityRateLimit({
      scope: "workspaces:actions",
      key: `${workspace_id}:${user.id}:${getRequestClientIp(request)}`,
      limit: 120,
    });
    if (!actionRateLimit.allowed) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    switch (action) {
      case "invite_member": {
        const email = normalizeEmail(args.email);
        const inviteRole =
          typeof args.role === "string" ? args.role : "member";
        const features = Array.isArray(args.features)
          ? args.features
              .filter(
                (feature): feature is string =>
                  typeof feature === "string" &&
                  /^[a-z0-9._-]{1,100}$/i.test(feature)
              )
              .slice(0, 100)
          : null;
        if (!email) {
          return NextResponse.json({ error: "Email inválido" }, { status: 400 });
        }
        if (!ASSIGNABLE_ROLES.has(inviteRole)) {
          return NextResponse.json({ error: "Perfil inválido" }, { status: 400 });
        }
        if (inviteRole === "admin" && role !== "owner") {
          return NextResponse.json(
            { error: "Apenas o proprietário pode convidar administradores" },
            { status: 403 }
          );
        }

        const inviteRateLimit = await consumeSecurityRateLimit({
          scope: "workspaces:invite-member",
          key: `${workspace_id}:${user.id}`,
          limit: 20,
          windowSeconds: 3600,
        });
        if (!inviteRateLimit.allowed) {
          return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
        }

        // Check if already a member
        const { data: existingProfile } = await supabase
          .from("profiles")
          .select("id")
          .eq("email", email)
          .single();

        if (existingProfile) {
          const { data: existingMember } = await supabase
            .from("workspace_members")
            .select("user_id")
            .eq("workspace_id", workspace_id)
            .eq("user_id", existingProfile.id)
            .single();

          if (existingMember) {
            return NextResponse.json(
              { error: "Este usuario ja e membro do workspace" },
              { status: 400 }
            );
          }
        }

        // Check if invitation already pending
        const { data: existingInvite } = await supabase
          .from("workspace_invitations")
          .select("id")
          .eq("workspace_id", workspace_id)
          .eq("email", email)
          .eq("status", "pending")
          .single();

        if (existingInvite) {
          return NextResponse.json(
            { error: "Convite ja enviado para este email" },
            { status: 400 }
          );
        }

        // Create invitation record (features only for member role)
        const inviteData: Record<string, unknown> = {
          workspace_id,
          email,
          role: inviteRole,
          invited_by: user.id,
        };
        if (inviteRole === "member" && features) {
          inviteData.features = features;
        }

        const { data: invitation, error: invError } = await supabase
          .from("workspace_invitations")
          .insert(inviteData)
          .select("token")
          .single();

        if (invError) throw invError;

        // Send email via Resend
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        const inviteUrl = `${getDashboardOrigin(request.nextUrl.origin)}/invite?token=${encodeURIComponent(
          invitation.token
        )}`;

        const { data: ws } = await supabase
          .from("workspaces")
          .select("name")
          .eq("id", workspace_id)
          .single();
        const workspaceName = String(ws?.name || "Dashboard Vortex")
          .replace(/[\r\n]+/g, " ")
          .slice(0, 120);
        const workspaceNameHtml = escapeHtml(workspaceName);
        const inviteUrlHtml = escapeHtml(inviteUrl);

        await resend.emails.send({
          from: `Vortex <${process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev"}>`,
          to: email,
          subject: `Convite para ${workspaceName}`,
          html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
              <h2 style="color: #111;">Voce foi convidado!</h2>
              <p style="color: #555; line-height: 1.6;">
                Voce recebeu um convite para participar do workspace
                <strong>${workspaceNameHtml}</strong>.
              </p>
              <a href="${inviteUrlHtml}"
                 style="display: inline-block; background: #111; color: #fff; padding: 12px 24px;
                        border-radius: 8px; text-decoration: none; margin: 16px 0;">
                Aceitar convite
              </a>
              <p style="color: #999; font-size: 13px; margin-top: 24px;">
                Este convite expira em 7 dias. Se voce nao solicitou este convite, ignore este email.
              </p>
            </div>
          `,
        });

        return NextResponse.json({ success: true });
      }

      case "cancel_invite": {
        const { invitation_id } = args;
        if (typeof invitation_id !== "string" || !UUID_RE.test(invitation_id)) {
          return NextResponse.json({ error: "Convite invalido" }, { status: 400 });
        }
        const { error } = await supabase
          .from("workspace_invitations")
          .delete()
          .eq("id", invitation_id)
          .eq("workspace_id", workspace_id);

        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case "resend_invite": {
        const { invitation_id } = args;
        if (typeof invitation_id !== "string" || !UUID_RE.test(invitation_id)) {
          return NextResponse.json({ error: "Convite invalido" }, { status: 400 });
        }

        const { data: inv } = await supabase
          .from("workspace_invitations")
          .select("email, token, workspace_id")
          .eq("id", invitation_id)
          .eq("workspace_id", workspace_id)
          .eq("status", "pending")
          .single();

        if (!inv) {
          return NextResponse.json({ error: "Convite nao encontrado" }, { status: 404 });
        }

        // Reset expiration
        await supabase
          .from("workspace_invitations")
          .update({ expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() })
          .eq("id", invitation_id);

        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        const inviteUrl = `${getDashboardOrigin(request.nextUrl.origin)}/invite?token=${encodeURIComponent(
          inv.token
        )}`;

        const { data: ws } = await supabase
          .from("workspaces")
          .select("name")
          .eq("id", workspace_id)
          .single();
        const workspaceName = String(ws?.name || "Dashboard Vortex")
          .replace(/[\r\n]+/g, " ")
          .slice(0, 120);
        const workspaceNameHtml = escapeHtml(workspaceName);
        const inviteUrlHtml = escapeHtml(inviteUrl);

        await resend.emails.send({
          from: `Vortex <${process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev"}>`,
          to: inv.email,
          subject: `Convite para ${workspaceName}`,
          html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
              <h2 style="color: #111;">Voce foi convidado!</h2>
              <p style="color: #555; line-height: 1.6;">
                Voce recebeu um convite para participar do workspace
                <strong>${workspaceNameHtml}</strong>.
              </p>
              <a href="${inviteUrlHtml}"
                 style="display: inline-block; background: #111; color: #fff; padding: 12px 24px;
                        border-radius: 8px; text-decoration: none; margin: 16px 0;">
                Aceitar convite
              </a>
              <p style="color: #999; font-size: 13px; margin-top: 24px;">
                Este convite expira em 7 dias.
              </p>
            </div>
          `,
        });

        return NextResponse.json({ success: true });
      }

      case "remove_member": {
        const userId = typeof args.user_id === "string" ? args.user_id : "";
        if (!UUID_RE.test(userId)) {
          return NextResponse.json({ error: "Membro inválido" }, { status: 400 });
        }
        const { data: targetMember } = await supabase
          .from("workspace_members")
          .select("role")
          .eq("workspace_id", workspace_id)
          .eq("user_id", userId)
          .maybeSingle();
        if (!targetMember) {
          return NextResponse.json({ error: "Membro não encontrado" }, { status: 404 });
        }
        if (targetMember.role === "owner") {
          return NextResponse.json(
            { error: "O proprietário do workspace não pode ser removido" },
            { status: 403 }
          );
        }
        if (role === "admin" && targetMember.role === "admin") {
          return NextResponse.json(
            { error: "Apenas o proprietário pode remover administradores" },
            { status: 403 }
          );
        }

        const { error } = await admin
          .from("workspace_members")
          .delete()
          .eq("workspace_id", workspace_id)
          .eq("user_id", userId);

        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case "update_role": {
        const userId = typeof args.user_id === "string" ? args.user_id : "";
        const newRole = typeof args.role === "string" ? args.role : "";
        if (!UUID_RE.test(userId) || !ASSIGNABLE_ROLES.has(newRole)) {
          return NextResponse.json({ error: "Membro ou perfil inválido" }, { status: 400 });
        }
        const { data: targetMember } = await supabase
          .from("workspace_members")
          .select("role")
          .eq("workspace_id", workspace_id)
          .eq("user_id", userId)
          .maybeSingle();
        if (!targetMember) {
          return NextResponse.json({ error: "Membro não encontrado" }, { status: 404 });
        }
        if (targetMember.role === "owner") {
          return NextResponse.json(
            { error: "O perfil do proprietário não pode ser alterado" },
            { status: 403 }
          );
        }
        if (
          role !== "owner" &&
          (targetMember.role === "admin" || newRole === "admin")
        ) {
          return NextResponse.json(
            { error: "Apenas o proprietário pode promover ou rebaixar administradores" },
            { status: 403 }
          );
        }

        const { error } = await admin
          .from("workspace_members")
          .update({ role: newRole })
          .eq("workspace_id", workspace_id)
          .eq("user_id", userId);

        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case "update_workspace": {
        const name =
          typeof args.name === "string" ? args.name.trim().slice(0, 120) : "";
        const slug =
          typeof args.slug === "string"
            ? args.slug.trim().toLowerCase()
            : "";
        const updates: Record<string, string> = {};
        if (name) updates.name = name;
        if (slug) {
          if (!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(slug)) {
            return NextResponse.json({ error: "Slug inválido" }, { status: 400 });
          }
          updates.slug = slug;
        }
        if (Object.keys(updates).length === 0) {
          return NextResponse.json({ error: "Nenhuma alteração válida" }, { status: 400 });
        }

        const { error } = await admin
          .from("workspaces")
          .update(updates)
          .eq("id", workspace_id);

        if (error) {
          if (error.code === "23505") {
            return NextResponse.json(
              { error: "Este slug já está em uso" },
              { status: 400 }
            );
          }
          throw error;
        }
        return NextResponse.json({ success: true });
      }

      case "save_meta_connection": {
        // Multi-connection: with connection_id -> rotate that connection's token;
        // without -> ADD a new connection (a workspace can hold several, e.g.
        // tokens from different Meta apps/Businesses).
        const access_token =
          typeof args.access_token === "string" &&
          args.access_token.length >= 20 &&
          args.access_token.length <= 8192
            ? args.access_token
            : null;
        const app_id =
          typeof args.app_id === "string" ? args.app_id.slice(0, 120) : null;
        const label =
          typeof args.label === "string" ? args.label.trim().slice(0, 120) : null;
        const connection_id =
          typeof args.connection_id === "string" && UUID_RE.test(args.connection_id)
            ? args.connection_id
            : null;
        if (!access_token) {
          return NextResponse.json({ error: "Token Meta inválido" }, { status: 400 });
        }
        const encryptedToken = encrypt(access_token);

        if (connection_id) {
          const { error } = await supabase
            .from("meta_connections")
            .update({ access_token: encryptedToken, app_id, label, user_id: user.id })
            .eq("id", connection_id)
            .eq("workspace_id", workspace_id);
          if (error) throw error;
          return NextResponse.json({ success: true, connection_id });
        }

        const { data: inserted, error } = await supabase
          .from("meta_connections")
          .insert({
            workspace_id,
            user_id: user.id,
            access_token: encryptedToken,
            app_id,
            label,
          })
          .select("id")
          .single();
        if (error) throw error;
        return NextResponse.json({ success: true, connection_id: inserted?.id });
      }

      case "fetch_all_meta_accounts": {
        // Fetch ALL accounts visible to a SPECIFIC connection's token (or the
        // latest connection when none is specified). Returned accounts are
        // tagged with their connection_id so the UI saves them correctly.
        const { connection_id } = args;
        let connQuery = supabase
          .from("meta_connections")
          .select("id, access_token")
          .eq("workspace_id", workspace_id);
        connQuery = connection_id
          ? connQuery.eq("id", connection_id)
          : connQuery.order("created_at", { ascending: false });
        const { data: connection } = await connQuery.limit(1).single();

        const usedConnectionId = connection?.id as string | undefined;

        if (!connection?.access_token) {
          return NextResponse.json(
            { error: "Nenhuma conexão Meta configurada" },
            { status: 400 }
          );
        }

        const result = await runWithToken(
          decrypt(connection.access_token),
          () => getAdAccounts()
        );
        const { accounts } = result as { accounts: Array<{ id: string; name: string }> };

        // Also get currently saved accounts to mark them
        const { data: savedAccounts } = await supabase
          .from("meta_accounts")
          .select("account_id, is_default")
          .eq("workspace_id", workspace_id);

        const savedMap = new Map(
          (savedAccounts || []).map((a: { account_id: string; is_default: boolean }) => [a.account_id, a.is_default])
        );

        const accountsWithStatus = accounts.map((acc: { id: string; name: string }) => ({
          ...acc,
          connection_id: usedConnectionId,
          selected: savedMap.has(acc.id),
          is_default: savedMap.get(acc.id) || false,
        }));

        return NextResponse.json({ accounts: accountsWithStatus });
      }

      case "save_selected_accounts": {
        // Multi-connection: the selection belongs to ONE connection. We replace
        // only THAT connection's accounts, leaving accounts from other
        // connections in the workspace untouched.
        const { accounts, connection_id } = args as {
          accounts: Array<{ id: string; name: string; is_default?: boolean }>;
          connection_id?: string;
        };

        let connId = connection_id;
        if (connId) {
          // validate the connection belongs to this workspace
          const { data: conn } = await supabase
            .from("meta_connections")
            .select("id")
            .eq("id", connId)
            .eq("workspace_id", workspace_id)
            .single();
          if (!conn) {
            return NextResponse.json({ error: "Conexão inválida" }, { status: 400 });
          }
        } else {
          // legacy single-connection path: use the latest connection
          const { data: conn } = await supabase
            .from("meta_connections")
            .select("id")
            .eq("workspace_id", workspace_id)
            .order("created_at", { ascending: false })
            .limit(1)
            .single();
          if (!conn) {
            return NextResponse.json(
              { error: "Nenhuma conexão Meta encontrada" },
              { status: 400 }
            );
          }
          connId = conn.id;
        }

        // Replace only THIS connection's accounts (preserve other connections)
        await supabase
          .from("meta_accounts")
          .delete()
          .eq("workspace_id", workspace_id)
          .eq("connection_id", connId);

        // Insert selected accounts
        if (accounts.length > 0) {
          const rows = accounts.map((acc) => ({
            workspace_id,
            connection_id: connId,
            account_id: acc.id,
            account_name: acc.name,
            is_default: acc.is_default || false,
          }));

          const { error } = await supabase
            .from("meta_accounts")
            .insert(rows);
          if (error) throw error;
        }

        return NextResponse.json({ success: true });
      }

      case "set_default_account": {
        const { account_id } = args;

        // Clear all defaults for this workspace
        await supabase
          .from("meta_accounts")
          .update({ is_default: false })
          .eq("workspace_id", workspace_id);

        // Set the new default
        const { error } = await supabase
          .from("meta_accounts")
          .update({ is_default: true })
          .eq("workspace_id", workspace_id)
          .eq("account_id", account_id);

        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case "save_vnda_connection": {
        const api_token =
          typeof args.api_token === "string" &&
          args.api_token.length >= 16 &&
          args.api_token.length <= 8192
            ? args.api_token
            : null;
        const store_host = normalizeVndaStoreHost(args.store_host);
        const store_name =
          typeof args.store_name === "string"
            ? args.store_name.trim().slice(0, 120)
            : null;
        if (!api_token || !store_host) {
          return NextResponse.json(
            { error: "Token ou domínio VNDA inválido" },
            { status: 400 }
          );
        }
        const encryptedToken = encrypt(api_token);

        // Upsert connection
        const { data: existingVnda } = await supabase
          .from("vnda_connections")
          .select("id, webhook_token")
          .eq("workspace_id", workspace_id)
          .limit(1)
          .single();

        if (existingVnda) {
          const { error } = await supabase
            .from("vnda_connections")
            .update({ api_token: encryptedToken, store_host, store_name, updated_at: new Date().toISOString() })
            .eq("id", existingVnda.id);
          if (error) throw error;

          // Generate webhook token if missing
          if (!existingVnda.webhook_token) {
            await supabase
              .from("vnda_connections")
              .update({ webhook_token: generateWebhookToken() })
              .eq("id", existingVnda.id);
          }
        } else {
          const { error } = await supabase
            .from("vnda_connections")
            .insert({
              workspace_id,
              api_token: encryptedToken,
              store_host,
              store_name,
              webhook_token: generateWebhookToken(),
            });
          if (error) throw error;
        }

        return NextResponse.json({ success: true });
      }

      case "test_vnda_connection": {
        const api_token =
          typeof args.api_token === "string" &&
          args.api_token.length >= 16 &&
          args.api_token.length <= 8192
            ? args.api_token
            : null;
        const store_host = normalizeVndaStoreHost(args.store_host);
        if (!api_token || !store_host) {
          return NextResponse.json(
            { error: "Token ou domínio VNDA inválido" },
            { status: 400 }
          );
        }
        const result = await testVndaConnection({ apiToken: api_token, storeHost: store_host });
        return NextResponse.json(result);
      }

      case "delete_vnda_connection": {
        const { error } = await supabase
          .from("vnda_connections")
          .delete()
          .eq("workspace_id", workspace_id);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case "regenerate_vnda_webhook_token": {
        const newToken = generateWebhookToken();
        const { error } = await supabase
          .from("vnda_connections")
          .update({ webhook_token: newToken, updated_at: new Date().toISOString() })
          .eq("workspace_id", workspace_id);
        if (error) throw error;
        return NextResponse.json({ success: true, webhook_token: newToken });
      }

      // --- Custom Domain ---

      case "set_custom_domain": {
        const domain =
          typeof args.domain === "string"
            ? args.domain.trim().toLowerCase()
            : "";

        if (!domain || !isValidDomain(domain)) {
          return NextResponse.json(
            { error: "Domínio inválido" },
            { status: 400 }
          );
        }

        // Check uniqueness
        const { data: existing } = await supabase
          .from("workspaces")
          .select("id")
          .eq("custom_domain", domain)
          .neq("id", workspace_id)
          .limit(1)
          .single();

        if (existing) {
          return NextResponse.json(
            { error: "Este domínio já está em uso por outro workspace" },
            { status: 400 }
          );
        }

        // Add to Vercel
        const vercelResult = await addDomainToVercel(domain);

        // Save to database
        const { error: updateError } = await admin
          .from("workspaces")
          .update({ custom_domain: domain })
          .eq("id", workspace_id);

        if (updateError) throw updateError;

        // Get DNS config
        const config = await getDomainConfig(domain);

        return NextResponse.json({
          success: true,
          domain: vercelResult.name,
          verified: vercelResult.verified,
          verification: vercelResult.verification || [],
          config,
        });
      }

      case "verify_domain": {
        const { data: ws } = await supabase
          .from("workspaces")
          .select("custom_domain")
          .eq("id", workspace_id)
          .single();

        if (!ws?.custom_domain) {
          return NextResponse.json(
            { error: "Nenhum domínio configurado" },
            { status: 400 }
          );
        }

        const result = await verifyDomainOnVercel(ws.custom_domain);
        const config = await getDomainConfig(ws.custom_domain);

        return NextResponse.json({
          success: true,
          verified: result.verified,
          verification: result.verification || [],
          config,
        });
      }

      case "remove_domain": {
        const { data: ws } = await supabase
          .from("workspaces")
          .select("custom_domain")
          .eq("id", workspace_id)
          .single();

        if (ws?.custom_domain) {
          await removeDomainFromVercel(ws.custom_domain).catch((err) => {
            console.error("[Domains] Failed to remove from Vercel:", err);
          });
        }

        const { error: updateError } = await admin
          .from("workspaces")
          .update({ custom_domain: null })
          .eq("id", workspace_id);

        if (updateError) throw updateError;

        return NextResponse.json({ success: true });
      }

      case "update_member_features": {
        const targetUserId =
          typeof args.user_id === "string" ? args.user_id : "";
        const features =
          args.features === null
            ? null
            : Array.isArray(args.features)
            ? args.features
                .filter(
                  (feature): feature is string =>
                    typeof feature === "string" &&
                    /^[a-z0-9._-]{1,100}$/i.test(feature)
                )
                .slice(0, 100)
            : undefined;
        if (!UUID_RE.test(targetUserId) || features === undefined) {
          return NextResponse.json(
            { error: "Membro ou permissoes invalidas" },
            { status: 400 }
          );
        }

        // Verify caller is admin/owner
        const { data: callerMember } = await supabase
          .from("workspace_members")
          .select("role")
          .eq("workspace_id", workspace_id)
          .eq("user_id", user.id)
          .single();

        if (!callerMember || !["owner", "admin"].includes(callerMember.role)) {
          return NextResponse.json(
            { error: "Sem permissao para alterar permissoes" },
            { status: 403 }
          );
        }

        // Cannot restrict owners or admins
        const { data: targetMember } = await supabase
          .from("workspace_members")
          .select("role")
          .eq("workspace_id", workspace_id)
          .eq("user_id", targetUserId)
          .single();

        if (!targetMember) {
          return NextResponse.json(
            { error: "Membro nao encontrado" },
            { status: 404 }
          );
        }

        if (targetMember.role !== "member") {
          return NextResponse.json(
            { error: "Apenas membros podem ter permissoes restritas" },
            { status: 400 }
          );
        }

        const { error: updateFeaturesError } = await admin
          .from("workspace_members")
          .update({ features })
          .eq("workspace_id", workspace_id)
          .eq("user_id", targetUserId);

        if (updateFeaturesError) throw updateFeaturesError;
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[workspaces]", message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

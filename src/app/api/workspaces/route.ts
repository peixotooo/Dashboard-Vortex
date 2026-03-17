import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { encrypt, decrypt } from "@/lib/encryption";
import { getAdAccounts, setContextToken } from "@/lib/meta-api";
import { testVndaConnection } from "@/lib/vnda-api";
import { generateWebhookToken } from "@/lib/vnda-webhook";
import {
  addDomainToVercel,
  verifyDomainOnVercel,
  removeDomainFromVercel,
  getDomainConfig,
  isValidDomain,
} from "@/lib/vercel-domains";

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

    // Get saved accounts
    const { data: accounts } = await supabase
      .from("meta_accounts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("account_name", { ascending: true });

    // Get connection status
    const { data: connection } = await supabase
      .from("meta_connections")
      .select("id, app_id, created_at, token_expires_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Get VNDA connection status
    const { data: vndaConnection } = await supabase
      .from("vnda_connections")
      .select("id, store_host, store_name, created_at, webhook_token")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Auto-generate webhook token if connection exists but token is missing
    if (vndaConnection && !vndaConnection.webhook_token) {
      const newToken = generateWebhookToken();
      await supabase
        .from("vnda_connections")
        .update({ webhook_token: newToken })
        .eq("id", vndaConnection.id);
      vndaConnection.webhook_token = newToken;
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
      vndaConnection: vndaConnection || null,
      customDomain: wsData?.custom_domain || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST — manage workspace members, connections, accounts
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { action, workspace_id, ...args } = body;

    switch (action) {
      case "invite_member": {
        const { email, role = "member", features = null } = args;

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
          role,
          invited_by: user.id,
        };
        if (role === "member" && features) {
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
        const inviteUrl = `${request.nextUrl.origin}/invite?token=${invitation.token}`;

        const { data: ws } = await supabase
          .from("workspaces")
          .select("name")
          .eq("id", workspace_id)
          .single();

        await resend.emails.send({
          from: `Vortex <${process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev"}>`,
          to: email,
          subject: `Convite para ${ws?.name || "Dashboard Vortex"}`,
          html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
              <h2 style="color: #111;">Voce foi convidado!</h2>
              <p style="color: #555; line-height: 1.6;">
                Voce recebeu um convite para participar do workspace
                <strong>${ws?.name || "Dashboard Vortex"}</strong>.
              </p>
              <a href="${inviteUrl}"
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
        const inviteUrl = `${request.nextUrl.origin}/invite?token=${inv.token}`;

        const { data: ws } = await supabase
          .from("workspaces")
          .select("name")
          .eq("id", workspace_id)
          .single();

        await resend.emails.send({
          from: `Vortex <${process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev"}>`,
          to: inv.email,
          subject: `Convite para ${ws?.name || "Dashboard Vortex"}`,
          html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
              <h2 style="color: #111;">Voce foi convidado!</h2>
              <p style="color: #555; line-height: 1.6;">
                Voce recebeu um convite para participar do workspace
                <strong>${ws?.name || "Dashboard Vortex"}</strong>.
              </p>
              <a href="${inviteUrl}"
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
        const { user_id } = args;
        const { error } = await supabase
          .from("workspace_members")
          .delete()
          .eq("workspace_id", workspace_id)
          .eq("user_id", user_id);

        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case "update_role": {
        const { user_id, role } = args;
        const { error } = await supabase
          .from("workspace_members")
          .update({ role })
          .eq("workspace_id", workspace_id)
          .eq("user_id", user_id);

        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case "update_workspace": {
        const { name, slug } = args;
        const updates: Record<string, string> = {};
        if (name) updates.name = name;
        if (slug) updates.slug = slug;

        const { error } = await supabase
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
        const { access_token, app_id } = args;
        const encryptedToken = encrypt(access_token);

        // Upsert connection
        const { data: existing } = await supabase
          .from("meta_connections")
          .select("id")
          .eq("workspace_id", workspace_id)
          .limit(1)
          .single();

        if (existing) {
          const { error } = await supabase
            .from("meta_connections")
            .update({ access_token: encryptedToken, app_id, user_id: user.id })
            .eq("id", existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("meta_connections")
            .insert({
              workspace_id,
              user_id: user.id,
              access_token: encryptedToken,
              app_id,
            });
          if (error) throw error;
        }

        return NextResponse.json({ success: true });
      }

      case "fetch_all_meta_accounts": {
        // Fetch ALL accounts from Meta API using workspace token
        const { data: connection } = await supabase
          .from("meta_connections")
          .select("access_token")
          .eq("workspace_id", workspace_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (!connection?.access_token) {
          // Fallback to env var
          const envToken = process.env.META_ACCESS_TOKEN;
          if (!envToken) {
            return NextResponse.json(
              { error: "Nenhuma conexão Meta configurada" },
              { status: 400 }
            );
          }
          setContextToken(envToken);
        } else {
          setContextToken(decrypt(connection.access_token));
        }

        const result = await getAdAccounts();
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
          selected: savedMap.has(acc.id),
          is_default: savedMap.get(acc.id) || false,
        }));

        return NextResponse.json({ accounts: accountsWithStatus });
      }

      case "save_selected_accounts": {
        const { accounts } = args as {
          accounts: Array<{ id: string; name: string; is_default?: boolean }>;
        };

        // Get connection id
        const { data: conn } = await supabase
          .from("meta_connections")
          .select("id")
          .eq("workspace_id", workspace_id)
          .limit(1)
          .single();

        if (!conn) {
          return NextResponse.json(
            { error: "Nenhuma conexão Meta encontrada" },
            { status: 400 }
          );
        }

        // Delete existing accounts for this workspace
        await supabase
          .from("meta_accounts")
          .delete()
          .eq("workspace_id", workspace_id);

        // Insert selected accounts
        if (accounts.length > 0) {
          const rows = accounts.map((acc) => ({
            workspace_id,
            connection_id: conn.id,
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
        const { api_token, store_host, store_name } = args;
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
        const { api_token, store_host } = args;
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
        const { domain } = args;

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
        const { error: updateError } = await supabase
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

        const { error: updateError } = await supabase
          .from("workspaces")
          .update({ custom_domain: null })
          .eq("id", workspace_id);

        if (updateError) throw updateError;

        return NextResponse.json({ success: true });
      }

      case "update_member_features": {
        const { user_id: targetUserId, features } = args;

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

        const { error: updateFeaturesError } = await supabase
          .from("workspace_members")
          .update({ features: features ?? null })
          .eq("workspace_id", workspace_id)
          .eq("user_id", targetUserId);

        if (updateFeaturesError) throw updateFeaturesError;
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

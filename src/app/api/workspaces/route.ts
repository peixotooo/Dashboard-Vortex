import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { encrypt } from "@/lib/encryption";
import { getAdAccounts, setContextToken } from "@/lib/meta-api";
import { decrypt } from "@/lib/encryption";

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

    return NextResponse.json({
      accounts: accounts || [],
      connection: connection || null,
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
        const { email, role = "member" } = args;

        // Look up user by email in profiles table
        const { data: invitedUser } = await supabase
          .from("profiles")
          .select("id")
          .eq("email", email)
          .single();

        if (!invitedUser) {
          return NextResponse.json(
            { error: "Nenhum usuário encontrado com este email" },
            { status: 404 }
          );
        }

        // Check if already a member
        const { data: existing } = await supabase
          .from("workspace_members")
          .select("user_id")
          .eq("workspace_id", workspace_id)
          .eq("user_id", invitedUser.id)
          .single();

        if (existing) {
          return NextResponse.json(
            { error: "Este usuário já é membro do workspace" },
            { status: 400 }
          );
        }

        const { error } = await supabase
          .from("workspace_members")
          .insert({
            workspace_id,
            user_id: invitedUser.id,
            role,
          });

        if (error) throw error;
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

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

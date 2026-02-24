import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { encrypt } from "@/lib/encryption";

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

// Manage workspace members and Meta connections
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
        // Find user by email
        const { email, role = "member" } = args;
        // Look up profile by email via auth (admin only in prod)
        // For now, we'll use the profiles table
        const { data: invitedUser } = await supabase
          .from("profiles")
          .select("id")
          .eq("id", email) // This would need email lookup
          .single();

        if (!invitedUser) {
          return NextResponse.json({ error: "User not found" }, { status: 404 });
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

      case "save_meta_accounts": {
        const { accounts, connection_id } = args;

        // Get connection id if not provided
        let connId = connection_id;
        if (!connId) {
          const { data: conn } = await supabase
            .from("meta_connections")
            .select("id")
            .eq("workspace_id", workspace_id)
            .limit(1)
            .single();
          connId = conn?.id;
        }

        if (!connId) {
          return NextResponse.json({ error: "No Meta connection found" }, { status: 400 });
        }

        // Delete existing accounts for this workspace
        await supabase
          .from("meta_accounts")
          .delete()
          .eq("workspace_id", workspace_id);

        // Insert new accounts
        if (accounts && accounts.length > 0) {
          const rows = accounts.map((acc: { id: string; name: string }) => ({
            workspace_id,
            connection_id: connId,
            account_id: acc.id,
            account_name: acc.name,
          }));

          const { error } = await supabase
            .from("meta_accounts")
            .insert(rows);
          if (error) throw error;
        }

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

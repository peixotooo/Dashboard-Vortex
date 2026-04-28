import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: conn } = await db.from("vnda_connections").select("workspace_id").eq("enable_cashback", true).limit(1).single();
  const workspaceId = conn!.workspace_id as string;
  const { data: row } = await db
    .from("coupon_workspace_settings")
    .select("workspace_id, cumulative_with_other_promos")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  console.log("Antes:", row);
  if (!row) {
    const { error } = await db.from("coupon_workspace_settings").insert({ workspace_id: workspaceId, cumulative_with_other_promos: true });
    console.log("inserted:", error || "ok");
  } else {
    const { error } = await db.from("coupon_workspace_settings").update({ cumulative_with_other_promos: true }).eq("workspace_id", workspaceId);
    console.log("updated:", error || "ok");
  }
  const { data: after } = await db.from("coupon_workspace_settings").select("cumulative_with_other_promos").eq("workspace_id", workspaceId).single();
  console.log("Depois:", after);
}
main();

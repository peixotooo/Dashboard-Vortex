import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: conn } = await db.from("vnda_connections").select("workspace_id, store_host").eq("enable_cashback", true).limit(1).single();
  console.log("workspace:", conn);
  const { data, error } = await db
    .from("gift_bars")
    .select("*")
    .eq("workspace_id", conn!.workspace_id);
  console.log("error:", error);
  console.log(JSON.stringify(data, null, 2).slice(0, 3000));
}
main();

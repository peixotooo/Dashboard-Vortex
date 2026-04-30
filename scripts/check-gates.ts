import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: c } = await db.from("vnda_connections").select("workspace_id").eq("enable_cashback", true).limit(1).single();
  const { data: cfg } = await db
    .from("cashback_config")
    .select("whatsapp_min_value, email_min_value, channel_mode, enable_whatsapp, enable_email")
    .eq("workspace_id", c!.workspace_id)
    .single();
  console.log(JSON.stringify(cfg, null, 2));
}
main();

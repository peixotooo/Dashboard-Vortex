import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: conn } = await db.from("vnda_connections").select("workspace_id").eq("enable_cashback", true).limit(1).single();
  const ws = conn!.workspace_id as string;

  const { data: all, error, count } = await db
    .from("wa_templates")
    .select("name, status, workspace_id, meta_id, language", { count: "exact" })
    .eq("workspace_id", ws)
    .ilike("name", "cashback%");
  console.log("error:", error);
  console.log("count exact:", count);
  console.log("rows returned:", all?.length);
  for (const r of all || []) console.log(`  ${r.name} · ${r.language} · ${r.status} · meta=${r.meta_id}`);
}
main();

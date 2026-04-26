import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { data: conn } = await db.from("vnda_connections").select("workspace_id").eq("enable_cashback", true).limit(1).single();
  const workspaceId = conn!.workspace_id as string;

  const { data } = await db
    .from("wa_templates")
    .select("name, language, status, components")
    .eq("workspace_id", workspaceId)
    .ilike("name", "cashback%")
    .order("name");

  console.log(`\n${data?.length || 0} templates de cashback no wa_templates:\n`);
  for (const t of data || []) {
    console.log(`=== ${t.name} (${t.language}) — ${t.status} ===`);
    const comps = t.components as Array<{ type: string; text?: string; format?: string; example?: unknown; buttons?: unknown[] }>;
    for (const c of comps || []) {
      const txt = c.text || "(sem texto)";
      const placeholders = (txt.match(/\{\{\d+\}\}/g) || []).length;
      console.log(`  ${c.type}${c.format ? `/${c.format}` : ""}: ${placeholders} variável(is)`);
      console.log(`    "${txt.replace(/\n/g, "\\n").slice(0, 250)}"`);
      if (c.example) console.log(`    example: ${JSON.stringify(c.example).slice(0, 200)}`);
    }
    console.log("");
  }
}
main();

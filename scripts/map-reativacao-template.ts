import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { data: conn } = await db.from("vnda_connections").select("workspace_id").eq("enable_cashback", true).limit(1).single();
  const ws = conn!.workspace_id as string;

  // Map reativacao_cashback_jan_25 to BOTH reactivation stages — same template
  // is fine since the message already says "reativado / use antes que expire"
  const stages = ["REATIVACAO", "REATIVACAO_LEMBRETE"];
  for (const estagio of stages) {
    const { error } = await db
      .from("cashback_reminder_templates")
      .update({
        wa_template_name: "reativacao_cashback_jan_25",
        wa_template_language: "pt_BR",
        enabled: true,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", ws)
      .eq("canal", "whatsapp")
      .eq("estagio", estagio);
    console.log(`${error ? "❌" : "✅"} ${estagio} → reativacao_cashback_jan_25 ${error?.message || ""}`);
  }
}
main();

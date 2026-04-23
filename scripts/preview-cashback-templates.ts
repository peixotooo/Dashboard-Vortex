/**
 * Sends a live preview of each email template (all 5 stages) to
 * guilherme@bulking.com.br so you can see the actual rendered output in
 * your inbox. Uses the same pipeline the cron would use.
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
const ENC_KEY = process.env.ENCRYPTION_KEY!;
function decrypt(t: string): string {
  if (!t.includes(":")) return t;
  const [iv, tag, enc] = t.split(":");
  const d = createDecipheriv("aes-256-gcm", Buffer.from(ENC_KEY, "hex"), Buffer.from(iv, "hex"));
  d.setAuthTag(Buffer.from(tag, "hex"));
  return d.update(enc, "hex", "utf8") + d.final("utf8");
}

const TARGET = "guilherme@bulking.com.br";

const PREVIEW_VARS = {
  nome: "Guilherme",
  valor: "R$ 25,90",
  expira_em: "22/05",
  pedido: "PED-PREVIEW-001",
};

function render(tpl: string): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => (PREVIEW_VARS as Record<string, string>)[k] || "");
}

async function main() {
  const { data: conn } = await db.from("vnda_connections").select("workspace_id").eq("enable_cashback", true).limit(1).single();
  const workspaceId = conn!.workspace_id as string;

  const { data: smtp } = await db.from("smtp_config").select("api_token, from_email, from_name").eq("workspace_id", workspaceId).single();
  const smtpToken = decrypt(smtp!.api_token as string);

  const { data: templates } = await db
    .from("cashback_reminder_templates")
    .select("estagio, email_subject, email_body_html")
    .eq("workspace_id", workspaceId)
    .eq("canal", "email")
    .order("estagio");

  const stages = ["LEMBRETE_1", "LEMBRETE_2", "LEMBRETE_3", "REATIVACAO", "REATIVACAO_LEMBRETE"];
  const byStage = new Map(templates!.map((t) => [t.estagio as string, t]));

  for (const estagio of stages) {
    const tpl = byStage.get(estagio);
    if (!tpl?.email_subject || !tpl?.email_body_html) {
      console.log(`⚠️  ${estagio}: template vazio, pulando`);
      continue;
    }

    const subjectRendered = `[PREVIEW ${estagio}] ${render(tpl.email_subject as string)}`;
    const bodyRendered = render(tpl.email_body_html as string);
    const body = {
      subject: subjectRendered,
      body: bodyRendered,
      from: `${smtp!.from_name} <${smtp!.from_email}>`,
      to: TARGET,
      headers: { "Content-Type": "text/html" },
    };

    const res = await fetch("https://api.smtplw.com.br/v1/messages", {
      method: "POST",
      headers: { "x-auth-token": smtpToken, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const okTag = res.ok ? "✅" : "❌";
    console.log(`${okTag} ${estagio.padEnd(22)} HTTP ${res.status} · "${subjectRendered.slice(0, 80)}"`);
    // slight throttle
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\nConfere a caixa de ${TARGET} (inclusive spam).`);
}
main();

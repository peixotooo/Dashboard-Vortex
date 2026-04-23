/**
 * Sends a single test email via Locaweb SMTP to guilherme@bulking.com.br
 * using the lib/cashback/locaweb-smtp.ts pipeline (same path used by the
 * cron for real reminders). Authorized by user.
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

async function main() {
  const { data: conn } = await db.from("vnda_connections").select("workspace_id").eq("enable_cashback", true).limit(1).single();
  const workspaceId = conn!.workspace_id as string;

  const { data: smtp } = await db
    .from("smtp_config")
    .select("provider, api_token, from_email, from_name, reply_to")
    .eq("workspace_id", workspaceId)
    .single();
  if (!smtp?.api_token) {
    console.error("❌ smtp_config não encontrado pra workspace", workspaceId);
    process.exit(1);
  }

  const token = decrypt(smtp.api_token as string);
  const fromEmail = smtp.from_email as string;
  const fromName = (smtp.from_name as string) || "Bulking";

  const subject = `[TESTE CASHBACK] Seu cashback de R$ 25,90 estÁ disponível`;
  const bodyHtml = `
    <html>
      <body style="font-family: Arial, sans-serif; color: #111; max-width: 600px;">
        <h2 style="color: #ff8a00;">Seu cashback chegou</h2>
        <p>Olá Guilherme,</p>
        <p>Este é um <strong>teste do sistema</strong> da nova régua de cashback.</p>
        <p>Seu saldo de <strong>R$ 25,90</strong> referente ao pedido <strong>TESTE-001</strong> expira em <strong>22/05</strong>.</p>
        <p style="font-size: 12px; color: #666;">Ignore este e-mail — foi disparado automaticamente durante teste E2E da integração com Locaweb SMTP.</p>
        <hr style="border: 0; border-top: 1px solid #eee;" />
        <p style="font-size: 11px; color: #999;">Enviado em ${new Date().toISOString()} via Dashboard Vortex → Locaweb SMTP</p>
      </body>
    </html>
  `;

  const body: Record<string, unknown> = {
    subject,
    body: bodyHtml,
    from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
    to: "guilherme@bulking.com.br",
    headers: { "Content-Type": "text/html" },
  };

  console.log(`\n→ Enviando e-mail de teste`);
  console.log(`  from: ${body.from}`);
  console.log(`  to:   ${body.to}`);
  console.log(`  subject: ${body.subject}`);

  const res = await fetch("https://api.smtplw.com.br/v1/messages", {
    method: "POST",
    headers: { "x-auth-token": token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text().catch(() => "");
  console.log(`\n→ HTTP ${res.status}`);
  console.log(`→ body: ${text.slice(0, 500)}`);

  if (!res.ok) {
    console.error("\n❌ Locaweb SMTP falhou.");
    process.exit(1);
  }
  console.log("\n✅ E-mail enviado. Confere guilherme@bulking.com.br (olha spam também).");
}
main();

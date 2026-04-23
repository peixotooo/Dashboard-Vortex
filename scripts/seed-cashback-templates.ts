/**
 * Seeds the 5 cashback reminder email templates for the Bulking workspace.
 * Email HTML uses inline styles (email-client safe) and the template
 * variables {{nome}}, {{valor}}, {{expira_em}}, {{pedido}}.
 *
 * WhatsApp rows are created as placeholders (enabled=true but
 * wa_template_name=null) so the UI shows them — fill wa_template_name
 * in the panel once the template is approved in Meta Business Manager.
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

const BRAND = {
  name: "BULKING",
  color: "#ff8a00",
  colorDark: "#c96a00",
  bg: "#0b0b0b",
  text: "#111",
  mutedText: "#666",
  site: "https://www.bulking.com.br",
};

function wrapEmail(innerHtml: string): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BULKING · Cashback</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:${BRAND.text};">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0;">
      <tr>
        <td align="center">
          <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
            <tr>
              <td style="background:${BRAND.bg};padding:20px 32px;">
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:900;letter-spacing:2px;color:#ffffff;">
                  <span style="color:${BRAND.color};">●</span>&nbsp;BULKING
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                ${innerHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background:#fafafa;border-top:1px solid #eee;">
                <p style="margin:0;font-size:11px;color:${BRAND.mutedText};line-height:1.5;">
                  Este e-mail é automático. Dúvidas? Responda ou fale com a gente em
                  <a href="mailto:contato@bulking.com.br" style="color:${BRAND.color};text-decoration:none;">contato@bulking.com.br</a>.
                  Para não receber mais avisos de cashback, ajuste suas preferências na sua conta.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:11px;color:${BRAND.mutedText};">
            ${BRAND.name} · <a href="${BRAND.site}" style="color:${BRAND.mutedText};text-decoration:none;">${BRAND.site.replace("https://", "")}</a>
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function cta(label: string): string {
  return `
    <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td align="center" style="background:${BRAND.color};border-radius:8px;">
          <a href="${BRAND.site}" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#000;text-decoration:none;">${label} →</a>
        </td>
      </tr>
    </table>`;
}

const emails = {
  LEMBRETE_1: {
    subject: "{{nome}}, teu cashback de {{valor}} acabou de cair 💪",
    body: wrapEmail(`
      <h1 style="margin:0 0 12px;font-size:24px;font-weight:900;color:${BRAND.text};">Teu cashback chegou, {{nome}}.</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:${BRAND.text};">
        Obrigado por comprar na BULKING. Como combinado, <strong>{{valor}}</strong> do pedido <strong>{{pedido}}</strong>
        acabaram de virar crédito na tua conta. É só seguir o jogo e usar na próxima compra.
      </p>
      <div style="background:#fff7ed;border-left:4px solid ${BRAND.color};padding:14px 16px;border-radius:6px;margin:20px 0;">
        <p style="margin:0;font-size:13px;color:${BRAND.text};line-height:1.5;">
          ⚠️ Teu cashback expira em <strong>{{expira_em}}</strong>. Depois disso, vira fumaça.
        </p>
      </div>
      ${cta("Gastar agora")}
      <p style="margin:16px 0 0;font-size:13px;color:${BRAND.mutedText};line-height:1.5;">
        Bora colocar a casa em ordem: whey, creatina, pré-treino, stack que tá faltando. Tamo junto.
      </p>
    `),
  },

  LEMBRETE_2: {
    subject: "Faltam poucos dias pra gastar teu cashback de {{valor}}, {{nome}}",
    body: wrapEmail(`
      <h1 style="margin:0 0 12px;font-size:24px;font-weight:900;color:${BRAND.text};">Meio do caminho, {{nome}}.</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:${BRAND.text};">
        Passou da metade do prazo e teu cashback de <strong>{{valor}}</strong> segue esperando.
        Desperdício? Nada a ver com a BULKING.
      </p>
      <div style="background:#fff7ed;border-left:4px solid ${BRAND.color};padding:14px 16px;border-radius:6px;margin:20px 0;">
        <p style="margin:0;font-size:13px;color:${BRAND.text};line-height:1.5;">
          Expira em <strong>{{expira_em}}</strong>. Não deixa pra última hora.
        </p>
      </div>
      ${cta("Ver coleção")}
      <p style="margin:16px 0 0;font-size:13px;color:${BRAND.mutedText};line-height:1.5;">
        <strong>Sugestões rápidas:</strong> suplementação, vestuário de treino, acessórios. O crédito é teu — usa no que fizer sentido.
      </p>
    `),
  },

  LEMBRETE_3: {
    subject: "🚨 Última chance: teu cashback de {{valor}} expira em {{expira_em}}, {{nome}}",
    body: wrapEmail(`
      <div style="background:${BRAND.color};color:#000;padding:10px 14px;border-radius:6px;display:inline-block;font-weight:800;font-size:13px;letter-spacing:1px;margin-bottom:16px;">
        ÚLTIMA CHAMADA
      </div>
      <h1 style="margin:0 0 12px;font-size:26px;font-weight:900;color:${BRAND.text};">{{nome}}, hoje ou nunca.</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:${BRAND.text};">
        Teu cashback de <strong>{{valor}}</strong> expira em <strong>{{expira_em}}</strong>.
        Amanhã ele simplesmente some. Sem prorrogação, sem volta.
      </p>
      ${cta("Usar antes de acabar")}
      <p style="margin:16px 0 0;font-size:13px;color:${BRAND.mutedText};line-height:1.5;">
        O crédito é aplicado direto no checkout. Só escolher e finalizar. Se precisar de ajuda, responde este e-mail.
      </p>
    `),
  },

  REATIVACAO: {
    subject: "{{nome}}, tua segunda chance: cashback de {{valor}} voltou 🔄",
    body: wrapEmail(`
      <h1 style="margin:0 0 12px;font-size:24px;font-weight:900;color:${BRAND.text};">Olha quem voltou, {{nome}}.</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:${BRAND.text};">
        Teu cashback de <strong>{{valor}}</strong> do pedido <strong>{{pedido}}</strong> tinha expirado — mas a BULKING decidiu te dar mais uma chance.
        Crédito reativado, pronto pra usar.
      </p>
      <div style="background:#fff7ed;border-left:4px solid ${BRAND.color};padding:14px 16px;border-radius:6px;margin:20px 0;">
        <p style="margin:0;font-size:13px;color:${BRAND.text};line-height:1.5;">
          Dessa vez é menos tempo: expira em <strong>{{expira_em}}</strong>. Aproveita antes que vá embora de vez.
        </p>
      </div>
      ${cta("Aproveitar agora")}
      <p style="margin:16px 0 0;font-size:13px;color:${BRAND.mutedText};line-height:1.5;">
        Segunda chance não rola duas vezes. Esse é o momento.
      </p>
    `),
  },

  REATIVACAO_LEMBRETE: {
    subject: "{{nome}}, teu cashback reativado de {{valor}} está acabando",
    body: wrapEmail(`
      <h1 style="margin:0 0 12px;font-size:24px;font-weight:900;color:${BRAND.text};">Tick-tock, {{nome}}.</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:${BRAND.text};">
        Teu cashback reativado de <strong>{{valor}}</strong> expira em <strong>{{expira_em}}</strong>.
        Depois disso não tem terceira chance — foi-se.
      </p>
      ${cta("Gastar antes de perder")}
      <p style="margin:16px 0 0;font-size:13px;color:${BRAND.mutedText};line-height:1.5;">
        Se ficou alguma dúvida na primeira rodada, responde este e-mail. Tamo junto pra fechar a compra.
      </p>
    `),
  },
};

async function main() {
  const { data: conn } = await db.from("vnda_connections").select("workspace_id").eq("enable_cashback", true).limit(1).single();
  const workspaceId = conn!.workspace_id as string;

  const stages = ["LEMBRETE_1", "LEMBRETE_2", "LEMBRETE_3", "REATIVACAO", "REATIVACAO_LEMBRETE"] as const;

  const rows: Array<Record<string, unknown>> = [];
  for (const estagio of stages) {
    rows.push({
      workspace_id: workspaceId,
      canal: "email",
      estagio,
      enabled: true,
      email_subject: emails[estagio].subject,
      email_body_html: emails[estagio].body,
      updated_at: new Date().toISOString(),
    });
    rows.push({
      workspace_id: workspaceId,
      canal: "whatsapp",
      estagio,
      enabled: true,
      wa_template_name: null,            // fill in panel once Meta-approved
      wa_template_language: "pt_BR",
      updated_at: new Date().toISOString(),
    });
  }

  const { error } = await db
    .from("cashback_reminder_templates")
    .upsert(rows, { onConflict: "workspace_id, canal, estagio" });

  if (error) {
    console.error("❌ upsert failed:", error);
    process.exit(1);
  }

  console.log(`✅ ${rows.length} templates (5 email + 5 whatsapp placeholders) upserted for workspace ${workspaceId}`);

  // Quick sanity check
  const { data: check } = await db
    .from("cashback_reminder_templates")
    .select("canal, estagio, enabled, wa_template_name, email_subject")
    .eq("workspace_id", workspaceId)
    .order("estagio")
    .order("canal");
  console.log("\nTemplates no DB:");
  for (const t of check || []) {
    const sub = (t as { email_subject?: string }).email_subject;
    const waName = (t as { wa_template_name?: string | null }).wa_template_name;
    console.log(
      `  [${t.estagio}] ${t.canal.padEnd(8)} enabled=${t.enabled} ` +
        (t.canal === "email" ? `subject="${(sub || "").slice(0, 70)}…"` : `wa_template_name=${waName || "(pendente)"}`)
    );
  }
}
main();

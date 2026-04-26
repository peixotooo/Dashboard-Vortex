/**
 * Renders the body of cashback_01 (LEMBRETE_1) locally using the variable
 * order our send pipeline now uses. No Meta API call, no send, no DB write.
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

const TEMPLATES = {
  cashback_01: {
    header: "Trago boas notícias!",
    body: "Oi {{1}},\n\nVocê acabou de ganhar *{{2}}* de cashback para sua próxima compra na Bulking! 💪\n\nO valor já está disponível em sua conta ({{3}}). Basta realizar seu pedido e utilizar seu crédito no próprio checkout.\n\nMas fique atento, o cashback tem validade até o dia *{{4}}*. Não perca a oportunidade de usar esse benefício exclusivo e atualizar seu guarda-roupa com nossos produtos.\n\nAproveite e boas compras!",
    footer: "Clique no botão abaixo",
    button: { text: "QUERO APROVEITAR", url: "https://www.bulking.com.br/lancamentos?utm_source=cashback-01" },
  },
  cashback_02: {
    header: "lembrete importante para você!",
    body: "{{1}},\n\nVocê ainda tem *{{2}}* de cashback esperando para ser usado em sua próxima compra. O valor já está disponível em sua conta ({{3}}) e pode ser utilizado diretamente no checkout.\n\nMas atenção, faltam apenas 5 dias para o cashback expirar, sendo válido até o dia *{{4}}*. Não deixe essa oportunidade escapar!",
    footer: "Aproveite agora",
    button: { text: "APROVEITAR A TEMPO", url: "https://www.bulking.com.br/lancamentos?utm_source=cashback-02" },
  },
  cashback_03: {
    header: "Seu cashback vai expirar",
    body: "{{1}},\n\n👉 Atenção! Você tem apenas algumas horas para usar *{{2}}* de cashback. Não perca essa chance!\n\nO valor está disponível em sua conta ({{3}}) e expira em breve, {{4}}. ⏰\n\nCorre e aproveite agora!",
    footer: "Clique no botão abaixo",
    button: { text: "APROVEITAR O ÚLTIMO DIA", url: "https://www.bulking.com.br/lancamentos?utm_source=cashback-03" },
  },
};

function formatBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function formatDateLong(d: Date) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

async function main() {
  const { data: conn } = await db.from("vnda_connections").select("workspace_id").eq("enable_cashback", true).limit(1).single();
  const workspaceId = conn!.workspace_id as string;

  // Pick a sample pending cashback to render against
  const { data: sample } = await db
    .from("cashback_transactions")
    .select("nome_cliente, email, telefone, valor_cashback, expira_em, numero_pedido")
    .eq("workspace_id", workspaceId)
    .eq("status", "AGUARDANDO_DEPOSITO")
    .gte("valor_cashback", 20)
    .not("telefone", "is", null)
    .order("valor_cashback", { ascending: false })
    .limit(1)
    .single();
  if (!sample) return;

  const expira = new Date();
  expira.setUTCDate(expira.getUTCDate() + 30);

  const vars: Record<string, string> = {
    "1": (sample.nome_cliente as string)?.split(" ")[0] || "cliente",
    "2": formatBRL(Number(sample.valor_cashback)),
    "3": sample.email as string,
    "4": formatDateLong(expira),
  };

  for (const [stage, tplName] of [["LEMBRETE_1", "cashback_01"], ["LEMBRETE_2", "cashback_02"], ["LEMBRETE_3", "cashback_03"]] as const) {
    const t = TEMPLATES[tplName];
    const rendered = t.body.replace(/\{\{(\d+)\}\}/g, (_, n) => vars[n] || "");
    console.log(`\n╔══ ${stage} → ${tplName} ══════════════════════════════════════════╗`);
    console.log(`Para: ${sample.nome_cliente} · ${sample.telefone}`);
    console.log(`Variáveis: ${JSON.stringify(vars)}`);
    console.log(`\n[HEADER] ${t.header}`);
    console.log(`\n${rendered}`);
    console.log(`\n[FOOTER] ${t.footer}`);
    console.log(`[BUTTON] ${t.button.text} → ${t.button.url}`);
  }
}
main();

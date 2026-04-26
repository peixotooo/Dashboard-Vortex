/**
 * Renders what the WhatsApp message payload will look like for a sample
 * pending cashback, WITHOUT sending. Prints the exact body Meta will
 * receive after variable substitution.
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

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

  if (!sample) {
    console.log("Sem amostras pra renderizar.");
    return;
  }

  // Simulate D+15: depositado_em = now, expira_em = now + validity_days (30)
  const expira = new Date();
  expira.setUTCDate(expira.getUTCDate() + 30);

  const vars = {
    "1": (sample.nome_cliente as string)?.split(" ")[0] || "cliente",
    "2": formatBRL(Number(sample.valor_cashback)),
    "3": sample.email as string,
    "4": formatDateLong(expira),
  };

  const { data: tpl, error } = await db
    .from("wa_templates")
    .select("name, components")
    .eq("workspace_id", workspaceId)
    .eq("name", "cashback_01")
    .maybeSingle();
  if (!tpl || error) {
    console.log("template cashback_01 não encontrado em wa_templates", error);
    return;
  }
  console.log("DEBUG components:", JSON.stringify(tpl.components).slice(0, 200));
  const comps = tpl.components as Array<{ type: string; text?: string; buttons?: Array<{ text: string; url: string }> }> | null;
  const body = (comps || []).find((c) => c.type === "BODY")?.text || "";
  const rendered = body.replace(/\{\{(\d+)\}\}/g, (_, n) => (vars as Record<string, string>)[n] || "");

  console.log(`\n=== Preview de WhatsApp (LEMBRETE_1 = cashback_01) ===\n`);
  console.log(`Destinatário: ${sample.nome_cliente} <${sample.email}> · ${sample.telefone}`);
  console.log(`Pedido: ${sample.numero_pedido} · Cashback: ${vars["2"]}`);
  console.log(`\nVariáveis enviadas pra Meta:`);
  for (const [k, v] of Object.entries(vars)) console.log(`  {{${k}}} = ${JSON.stringify(v)}`);
  console.log(`\n--- Body renderizado (o que cliente vai ver) ---`);
  console.log(rendered);
  console.log(`\n--- HEADER ---`);
  console.log((comps || []).find((c) => c.type === "HEADER")?.text || "(sem header)");
  console.log(`\n--- BUTTON ---`);
  const btn = (comps || []).find((c) => c.type === "BUTTONS")?.buttons?.[0];
  if (btn) console.log(`[${btn.text}] → ${btn.url}`);
}
main();

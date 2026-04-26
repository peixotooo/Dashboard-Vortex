/**
 * Cross-checks every AGUARDANDO_DEPOSITO cashback row against the VNDA
 * client API to find any "bulking-club" members that should NOT receive
 * cashback. Reports findings — does NOT modify state.
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

const EXCLUDED = ["bulking-club"];

async function main() {
  const { data: conn } = await db
    .from("vnda_connections")
    .select("workspace_id, store_host, api_token")
    .eq("enable_cashback", true)
    .limit(1)
    .single();
  const workspaceId = conn!.workspace_id as string;
  const apiToken = decrypt(conn!.api_token as string);
  const storeHost = conn!.store_host as string;

  const { data: pending } = await db
    .from("cashback_transactions")
    .select("id, source_order_id, numero_pedido, email, nome_cliente, valor_cashback, confirmado_em")
    .eq("workspace_id", workspaceId)
    .eq("status", "AGUARDANDO_DEPOSITO");

  console.log(`\nAuditando ${pending?.length || 0} cashbacks pendentes…\n`);

  const toCancel: Array<{ id: string; pedido: string; email: string; tag: string }> = [];
  for (const p of pending || []) {
    const url = `https://api.vnda.com.br/api/v2/clients?email=${encodeURIComponent(p.email as string)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiToken}`, "X-Shop-Host": storeHost, Accept: "application/json" },
    });
    if (!res.ok) {
      console.log(`  ⚠️  ${p.email} → HTTP ${res.status} (sem dados de tag)`);
      continue;
    }
    const body = (await res.json().catch(() => null)) as { tags?: unknown } | null;
    const raw = body?.tags;
    const list = !raw
      ? []
      : Array.isArray(raw)
      ? raw.map((x) => String(x).toLowerCase().trim()).filter(Boolean)
      : String(raw).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const matchedExclusion = list.find((t) => EXCLUDED.includes(t));
    const flag = matchedExclusion ? "❌ EXCLUIR" : "✅ ok";
    console.log(`  ${flag}  ${p.numero_pedido || p.source_order_id} · ${p.email} · R$${p.valor_cashback} · tags=${JSON.stringify(list)}`);
    if (matchedExclusion) {
      toCancel.push({ id: p.id as string, pedido: p.numero_pedido as string, email: p.email as string, tag: matchedExclusion });
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\nResumo: ${toCancel.length} cashback(s) a cancelar`);
  if (toCancel.length) {
    console.log("\nIds que deveriam ser CANCELADOS antes do D+15:");
    for (const c of toCancel) console.log(`  - ${c.id}  pedido=${c.pedido}  email=${c.email}  tag=${c.tag}`);
    console.log("\nUse scripts/cancel-club-cashbacks.ts (a criar) ou rode SQL manual após confirmar.");
  } else {
    console.log("\n✅ Nenhum membro do Club na fila. Pode seguir.");
  }
}
main();

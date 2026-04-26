/**
 * Cancels every AGUARDANDO_DEPOSITO cashback whose client carries the
 * "bulking-club" VNDA tag. Pure DB write — no external calls. Logs an
 * audit event EXCLUDED_MEMBER_RETROACTIVE per cashback so we keep trail.
 *
 * Safe: status was AGUARDANDO_DEPOSITO so no VNDA credit was issued and
 * no email/whatsapp was sent (cron only fires reminders post-deposit).
 *
 * Use --dry-run to print without mutating.
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

const DRY_RUN = process.argv.includes("--dry-run");
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
    .select("id, source_order_id, numero_pedido, email, valor_cashback, status")
    .eq("workspace_id", workspaceId)
    .eq("status", "AGUARDANDO_DEPOSITO");

  console.log(`\nVerificando ${pending?.length || 0} cashbacks pendentes…\n`);
  const toCancel: Array<{ id: string; pedido: string; email: string; tag: string; valor: number }> = [];

  for (const p of pending || []) {
    const url = `https://api.vnda.com.br/api/v2/clients?email=${encodeURIComponent(p.email as string)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiToken}`, "X-Shop-Host": storeHost, Accept: "application/json" },
    });
    if (!res.ok) continue;
    const body = (await res.json().catch(() => null)) as { tags?: unknown } | null;
    if (!body) continue;
    const list = !body.tags
      ? []
      : Array.isArray(body.tags)
      ? body.tags.map((x) => String(x).toLowerCase().trim()).filter(Boolean)
      : String(body.tags).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const matched = list.find((t) => EXCLUDED.includes(t));
    if (matched) {
      toCancel.push({
        id: p.id as string,
        pedido: (p.numero_pedido as string) || (p.source_order_id as string),
        email: p.email as string,
        tag: matched,
        valor: Number(p.valor_cashback),
      });
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\nIdentificados ${toCancel.length} cashbacks de membros do Club:\n`);
  for (const c of toCancel) console.log(`  - ${c.pedido} · ${c.email} · R$${c.valor} (tag: ${c.tag})`);

  if (toCancel.length === 0) {
    console.log("\n✅ Nada a cancelar.");
    return;
  }
  if (DRY_RUN) {
    console.log("\n[DRY-RUN] Nada foi alterado. Rode sem --dry-run pra cancelar.");
    return;
  }

  console.log(`\nCancelando ${toCancel.length} cashbacks…\n`);
  let success = 0;
  for (const c of toCancel) {
    const { error: updErr } = await db
      .from("cashback_transactions")
      .update({
        status: "CANCELADO",
        updated_at: new Date().toISOString(),
      })
      .eq("id", c.id);
    if (updErr) {
      console.log(`  ❌ ${c.pedido}: ${updErr.message}`);
      continue;
    }
    await db.from("cashback_events").insert({
      workspace_id: workspaceId,
      cashback_id: c.id,
      tipo: "EXCLUDED_MEMBER_RETROACTIVE",
      payload: {
        reason: "Cliente é membro do Bulking Club — não elegível a cashback",
        excluded_tag: c.tag,
        previous_status: "AGUARDANDO_DEPOSITO",
      },
    });
    success++;
    console.log(`  ✅ ${c.pedido} · ${c.email}`);
  }

  console.log(`\n✅ ${success}/${toCancel.length} cashbacks cancelados (status=CANCELADO + audit event gravado).`);
  console.log("Nenhuma chamada VNDA foi feita (nenhum crédito foi depositado pra esses).");
}
main();

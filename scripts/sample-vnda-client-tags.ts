/**
 * Reads the 50 most recent unique customer emails from crm_vendas, queries
 * VNDA /api/v2/clients?email= for each, and tallies how many have a `tags`
 * field set + which tag values appear.
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
  const { data: conn } = await db
    .from("vnda_connections")
    .select("workspace_id, store_host, api_token")
    .eq("enable_cashback", true)
    .limit(1)
    .single();
  const apiToken = decrypt(conn!.api_token as string);
  const storeHost = conn!.store_host as string;
  const workspaceId = conn!.workspace_id as string;

  // Get last 100 unique emails ordered by most recent purchase
  const { data: rows } = await db
    .from("crm_vendas")
    .select("email, data_compra")
    .eq("workspace_id", workspaceId)
    .eq("source", "vnda_webhook")
    .order("data_compra", { ascending: false })
    .limit(500);

  const seen = new Set<string>();
  const emails: string[] = [];
  for (const r of rows || []) {
    const e = (r.email as string)?.trim().toLowerCase();
    if (!e) continue;
    if (!seen.has(e)) {
      seen.add(e);
      emails.push(e);
      if (emails.length >= 50) break;
    }
  }
  console.log(`Amostrando ${emails.length} clientes únicos…\n`);

  const tagFreq = new Map<string, number>();
  let withTags = 0;
  let nullTags = 0;
  let notFound = 0;
  let errors = 0;
  const examples: Array<{ email: string; tags: unknown }> = [];

  for (const email of emails) {
    const url = `https://api.vnda.com.br/api/v2/clients?email=${encodeURIComponent(email)}`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiToken}`, "X-Shop-Host": storeHost, Accept: "application/json" },
      });
      if (res.status === 404) {
        notFound++;
        continue;
      }
      if (!res.ok) {
        errors++;
        continue;
      }
      const body = (await res.json()) as { tags?: unknown; email?: string; first_name?: string; lists?: unknown };
      if (body.tags === null || body.tags === undefined || (typeof body.tags === "string" && body.tags.trim() === "") || (Array.isArray(body.tags) && body.tags.length === 0)) {
        nullTags++;
      } else {
        withTags++;
        if (examples.length < 5) examples.push({ email: email, tags: body.tags });
        // Extract tag values
        if (typeof body.tags === "string") {
          for (const t of body.tags.split(",").map((s) => s.trim()).filter(Boolean)) {
            tagFreq.set(t, (tagFreq.get(t) || 0) + 1);
          }
        } else if (Array.isArray(body.tags)) {
          for (const t of body.tags as unknown[]) {
            const k = typeof t === "string" ? t : JSON.stringify(t);
            tagFreq.set(k, (tagFreq.get(k) || 0) + 1);
          }
        }
      }
    } catch {
      errors++;
    }
    // throttle to be nice to VNDA
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`Resultado da amostra (${emails.length} clientes):`);
  console.log(`  ✓ Com tags:    ${withTags}`);
  console.log(`  ∅ Tags null:   ${nullTags}`);
  console.log(`  ? Não achado:  ${notFound}`);
  console.log(`  ⚠️ Erros:       ${errors}`);

  if (tagFreq.size > 0) {
    console.log("\nTags encontradas (frequência):");
    const sorted = Array.from(tagFreq.entries()).sort((a, b) => b[1] - a[1]);
    for (const [t, n] of sorted) console.log(`  ${n.toString().padStart(3)}× "${t}"`);
  }
  if (examples.length > 0) {
    console.log("\nExemplos:");
    for (const e of examples) console.log(`  ${e.email}: tags=${JSON.stringify(e.tags)}`);
  }
}
main();

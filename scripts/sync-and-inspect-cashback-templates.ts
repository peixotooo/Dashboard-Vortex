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

  const { data: wa } = await db.from("wa_config").select("phone_number_id, waba_id, access_token").eq("workspace_id", workspaceId).single();
  const accessToken = decrypt(wa!.access_token as string);
  const wabaId = wa!.waba_id as string;

  console.log(`waba_id: ${wabaId}`);

  // Paginate through ALL templates
  let url: string | null = `https://graph.facebook.com/v21.0/${wabaId}/message_templates?limit=100`;
  type Comp = { type: string; text?: string; format?: string; example?: unknown; buttons?: unknown[] };
  type Tpl = { id: string; name: string; language: string; category: string; status: string; components: Comp[] };
  const all: Tpl[] = [];
  while (url) {
    const r: Response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) {
      const t = await r.text();
      console.log(`Meta API error ${r.status}: ${t.slice(0, 400)}`);
      process.exit(1);
    }
    const j = (await r.json()) as { data?: Tpl[]; paging?: { next?: string } };
    if (j.data) all.push(...j.data);
    url = j.paging?.next || null;
  }
  console.log(`Meta retornou ${all.length} templates totais`);

  // Show all template names for visibility
  const allNames = all.map((t) => t.name).sort();
  console.log("Nomes (filtrados por 'cash'):", allNames.filter((n) => /cash/i.test(n)));

  const cashback = all.filter((t) => t.name.startsWith("cashback"));
  console.log(`\n${cashback.length} templates de cashback na Meta:\n`);
  for (const t of cashback) {
    console.log(`=== ${t.name} (${t.language}) — ${t.status} — ${t.category} ===`);
    for (const c of t.components || []) {
      const txt = c.text || "";
      const placeholders = (txt.match(/\{\{\d+\}\}/g) || []);
      console.log(`  ${c.type}${c.format ? `/${c.format}` : ""}: ${placeholders.length} variável(is) [${placeholders.join(",")}]`);
      console.log(`    "${txt.replace(/\n/g, "\\n")}"`);
      if (c.example) console.log(`    example: ${JSON.stringify(c.example).slice(0, 300)}`);
      if (c.buttons) console.log(`    buttons: ${JSON.stringify(c.buttons).slice(0, 200)}`);
    }
    console.log("");
  }

  // Also save to wa_templates for the cron to use
  console.log(`Sincronizando ${cashback.length} templates em wa_templates…`);
  for (const t of cashback) {
    await db.from("wa_templates").upsert(
      {
        workspace_id: workspaceId,
        meta_id: t.id,
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        components: t.components,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id, meta_id" }
    );
  }
  console.log("✅ sincronizados");
}
main();

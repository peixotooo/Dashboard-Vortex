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
  const ws = conn!.workspace_id as string;
  const { data: wa } = await db.from("wa_config").select("waba_id, access_token").eq("workspace_id", ws).single();
  const accessToken = decrypt(wa!.access_token as string);
  const wabaId = wa!.waba_id as string;

  let url: string | null = `https://graph.facebook.com/v21.0/${wabaId}/message_templates?name=reativacao_cashback_jan_25&limit=10`;
  while (url) {
    const r: Response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) {
      console.log("erro:", r.status, await r.text());
      return;
    }
    const j = (await r.json()) as { data?: Array<{ id: string; name: string; language: string; status: string; category: string; components: unknown[] }>; paging?: { next?: string } };
    for (const t of j.data || []) {
      console.log(`\n=== ${t.name} (${t.language}) — ${t.status} — ${t.category} ===`);
      for (const c of t.components as Array<{ type: string; text?: string; format?: string; example?: unknown; buttons?: unknown[] }>) {
        const txt = c.text || "";
        const placeholders = (txt.match(/\{\{\d+\}\}/g) || []);
        console.log(`  ${c.type}${c.format ? `/${c.format}` : ""}: ${placeholders.length} variável(is) [${placeholders.join(",")}]`);
        console.log(`    "${txt.replace(/\n/g, "\\n")}"`);
        if (c.example) console.log(`    example: ${JSON.stringify(c.example)}`);
        if (c.buttons) console.log(`    buttons: ${JSON.stringify(c.buttons)}`);
      }
    }
    url = j.paging?.next || null;
  }
}
main();

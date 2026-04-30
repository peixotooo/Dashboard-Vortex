import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../src/lib/encryption";

config({ path: ".env.local" });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data } = await sb
    .from("meta_connections")
    .select("access_token")
    .eq("workspace_id", "36f37e88-a9c7-4ed7-89b9-45e62b8bba04")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  const token = decrypt(data!.access_token);

  const accounts = [
    { id: "act_880937624549391", name: "001BK (default)" },
    { id: "act_1655478342004952", name: "Bulking 3.0" },
    { id: "act_1128224046140495", name: "Bulking New" },
    { id: "act_648029189321468", name: "BULKING 2.0" },
    { id: "act_956414134937480", name: "BK Marketing" },
    { id: "act_1234583478774369", name: "B7984" },
  ];

  for (const acc of accounts) {
    const url = `https://graph.facebook.com/v21.0/${acc.id}/insights?fields=spend,impressions,clicks&date_preset=last_30d&level=account&access_token=${encodeURIComponent(token)}`;
    const r = await fetch(url);
    const txt = await r.text();
    console.log(`\n--- ${acc.name} (${acc.id}) ---`);
    console.log(`status=${r.status}`);
    console.log(txt.slice(0, 400));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

import { config } from "dotenv";
import { promises as fs } from "fs";
import path from "path";

config({ path: ".env.local" });

(async () => {
  const sql = await fs.readFile(
    path.join(process.cwd(), "supabase", "migration-115-workspace-integration-settings.sql"),
    "utf-8"
  );

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios");
  }

  const res = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ sql }),
  });

  if (res.ok) {
    console.log("Migration 115 aplicada via exec_sql RPC");
    return;
  }

  console.log(`exec_sql nao disponivel (${res.status}). Rode o SQL manualmente no Supabase:\n`);
  console.log(sql);
})();

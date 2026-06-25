/* eslint-disable @typescript-eslint/no-explicit-any */
import { config } from "dotenv";
import { promises as fs } from "fs";
import path from "path";

config({ path: ".env.local", quiet: true });

(async () => {
  const sql = await fs.readFile(
    path.join(process.cwd(), "supabase", "migration-123-eccosys-id-bigint.sql"),
    "utf-8"
  );
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
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
    console.log("Migration 123 aplicada via exec_sql RPC");
    return;
  }

  console.log(`exec_sql não disponível (${res.status}). Rode o SQL manualmente no Supabase SQL editor:\n`);
  console.log(sql);
})();

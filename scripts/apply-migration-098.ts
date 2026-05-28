/* eslint-disable @typescript-eslint/no-explicit-any */
// Aplica migration-098-customer-gender-inference.sql via service_role
// Uso: npx tsx scripts/apply-migration-098.ts

import { config } from "dotenv";
import { promises as fs } from "fs";
import path from "path";

config({ path: ".env.local" });

(async () => {
  const sql = await fs.readFile(
    path.join(process.cwd(), "supabase", "migration-098-customer-gender-inference.sql"),
    "utf-8"
  );
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
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
    console.log("Migration 098 aplicada via exec_sql RPC");
    return;
  }
  console.log(`exec_sql não disponível (${res.status}). SQL pra rodar manual:\n`);
  console.log(sql);
})();

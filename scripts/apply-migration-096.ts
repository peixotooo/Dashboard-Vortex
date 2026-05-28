/* eslint-disable @typescript-eslint/no-explicit-any */
// Aplica migration-096-gift-request-sync.sql via service_role
// Uso: npx tsx scripts/apply-migration-096.ts

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { promises as fs } from "fs";
import path from "path";

config({ path: ".env.local" });

void createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim(),
  (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
);

(async () => {
  const sql = await fs.readFile(
    path.join(process.cwd(), "supabase", "migration-096-gift-request-sync.sql"),
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
    console.log("Migration 096 aplicada via exec_sql RPC");
    return;
  }
  console.log(`exec_sql não disponível (${res.status}). SQL pra rodar manual:\n`);
  console.log(sql);
})();

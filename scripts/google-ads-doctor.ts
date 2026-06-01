/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
/**
 * Google Ads connection doctor.
 *
 * Diagnoses an existing Google Ads API configuration end-to-end and tells you the
 * exact fix for each failure mode (test-token trap, expired refresh token, wrong
 * customer ID / missing MCC login-customer-id, sunset API version).
 *
 * Run: npx tsx scripts/google-ads-doctor.ts
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const E = (k: string) => (process.env[k] || "").trim();
const CLIENT_ID = E("GOOGLE_ADS_CLIENT_ID");
const CLIENT_SECRET = E("GOOGLE_ADS_CLIENT_SECRET");
const REFRESH = E("GOOGLE_ADS_REFRESH_TOKEN");
const DEV = E("GOOGLE_ADS_DEVELOPER_TOKEN");
const CUST = E("GOOGLE_ADS_CUSTOMER_ID").replace(/-/g, "");
const LOGIN = E("GOOGLE_ADS_LOGIN_CUSTOMER_ID").replace(/-/g, "");
const VER = E("GOOGLE_ADS_API_VERSION") || "v24";

function line(ok: boolean, label: string, extra = "") {
  console.log(`  ${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

async function main() {
  console.log("\n=== Google Ads Doctor ===\n");
  console.log("1) Variaveis de ambiente (.env.local):");
  line(!!CLIENT_ID, "GOOGLE_ADS_CLIENT_ID");
  line(!!CLIENT_SECRET, "GOOGLE_ADS_CLIENT_SECRET");
  line(!!REFRESH, "GOOGLE_ADS_REFRESH_TOKEN");
  line(!!DEV, "GOOGLE_ADS_DEVELOPER_TOKEN");
  line(!!CUST, "GOOGLE_ADS_CUSTOMER_ID", CUST ? `(${CUST})` : "obrigatorio");
  line(true, "GOOGLE_ADS_LOGIN_CUSTOMER_ID", LOGIN ? `(${LOGIN}) — modo MCC` : "(vazio — conta direta, ok)");
  console.log(`  ℹ️  GOOGLE_ADS_API_VERSION = ${VER}`);

  const missing = [
    ["GOOGLE_ADS_CLIENT_ID", CLIENT_ID],
    ["GOOGLE_ADS_CLIENT_SECRET", CLIENT_SECRET],
    ["GOOGLE_ADS_REFRESH_TOKEN", REFRESH],
    ["GOOGLE_ADS_DEVELOPER_TOKEN", DEV],
    ["GOOGLE_ADS_CUSTOMER_ID", CUST],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length) {
    console.log("\n❌ Faltam variaveis: " + missing.join(", "));
    console.log("   Gere o refresh token com: npx tsx scripts/google-ads-auth.ts");
    console.log("   Passo a passo completo: docs/google-ads-setup.md\n");
    process.exit(1);
  }

  console.log("\n2) Renovando access token (OAuth refresh)...");
  let accessToken = "";
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: REFRESH,
        grant_type: "refresh_token",
      }),
    });
    const j: any = await r.json();
    if (!r.ok) {
      if (JSON.stringify(j).includes("invalid_grant")) {
        console.log("  ❌ invalid_grant — refresh token expirado ou revogado.");
        console.log("     Causa provavel: tela de consentimento OAuth em modo 'Testing' (expira em 7 dias).");
        console.log("     Solucao: publique o app ('In production') e rode 'npx tsx scripts/google-ads-auth.ts'.\n");
      } else {
        console.log("  ❌ Falha no OAuth: " + JSON.stringify(j) + "\n");
      }
      process.exit(1);
    }
    accessToken = j.access_token;
    line(true, "Access token renovado");
  } catch (e) {
    console.log("  ❌ " + (e as Error).message);
    process.exit(1);
  }

  console.log("\n3) listAccessibleCustomers (developer token + escopo)...");
  const lr = await fetch(`https://googleads.googleapis.com/${VER}/customers:listAccessibleCustomers`, {
    headers: { Authorization: `Bearer ${accessToken}`, "developer-token": DEV },
  });
  const lb = await lr.text();
  if (!lr.ok) {
    diagnose(lr.status, lb);
    process.exit(1);
  }
  const ids: string[] = (JSON.parse(lb).resourceNames || []).map((x: string) => x.split("/")[1]);
  line(true, "Acesso a API ok", `${ids.length} conta(s) acessivel(is)`);
  if (CUST && !ids.includes(CUST)) {
    console.log(`     ⚠️  ${CUST} nao esta na lista de contas diretamente acessiveis.`);
    console.log("        Se a conta esta sob uma MCC, isso e normal — confirme o login-customer-id.");
  }

  console.log(`\n4) Query de campanhas na conta configurada (${CUST})...`);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": DEV,
    "Content-Type": "application/json",
  };
  if (LOGIN) headers["login-customer-id"] = LOGIN;
  const qr = await fetch(`https://googleads.googleapis.com/${VER}/customers/${CUST}/googleAds:searchStream`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query:
        "SELECT campaign.id, campaign.name, metrics.cost_micros FROM campaign " +
        "WHERE segments.date DURING LAST_30_DAYS ORDER BY metrics.cost_micros DESC LIMIT 5",
    }),
  });
  const qb = await qr.text();
  if (!qr.ok) {
    diagnose(qr.status, qb);
    process.exit(1);
  }
  const rows: any[] = [];
  try {
    const arr = JSON.parse(qb);
    for (const b of Array.isArray(arr) ? arr : []) rows.push(...(b.results || []));
  } catch {
    /* ignore parse */
  }
  line(true, "Query de campanhas ok", `${rows.length} campanha(s) nos ultimos 30 dias`);
  for (const r of rows) {
    const spend = (Number(r.metrics?.costMicros || 0) / 1e6).toFixed(2);
    console.log(`     • ${r.campaign?.name} (gasto 30d: ${spend})`);
  }

  console.log("\n✅ Tudo funcionando 100%. A pagina /google-ads deve carregar dados reais.\n");
}

function diagnose(status: number, body: string) {
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }
  const errObj = Array.isArray(parsed) ? parsed[0]?.error : parsed?.error;
  const gaErr = errObj?.details?.[0]?.errors?.[0];
  const codeKey = gaErr?.errorCode ? (Object.values(gaErr.errorCode)[0] as string) : undefined;
  console.log(
    `  ❌ Erro ${status}${codeKey ? ` (${codeKey})` : ""}: ${(gaErr?.message || errObj?.message || body).slice(0, 300)}`
  );

  if (codeKey === "DEVELOPER_TOKEN_NOT_APPROVED") {
    console.log("\n  👉 ESTE e o motivo classico do 'nunca funcionou 100%'.");
    console.log("     O developer token so acessa contas de TESTE.");
    console.log("     Google Ads (conta MANAGER) > API Center > 'Apply for Basic Access' (~2 dias uteis).");
  } else if (codeKey === "CUSTOMER_NOT_FOUND") {
    console.log("\n  👉 Verifique GOOGLE_ADS_CUSTOMER_ID (so digitos, sem hifens).");
    console.log("     Se a conta esta sob MCC, defina GOOGLE_ADS_LOGIN_CUSTOMER_ID com o ID da manager.");
  } else if (status === 404 && !codeKey) {
    console.log(`\n  👉 404 — a versao '${VER}' pode ter sido descontinuada (sunset).`);
    console.log("     Defina GOOGLE_ADS_API_VERSION para uma versao suportada");
    console.log("     (veja https://developers.google.com/google-ads/api/docs/release-notes).");
  } else if (codeKey === "USER_PERMISSION_DENIED") {
    console.log("\n  👉 O usuario do OAuth nao tem acesso a essa conta, ou falta login-customer-id (MCC).");
  }
  console.log("");
}

main().catch((e) => {
  console.error("\n❌ " + (e instanceof Error ? e.message : String(e)) + "\n");
  process.exit(1);
});

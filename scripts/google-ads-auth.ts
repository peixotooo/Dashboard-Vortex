/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
/**
 * Google Ads OAuth bootstrap.
 *
 * Mints a long-lived OAuth 2.0 refresh token for the Google Ads API using a local
 * loopback redirect (the OOB copy/paste flow is deprecated). If a developer token
 * is already present, it then lists the accounts you can access so you can pick
 * GOOGLE_ADS_CUSTOMER_ID (and GOOGLE_ADS_LOGIN_CUSTOMER_ID for MCC setups).
 *
 * Prereqs (see docs/google-ads-setup.md):
 *   - GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET in .env.local
 *     (OAuth client of type "Desktop app", from Google Cloud Console)
 *   - OAuth consent screen PUBLISHED ("In production") — otherwise the refresh
 *     token expires after 7 days.
 *
 * Run: npx tsx scripts/google-ads-auth.ts
 */
import http from "node:http";
import crypto from "node:crypto";
import { exec } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env.local" });

const CLIENT_ID = (process.env.GOOGLE_ADS_CLIENT_ID || "").trim();
const CLIENT_SECRET = (process.env.GOOGLE_ADS_CLIENT_SECRET || "").trim();
const DEV_TOKEN = (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim();
const LOGIN = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").trim().replace(/-/g, "");
const API_VERSION = (process.env.GOOGLE_ADS_API_VERSION || "v24").trim();
const SCOPE = "https://www.googleapis.com/auth/adwords";
const PORT = Number(process.env.GOOGLE_ADS_OAUTH_PORT || 4848);
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;

function fail(msg: string): never {
  console.error("\n❌ " + msg + "\n");
  process.exit(1);
}

function openBrowser(url: string) {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {
    /* if it fails, the URL is printed for manual paste */
  });
}

function formatId(id: string): string {
  return id.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3");
}

if (!CLIENT_ID || !CLIENT_SECRET) {
  fail(
    "Defina GOOGLE_ADS_CLIENT_ID e GOOGLE_ADS_CLIENT_SECRET no .env.local antes de rodar.\n" +
      "   Crie um OAuth client do tipo 'Desktop app' em Google Cloud Console > APIs & Services > Credentials.\n" +
      "   Passo a passo completo: docs/google-ads-setup.md"
  );
}

async function main() {
  const state = crypto.randomBytes(16).toString("hex");
  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent",
      state,
    }).toString();

  const code: string = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || "/", REDIRECT_URI);
      if (reqUrl.pathname !== "/") {
        res.writeHead(404);
        res.end();
        return;
      }
      const err = reqUrl.searchParams.get("error");
      const gotCode = reqUrl.searchParams.get("code");
      const gotState = reqUrl.searchParams.get("state");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });

      if (err) {
        res.end(`<h2>Erro de OAuth: ${err}</h2><p>Pode fechar esta aba.</p>`);
        server.close();
        reject(new Error("OAuth negado: " + err));
        return;
      }
      if (gotState !== state) {
        res.end("<h2>State invalido (possivel CSRF). Rode o script de novo.</h2>");
        server.close();
        reject(new Error("state mismatch — abortando por seguranca"));
        return;
      }
      res.end(
        "<h2>✅ Autorizado!</h2><p>Pode fechar esta aba e voltar ao terminal.</p>"
      );
      server.close();
      resolve(gotCode || "");
    });

    server.on("error", (e: any) => {
      if (e.code === "EADDRINUSE") {
        reject(
          new Error(
            `Porta ${PORT} em uso. Rode com outra porta: GOOGLE_ADS_OAUTH_PORT=4849 npx tsx scripts/google-ads-auth.ts`
          )
        );
      } else {
        reject(e);
      }
    });

    server.listen(PORT, "127.0.0.1", () => {
      console.log(`\n🔑 Abrindo o navegador para autorizar (loopback em ${REDIRECT_URI})...`);
      console.log("   Se nao abrir sozinho, cole esta URL no navegador:\n\n   " + authUrl + "\n");
      console.log("   (Se aparecer 'Google nao verificou este app', clique Avancado > Continuar.)\n");
      openBrowser(authUrl);
    });
  });

  if (!code) fail("Nao recebi o authorization code.");

  // Exchange code -> tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const tokenJson: any = await tokenRes.json();
  if (!tokenRes.ok) fail("Falha na troca do code por token: " + JSON.stringify(tokenJson));

  const refreshToken: string | undefined = tokenJson.refresh_token;
  const accessToken: string | undefined = tokenJson.access_token;

  if (!refreshToken) {
    fail(
      "O Google nao retornou refresh_token. Causas comuns:\n" +
        "   - voce ja havia consentido antes (revogue em https://myaccount.google.com/permissions e rode de novo);\n" +
        "   - o OAuth client nao e do tipo 'Desktop app'.\n" +
        "   O script ja envia access_type=offline e prompt=consent, entao normalmente e um dos itens acima."
    );
  }

  console.log("\n========================================================");
  console.log("✅ REFRESH TOKEN gerado. Cole no .env.local (e na Vercel):\n");
  console.log("GOOGLE_ADS_REFRESH_TOKEN=" + refreshToken);
  console.log("========================================================\n");

  if (!DEV_TOKEN) {
    console.log("ℹ️  GOOGLE_ADS_DEVELOPER_TOKEN ainda nao esta no .env.local — pulei a descoberta de contas.");
    console.log("   Configure o developer token e rode: npx tsx scripts/google-ads-doctor.ts\n");
    return;
  }

  console.log("🔎 Buscando contas acessiveis (listAccessibleCustomers)...\n");
  const listRes = await fetch(
    `https://googleads.googleapis.com/${API_VERSION}/customers:listAccessibleCustomers`,
    { headers: { Authorization: `Bearer ${accessToken}`, "developer-token": DEV_TOKEN } }
  );
  const listBody = await listRes.text();
  if (!listRes.ok) {
    explainAdsError(listRes.status, listBody);
    return;
  }

  const ids: string[] = (JSON.parse(listBody).resourceNames || []).map((rn: string) =>
    rn.split("/")[1]
  );
  if (!ids.length) {
    console.log("Nenhuma conta acessivel para este usuario OAuth.");
    return;
  }

  console.log(`Encontrei ${ids.length} conta(s):\n`);
  for (const id of ids) {
    let detail = "(sem detalhes)";
    try {
      const q =
        "SELECT customer.id, customer.descriptive_name, customer.manager, " +
        "customer.test_account, customer.currency_code, customer.time_zone FROM customer";
      const r = await fetch(
        `https://googleads.googleapis.com/${API_VERSION}/customers/${id}/googleAds:search`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "developer-token": DEV_TOKEN,
            "Content-Type": "application/json",
            // Use the configured MCC manager id, else the account's own id, so that
            // accounts nested under a manager resolve their name instead of 403'ing.
            "login-customer-id": LOGIN || id,
          },
          body: JSON.stringify({ query: q }),
        }
      );
      const rb = await r.text();
      if (r.ok) {
        const c = (JSON.parse(rb).results || [])[0]?.customer || {};
        const flags = [
          c.manager ? "MANAGER/MCC" : "cliente",
          c.testAccount ? "TESTE" : "real",
          c.currencyCode,
          c.timeZone,
        ]
          .filter(Boolean)
          .join(", ");
        detail = `${c.descriptiveName || "(sem nome)"} — ${flags}`;
      }
    } catch {
      /* keep default detail */
    }
    console.log(`  • ${formatId(id)}   ${detail}`);
  }

  console.log("\n👉 Use o ID de uma conta real e NAO-manager como GOOGLE_ADS_CUSTOMER_ID (so digitos, sem hifen).");
  console.log("   Se essa conta estiver sob uma MANAGER/MCC, use o ID da manager como GOOGLE_ADS_LOGIN_CUSTOMER_ID.");
  console.log("   Depois valide tudo com: npx tsx scripts/google-ads-doctor.ts\n");
}

function explainAdsError(status: number, body: string) {
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }
  const errObj = Array.isArray(parsed) ? parsed[0]?.error : parsed?.error;
  const gaErr = errObj?.details?.[0]?.errors?.[0];
  const codeKey = gaErr?.errorCode ? Object.values(gaErr.errorCode)[0] : undefined;

  if (codeKey === "DEVELOPER_TOKEN_NOT_APPROVED") {
    console.log("⚠️  DEVELOPER_TOKEN_NOT_APPROVED — o developer token so acessa contas de TESTE.");
    console.log("    Este e o motivo classico do 'nunca funcionou 100%'. Solucao:");
    console.log("    Google Ads (conta MANAGER) > API Center > 'Apply for Basic Access' (~2 dias uteis).\n");
    return;
  }
  if (status === 404) {
    console.log(
      `⚠️  404 — a versao da API (${API_VERSION}) pode ter sido descontinuada. ` +
        "Defina GOOGLE_ADS_API_VERSION para uma versao suportada " +
        "(veja https://developers.google.com/google-ads/api/docs/release-notes).\n"
    );
    return;
  }
  console.log(`⚠️  Erro ${status}${codeKey ? ` (${codeKey})` : ""}: ${(gaErr?.message || body).slice(0, 400)}\n`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));

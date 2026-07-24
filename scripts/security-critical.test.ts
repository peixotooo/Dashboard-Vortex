import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server.js";
import {
  createOAuthState,
  oauthNonceMatches,
  parseOAuthState,
} from "../src/lib/security/oauth-state.ts";
import { canAccessFeature } from "../src/lib/features.ts";
import { normalizePublicBrowserUrl } from "../src/lib/security/external-url.ts";
import { sanitizeEmailHtml } from "../src/lib/email-templates/tracking.ts";
import { sanitizeStorefrontRichHtml } from "../src/lib/security/storefront-rich-html.ts";
import {
  getWebhookSecret,
  readLimitedJson,
  secretsEqual,
} from "../src/lib/security/webhook-request.ts";

const ROOT = process.cwd();

test("middleware validates the Supabase user instead of trusting getSession", async () => {
  const source = await readFile(path.join(ROOT, "src/middleware.ts"), "utf8");

  assert.match(source, /supabase\.auth\.getUser\(\)/);
  assert.doesNotMatch(source, /supabase\.auth\.getSession\(\)/);
});

test("public storefront routes remain outside dashboard authentication", async () => {
  const source = await readFile(path.join(ROOT, "src/middleware.ts"), "utf8");

  for (const route of ["/g", "/bio", "/chat", "/shelves.js", "/assistant.js"]) {
    assert.match(source, new RegExp(`"${route.replace(".", "\\.")}"`));
  }
});

test("commercial CSV exports are not kept in public", async () => {
  const files = await readdir(path.join(ROOT, "public"));
  const removedExports = [
    "cadastro-gladiator-preta-exemplo - Worksheet (1).csv",
    "cadastro-gladiator-preta-exemplo - Worksheet.csv",
    "produtos_2026-04-09-17-16-24.csv",
  ];
  const vercelIgnore = await readFile(path.join(ROOT, ".vercelignore"), "utf8");

  for (const file of removedExports) {
    assert.equal(files.includes(file), false);
  }
  assert.match(vercelIgnore, /^public\/\*\.csv$/m);
});

test("iPORTO operational RPCs are restricted to service_role", async () => {
  const source = await readFile(
    path.join(ROOT, "supabase/migration-144-security-critical-rpc-grants.sql"),
    "utf8"
  );

  assert.match(
    source,
    /revoke all on function public\.claim_iporto_envios\(integer\)[\s\S]*from public, anon, authenticated/
  );
  assert.match(
    source,
    /grant execute on function public\.claim_iporto_envios\(integer\) to service_role/
  );
  assert.match(
    source,
    /revoke all on function public\.requeue_iporto_envio\(bigint, text, integer\)[\s\S]*from public, anon, authenticated/
  );
});

test("OAuth state is scoped to a valid workspace and verified in constant time", () => {
  const workspaceId = "123e4567-e89b-42d3-a456-426614174000";
  const { nonce, state } = createOAuthState(workspaceId);

  assert.deepEqual(parseOAuthState(state), { nonce, workspaceId });
  assert.equal(oauthNonceMatches(nonce, nonce), true);
  assert.equal(oauthNonceMatches("0".repeat(32), nonce), false);
  assert.equal(parseOAuthState(`${nonce}:not-a-workspace`), null);
});

test("OAuth routes require workspace admin authorization before token writes", async () => {
  const routes = [
    "src/app/api/ml/auth/route.ts",
    "src/app/api/ml/callback/route.ts",
    "src/app/api/tiktok/auth/route.ts",
    "src/app/api/tiktok/callback/route.ts",
  ];

  for (const route of routes) {
    const source = await readFile(path.join(ROOT, route), "utf8");
    assert.match(source, /getWorkspaceAdminContext/);
  }
});

test("commercial analytics endpoints require authenticated workspace access", async () => {
  const ga4 = await readFile(
    path.join(ROOT, "src/app/api/ga4/insights/route.ts"),
    "utf8"
  );
  const googleAds = await readFile(
    path.join(ROOT, "src/app/api/google-ads/accounts/route.ts"),
    "utf8"
  );

  assert.match(ga4, /await getWorkspaceContext\(request\)/);
  assert.match(googleAds, /await getWorkspaceAdminContext\(request\)/);
});

test("public CAPI verifies storefront origin and browser purchases", async () => {
  const source = await readFile(
    path.join(ROOT, "src/app/api/meta-capi/route.ts"),
    "utf8"
  );

  assert.match(source, /isWorkspaceStorefrontOrigin/);
  assert.match(source, /verifyBrowserPurchase/);
  assert.match(source, /purchase_not_verified/);
  assert.doesNotMatch(source, /body\.ip\s*\|\|/);
});

test("server feature authorization preserves parent and legacy grants", () => {
  assert.equal(canAccessFeature("loja.reviews", "member", ["loja.reviews"]), true);
  assert.equal(canAccessFeature("loja.reviews", "member", ["loja"]), true);
  assert.equal(canAccessFeature("loja.reviews", "member", []), false);
  assert.equal(canAccessFeature("loja.reviews", "member", null), true);
  assert.equal(canAccessFeature("controladoria", "member", null), false);
  assert.equal(canAccessFeature("controladoria", "admin", []), true);
  assert.equal(canAccessFeature("loja.gift_request", "member", ["loja"]), true);
  assert.equal(canAccessFeature("loja.topbar", "member", []), false);
});

test("authenticated mutations have centralized origin and feature checks", async () => {
  const source = await readFile(path.join(ROOT, "src/lib/api-auth.ts"), "utf8");

  assert.match(source, /export function assertTrustedMutationOrigin/);
  assert.match(source, /fetchSite === "cross-site"/);
  assert.match(source, /trustedDashboardOrigins\(request\)\.has\(origin\)/);
  assert.match(source, /\["\/api\/topbar", \["loja\.topbar"\]\]/);
  assert.match(source, /\["\/api\/gift-request", \["loja\.gift_request"\]\]/);
});

test("legacy webhooks accept headers safely and enforce body limits", async () => {
  const bearerRequest = new NextRequest("https://dash.example/api/webhook", {
    method: "POST",
    headers: { authorization: "Bearer secret-value" },
    body: JSON.stringify({ ok: true }),
  });
  assert.equal(getWebhookSecret(bearerRequest), "secret-value");
  assert.equal(secretsEqual("same-secret", "same-secret"), true);
  assert.equal(secretsEqual("same-secret", "other-secret"), false);

  const validBody = await readLimitedJson(bearerRequest, 100);
  assert.equal(validBody.ok, true);
  const oversized = await readLimitedJson(
    new NextRequest("https://dash.example/api/webhook", {
      method: "POST",
      body: JSON.stringify({ value: "x".repeat(100) }),
    }),
    32
  );
  assert.deepEqual(oversized, {
    ok: false,
    status: 413,
    error: "payload_too_large",
  });
});

test("rate limiting and private import storage are migration-backed", async () => {
  const rateMigration = await readFile(
    path.join(ROOT, "supabase/migration-145-security-rate-limits.sql"),
    "utf8"
  );
  const storageMigration = await readFile(
    path.join(ROOT, "supabase/migration-146-private-email-import-storage.sql"),
    "utf8"
  );
  const storageHelper = await readFile(
    path.join(ROOT, "src/lib/email-templates/import-storage.ts"),
    "utf8"
  );

  assert.match(rateMigration, /consume_security_rate_limit/);
  assert.match(rateMigration, /grant execute[\s\S]*to service_role/i);
  assert.match(storageMigration, /set public = false/);
  assert.match(storageHelper, /createSignedUrl/);
  assert.doesNotMatch(storageHelper, /object\/public/);
});

test("Mercado Livre webhook verifies source and schedules guaranteed after-work", async () => {
  const source = await readFile(
    path.join(ROOT, "src/app/api/ml/webhook/route.ts"),
    "utf8"
  );

  assert.match(source, /DEFAULT_ML_WEBHOOK_IPS/);
  assert.match(source, /isTrustedWebhookIp/);
  assert.match(source, /consumeSecurityRateLimit/);
  assert.match(source, /after\(\(\) => processNotification/);
  assert.match(source, /\^\\\/orders\\\/\\d\+\$/);
});

test("security headers and patched runtime dependencies stay enabled", async () => {
  const config = await readFile(path.join(ROOT, "next.config.ts"), "utf8");
  const pkg = JSON.parse(
    await readFile(path.join(ROOT, "package.json"), "utf8")
  ) as {
    dependencies: Record<string, string>;
    overrides: Record<string, unknown>;
  };

  assert.match(config, /X-Content-Type-Options/);
  assert.match(config, /strict-origin-when-cross-origin/);
  assert.match(config, /object-src 'none'/);
  assert.equal(pkg.dependencies.next, "16.2.11");
  assert.equal(pkg.overrides["brace-expansion"], "5.0.7");
});

test("Meta MCP stays admin-only, opt-in, workspace-scoped, and read-only by default", async () => {
  const route = await readFile(
    path.join(ROOT, "src/app/api/mcp/route.ts"),
    "utf8"
  );
  const client = await readFile(
    path.join(ROOT, "src/lib/mcp-client.ts"),
    "utf8"
  );

  assert.match(route, /getWorkspaceAdminContext\(request\)/);
  assert.match(route, /ENABLE_META_MCP_API !== "true"/);
  assert.match(route, /META_MCP_ALLOWED_WORKSPACE_IDS/);
  assert.match(route, /DEFAULT_READ_ONLY_TOOLS/);
  assert.match(route, /META_MCP_ALLOWED_TOOLS/);
  assert.match(route, /consumeSecurityRateLimit/);
  assert.match(client, /meta-ads-mcp@1\.1\.0/);
});

test("public browser URLs reject executable and local targets", () => {
  assert.equal(normalizePublicBrowserUrl("javascript:alert(1)"), null);
  assert.equal(normalizePublicBrowserUrl("http://127.0.0.1/private"), null);
  assert.equal(normalizePublicBrowserUrl("https://example.com/image.jpg")?.startsWith("https://example.com/"), true);
});

test("storefront HTML sinks use escaped URLs and text-node templates", async () => {
  const source = await readFile(path.join(ROOT, "public/shelves.js"), "utf8");
  const cartRecovery = await readFile(
    path.join(ROOT, "src/app/(dashboard)/crm/cart-recovery/page.tsx"),
    "utf8"
  );

  assert.match(source, /function safeUrlAttr/);
  assert.match(source, /function renderBadgeTemplate/);
  assert.doesNotMatch(source, /badge\.innerHTML = template/);
  assert.doesNotMatch(cartRecovery, /dangerouslySetInnerHTML/);
  assert.match(cartRecovery, /sandbox=""/);
});

test("cashback reminder reset is tenant scoped", async () => {
  const source = await readFile(
    path.join(
      ROOT,
      "src/app/api/cashback/transactions/[id]/force-reminder/route.ts"
    ),
    "utf8"
  );
  const resetBlock = source.slice(
    source.indexOf("const { error: resetError }"),
    source.indexOf("const { data: cb }")
  );

  assert.match(resetBlock, /\.eq\("workspace_id", auth!\.workspaceId\)/);
  assert.match(resetBlock, /\.eq\("id", id\)/);
});

test("email sanitization preserves layout and removes executable markup", () => {
  const input =
    '<!doctype html><html><head><style>@import "https://evil.invalid/x.css";' +
    ".hero{color:#111}</style></head><body>" +
    '<table width="600" style="width:600px"><tr><td>{{customer_name}}</td></tr></table>' +
    '<a href="javascript:alert(1)" onclick="alert(1)">link</a>' +
    '<img src="https://example.com/p.jpg" onerror="alert(1)">' +
    "<script>alert(1)</script></body></html>";
  const output = sanitizeEmailHtml(input);

  assert.match(output, /<table/);
  assert.match(output, /\{\{customer_name\}\}/);
  assert.match(output, /\.hero\{color:#111\}/);
  assert.match(output, /https:\/\/example\.com\/p\.jpg/);
  assert.doesNotMatch(output, /<script/i);
  assert.doesNotMatch(output, /onerror|onclick|javascript:/i);
  assert.doesNotMatch(output, /@import/i);
});

test("storefront rich text keeps formatting without executable markup", () => {
  const output = sanitizeStorefrontRichHtml(
    '<p onclick="alert(1)"><strong>Envio</strong> em 24h</p>' +
      '<a href="javascript:alert(1)">detalhes</a><script>alert(1)</script>'
  );

  assert.match(output, /<strong>Envio<\/strong>/);
  assert.doesNotMatch(output, /onclick|javascript:|script/i);
});

test("storefront mutations use exact workspace-aware CORS", async () => {
  const cors = await readFile(path.join(ROOT, "src/lib/cors.ts"), "utf8");
  const origin = await readFile(
    path.join(ROOT, "src/lib/security/storefront-origin.ts"),
    "utf8"
  );
  const events = await readFile(
    path.join(ROOT, "src/app/api/assistant/events/route.ts"),
    "utf8"
  );

  assert.match(cors, /isWorkspaceStorefrontOrigin/);
  assert.match(origin, /originsFromStoreHost/);
  assert.doesNotMatch(cors, /Access-Control-Allow-Origin.*origin/);
  assert.match(events, /getStorefrontCors\(request, auth\.workspaceId\)/);
  assert.match(events, /consumeSecurityRateLimit/);
});

test("CMV public-file import is confined to a direct CSV under public", async () => {
  const route = await readFile(
    path.join(ROOT, "src/app/api/pricing/import/cmv/route.ts"),
    "utf8"
  );

  assert.match(route, /filename !== path\.basename\(filename\)/);
  assert.match(route, /path\.dirname\(candidate\) !== publicRoot/);
  assert.match(route, /linkStat\.isSymbolicLink\(\)/);
  assert.match(route, /MAX_CSV_BYTES/);
});

test("workspace role hierarchy protects owners and admin promotion", async () => {
  const route = await readFile(
    path.join(ROOT, "src/app/api/workspaces/route.ts"),
    "utf8"
  );

  assert.match(route, /targetMember\.role === "owner"/);
  assert.match(route, /Apenas o proprietário pode promover ou rebaixar administradores/);
  assert.match(route, /inviteRole === "admin" && role !== "owner"/);
  assert.match(route, /assertTrustedMutationOrigin\(request\)/);
  assert.doesNotMatch(route, /Auto-generate webhook token/);
});

test("review submission claims the invitation before inserting reviews", async () => {
  const route = await readFile(
    path.join(ROOT, "src/app/api/reviews/request/[token]/route.ts"),
    "utf8"
  );

  const claimAt = route.indexOf('.update({ status: "submitting"');
  const insertAt = route.indexOf('.from("reviews").insert(rows)');
  assert.ok(claimAt > 0);
  assert.ok(insertAt > claimAt);
  assert.match(route, /\.eq\("status", originalStatus\)/);
  assert.match(route, /\.is\("review_id", null\)/);
});

test("iframe message handlers verify the communicating window", async () => {
  const page = await readFile(
    path.join(
      ROOT,
      "src/app/(dashboard)/crm/email-templates/editor/[id]/page.tsx"
    ),
    "utf8"
  );
  const renderer = await readFile(
    path.join(ROOT, "src/lib/email-templates/editor/render.ts"),
    "utf8"
  );

  assert.match(page, /e\.source !== iframeRef\.current\?\.contentWindow/);
  assert.match(renderer, /e\.source!==parent/);
});

test("record-by-id routes scope reads and writes to the active workspace", async () => {
  const routes = [
    "src/app/api/team/projects/[id]/route.ts",
    "src/app/api/team/tasks/[id]/route.ts",
    "src/app/api/team/deliverables/[id]/route.ts",
    "src/app/api/marketing/actions/[id]/route.ts",
  ];

  for (const route of routes) {
    const source = await readFile(path.join(ROOT, route), "utf8");
    assert.match(source, /getWorkspaceContext\(request\)/);
    assert.match(source, /workspaceId/);
  }
});

test("credentialed external requests validate destinations and redirects", async () => {
  const externalUrl = await readFile(
    path.join(ROOT, "src/lib/security/external-url.ts"),
    "utf8"
  );
  const vnda = await readFile(path.join(ROOT, "src/lib/vnda-api.ts"), "utf8");
  const iporto = await readFile(
    path.join(ROOT, "src/lib/iporto/email-marketing.ts"),
    "utf8"
  );
  const locaweb = await readFile(
    path.join(ROOT, "src/lib/locaweb/email-marketing.ts"),
    "utf8"
  );

  assert.match(externalUrl, /headers\.delete\("authorization"\)/);
  assert.match(externalUrl, /reader\.cancel\(\)/);
  assert.match(vnda, /fetchPublicHttpUrl\(url\.toString\(\), init/);
  assert.match(vnda, /allowCrossOriginRedirects: false/);
  assert.match(iporto, /allowCrossOriginRedirects: false/);
  assert.match(locaweb, /allowCrossOriginRedirects: false/);
});

test("internal route chaining does not forward secrets to a Host-derived URL", async () => {
  const mlWebhook = await readFile(
    path.join(ROOT, "src/app/api/ml/webhook/route.ts"),
    "utf8"
  );
  const republish = await readFile(
    path.join(ROOT, "src/app/api/sync/republish-ml/route.ts"),
    "utf8"
  );

  assert.match(mlWebhook, /pullMercadoLivreOrder\(internalRequest\)/);
  assert.match(republish, /pushToMercadoLivre\(pushRequest\)/);
  assert.doesNotMatch(mlWebhook, /fetch\(\s*new URL\("\/api\/sync/);
  assert.doesNotMatch(republish, /fetch\(`\$\{origin\}/);
});

test("integration credential mutations require workspace administrators", async () => {
  const routes = [
    "src/app/api/crm/whatsapp/config/route.ts",
    "src/app/api/reviews/connection/route.ts",
    "src/app/api/whatsapp-groups/config/route.ts",
    "src/app/api/crm/email-templates/provider/route.ts",
    "src/app/api/crm/email-templates/iporto/settings/route.ts",
    "src/app/api/crm/email-templates/locaweb/settings/route.ts",
    "src/app/api/meta-capi/settings/route.ts",
  ];

  for (const route of routes) {
    const source = await readFile(path.join(ROOT, route), "utf8");
    assert.match(source, /getWorkspaceAdminContext\(/);
  }
});

test("database grants cannot bypass workspace hierarchy checks", async () => {
  const migration = await readFile(
    path.join(ROOT, "supabase/migration-144-security-critical-rpc-grants.sql"),
    "utf8"
  );

  assert.match(
    migration,
    /revoke insert, update, delete on table public\.workspace_members[\s\S]*from anon, authenticated/
  );
  assert.match(
    migration,
    /revoke update, delete on table public\.workspaces[\s\S]*from anon, authenticated/
  );
  assert.match(
    migration,
    /revoke update on table public\.profiles from anon, authenticated/
  );
  assert.match(migration, /set search_path = public/);
});

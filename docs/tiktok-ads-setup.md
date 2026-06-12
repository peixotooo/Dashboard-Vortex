# TikTok Ads — setup & runbook

Read-only TikTok Ads tab (campaigns + spend/ROAS), mirroring the Meta and Google
Ads tabs. Connection model = OAuth per workspace (same as Mercado Livre), with a
**durable** advertiser token (no refresh needed).

Status: **built on branch `tiktok-ads-integration`, NOT merged.** Production data is
gated on TikTok app review — ship/merge once approved. Sandbox works immediately.

## 1. TikTok developer portal

1. App → register the redirect exactly as
   `https://dash.bulking.com.br/api/tiktok/callback`.
2. Scopes (check the boxes — there is no per-request scope param):
   - Ad Account Management
   - Ads Management
   - **Reporting** ← required, or `/report/integrated/get/` returns a permission error
3. Copy the generated **Advertiser authorization URL** (it embeds `app_id`, the
   TikTok-issued `rid`, and the checked scopes) → this becomes `TIKTOK_AUTH_URL`.
4. Create a **Sandbox Ad Account** to build/validate before approval.

## 2. Env vars (Vercel + .env.local)

| Var | Value |
|---|---|
| `TIKTOK_APP_ID` | App id (client key) from the portal |
| `TIKTOK_APP_SECRET` | App secret (used as `secret` in the token exchange) |
| `TIKTOK_REDIRECT_URI` | `https://dash.bulking.com.br/api/tiktok/callback` (must match the portal exactly) |
| `TIKTOK_AUTH_URL` | The full "Advertiser authorization URL" copied from the portal |
| `TIKTOK_API_VERSION` | `v1.3` (env-configurable like `GOOGLE_ADS_API_VERSION`) |
| `ENCRYPTION_KEY` | already set — reused to encrypt the stored token |

`TIKTOK_AUTH_RID` is an optional fallback only if you don't set `TIKTOK_AUTH_URL`.

## 3. Database

Apply `supabase/migration-119-tiktok-credentials.sql` **manually** in the Supabase
SQL editor (repo convention — same as 105/106/117/118). It creates
`tiktok_credentials` (durable-token shape) and extends the `saved_campaigns` /
`saved_creatives` platform CHECK to allow `'tiktok'`.

## 4. Connect flow

1. Open `/tiktok-ads` → if not connected, click **Conectar TikTok**
   (→ `/api/tiktok/auth?workspace_id=...`).
2. Authorize on TikTok → callback `/api/tiktok/callback` exchanges `auth_code` for a
   durable token, stores it encrypted with the authorized `advertiser_ids[]`, and
   redirects back to `/tiktok-ads`.

## 5. What's where

| Piece | File |
|---|---|
| OAuth start (+CSRF cookie) | `src/app/api/tiktok/auth/route.ts` |
| OAuth callback (verifies CSRF, durable token) | `src/app/api/tiktok/callback/route.ts` |
| Credentials store (encrypt/decrypt) | `src/lib/tiktok-credentials.ts` |
| API client (campaigns + report merge) | `src/lib/tiktok-ads-api.ts` |
| Campaigns route | `src/app/api/tiktok-ads/campaigns/route.ts` |
| Accounts/advertisers route | `src/app/api/tiktok-ads/accounts/route.ts` |
| UI tab | `src/app/(dashboard)/tiktok-ads/page.tsx` |
| Nav + feature gate | `app-sidebar.tsx`, `src/lib/features.ts` (`tiktok_ads`) |
| Migration | `supabase/migration-119-tiktok-credentials.sql` |

## 6. API notes / footguns

- Base: `https://business-api.tiktok.com/open_api/v1.3`.
- Token goes in the **`Access-Token` header** (exact casing), never a query param.
- Errors come back as **HTTP 200 with `code != 0`** in the envelope — we check
  `data.code === 0`, not `res.ok`.
- GET params that are arrays/objects (`dimensions`, `metrics`, `filtering`,
  `fields`) must be **JSON-stringified** in the query.
- Money is in **account currency, no micros**. ROAS = `complete_payment_roas`;
  revenue = `spend * roas`.
- Light backoff/retry on throttle codes (40100/50002) is built into the client.

## 7. Out of scope (future parity, not built)

- **Events API** (server-side conversions, TikTok's CAPI equivalent) — needs the
  Measurement scope + a web Pixel code.
- **Write ops** (pause/resume/budget) — the Google tab is read-only by design; same
  here for v1.

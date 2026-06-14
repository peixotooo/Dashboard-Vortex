/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
/**
 * Cria uma campanha DEMAND GEN no Google Ads (atômica) a partir de criativos limpos.
 *
 * SEGURO POR PADRÃO: dry-run mostra o que será criado. Só executa com --yes.
 * A campanha é criada PAUSADA (assets passam por revisão antes de servir).
 *
 * Uso:
 *   npx tsx scripts/google-ads-create-demandgen.ts          # dry-run (valida + mostra payload)
 *   npx tsx scripts/google-ads-create-demandgen.ts --yes    # cria de verdade
 *
 * Régua de marca: docs/bulking-manifesto.md (copy do manifesto, criativo evergreen limpo).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync, existsSync } from "node:fs";

// ─────────────────────────── CONFIG ───────────────────────────
const C = {
  campaignName: "[Demand Gen] Bulking — Heavy+Army (manifesto)",
  dailyBudgetBRL: 60,
  finalUrl: "https://www.bulking.com.br",
  businessName: "Bulking", // ≤25
  callToActionText: "Saiba mais", // ≤10
  // Copy do manifesto (Frases Matriz). headlines ≤40, descriptions ≤90.
  headlines: [
    "A peça vem depois da atitude.",
    "Tem quem quer parecer. Tem quem faz.",
    "A Bulking não veste desculpa.",
    "Se precisa gritar, falta peso.",
    "Respeito vem antes da peça.",
  ],
  descriptions: [
    "Não é sobre camiseta. É sobre o que você aceita vestir todo dia.",
    "Roupa não constrói respeito. Respeito vem antes da peça.",
    "Pra quem leva o processo a sério. Se procura consolo, não é aqui.",
    "Caimento, padrão, peso. A peça acompanha quem já decidiu fazer.",
  ],
  images: {
    landscape: ["scripts/assets/demandgen-heavy-army/army_landscape.jpg"], // 1.91:1 (obrigatória)
    square: ["scripts/assets/demandgen-heavy-army/heavy_square.jpg", "scripts/assets/demandgen-heavy-army/army_square.jpg"], // 1:1 (obrigatória)
    portrait: ["scripts/assets/demandgen-heavy-army/heavy_portrait.jpg", "scripts/assets/demandgen-heavy-army/army_portrait.jpg"], // 4:5
    logo: ["public/socialbu-resized-400x400.png"], // 1:1
  },
};
// ───────────────────────────────────────────────────────────────

const YES = process.argv.includes("--yes");
const DEV = (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim();
const CID = (process.env.GOOGLE_ADS_CUSTOMER_ID || "").replace(/-/g, "");
const LOGIN = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/-/g, "");
const VER = (process.env.GOOGLE_ADS_API_VERSION || "v24").trim();

function bail(m: string): never {
  console.error("\n❌ " + m + "\n");
  process.exit(1);
}
function checkText(label: string, arr: string[], max: number) {
  for (const t of arr) if (t.length > max) bail(`${label} excede ${max} chars: "${t}" (${t.length})`);
}

async function accessToken(): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: (process.env.GOOGLE_ADS_CLIENT_ID || "").trim(),
      client_secret: (process.env.GOOGLE_ADS_CLIENT_SECRET || "").trim(),
      refresh_token: (process.env.GOOGLE_ADS_REFRESH_TOKEN || "").trim(),
      grant_type: "refresh_token",
    }),
  });
  const j: any = await r.json();
  if (!r.ok) bail("OAuth: " + JSON.stringify(j));
  return j.access_token;
}

function imgAssetOp(tempId: number, path: string) {
  if (!existsSync(path)) bail(`Imagem não encontrada: ${path}`);
  const bytes = readFileSync(path);
  if (bytes.length > 5_120_000) bail(`Imagem > 5MB: ${path}`);
  return {
    assetOperation: {
      create: {
        resourceName: `customers/${CID}/assets/${tempId}`,
        name: `bk_${path.split("/").pop()}_${-tempId}`,
        type: "IMAGE",
        imageAsset: { data: bytes.toString("base64") },
      },
    },
  };
}

async function main() {
  for (const k of ["GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN", "GOOGLE_ADS_CUSTOMER_ID"])
    if (!process.env[k]) bail(`Falta ${k} no .env.local`);

  // Validações de marca/policy
  checkText("headline", C.headlines, 40);
  checkText("description", C.descriptions, 90);
  if (C.businessName.length > 25) bail("businessName > 25");
  if (C.headlines.length < 1 || C.headlines.length > 5) bail("headlines: 1–5");
  if (C.descriptions.length < 1 || C.descriptions.length > 5) bail("descriptions: 1–5");
  if (!C.images.landscape.length) bail("landscape 1.91:1 é obrigatória");
  if (!C.images.square.length) bail("square 1:1 é obrigatória");
  if (!C.images.logo.length) bail("logo 1:1 é obrigatório");

  // Asset temp ids
  let t = -10;
  const land = C.images.landscape.map((p) => ({ p, id: t-- }));
  const sq = C.images.square.map((p) => ({ p, id: t-- }));
  const por = C.images.portrait.map((p) => ({ p, id: t-- }));
  const logo = C.images.logo.map((p) => ({ p, id: t-- }));
  const allImgs = [...land, ...sq, ...por, ...logo];

  const budgetMicros = Math.round(C.dailyBudgetBRL * 1_000_000);

  const ops: any[] = [
    { campaignBudgetOperation: { create: { resourceName: `customers/${CID}/campaignBudgets/-1`, name: `${C.campaignName} — budget`, amountMicros: String(budgetMicros), deliveryMethod: "STANDARD", explicitlyShared: false } } },
    { campaignOperation: { create: { resourceName: `customers/${CID}/campaigns/-2`, name: C.campaignName, advertisingChannelType: "DEMAND_GEN", status: "PAUSED", campaignBudget: `customers/${CID}/campaignBudgets/-1`, maximizeConversions: {}, containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING" } } },
    { adGroupOperation: { create: { resourceName: `customers/${CID}/adGroups/-3`, name: "Heavy+Army", campaign: `customers/${CID}/campaigns/-2`, status: "ENABLED" } } },
    ...allImgs.map((i) => imgAssetOp(i.id, i.p)),
    {
      adGroupAdOperation: {
        create: {
          adGroup: `customers/${CID}/adGroups/-3`,
          status: "ENABLED",
          ad: {
            finalUrls: [C.finalUrl],
            demandGenMultiAssetAd: {
              businessName: C.businessName,
              // callToActionText omitido: o campo não aceita texto livre ("Saiba mais"
              // foi rejeitado com INVALID_CALL_TO_ACTION_TEXT). Sem ele o Google usa o CTA padrão.
              headlines: C.headlines.map((text) => ({ text })),
              descriptions: C.descriptions.map((text) => ({ text })),
              marketingImages: land.map((i) => ({ asset: `customers/${CID}/assets/${i.id}` })),
              squareMarketingImages: sq.map((i) => ({ asset: `customers/${CID}/assets/${i.id}` })),
              portraitMarketingImages: por.map((i) => ({ asset: `customers/${CID}/assets/${i.id}` })),
              logoImages: logo.map((i) => ({ asset: `customers/${CID}/assets/${i.id}` })),
            },
          },
        },
      },
    },
  ];

  console.log("\n=== DEMAND GEN — plano de criação ===");
  console.log(`Conta: ${CID}${LOGIN ? ` (login-customer-id ${LOGIN})` : ""}  | API ${VER}`);
  console.log(`Campanha: "${C.campaignName}"  (PAUSADA) | Maximize Conversions | R$${C.dailyBudgetBRL}/dia`);
  console.log(`Final URL: ${C.finalUrl} | business: ${C.businessName} | CTA: ${C.callToActionText}`);
  console.log(`Imagens: ${land.length} landscape, ${sq.length} square, ${por.length} portrait, ${logo.length} logo`);
  allImgs.forEach((i) => console.log(`   - ${i.p} (${(readFileSync(i.p).length / 1024).toFixed(0)} KB)`));
  console.log(`Headlines (${C.headlines.length}): ${C.headlines.map((h) => `“${h}”`).join("  ")}`);
  console.log(`Descrições (${C.descriptions.length}):`);
  C.descriptions.forEach((d) => console.log(`   - ${d}`));
  console.log(`Total de operações no mutate atômico: ${ops.length}`);

  if (!YES) {
    console.log("\n(DRY-RUN — nada criado. Rode com --yes para criar a campanha PAUSADA.)\n");
    return;
  }

  const token = await accessToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "developer-token": DEV, "Content-Type": "application/json" };
  if (LOGIN) headers["login-customer-id"] = LOGIN;

  console.log("\n⏳ Enviando mutate atômico...");
  const res = await fetch(`https://googleads.googleapis.com/${VER}/customers/${CID}/googleAds:mutate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ mutateOperations: ops }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`\n❌ Erro ${res.status}:\n${body.slice(0, 1500)}\n`);
    process.exit(1);
  }
  const out = JSON.parse(body);
  console.log("\n✅ Campanha Demand Gen criada (PAUSADA). Recursos:");
  for (const r of out.mutateOperationResponses || []) {
    const key = Object.keys(r)[0];
    console.log(`   ${key}: ${r[key]?.resourceName || JSON.stringify(r[key])}`);
  }
  console.log("\nPróximo: revisar no painel, esperar assets aprovarem, e ativar com:");
  console.log("   npx tsx scripts/google-ads-mutate.ts enable <campaignId> --yes\n");
}

main().catch((e) => bail(e instanceof Error ? e.message : String(e)));

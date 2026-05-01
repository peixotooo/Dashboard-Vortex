// src/lib/email-templates/preview-fixture.ts
//
// Stub TemplateRenderContext used by the dashboard's Layout Library page so
// every layout can render an aesthetic preview regardless of whether GA4 / VNDA
// /CRM data is available for a given workspace. The fixture intentionally uses
// real Bulking product imagery so the previews look representative.

import type { TemplateRenderContext, Slot, ProductSnapshot } from "./types";
import { buildCountdownUrl } from "./countdown";

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "https://dash.bulking.com.br";

const PRIMARY = {
  vnda_id: "preview-1",
  name: "Camiseta Hustle Preta",
  price: 89.9,
  old_price: 119.9,
  image_url:
    "https://cdn.vnda.com.br/350x437/bulking/2024/02/06/15_8_3_307_1_camisetabasicfitprime.jpg",
  url: "https://www.bulking.com.br",
};

const RELATED = [
  {
    vnda_id: "preview-2",
    name: "Regata Hustle Verde",
    price: 79.9,
    image_url:
      "https://cdn.vnda.com.br/350x437/bulking/2024/02/06/15_8_3_307_2_camisetabasicfitprime.jpg",
    url: "https://www.bulking.com.br",
  },
  {
    vnda_id: "preview-3",
    name: "Jogger Bulking Cinza",
    price: 149.9,
    old_price: 179.9,
    image_url:
      "https://cdn.vnda.com.br/350x437/bulking/2024/02/06/15_8_3_307_3_camisetabasicfitprime.jpg",
    url: "https://www.bulking.com.br",
  },
  {
    vnda_id: "preview-4",
    name: "Boné Hustle",
    price: 59.9,
    image_url:
      "https://cdn.vnda.com.br/350x437/bulking/2024/02/06/15_8_3_307_4_camisetabasicfitprime.jpg",
    url: "https://www.bulking.com.br",
  },
];

const COPY_BY_SLOT: Record<Slot, TemplateRenderContext["copy"]> = {
  1: {
    subject: "Camiseta Hustle Preta: a peça mais vestida da semana",
    headline: "Top 1 e dá pra ver por quê.",
    lead: "Caimento pra quem treina, design feito pra durar. Quem treina escolheu essa essa semana.",
    cta_text: "Ver na loja",
    cta_url: "https://www.bulking.com.br",
  },
  2: {
    subject: "Estoque acabando: Camiseta Hustle Preta",
    headline: "Última chance pra essa.",
    lead: "Estoque acabando em Camiseta Hustle Preta. Use o cupom abaixo pra levar com 10% off.",
    cta_text: "Aproveitar agora",
    cta_url: "https://www.bulking.com.br",
  },
  3: {
    subject: "Camiseta Hustle Preta acabou de chegar",
    headline: "Acabou de chegar.",
    lead: "Camiseta Hustle Preta acabou de chegar na grade. Mesma intenção de sempre: design autoral, caimento pensado.",
    cta_text: "Conferir lançamento",
    cta_url: "https://www.bulking.com.br",
  },
};

const HOOK_BY_SLOT: Record<Slot, string> = {
  1: "O top 1 da semana",
  2: "Estoque acabando",
  3: "Acabou de chegar",
};

export function buildPreviewContext(
  slot: Slot = 1,
  override?: { primary?: ProductSnapshot; related?: ProductSnapshot[] }
): TemplateRenderContext {
  const ctx: TemplateRenderContext = {
    slot,
    product: override?.primary ?? PRIMARY,
    related_products: override?.related ?? RELATED,
    copy: COPY_BY_SLOT[slot],
    workspace: { name: "Bulking" },
    hook: HOOK_BY_SLOT[slot],
  };

  if (slot === 2) {
    const expires_at = new Date(Date.now() + 48 * 60 * 60 * 1000);
    let countdown_url = "";
    try {
      countdown_url = buildCountdownUrl({ base_url: APP_BASE_URL, expires_at });
    } catch {
      // EMAIL_COUNTDOWN_SECRET missing in dev — leave URL blank.
    }
    ctx.coupon = {
      code: "EMAIL-PREVIEW-AB12C",
      discount_percent: 10,
      expires_at,
      countdown_url,
    };
  }

  return ctx;
}

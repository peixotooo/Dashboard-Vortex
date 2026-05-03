// src/app/api/crm/email-templates/ai-compose/route.ts
//
// One-shot AI email composer. Accepts a free-form context ("promoção da
// madrugada", "lançamento camiseta gladiator", "frete grátis fim de semana")
// + a layout id + an optional product, and returns a fully-seeded tree
// draft ready to open in the editor. The LLM generates subject, preview,
// hook, headline, lead, and CTA copy aligned to the Bulking brand.
//
// Flow:
//   1) Resolve product (explicit OR auto via pickBestseller)
//   2) Pull up to 9 related products from shelf
//   3) Call OpenRouter (Haiku) with a structured prompt
//   4) Parse JSON; build tree draft via buildTreeDraftFromSuggestion
//   5) Insert into email_template_drafts; return the new draft id

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { buildTreeDraftFromSuggestion } from "@/lib/email-templates/tree/presets";
import { callLLM } from "@/lib/agent/llm-provider";
import { getSettings } from "@/lib/email-templates/settings";
import { pickBestseller } from "@/lib/email-templates/picker";
import type { ProductSnapshot, Slot } from "@/lib/email-templates/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  context: string;
  layout_id: string;
  /** Optional. If omitted, picker.pickBestseller chooses today's top item. */
  product_id?: string;
  /** Optional. Default 1 (best-seller / news vibe). 2 = slowmoving (with
   *  coupon hint), 3 = new arrival. */
  slot?: Slot;
  tone?: "urgent" | "premium" | "playful" | "minimal";
  /** Optional discount info (when context implies a promo) */
  coupon?: {
    code?: string;
    discount_percent: number;
    expires_in_hours?: number;
  };
}

interface ShelfRow {
  product_id: string;
  name: string;
  price: number | null;
  sale_price: number | null;
  image_url: string | null;
  product_url: string | null;
}

function abs(u: string | null): string {
  if (!u) return "";
  return u.startsWith("//") ? `https:${u}` : u;
}

function toSnap(r: ShelfRow): ProductSnapshot {
  return {
    vnda_id: r.product_id,
    name: r.name,
    price: Number(r.sale_price ?? r.price ?? 0),
    old_price:
      r.sale_price != null && r.price != null && Number(r.price) > Number(r.sale_price)
        ? Number(r.price)
        : undefined,
    image_url: abs(r.image_url),
    url: r.product_url ?? "",
  };
}

const SYSTEM = `You are a senior copywriter for the Bulking brand — Brazilian streetwear / fitness apparel ("Respect the Hustle"). Brand voice: direct, confident, real, premium but never showy. Monochrome aesthetic (white, black, grays). Avoid em dashes. No emojis unless the context demands urgency.

You write email copy as STRICT JSON. Never wrap the JSON in markdown fences. No commentary outside the JSON.

Schema:
{
  "subject": string (50-65 chars, optimized for Gmail snippet, sentence-friendly),
  "preview": string (60-90 chars, complement to subject — never repeats subject),
  "hook": string (10-30 chars, ALL CAPS, like "TOP 1 DA SEMANA" or "ÚLTIMA CHANCE" or "FRETE GRÁTIS"),
  "headline": string (30-65 chars, sentence form, ends with period or .),
  "lead": string (90-200 chars, 1-2 sentences, body voice, no clichês como "não perca"),
  "cta_text": string (12-24 chars, imperative, no period)
}

Always reply in pt-BR. Match the energy of the context but stay editorial — never shouty. Reference the product name only when it adds rhythm.`;

const TONE_HINT: Record<NonNullable<Body["tone"]>, string> = {
  urgent: "Tom: urgência editorial — não shouty. Prazo curto, escassez real.",
  premium: "Tom: premium e calmo — autoridade, sem hype.",
  playful: "Tom: leve, espirituoso, irreverente, sem perder elegância.",
  minimal: "Tom: minimalista, frase curta, descrição quase clínica.",
};

interface CopyOut {
  subject: string;
  preview: string;
  hook: string;
  headline: string;
  lead: string;
  cta_text: string;
}

async function generateCopyWithLLM(
  context: string,
  product: ProductSnapshot,
  tone: Body["tone"],
  coupon?: Body["coupon"]
): Promise<CopyOut> {
  const couponLine = coupon
    ? `\nCupom: ${coupon.code ?? "(gerado)"} · ${coupon.discount_percent}% off · expira em ${
        coupon.expires_in_hours ?? 48
      }h.`
    : "";
  const userPrompt = `Contexto do email: ${context}

Produto em destaque: ${product.name} · R$ ${product.price.toFixed(2)}${
    product.old_price ? ` (de R$ ${product.old_price.toFixed(2)})` : ""
  }${couponLine}
${tone ? TONE_HINT[tone] : ""}

Devolva o JSON.`;

  const resp = await callLLM({
    provider: "openrouter",
    model: "anthropic/claude-haiku-4.5",
    maxTokens: 600,
    system: SYSTEM,
    tools: [],
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = resp.content
    .filter((b: { type: string }) => b.type === "text")
    .map((b: unknown) => (b as { text: string }).text)
    .join("")
    .trim();
  const cleaned = text.replace(/^```json\s*|\s*```$/g, "").trim();
  const parsed = JSON.parse(cleaned) as Partial<CopyOut>;

  return {
    subject: parsed.subject?.trim() || `${product.name}: a peça da semana`,
    preview: parsed.preview?.trim() || `Confira ${product.name}.`,
    hook: parsed.hook?.trim().toUpperCase() || "TOP 1 DA SEMANA",
    headline: parsed.headline?.trim() || `${product.name} — top 1 da semana.`,
    lead:
      parsed.lead?.trim() ||
      "Caimento pra quem treina, design feito pra durar.",
    cta_text: parsed.cta_text?.trim() || "Ver na loja",
  };
}

export async function POST(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const body = (await req.json()) as Body;

    if (!body.context || body.context.trim().length < 5) {
      return NextResponse.json(
        { error: "Conte um pouco do contexto (pelo menos uma frase)." },
        { status: 400 }
      );
    }
    if (!body.layout_id) {
      return NextResponse.json({ error: "layout_id é obrigatório" }, { status: 400 });
    }

    const sb = createAdminClient();

    // 1) Resolve product (explicit or auto via pickBestseller)
    let primary: ProductSnapshot | null = null;
    if (body.product_id) {
      const { data } = await sb
        .from("shelf_products")
        .select("product_id, name, price, sale_price, image_url, product_url")
        .eq("workspace_id", workspaceId)
        .eq("product_id", body.product_id)
        .maybeSingle();
      if (data) primary = toSnap(data as ShelfRow);
    }
    if (!primary) {
      const settings = await getSettings(workspaceId);
      const pick = await pickBestseller(
        workspaceId,
        settings,
        new Set(),
        new Date().toISOString().slice(0, 10)
      );
      if (pick.product) primary = pick.product;
    }
    if (!primary) {
      // Final fallback: latest in-stock product
      const { data } = await sb
        .from("shelf_products")
        .select("product_id, name, price, sale_price, image_url, product_url")
        .eq("workspace_id", workspaceId)
        .eq("active", true)
        .eq("in_stock", true)
        .not("image_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) primary = toSnap(data as ShelfRow);
    }
    if (!primary) {
      return NextResponse.json(
        { error: "Nenhum produto ativo disponível pra montar o email." },
        { status: 400 }
      );
    }

    // 2) Pull up to 9 related products for grid-heavy layouts
    const { data: relRows } = await sb
      .from("shelf_products")
      .select("product_id, name, price, sale_price, image_url, product_url")
      .eq("workspace_id", workspaceId)
      .eq("active", true)
      .eq("in_stock", true)
      .not("image_url", "is", null)
      .neq("product_id", primary.vnda_id)
      .order("created_at", { ascending: false })
      .limit(9);
    const related: ProductSnapshot[] = ((relRows ?? []) as ShelfRow[]).map(toSnap);

    // 3) Generate copy with the LLM
    let copy: CopyOut;
    try {
      copy = await generateCopyWithLLM(body.context.trim(), primary, body.tone, body.coupon);
    } catch (err) {
      console.error("[ai-compose] LLM failed:", err);
      return NextResponse.json(
        { error: `Falha ao gerar copy: ${(err as Error).message}` },
        { status: 502 }
      );
    }

    // 4) Build tree draft from the layout + the LLM copy + the product
    const slot: Slot = body.slot ?? 1;
    const couponData = body.coupon
      ? {
          code: body.coupon.code ?? `EMAIL-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
          discount_percent: body.coupon.discount_percent,
          expires_at: new Date(
            Date.now() + (body.coupon.expires_in_hours ?? 48) * 60 * 60 * 1000
          ),
        }
      : undefined;

    const tree = buildTreeDraftFromSuggestion({
      workspace_id: workspaceId,
      layoutId: body.layout_id,
      slot,
      primary,
      related,
      copy: {
        subject: copy.subject,
        headline: copy.headline,
        lead: copy.lead,
        cta_text: copy.cta_text,
        cta_url: primary.url || "https://www.bulking.com.br",
      },
      coupon: couponData,
    });

    // 5) Insert and return id
    const { data: inserted, error: insErr } = await sb
      .from("email_template_drafts")
      .insert({
        workspace_id: workspaceId,
        layout_id: tree.layout_id ?? null,
        name: `IA · ${body.context.slice(0, 60)}`,
        meta: {
          ...tree.meta,
          subject: copy.subject,
          preview: copy.preview,
          engine: "tree",
        },
        blocks: tree.sections,
      })
      .select()
      .single();
    if (insErr) {
      console.error("[ai-compose] insert failed:", insErr);
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    return NextResponse.json({ draft: inserted });
  } catch (err) {
    console.error("[ai-compose] unhandled:", err);
    return handleAuthError(err);
  }
}

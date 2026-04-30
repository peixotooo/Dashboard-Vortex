// src/lib/email-templates/copy.ts
//
// Provides marketing copy for email suggestions.
//
// Default: template-based (deterministic, brand-on-voice, zero cost).
// Hook: LLM-based via callLLM (OpenRouter), with automatic fallback to
// template-based if the LLM call fails or its output is unusable.

import type {
  CopyInput,
  CopyOutput,
  CopyProviderImpl,
  CopyProvider,
} from "./types";

// ---- Template-based (DEFAULT) -------------------------------------------

const SUBJECT_BANK: Record<1 | 2 | 3, string[]> = {
  1: [
    "{name} — o mais vestido da semana.",
    "Top 1 da semana: {name}.",
    "{name} liderou. Veja por quê.",
  ],
  2: [
    "Última chance pra vestir {name}.",
    "{name} — ainda dá tempo.",
    "Estoque acabando: {name}.",
  ],
  3: [
    "{name} — acabou de chegar.",
    "Nova fase, nova peça: {name}.",
    "Lançamento: {name}.",
  ],
};

const HEADLINE_BANK: Record<1 | 2 | 3, string[]> = {
  1: ["O mais vestido da semana.", "Quem treina, escolheu essa.", "Top 1 — e dá pra ver por quê."],
  2: ["Última chance.", "Tá indo embora.", "Antes que acabe."],
  3: ["Acabou de chegar.", "Nova peça. Mesmo trabalho.", "Pronto pra vestir."],
};

const CTA_BANK: Record<1 | 2 | 3, string> = {
  1: "Ver na loja",
  2: "Aproveitar agora",
  3: "Conferir lançamento",
};

const LEAD_BANK: Record<1 | 2 | 3, (input: CopyInput) => string> = {
  1: ({ product }) =>
    `${product.name} foi a peça mais vendida dos últimos dias. Caimento pra quem treina, design feito pra durar. Vista o trabalho.`,
  2: ({ product, coupon }) =>
    coupon
      ? `Estoque acabando em ${product.name}. Use o cupom ${coupon.code} e leve com ${coupon.discount_percent}% off — só por ${Math.round(
          (coupon.expires_at.getTime() - Date.now()) / 36e5
        )} horas.`
      : `Estoque acabando em ${product.name}. Última chance pra vestir essa.`,
  3: ({ product }) =>
    `${product.name} acabou de chegar. Mesma intenção de sempre: design autoral, caimento pensado, qualidade que dura.`,
};

function pickRotated<T>(arr: T[], salt: number): T {
  return arr[salt % arr.length];
}

function dayOfYear(d = new Date()): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const ms = d.getTime() - start;
  return Math.floor(ms / 86400000);
}

class TemplateProvider implements CopyProviderImpl {
  async generate(input: CopyInput): Promise<CopyOutput> {
    const salt = dayOfYear() + input.slot;
    const subjectTpl = pickRotated(SUBJECT_BANK[input.slot], salt);
    const headline = pickRotated(HEADLINE_BANK[input.slot], salt);
    const lead = LEAD_BANK[input.slot](input);
    const cta_text = CTA_BANK[input.slot];
    return {
      subject: subjectTpl.replace("{name}", input.product.name),
      headline,
      lead,
      cta_text,
      cta_url: input.product.url,
    };
  }
}

// ---- LLM hook (falls back to template if it fails) ----------------------

const BRAND_VOICE_BRIEF = `Bulking é uma marca de fashion fitness masculina (Hero+Creator).
Voz: determinada, direta, confiante. Sem exageros, sem gritos.
Paleta: preto + verde neon. Lema: "Respect the Hustle" / "Vista o trabalho".
USAR: hustle, shape, treino, vestir, processo, construir, intenção.
EVITAR (NUNCA usar): mega promo, baratinho, guerreiro, campeão, "só hoje!!!", urgência falsa, exclamações em cascata.`;

class LlmProvider implements CopyProviderImpl {
  // agent_slug is informational only (e.g., 'copywriting' / 'email-sequence');
  // we always end up calling callLLM directly with a compact brief.
  constructor(private agent_slug: string) {}

  async generate(input: CopyInput): Promise<CopyOutput> {
    const { callLLM } = await import("@/lib/agent/llm-provider");
    const slotLabel = { 1: "best-seller (top da semana)", 2: "estoque acabando (com cupom)", 3: "lançamento" }[input.slot];
    const couponPart = input.coupon
      ? `Cupom ${input.coupon.code}, ${input.coupon.discount_percent}% off, expira em ${input.coupon.expires_at.toISOString()}.`
      : "Sem cupom.";

    const system = `${BRAND_VOICE_BRIEF}

Tarefa: gerar copy de email marketing como o agente "${this.agent_slug}" faria — em pt-BR, brand-on-voice.

REGRAS DURAS:
- subject ≤ 60 caracteres.
- headline ≤ 50 caracteres.
- lead: 2 a 3 frases, ≤ 280 caracteres.
- cta_text ≤ 24 caracteres.
- Retorne APENAS JSON válido com chaves: subject, headline, lead, cta_text. Sem markdown, sem comentários, sem prefixo "Aqui está", sem sufixo.`;

    const user = `Slot: ${input.slot} (${slotLabel}).
Produto: ${input.product.name} — R$ ${input.product.price.toFixed(2)}.
Segmento alvo: ${input.segment.display_label}.
${couponPart}`;

    const resp = await callLLM({
      provider: "openrouter",
      model: "openrouter/auto",
      maxTokens: 400,
      system,
      tools: [],
      messages: [{ role: "user", content: user }],
    });

    const text = resp.content
      .filter((b: { type: string }) => b.type === "text")
      .map((b: unknown) => (b as { text: string }).text)
      .join("")
      .trim();

    const cleaned = text.replace(/^```json\s*|\s*```$/g, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<CopyOutput>;

    const subject = String(parsed.subject ?? "").slice(0, 80);
    const headline = String(parsed.headline ?? "").slice(0, 60);
    const lead = String(parsed.lead ?? "");
    const cta_text = String(parsed.cta_text ?? "Ver");

    if (!subject || !headline || !lead) {
      throw new Error("LLM returned incomplete copy");
    }

    return { subject, headline, lead, cta_text, cta_url: input.product.url };
  }
}

// ---- Public API ---------------------------------------------------------

export async function generateCopy(
  input: CopyInput,
  provider: CopyProvider,
  llm_agent_slug: string | null
): Promise<{ output: CopyOutput; provider_used: CopyProvider }> {
  if (provider === "llm" && llm_agent_slug) {
    try {
      const out = await new LlmProvider(llm_agent_slug).generate(input);
      return { output: out, provider_used: "llm" };
    } catch {
      // Automatic fallback to template-based on any LLM failure
    }
  }
  const out = await new TemplateProvider().generate(input);
  return { output: out, provider_used: "template" };
}

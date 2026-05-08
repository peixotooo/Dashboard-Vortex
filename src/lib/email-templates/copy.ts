// src/lib/email-templates/copy.ts
//
// Provides marketing copy for email suggestions.
//
// Two providers:
//   - "template": deterministic, brand-on-voice, zero cost
//   - "llm": single-shot enriched call to Anthropic Claude with a
//      slot-specific copywriter soul (Andre Chaperon / Ben Settle /
//      Dan Koe), recent-subject avoidance, persona context, and the
//      brand voice brief baked in. Falls back to template if it fails.
//
// Frente D-lite (single-shot enriched, decisão do usuário): we deliberately
// do NOT cascade through researcher → writer → editor. One rich call
// keeps cost similar to the legacy LLM provider while giving copy
// real persona, anti-repetition, and slot-aware tone.

import { promises as fs } from "fs";
import path from "path";
import { createAdminClient } from "@/lib/supabase-admin";
import type {
  CopyInput,
  CopyOutput,
  CopyProviderImpl,
  CopyProvider,
  Slot,
} from "./types";

// ---- Template-based (DEFAULT) -------------------------------------------

// Subject lines: Andre Chaperon principle (intimate, no shouting), Eugene
// Schwartz routing by awareness level. No em dashes. Slot 1 = product aware
// (signal what is loved). Slot 2 = most aware (signal scarcity, stay calm).
// Slot 3 = solution aware (lead with the new arrival itself).
const SUBJECT_BANK: Record<1 | 2 | 3, string[]> = {
  1: [
    "{name}: a peça mais vestida da semana",
    "Quem treina escolheu {name}",
    "Top 1 da semana é {name}",
  ],
  2: [
    "Estoque acabando: {name}",
    "Sua chance em {name}",
    "{name} antes de acabar",
  ],
  3: [
    "{name} acabou de chegar",
    "Nova peça. Mesma intenção. {name}",
    "Lançamento Bulking: {name}",
  ],
};

const HEADLINE_BANK: Record<1 | 2 | 3, string[]> = {
  1: [
    "A peça mais vestida da semana.",
    "Quem treina escolheu essa.",
    "Top 1 e dá pra ver por quê.",
  ],
  2: ["Última chance pra essa.", "Tá indo embora.", "Antes que acabe."],
  3: [
    "Acabou de chegar.",
    "Nova peça. Mesmo trabalho.",
    "Pronto pra vestir.",
  ],
};

const CTA_BANK: Record<1 | 2 | 3, string> = {
  1: "Ver na loja",
  2: "Aproveitar agora",
  3: "Conferir lançamento",
};

const LEAD_BANK: Record<1 | 2 | 3, (input: CopyInput) => string> = {
  1: ({ product }) =>
    `${product.name} foi a peça mais vendida dos últimos dias. Caimento pra quem treina, design feito pra durar.`,
  2: ({ product, coupon }) => {
    if (!coupon) {
      return `Estoque acabando em ${product.name}. Antes que ela saia da nossa grade.`;
    }
    const hours = Math.round((coupon.expires_at.getTime() - Date.now()) / 36e5);
    return `Estoque acabando em ${product.name}. Use o cupom ${coupon.code} pra levar com ${coupon.discount_percent}% off. Vale por ${hours} horas.`;
  },
  3: ({ product }) =>
    `${product.name} acabou de chegar na grade. Mesma intenção de sempre: design autoral, caimento pensado, qualidade que dura.`,
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

// ---- LLM provider (Frente D-lite — single-shot enriched) ---------------

const BRAND_VOICE_BRIEF = `Bulking é uma marca de fashion fitness masculina (Hero + Creator).
Voz: determinada, direta, confiante. Calma. Sem exageros, sem gritos.
Estética visual: monocromática (preto, branco e tons de cinza para texto). Verde neon só em ativos da marca, NUNCA em copy.
Lema: "Respect the Hustle" / "Vista o trabalho".
USAR: hustle, shape, treino, vestir, processo, construir, intenção.
EVITAR: mega promo, baratinho, guerreiro, campeão, "só hoje!!!", urgência falsa, exclamações em cascata, travessões longos.
NUNCA use travessão (—) em nenhum texto. Use ponto ou vírgula.`;

// Slot → copywriter mapping. Each one matches the angle the slot is
// aiming for: best-seller (intimate, "what people you know are wearing"),
// scarcity-with-coupon (Settle's calm urgency, no shouting), launch
// (Koe's clean modern declaration of "this is here, this is who it's
// for"). Soul docs live in /agents/squads/copy-squad/agents/*.md.
const COPYWRITER_BY_SLOT: Record<Slot, string> = {
  1: "andre-chaperon",
  2: "ben-settle",
  3: "dan-koe",
};

const COPYWRITER_DIR = path.join(
  process.cwd(),
  "agents",
  "squads",
  "copy-squad",
  "agents"
);

const SOUL_CACHE = new Map<string, string>();

async function loadCopywriterSoul(slug: string): Promise<string> {
  if (SOUL_CACHE.has(slug)) return SOUL_CACHE.get(slug)!;
  try {
    const file = path.join(COPYWRITER_DIR, `${slug}.md`);
    const raw = await fs.readFile(file, "utf-8");
    // Strip frontmatter / metadata if present, keep body. The agent
    // souls are concise enough that we ship the full file as system
    // context — that's what gives the persona its voice.
    SOUL_CACHE.set(slug, raw);
    return raw;
  } catch (err) {
    console.warn(
      `[email-templates/copy] could not load copywriter soul "${slug}": ${(err as Error).message}`
    );
    SOUL_CACHE.set(slug, ""); // negative cache so we don't retry
    return "";
  }
}

/** Subjects already used in the last 14 days for this workspace+slot.
 *  Fed into the LLM prompt as "do not repeat these hooks" so we don't
 *  loop the same opener every Monday. */
async function recentSubjects(
  workspace_id: string,
  slot: Slot,
  days = 14
): Promise<string[]> {
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("email_template_suggestions")
    .select("copy")
    .eq("workspace_id", workspace_id)
    .eq("slot", slot)
    .gte("generated_for_date", sinceIso)
    .limit(30);
  const out: string[] = [];
  for (const row of (data ?? []) as Array<{ copy: { subject?: string } | null }>) {
    const s = row.copy?.subject?.trim();
    if (s) out.push(s);
  }
  return out;
}

/** Casts the RFM segment label into a short persona blurb the LLM can
 *  use to tune tone. Keeps the copy specific to who's reading without
 *  forcing the orchestrator to plumb full persona objects through. */
function personaBlurb(displayLabel: string): string {
  const lower = displayLabel.toLowerCase();
  if (lower.includes("champ") || lower.includes("vip") || lower.includes("top compradores")) {
    return "Cliente top — já compra recorrente, conhece a marca, ticket alto. Fala como amigo que já viu o produto, não como vendedor.";
  }
  if (lower.includes("loyal") || lower.includes("recorrente")) {
    return "Cliente fiel mas não topo — abre todo email mas precisa de razão clara pra clicar dessa vez.";
  }
  if (lower.includes("recent") || lower.includes("novo")) {
    return "Cliente novo — ainda formando opinião. Foco em mostrar caimento e intenção da peça, não desconto.";
  }
  if (lower.includes("at risk") || lower.includes("risco")) {
    return "Cliente sumindo — tom mais quente, lembrar do último treino sem soar desesperado.";
  }
  return "Cliente da base geral — varia entre novato e recorrente.";
}

class LlmProvider implements CopyProviderImpl {
  // agent_slug stays as a free-form override hint. If null we auto-pick
  // by slot (recommended).
  constructor(private agent_slug: string | null) {}

  async generate(input: CopyInput): Promise<CopyOutput> {
    const { callLLM } = await import("@/lib/agent/llm-provider");

    const slug = this.agent_slug ?? COPYWRITER_BY_SLOT[input.slot];
    const soul = await loadCopywriterSoul(slug);

    const slotLabel = {
      1: "best-seller (top da semana, sem cupom)",
      2: "estoque acabando (com cupom + janela curta)",
      3: "lançamento (peça nova na grade)",
    }[input.slot];

    const couponPart = input.coupon
      ? `Cupom: ${input.coupon.code}, ${input.coupon.discount_percent}% off, expira em ${input.coupon.expires_at.toISOString()}.`
      : "Sem cupom — copy não pode mencionar desconto.";

    const persona = personaBlurb(input.segment.display_label);

    // Pull recent subjects to discourage repetition. Best-effort.
    let recent: string[] = [];
    try {
      recent = await recentSubjects(input.workspace_id, input.slot, 14);
    } catch {
      /* ignore — empty list is fine */
    }
    const recentBlock =
      recent.length > 0
        ? `Subjects que JÁ USAMOS nos últimos 14 dias (NÃO repetir o mesmo hook):\n${recent.map((s) => `- ${s}`).join("\n")}`
        : "Sem subjects recentes registrados — você pode usar qualquer hook.";

    const oldPriceLine = input.product.old_price
      ? `Preço antigo: R$ ${input.product.old_price.toFixed(2)}.`
      : "";

    const categoryLine = input.product.tags?.length
      ? `Tags do produto: ${input.product.tags.slice(0, 6).join(", ")}.`
      : "";

    const productSummary = `Produto: ${input.product.name}.
Preço atual: R$ ${input.product.price.toFixed(2)}.
${oldPriceLine}
${categoryLine}`;

    // Assemble the system prompt. Order matters: brand voice first
    // (firmest constraints), copywriter soul second (voice + style),
    // output schema last (most-recent reminder right before the user
    // turn). The full block is cacheable on Anthropic — same prompt
    // bytes across runs for the same slot/agent.
    const system = `${BRAND_VOICE_BRIEF}

# Copywriter persona — escreva como esse autor

${soul || "(soul não disponível — use só o brand voice acima)"}

# Tarefa

Gerar copy de email marketing pt-BR brand-on-voice, na pele do copywriter acima, pra um slot específico.

# Regras duras

- subject ≤ 70 caracteres.
- headline ≤ 50 caracteres.
- lead: 2 a 3 frases, ≤ 280 caracteres.
- cta_text ≤ 24 caracteres.
- NUNCA use travessão (—). Ponto ou vírgula.
- NUNCA "!!!" ou exclamações em cascata.
- Se não há cupom, NÃO inventar desconto.
- Não repetir hooks já usados (lista vem no user message).
- Output: APENAS JSON válido. Sem markdown, sem prefixo, sem comentário.

# Formato do output

{
  "subject": "string",
  "headline": "string",
  "lead": "string",
  "cta_text": "string",
  "alternates": ["string", "string"]   // 2 subjects alternativos pra A/B
}`;

    const user = `Slot: ${input.slot} (${slotLabel}).
${productSummary}
Segmento alvo: ${input.segment.display_label}.
Persona: ${persona}
${couponPart}

${recentBlock}

Gere agora.`;

    const resp = await callLLM({
      provider: "anthropic",
      // Sonnet 4.6 — equilíbrio custo/qualidade pra copy. Pode subir
      // pra Opus 4.7 se a Bulking pedir.
      model: "claude-sonnet-4-6",
      maxTokens: 600,
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
    const parsed = JSON.parse(cleaned) as Partial<CopyOutput> & {
      alternates?: unknown;
    };

    let subject = String(parsed.subject ?? "").slice(0, 80);
    let headline = String(parsed.headline ?? "").slice(0, 60);
    let lead = String(parsed.lead ?? "");
    const cta_text = String(parsed.cta_text ?? "Ver");

    // Hard-strip em-dashes — the LLM ignores the rule sometimes.
    subject = subject.replace(/—/g, ",").trim();
    headline = headline.replace(/—/g, ",").trim();
    lead = lead.replace(/—/g, ",").trim();

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
  // The "llm" provider now auto-picks a slot-specific copywriter soul
  // when no slug is provided — the legacy null-slug path was a
  // no-op that returned to template silently.
  if (provider === "llm") {
    try {
      const out = await new LlmProvider(llm_agent_slug).generate(input);
      return { output: out, provider_used: "llm" };
    } catch (err) {
      console.warn(
        "[email-templates/copy] LLM failed, falling back to template:",
        (err as Error).message
      );
      // Automatic fallback to template-based on any LLM failure
    }
  }
  const out = await new TemplateProvider().generate(input);
  return { output: out, provider_used: "template" };
}

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { saveMemoryRecord } from "./memory";

const EXTRACTION_PROMPT = `Voce e um extrator de fatos. Analise a conversa abaixo entre um usuario e um assistente de Meta Ads chamado Vortex.

Extraia APENAS fatos novos e uteis sobre o usuario que nao estavam na memoria existente. Fatos uteis incluem:
- Preferencias de budget (ex: "sempre usa R$50/dia")
- Preferencias de targeting (ex: "foco em 25-45 anos no Brasil")
- Convencoes de nomenclatura (ex: "nomeia campanhas como [OBJ]_[DATA]")
- Preferencias de estilo de comunicacao (ex: "prefere respostas curtas")
- Informacoes sobre o negocio (ex: "vende cursos online")
- Padroes de uso (ex: "sempre cria campanhas de trafego")
- Objetivos e metas (ex: "quer aumentar vendas no e-commerce")

Retorne um JSON array. Se nao houver fatos novos, retorne [].
Formato: [{"category": "targeting|budget|naming|preference|general", "key": "chave_descritiva_em_snake_case", "value": "o fato em linguagem natural"}]

REGRAS:
- NAO repita fatos que ja estao na memoria existente
- NAO invente fatos — apenas extraia do que foi dito explicitamente
- Seja conservador: se nao tem certeza, nao extraia
- Maximo 3 fatos por conversa
- Retorne APENAS o JSON array, sem texto adicional`;

export async function extractAndSaveFacts(
  supabase: SupabaseClient,
  workspaceId: string,
  accountId: string,
  userMessage: string,
  assistantResponse: string,
  existingMemories: string
): Promise<void> {
  try {
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || "",
    });

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: EXTRACTION_PROMPT,
      messages: [
        {
          role: "user",
          content: `## Memoria Existente:\n${existingMemories || "Nenhuma"}\n\n## Conversa:\nUsuario: ${userMessage}\nVortex: ${assistantResponse}`,
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    // Parse the JSON array from the response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const facts = JSON.parse(jsonMatch[0]) as Array<{
      category: string;
      key: string;
      value: string;
    }>;

    if (!Array.isArray(facts) || facts.length === 0) return;

    const validCategories = [
      "targeting",
      "budget",
      "naming",
      "preference",
      "general",
    ];

    // Save each fact (max 3)
    for (const fact of facts.slice(0, 3)) {
      if (
        fact.category &&
        fact.key &&
        fact.value &&
        validCategories.includes(fact.category)
      ) {
        await saveMemoryRecord(
          supabase,
          workspaceId,
          accountId,
          fact.category,
          fact.key,
          fact.value
        );
      }
    }
  } catch {
    // Silently fail — this is a background enhancement, not critical path
  }
}

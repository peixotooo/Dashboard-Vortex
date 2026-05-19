import { callLLM } from "@/lib/agent/llm-provider";
import { createAdminClient } from "@/lib/supabase-admin";

export interface GenerateInput {
  workspaceId: string;
  campaignId: string;
  count?: number;
  model?: string;
}

export interface GeneratedVariation {
  message: string;
  link_label?: string;
}

/**
 * Gera N variações de copy para uma campanha de topbar usando OpenRouter.
 * Persiste em topbar_variations e retorna as criadas.
 */
export async function generateCampaignVariations(input: GenerateInput) {
  const admin = createAdminClient();

  const [campaignRes, configRes] = await Promise.all([
    admin
      .from("topbar_campaigns")
      .select("*")
      .eq("id", input.campaignId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle(),
    admin
      .from("topbar_configs")
      .select("ai_context, ai_brand_voice, ai_model, ai_variations_per_run")
      .eq("workspace_id", input.workspaceId)
      .maybeSingle(),
  ]);

  if (campaignRes.error) throw new Error(campaignRes.error.message);
  if (!campaignRes.data) throw new Error("Campaign not found");

  const campaign = campaignRes.data;
  const config = (configRes.data || {}) as {
    ai_context?: string | null;
    ai_brand_voice?: string | null;
    ai_model?: string | null;
    ai_variations_per_run?: number | null;
  };
  const count = input.count ?? config.ai_variations_per_run ?? 3;
  const model = input.model || config.ai_model || "openrouter/auto";

  const contextPieces: string[] = [];
  if (config.ai_context) contextPieces.push(`Contexto do negócio: ${config.ai_context}`);
  if (config.ai_brand_voice) contextPieces.push(`Tom de voz: ${config.ai_brand_voice}`);
  if (campaign.context_type)
    contextPieces.push(`Tipo de campanha: ${campaign.context_type}`);
  if (campaign.context_brief)
    contextPieces.push(`Brief da campanha: ${campaign.context_brief}`);
  if (campaign.countdown_enabled)
    contextPieces.push(
      `A topbar terá um countdown ao lado da mensagem — use frases que casem com urgência (ex.: "Termina em", "Só hoje"). NÃO repita o tempo dentro do texto.`
    );

  const system = `Você é um copywriter sênior de e-commerce especializado em conversão.
Sua tarefa é gerar VARIAÇÕES de uma mensagem curta para uma TOPBAR (régua superior) de loja online.

FONTE DE VERDADE:
- O ÚNICO conjunto de fatos válidos é o "BRIEF" abaixo (mais o contexto do negócio e tipo de campanha).
- A "Mensagem atual" é referência de ESTILO apenas — pode conter números/preços/produtos inventados em gerações anteriores.
- Se um número (preço, %, prazo, peças) aparece na Mensagem atual mas NÃO no Brief, é ALUCINAÇÃO — descarte.

REGRAS DE CONTEÚDO (CRÍTICAS):
- Proibido inventar números: preços (R$), % de desconto, prazos, estoque, quantidades, prestações.
- Proibido inventar nomes de produtos, coleções, materiais.
- Se o Brief não menciona "R$ X" — NÃO escreva valor.
- Se o Brief não menciona "Y% off" — NÃO escreva desconto.
- Se o Brief não menciona "frete grátis" — NÃO mencione frete.
- Sem emojis, JAMAIS, mesmo que a Mensagem atual tenha. NUNCA use 🔥 💥 ⚡️ ✨ 🎉 etc.

REGRAS DE FORMA:
- Português do Brasil.
- MÁXIMO 70 caracteres por mensagem (idealmente 40-60).
- Sem clichês ("oferta imperdível", "não perca tempo", "corra", "imperdível").
- O CTA (link_label) deve ter 1-3 palavras (ex.: "Aproveitar", "Ver coleção", "Comprar agora").

ÂNGULOS PERMITIDOS (escolha apenas os que o Brief sustenta):
- novidade / lançamento → quando o Brief fala em "novo", "lançamento", "está de volta"
- exclusividade → quando o Brief fala em "edição limitada", "exclusivo"
- urgência → APENAS se houver countdown ou prazo declarado
- escassez → APENAS se o Brief afirmar estoque baixo
- preço / desconto → APENAS se o Brief trouxer número
- frete → APENAS se o Brief mencionar frete

FORMATO DE SAÍDA (JSON puro, sem markdown, sem comentários):
{
  "variations": [
    { "message": "...", "link_label": "..." }
  ]
}

Gere exatamente ${count} variações distintas, variando apenas os ângulos suportados pelo Brief.`;

  const userPrompt = `BRIEF (única fonte de verdade):
${contextPieces.join("\n") || "(brief vazio — gere variações neutras de descoberta de marca)"}

Mensagem atual (apenas referência de estilo, IGNORE números/produtos não presentes no Brief): "${campaign.message}"
CTA atual: "${campaign.link_label || "(nenhum)"}"

Gere ${count} variações novas seguindo as REGRAS DE CONTEÚDO. Responda APENAS o JSON.`;

  // Usa OpenRouter pela LLM provider abstraction
  const llmResponse = await callLLM({
    provider: "openrouter",
    model,
    maxTokens: 1500,
    system,
    tools: [],
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = llmResponse.content.find((b) => b.type === "text") as
    | { type: "text"; text: string }
    | undefined;
  if (!textBlock) throw new Error("LLM retornou conteúdo vazio");

  // Parsing robusto: tira ```json fences se vierem
  let raw = textBlock.text.trim();
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");

  let parsed: { variations?: GeneratedVariation[] };
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Falha ao parsear JSON da LLM: ${(e as Error).message}\nResposta: ${raw.slice(0, 500)}`);
  }

  const variations = (parsed.variations || []).filter(
    (v): v is GeneratedVariation =>
      typeof v?.message === "string" && v.message.trim().length > 0
  );

  if (variations.length === 0) {
    throw new Error("LLM não retornou variações válidas");
  }

  // Persiste no banco
  const inserts = variations.map((v) => ({
    workspace_id: input.workspaceId,
    campaign_id: input.campaignId,
    message: v.message.trim().slice(0, 140),
    link_label: v.link_label?.trim().slice(0, 40) || null,
    generated_by: "llm" as const,
    llm_model: model,
    llm_prompt_used: userPrompt.slice(0, 2000),
  }));

  const { data, error } = await admin
    .from("topbar_variations")
    .insert(inserts)
    .select();

  if (error) throw new Error(error.message);

  return data || [];
}

/**
 * Auto-rotaciona: gera variações, e em sucesso seleciona a primeira gerada
 * (a "fresh"), atualiza next_regenerate_at e last_regenerated_at.
 */
export async function autoRegenerateCampaign(input: GenerateInput) {
  const admin = createAdminClient();
  const variations = await generateCampaignVariations(input);
  if (variations.length === 0) return { ok: false, message: "no variations generated" };

  const first = variations[0];

  // Desmarca todas, marca a nova como selecionada, espelha no campaign
  await admin
    .from("topbar_variations")
    .update({ selected: false })
    .eq("campaign_id", input.campaignId);
  await admin.from("topbar_variations").update({ selected: true }).eq("id", first.id);

  const { data: campaign } = await admin
    .from("topbar_campaigns")
    .select("regenerate_every_hours")
    .eq("id", input.campaignId)
    .single();

  const nextRegen = new Date(
    Date.now() + ((campaign?.regenerate_every_hours || 24) as number) * 3600 * 1000
  ).toISOString();

  await admin
    .from("topbar_campaigns")
    .update({
      message: first.message,
      link_label: first.link_label,
      last_regenerated_at: new Date().toISOString(),
      next_regenerate_at: nextRegen,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.campaignId);

  return { ok: true, variations, selected: first };
}

import { callLLM } from "@/lib/agent/llm-provider";
import { createAdminClient } from "@/lib/supabase-admin";
import { getReviewSettings } from "@/lib/reviews/settings";

// Geração de avaliações com IA (OpenRouter). Aprende o tom das avaliações reais
// que já temos no banco e gera novas no mesmo estilo, com campos estruturados
// realistas. Entram como 'pending' (ou 'published' se auto_publish) e source='ai'.

interface GeneratedReview {
  rating: number;
  title?: string;
  body: string;
  author?: string;
  custom_fields?: { name: string; values: string[] }[];
}

export interface AiGenerateResult {
  inserted: number;
  requested: number;
  product_name: string;
}

const MAX_COUNT = 15;

export async function generateAiReviews(
  workspaceId: string,
  productId: string,
  count: number,
  autoPublish: boolean
): Promise<AiGenerateResult> {
  const admin = createAdminClient();
  const n = Math.min(Math.max(1, Math.round(count)), MAX_COUNT);

  const { data: prod } = await admin
    .from("shelf_products")
    .select("product_id, name, image_url, product_url")
    .eq("workspace_id", workspaceId)
    .eq("product_id", productId)
    .maybeSingle();
  if (!prod) throw new Error("Produto não encontrado no catálogo da loja.");

  // Amostra de tom: avaliações reais publicadas (qualquer produto).
  const { data: samples } = await admin
    .from("reviews")
    .select("title, body, rating")
    .eq("workspace_id", workspaceId)
    .eq("status", "published")
    .not("body", "is", null)
    .limit(30);
  const sampleText = (samples || [])
    .filter((s) => s.body && String(s.body).trim().length > 8)
    .slice(0, 20)
    .map((s) => `★${s.rating} ${s.title ? `"${s.title}" ` : ""}${s.body}`)
    .join("\n");

  const settings = await getReviewSettings(workspaceId);
  const fieldsDesc = (settings.form_fields || [])
    .filter((f) => f.options && f.options.length)
    .map((f) => `${f.label}: [${f.options.join(", ")}]`)
    .join("\n");

  const system =
    "Você gera avaliações de clientes REALISTAS em português brasileiro para uma loja de roupas fitness (Bulking). " +
    "Escreva como clientes de verdade: linguagem natural e informal, frases curtas, foco em caimento, tecido, qualidade e treino. " +
    "Notas altas (a maioria 5, algumas 4). Cada avaliação deve ter: rating (4 ou 5), title (curto, ex.: 'Camisa top'), body (1 a 3 frases), " +
    "author (primeiro nome + inicial do sobrenome, ex.: 'Lucas S.'), e custom_fields com valores realistas escolhidos das opções dadas. " +
    "Varie os perfis (tamanhos, tipos de corpo, idades). Responda APENAS com um array JSON, sem texto fora dele.";

  const userPrompt =
    `Produto: ${prod.name}\n\n` +
    `Gere ${n} avaliações distintas.\n\n` +
    (fieldsDesc ? `Campos estruturados (escolha valores destes para custom_fields):\n${fieldsDesc}\n\n` : "") +
    (sampleText ? `Exemplos do TOM das nossas avaliações reais (imite o estilo, não copie):\n${sampleText}\n\n` : "") +
    `Formato EXATO (array JSON):\n` +
    `[{"rating":5,"title":"...","body":"...","author":"Nome S.","custom_fields":[{"name":"Tamanho comprado","values":["M"]}]}]`;

  const llm = await callLLM({
    provider: "openrouter",
    model: "openrouter/auto",
    maxTokens: 4000,
    system,
    tools: [],
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = llm.content.find((b) => b.type === "text") as { type: "text"; text: string } | undefined;
  if (!textBlock) throw new Error("IA retornou conteúdo vazio.");
  let raw = textBlock.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  // pega o array, caso venha com texto antes/depois
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1);

  let parsed: GeneratedReview[];
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Falha ao parsear JSON da IA: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("IA não retornou avaliações.");

  const status = autoPublish ? "published" : "pending";
  const now = new Date().toISOString();
  const rows = parsed.slice(0, n).map((r) => ({
    workspace_id: workspaceId,
    source: "ai",
    product_id: String(prod.product_id),
    product_name: prod.name,
    product_image: prod.image_url,
    product_url: prod.product_url,
    rating: Math.min(5, Math.max(1, Math.round(Number(r.rating) || 5))),
    title: typeof r.title === "string" ? r.title.slice(0, 120) : null,
    body: typeof r.body === "string" ? r.body.slice(0, 2000) : "",
    author_name: typeof r.author === "string" ? r.author.slice(0, 60) : "Cliente",
    verified_buyer: true,
    custom_fields: Array.isArray(r.custom_fields)
      ? r.custom_fields
          .filter((c) => c && typeof c.name === "string" && Array.isArray(c.values))
          .map((c) => ({ name: c.name.slice(0, 60), values: c.values.filter((v) => typeof v === "string").slice(0, 4) }))
          .slice(0, 20)
      : [],
    media: [],
    media_kind: "none",
    status,
    reviewed_at: now,
  })).filter((r) => r.body && r.body.trim().length > 0);

  if (rows.length === 0) throw new Error("Nenhuma avaliação válida gerada.");

  const { data, error } = await admin.from("reviews").insert(rows).select("id");
  if (error) throw new Error(error.message);

  return { inserted: data?.length ?? 0, requested: n, product_name: prod.name as string };
}

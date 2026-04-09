/**
 * Pre-cadastro AI Analyzer
 *
 * Uses OpenRouter (OpenAI-compatible) to analyze product images
 * and generate structured product data for Eccosys registration.
 * Supports a pool of templates from different categories —
 * the AI picks the most appropriate one per product.
 */

import OpenAI from "openai";
import type { AIAnalysisResult, TemplateData, CategoryNode } from "./types";

// Reuse the same OpenRouter client pattern from llm-provider.ts
let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY || "",
      defaultHeaders: {
        "HTTP-Referer": "https://dashboard-vortex.vercel.app",
        "X-OpenRouter-Title": "Vortex Dashboard",
      },
    });
  }
  return _client;
}

const DEFAULT_MODEL = "openai/gpt-4o-mini";

function buildSystemPrompt(
  contextDescription: string | null,
  templates: TemplateData[],
  categories: CategoryNode[] | null
): string {
  const parts: string[] = [
    `Voce e um assistente especializado em cadastro de produtos para e-commerce brasileiro.
Analise a foto do produto e preencha os campos abaixo em formato JSON.

REGRA CRITICA: O NOME DO PRODUTO vem do NOME DO ARQUIVO enviado pelo usuario.
Voce DEVE usar o nome do arquivo como base para o campo "nome".
Apenas formate para MAIUSCULAS e limpe a extensao (.jpg, .png, etc).
Exemplo: arquivo "camiseta-oversized-pale-rider-preta.jpg" → nome "CAMISETA OVERSIZED PALE RIDER PRETA"
NAO invente um nome diferente. O nome do arquivo E o nome do produto.`,
  ];

  if (contextDescription) {
    parts.push(`CONTEXTO DA COLECAO:
${contextDescription}`);
  }

  // Template pool — AI must pick the best match
  if (templates.length === 1) {
    const t = templates[0];
    parts.push(`PRODUTO TEMPLATE (use estes valores como base para campos fiscais e operacionais):
- Template ID: ${t.id}
- Categoria: ${t.departamento} > ${t.categoria}
- NCM: ${t.cf || "N/A"}
- Unidade: ${t.unidade || "un"}
- Origem: ${t.origem || "0"}
- Peso medio: ${t.peso || "N/A"} kg
- Fornecedor ID: ${t.idFornecedor || "N/A"}
- Dimensoes: ${t.largura}x${t.altura}x${t.comprimento} cm`);
  } else if (templates.length > 1) {
    const templateLines = templates.map((t, i) =>
      `  ${i + 1}. ID=${t.id} | ${t.departamento} > ${t.categoria} | NCM=${t.cf || "N/A"} | Unidade=${t.unidade} | Origem=${t.origem} | Peso=${t.peso}kg | Fornecedor=${t.idFornecedor} | ${t.largura}x${t.altura}x${t.comprimento}cm`
    ).join("\n");

    parts.push(`POOL DE TEMPLATES (escolha o mais adequado para este produto baseado na categoria):
Cada template representa um tipo de produto diferente no ERP. Escolha o que mais se aproxima do produto na foto.
${templateLines}

IMPORTANTE: Retorne o campo "template_escolhido" com o ID do template escolhido.`);
  }

  if (categories && categories.length > 0) {
    const categoryList = flattenCategories(categories);
    parts.push(`CATEGORIAS DISPONIVEIS NO ERP (escolha a mais adequada):
${categoryList}`);
  }

  parts.push(`Retorne APENAS um JSON valido com esta estrutura exata:
{
  "nome": "NOME DO PRODUTO EM MAIUSCULAS",
  "descricao_ecommerce": "Texto completo para e-commerce, 3-5 frases descritivas sobre o produto, material, design e uso",
  "descricao_complementar": "Detalhes visuais concisos: tipo de peça, cor, estampa, acabamento",
  "descricao_detalhada": "Texto longo e envolvente (4-6 frases) sobre o produto, focando na identidade da marca e experiência",
  "keywords": "palavra-chave 1, palavra-chave 2, palavra-chave 3, pelo menos 5 keywords SEO",
  "metatag_description": "Descricao SEO de 150-160 caracteres para metatag. Inclua nome do produto, marca e CTA.",
  "titulo_pagina": "TITULO DA PAGINA PARA SEO",
  "url_slug": "url-slug-do-produto",
  "composicao": "100% Algodao",
  "departamento": { "id": "ID_DO_DEPARTAMENTO", "nome": "Nome do Departamento" },
  "categoria": { "id": "ID_DA_CATEGORIA", "nome": "Nome da Categoria" },
  "subcategoria": { "id": "ID_DA_SUBCATEGORIA", "nome": "Nome da Subcategoria" },
  "atributos_detectados": { "cor": "preta", "material": "algodao", "estilo": "oversized" },
  "template_escolhido": 12345,
  "confidence": {
    "nome": 0.9,
    "descricao_ecommerce": 0.85,
    "categorization": 0.7,
    "composicao": 0.6
  }
}

EXEMPLOS REAIS DE PRODUTOS JA CADASTRADOS (use como referencia de estilo e formato):

Exemplo 1 - Camiseta:
  nome: "CAMISETA OVERSIZED WINGS PRETA"
  descricao_complementar: "Camiseta oversized preta com estampa frontal de cabeca de aguia americana"
  keywords: "camiseta oversized preta aguia, camiseta bulking wings, camiseta army xiv eagle spirit"
  metatag: "Camiseta Oversized Wings Preta da colecao ARMY XIV Bulking. Cabeca de aguia americana. Corte oversized. Compre agora."
  composicao: "100% Algodao"
  url: "camiseta-oversized-wings-preta"

Exemplo 2 - Calca:
  nome: "CALCA JOGGER FORGE PRETA"
  descricao_complementar: "Calca jogger preta com estampa Bulking Army na coxa esquerda. Cos e punhos elasticos"
  keywords: "calca jogger preta, calca treino masculina, calca bulking army, jogger musculacao"
  composicao: "70,5% Algodao 22% Viscose 7,5% Elastano"

REGRAS:
- nome: OBRIGATORIO usar o nome do arquivo como base. Converter hifens para espacos, remover extensao, MAIUSCULAS. NAO invente outro nome
- url_slug: slug lowercase com hifens, sem acentos (ex: "camiseta-oversized-pale-rider-preta")
- SKU (codigo): NAO gere. O ERP atribui automaticamente
- titulo_pagina: igual ao nome (MAIUSCULAS)
- descricao_complementar: 1-2 frases curtas com detalhes visuais (cor, estampa, corte)
- descricao_ecommerce e descricao_detalhada: textos diferentes! ecommerce e mais conciso, detalhada e mais envolvente
- keywords: minimo 5 termos SEO separados por virgula, incluir variações com marca e tipo de peça
- metatag_description: 150-160 chars, terminar com "Compre agora."
- composicao: inferir da foto (ex: algodao para camisetas, poliester para peças tecnicas)
- GTIN/EAN: NAO gere. Deixe vazio
- Para departamento/categoria/subcategoria, use SOMENTE IDs da lista fornecida. Se nao encontrar match, retorne null
- template_escolhido: ID do template mais adequado da lista (se houver pool de templates)
- Confidence: 0.0 a 1.0 por campo
- atributos_detectados: cor, material, estilo, modelagem e outros atributos visiveis`);

  return parts.join("\n\n");
}

function flattenCategories(categories: CategoryNode[]): string {
  const lines: string[] = [];
  for (const dept of categories) {
    lines.push(`Departamento: ${dept.nome} (ID: ${dept.id})`);
    if (dept.categorias) {
      for (const cat of dept.categorias) {
        lines.push(`  Categoria: ${cat.nome} (ID: ${cat.id})`);
        if (cat.subcategorias) {
          for (const sub of cat.subcategorias) {
            lines.push(`    Subcategoria: ${sub.nome} (ID: ${sub.id})`);
          }
        }
      }
    }
  }
  // Limit to ~4000 chars to avoid token overflow
  const text = lines.join("\n");
  if (text.length > 4000) {
    return text.slice(0, 4000) + "\n... (lista truncada)";
  }
  return text;
}

/**
 * Given the AI result and the template pool, returns the chosen template.
 */
export function resolveTemplate(
  result: AIAnalysisResult,
  templates: TemplateData[]
): TemplateData | null {
  if (templates.length === 0) return null;
  if (templates.length === 1) return templates[0];

  // If AI chose a template, find it
  if (result.template_escolhido) {
    const match = templates.find((t) => t.id === result.template_escolhido);
    if (match) return match;
  }

  // Fallback: match by category name
  if (result.categoria?.nome) {
    const catName = result.categoria.nome.toLowerCase();
    const match = templates.find((t) => t.categoria.toLowerCase() === catName);
    if (match) return match;
  }

  // Last resort: first template
  return templates[0];
}

export async function analyzeProductImage(
  imageBase64: string,
  mimeType: string,
  filename: string,
  contextDescription: string | null,
  templates: TemplateData[],
  categories: CategoryNode[] | null,
  model?: string
): Promise<AIAnalysisResult> {
  const client = getClient();
  const systemPrompt = buildSystemPrompt(contextDescription, templates, categories);

  const response = await client.chat.completions.create({
    model: model || DEFAULT_MODEL,
    max_tokens: 2000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${imageBase64}`,
            },
          },
          {
            type: "text",
            text: `Nome do arquivo: ${filename}\n\nAnalise esta foto de produto e retorne o JSON estruturado conforme as instrucoes.`,
          },
        ],
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter retornou resposta vazia");
  }

  const parsed = JSON.parse(content) as AIAnalysisResult;

  // Validate required fields
  if (!parsed.nome) {
    throw new Error("Resposta da IA sem campo obrigatorio (nome)");
  }

  return parsed;
}

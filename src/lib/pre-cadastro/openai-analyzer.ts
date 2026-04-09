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
Analise a foto do produto e preencha os campos abaixo em formato JSON.`,
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
  "nome": "nome comercial completo do produto",
  "codigo": "codigo-do-produto-em-slug",
  "descricao_ecommerce": "descricao detalhada para e-commerce, 2-3 paragrafos",
  "descricao_complementar": "detalhes visuais: cor, material, acabamento, estilo",
  "departamento": { "id": "ID_DO_DEPARTAMENTO", "nome": "Nome do Departamento" },
  "categoria": { "id": "ID_DA_CATEGORIA", "nome": "Nome da Categoria" },
  "subcategoria": { "id": "ID_DA_SUBCATEGORIA", "nome": "Nome da Subcategoria" },
  "atributos_detectados": { "cor": "azul", "material": "algodao" },
  "template_escolhido": 12345,
  "confidence": {
    "nome": 0.9,
    "descricao_ecommerce": 0.85,
    "categorization": 0.7,
    "peso": 0.3,
    "dimensoes": 0.2
  }
}

REGRAS:
- O nome deve incorporar informacoes do nome do arquivo e do contexto da colecao
- O codigo deve ser um slug do nome (lowercase, hifens, sem acentos, max 30 chars)
- A descricao deve ser atrativa para e-commerce, mencionando material, cor, estilo
- Para departamento/categoria/subcategoria, use SOMENTE IDs da lista fornecida. Se nao encontrar match adequado, retorne null
- Se nao houver subcategoria adequada, retorne subcategoria como null
- template_escolhido: ID do template mais adequado da lista (se houver pool de templates)
- Confidence: 0.0 a 1.0, indicando quao confiante voce esta em cada campo
- atributos_detectados: liste cor, material, estilo, e qualquer outro atributo visivel na foto`);

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
  if (!parsed.nome || !parsed.codigo) {
    throw new Error("Resposta da IA sem campos obrigatorios (nome, codigo)");
  }

  return parsed;
}

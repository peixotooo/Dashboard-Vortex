// Ferramentas do assistente — whitelist FECHADA e somente-leitura.
//
// A fronteira de segurança real é esta: o LLM só consegue fazer o que estas
// quatro ferramentas permitem. Não existe tool de pedido, cliente, escrita
// ou acesso arbitrário. Adicionar tool aqui = ampliar a superfície — revisar
// com o mesmo rigor.

import type Anthropic from "@anthropic-ai/sdk";
import { searchCatalog, getProductDetails } from "./catalog";
import { getActiveKnowledge, formatActiveKnowledge } from "./knowledge";
import type { AssistantProductCard, AssistantSettings } from "./types";

export const ASSISTANT_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "buscar_produtos",
    description:
      "Busca produtos no catálogo da loja por texto livre e/ou filtros (cor, tecido, modelagem, preço máximo). Use para recomendar produtos ou verificar o que existe na loja. Retorna nome, preço, disponibilidade (sim/não), composição e link.",
    input_schema: {
      type: "object",
      properties: {
        busca: {
          type: "string",
          description: "Texto de busca livre, ex: 'regata azul', 'calça cargo'",
        },
        cor: {
          type: "string",
          description: "Cor desejada, ex: 'preto', 'branco', 'azul', 'verde'",
        },
        tecido: {
          type: "string",
          enum: ["dry", "algodao"],
          description: "dry = poliéster com secagem rápida (linha DRY); algodao = algodão premium",
        },
        modelagem: {
          type: "string",
          enum: ["oversized", "regular"],
          description: "Caimento da peça",
        },
        preco_max: {
          type: "number",
          description: "Preço máximo em reais",
        },
        limite: {
          type: "number",
          description: "Quantos produtos retornar (1 a 10, padrão 6)",
        },
      },
    },
  },
  {
    name: "detalhes_produto",
    description:
      "Detalhes completos de um produto pelo ID: descrição, composição do tecido, preço e DISPONIBILIDADE POR TAMANHO (P, M, G...). Use sempre antes de afirmar que um tamanho está disponível.",
    input_schema: {
      type: "object",
      properties: {
        produto_id: {
          type: "string",
          description: "ID do produto (número, ex: '1271')",
        },
      },
      required: ["produto_id"],
    },
  },
  {
    name: "guia_de_tamanhos",
    description:
      "Tabela de medidas oficial da loja (largura de peito e comprimento por tamanho) e regras de caimento. Use para ajudar o cliente a escolher o tamanho certo com base na altura/peso/preferência dele.",
    input_schema: {
      type: "object",
      properties: {
        modelagem: {
          type: "string",
          enum: ["oversized", "regular"],
          description: "Modelagem da peça em questão (padrão: oversized)",
        },
      },
    },
  },
  {
    name: "informacoes_da_loja",
    description:
      "Informações institucionais oficiais da loja: trocas e devoluções, prazos de frete/entrega, formas de pagamento, FAQ, política de privacidade e atendimento. Use quando o cliente perguntar sobre política/prazo/como funciona. Se a informação não estiver aqui, orientar o cliente a falar com o atendimento oficial.",
    input_schema: {
      type: "object",
      properties: {
        assunto: {
          type: "string",
          description:
            "Tópico da dúvida, ex: 'trocas', 'frete', 'pagamento', 'atendimento' (opcional — ajuda a focar)",
        },
      },
    },
  },
  {
    name: "promocoes_e_beneficios",
    description:
      "Campanhas, cupons e benefícios ATIVOS AGORA na loja: promoção da barra de topo, cupons vigentes (código e desconto), régua de brinde (ganhe brinde ao atingir valor), cashback, benefícios do produto e 'pedir de presente'. Use quando o cliente perguntar sobre desconto, cupom, promoção, frete grátis, brinde, cashback — ou pra fechar a venda com um empurrão. Consulte SEMPRE aqui em vez de supor.",
    input_schema: { type: "object", properties: {} },
  },
];

// --- Dados estáticos (guia de medidas, molde oversized padrão Bulking) ---

const SIZE_GUIDE_OVERSIZED = {
  modelagem: "oversized",
  aviso:
    "Modelagem oversized veste mais largo que o normal. Se o cliente prefere caimento mais justo, sugerir um tamanho ABAIXO do usual. Se gosta do estilo bem amplo, manter o tamanho usual.",
  medidas_cm: [
    { tamanho: "P", largura_peito: 54, comprimento: 76 },
    { tamanho: "M", largura_peito: 56, comprimento: 78 },
    { tamanho: "G", largura_peito: 58, comprimento: 80 },
    { tamanho: "GG", largura_peito: 60, comprimento: 82 },
    { tamanho: "XGG", largura_peito: 62, comprimento: 84 },
  ],
  observacao:
    "Medidas tiradas da peça fora do corpo; variação de até 2 cm pela margem de costura. Largura de peito é medida reta de axila a axila (dobrar em 2 ≈ circunferência).",
  referencia_rapida:
    "Referência prática: até ~1,70m e 70kg → P ou M; 1,70–1,80m e 70–85kg → M ou G; 1,80–1,90m ou 85–100kg → G ou GG; acima disso → GG ou XGG. Ajustar pela preferência de caimento.",
};

const SIZE_GUIDE_REGULAR = {
  modelagem: "regular",
  aviso:
    "Modelagem regular veste no tamanho usual do cliente. Em dúvida entre dois tamanhos, sugerir o maior para conforto.",
  medidas_cm: null,
  observacao:
    "Não há tabela de medidas específica cadastrada para modelagem regular — orientar pelo tamanho que o cliente costuma usar.",
  referencia_rapida: null,
};

// --- Executor (whitelist) ---

export interface ToolContext {
  workspaceId: string;
  settings: AssistantSettings;
  /** Tipo da página onde o cliente está (product/home/...) — usado no topbar. */
  pageType: string;
  /** Acumula produtos vistos pelas tools no turno — vira card no widget. */
  seenProducts: Map<string, AssistantProductCard>;
}

const TOOL_TIMEOUT_MS = 8000;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("tool timeout")), TOOL_TIMEOUT_MS)
    ),
  ]);
}

// A KB institucional é longa (~12k chars) e a página de termos começa com
// legalês (privacidade) antes do útil (trocas/prazos/pagamento). Quando o
// cliente pergunta um assunto, devolve uma janela centrada na 1ª ocorrência
// de uma palavra-chave do assunto — assim a seção certa nunca é cortada.
const KB_MAX = 6500;

function normalizeForSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function focusKb(kb: string, assunto: string): string {
  if (!kb) return "";
  if (kb.length <= KB_MAX) return kb;

  const hay = normalizeForSearch(kb);
  const words = normalizeForSearch(assunto)
    .split(/\s+/)
    .filter((w) => w.length > 3);
  // termos comuns de política pra ancorar a busca mesmo sem 'assunto'
  const anchors = ["troca", "devoluc", "frete", "entrega", "prazo", "envio", "pagament", "cupom", "cashback"];
  const candidates = words.length ? words : [];

  let pos = -1;
  for (const w of candidates) {
    const i = hay.indexOf(w);
    if (i >= 0) {
      pos = i;
      break;
    }
  }
  if (pos < 0) {
    for (const a of anchors) {
      const i = hay.indexOf(a);
      if (i >= 0) {
        pos = i;
        break;
      }
    }
  }
  if (pos < 0) return kb.slice(0, KB_MAX);

  const start = Math.max(0, pos - 1500);
  const slice = kb.slice(start, start + KB_MAX);
  return (start > 0 ? "…" : "") + slice;
}

function rememberProduct(ctx: ToolContext, p: AssistantProductCard) {
  if (!ctx.seenProducts.has(p.id)) {
    ctx.seenProducts.set(p.id, {
      id: p.id,
      name: p.name,
      url: p.url,
      image_url: p.image_url,
      price: p.price,
      sale_price: p.sale_price,
      available: p.available,
    });
  }
}

/**
 * Executa uma tool chamada pelo LLM. Nome fora da whitelist → erro genérico
 * (nunca eco do nome/input de volta em detalhe). Toda saída é serializável e
 * livre de segredos por construção (ver catalog.ts).
 */
export async function executeAssistantTool(
  ctx: ToolContext,
  name: string,
  input: unknown
): Promise<string> {
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  try {
    switch (name) {
      case "buscar_produtos": {
        const products = await withTimeout(
          searchCatalog(ctx.workspaceId, {
            query: typeof args.busca === "string" ? args.busca.slice(0, 120) : undefined,
            color: typeof args.cor === "string" ? args.cor.slice(0, 40) : undefined,
            fabric:
              args.tecido === "dry" || args.tecido === "algodao" ? args.tecido : undefined,
            fit:
              args.modelagem === "oversized" || args.modelagem === "regular"
                ? args.modelagem
                : undefined,
            maxPrice: typeof args.preco_max === "number" ? args.preco_max : undefined,
            limit: typeof args.limite === "number" ? args.limite : undefined,
          })
        );
        products.forEach((p) => rememberProduct(ctx, p));
        if (products.length === 0) {
          return JSON.stringify({
            resultado: "nenhum produto encontrado com esses filtros",
            dica: "tente uma busca mais ampla ou sem filtro de cor",
          });
        }
        return JSON.stringify({ produtos: products });
      }

      case "detalhes_produto": {
        const id = String(args.produto_id || "").trim();
        if (!id || !/^[\w-]{1,40}$/.test(id)) {
          return JSON.stringify({ erro: "produto_id inválido" });
        }
        const details = await withTimeout(getProductDetails(ctx.workspaceId, id));
        if (!details) {
          return JSON.stringify({ erro: "produto não encontrado no catálogo" });
        }
        rememberProduct(ctx, details);
        return JSON.stringify({ produto: details });
      }

      case "guia_de_tamanhos": {
        const guide =
          args.modelagem === "regular" ? SIZE_GUIDE_REGULAR : SIZE_GUIDE_OVERSIZED;
        return JSON.stringify(guide);
      }

      case "informacoes_da_loja": {
        const store = ctx.settings.storeInfo.trim();
        const kb = ctx.settings.institutionalKb.trim();
        if (!store && !kb) {
          return JSON.stringify({
            informacoes: null,
            instrucao:
              "Não há políticas cadastradas. Diga ao cliente que para trocas, devoluções e prazos ele deve falar com o atendimento oficial da loja. NÃO invente políticas.",
          });
        }
        const assunto = typeof args.assunto === "string" ? args.assunto : "";
        const kbFocused = focusKb(kb, assunto);
        const informacoes = [store, kbFocused].filter(Boolean).join("\n\n");
        return JSON.stringify({ informacoes });
      }

      case "promocoes_e_beneficios": {
        const knowledge = await withTimeout(
          getActiveKnowledge(ctx.workspaceId, ctx.pageType)
        );
        return JSON.stringify({
          ativos: formatActiveKnowledge(knowledge),
          instrucao:
            "Comunique só o que está listado. Se vazio, não invente cupom/desconto — ofereça ajuda com o produto.",
        });
      }

      default:
        return JSON.stringify({ erro: "ferramenta não disponível" });
    }
  } catch {
    return JSON.stringify({
      erro: "falha temporária ao consultar os dados — tente responder sem essa informação ou avise o cliente",
    });
  }
}

// Ferramentas do assistente — whitelist FECHADA e somente-leitura.
//
// A fronteira de segurança real é esta: o LLM só consegue fazer o que estas
// quatro ferramentas permitem. Não existe tool de pedido, cliente, escrita
// ou acesso arbitrário. Adicionar tool aqui = ampliar a superfície — revisar
// com o mesmo rigor.

import type Anthropic from "@anthropic-ai/sdk";
import { searchCatalog, getProductDetails } from "./catalog";
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
      "Informações oficiais da loja: trocas, devoluções, frete e pagamento. Use quando o cliente perguntar sobre políticas. Se a informação não estiver aqui, orientar o cliente a falar com o atendimento oficial.",
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
        const info = ctx.settings.storeInfo.trim();
        if (!info) {
          return JSON.stringify({
            informacoes: null,
            instrucao:
              "Não há políticas cadastradas. Diga ao cliente que para trocas, devoluções e prazos ele deve falar com o atendimento oficial da loja. NÃO invente políticas.",
          });
        }
        return JSON.stringify({ informacoes: info });
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

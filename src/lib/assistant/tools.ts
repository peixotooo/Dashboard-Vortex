// Ferramentas do assistente — whitelist FECHADA e somente-leitura.
//
// A fronteira de segurança real é esta: o LLM só consegue fazer o que estas
// quatro ferramentas permitem. Não existe tool de pedido, cliente, escrita
// ou acesso arbitrário. Adicionar tool aqui = ampliar a superfície — revisar
// com o mesmo rigor.

import type Anthropic from "@anthropic-ai/sdk";
import { searchCatalog, getProductDetails } from "./catalog";
import { getActiveKnowledge, formatActiveKnowledge } from "./knowledge";
import { lookupOrder } from "./orders";
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
      "Tabela de medidas por tamanho (comprimento e tórax em cm) e regras de caimento. Passe o produto_id pra pegar a tabela REAL daquele produto (recomendado, funciona pra qualquer modelagem). Sem produto_id, cai na referência genérica oversized. Use pra ajudar o cliente a escolher o tamanho pela altura/peso/preferência.",
    input_schema: {
      type: "object",
      properties: {
        produto_id: {
          type: "string",
          description: "ID do produto pra pegar a tabela de medidas oficial dele (recomendado)",
        },
        modelagem: {
          type: "string",
          enum: ["oversized", "regular"],
          description: "Fallback se não tiver produto_id (padrão: oversized)",
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
            "Tópico da dúvida, ex: 'trocas', 'frete', 'pagamento', 'atendimento' (opcional, ajuda a focar)",
        },
      },
    },
  },
  {
    name: "consultar_pedido",
    description:
      "Consulta o status de UM pedido do PRÓPRIO cliente (rastreio/WISMO). EXIGE número do pedido E o e-mail usado na compra, que precisam bater. Retorna: status, código de rastreio, itens e se algum item é sob demanda (produção mais demorada). Use quando o cliente perguntar 'cadê meu pedido', 'pedido atrasado', 'já foi enviado?'. Se o cliente não deu os dois dados, PEÇA os dois numa mensagem só antes de chamar.",
    input_schema: {
      type: "object",
      properties: {
        numero_pedido: {
          type: "string",
          description: "Número/código do pedido informado pelo cliente",
        },
        email: {
          type: "string",
          description: "E-mail usado na compra (precisa bater com o do pedido)",
        },
      },
      required: ["numero_pedido", "email"],
    },
  },
  {
    name: "promocoes_e_beneficios",
    description:
      "Campanhas, cupons e benefícios ATIVOS AGORA na loja: promoção da barra de topo, cupons vigentes (código e desconto), régua de brinde (ganhe brinde ao atingir valor), cashback, benefícios do produto e 'pedir de presente'. Use quando o cliente perguntar sobre desconto, cupom, promoção, frete grátis, brinde, cashback, ou pra fechar a venda com um empurrão. Consulte SEMPRE aqui em vez de supor.",
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
    "Referência prática: até 1,70m e 70kg: P ou M. De 1,70 a 1,80m e 70 a 85kg: M ou G. De 1,80 a 1,90m ou 85 a 100kg: G ou GG. Acima disso: GG ou XGG. Ajustar pela preferência de caimento.",
};

const SIZE_GUIDE_REGULAR = {
  modelagem: "regular",
  aviso:
    "Modelagem regular veste no tamanho usual do cliente. Em dúvida entre dois tamanhos, sugerir o maior para conforto.",
  medidas_cm: null,
  observacao:
    "Não há tabela de medidas específica cadastrada para modelagem regular. Orientar pelo tamanho que o cliente costuma usar.",
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
  /** Tentativas de consulta de pedido no turno (anti-enumeração: máx 2). */
  orderLookups?: number;
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
        // Com produto_id → tabela REAL da PDP (qualquer modelagem). Sem → genérica.
        const pid = String(args.produto_id || "").trim();
        if (pid && /^[\w-]{1,40}$/.test(pid)) {
          const details = await withTimeout(getProductDetails(ctx.workspaceId, pid));
          if (details?.sizeGuide) {
            return JSON.stringify({
              produto: details.name,
              modelagem: details.fit,
              tabela_de_medidas: details.sizeGuide,
              aviso:
                details.fit === "oversized"
                  ? "Modelagem oversized veste mais largo. Quem prefere caimento mais justo pode pegar um tamanho abaixo do usual."
                  : "Modelagem regular veste no tamanho usual. Em dúvida entre dois, o maior dá mais conforto.",
              instrucao:
                "Use ESTAS medidas (são as oficiais deste produto). Cruze com a altura/peso do cliente e recomende um tamanho.",
            });
          }
        }
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

      case "consultar_pedido": {
        // Anti-enumeração: no máximo 2 tentativas por turno
        ctx.orderLookups = (ctx.orderLookups || 0) + 1;
        if (ctx.orderLookups > 2) {
          return JSON.stringify({
            erro: "limite de consultas atingido",
            instrucao:
              "Diga ao cliente pra conferir com calma o número do pedido e o e-mail da compra e tentar de novo, ou falar com o atendimento. Adicione [[whatsapp]] no final.",
          });
        }
        const order = await withTimeout(
          lookupOrder(ctx.workspaceId, args.numero_pedido, args.email)
        );
        if (!order) {
          return JSON.stringify({
            resultado: "pedido não encontrado com esse número + e-mail",
            instrucao:
              "NÃO diga qual dado está errado. Peça pra conferir o número do pedido (está no e-mail de confirmação) e o e-mail usado na compra. Se falhar de novo, oriente o atendimento com [[whatsapp]].",
          });
        }
        return JSON.stringify({
          pedido: order,
          instrucao:
            order.has_sob_demanda && !order.dispatched
              ? "IMPORTANTE: o pedido tem item SOB DEMANDA (produzido após a compra, postagem em até 10 dias úteis). Explique isso com empatia como o motivo do prazo maior, diga qual item é, reforce que está tudo certo com o pedido e que avisamos por e-mail quando postar. Tranquilize; a peça está sendo produzida especialmente pra ele."
              : order.dispatched
              ? "Pedido já despachado: informe o código de rastreio e diga que dá pra acompanhar no site da transportadora/Correios."
              : "Explique o status atual com clareza e o próximo passo.",
        });
      }

      case "promocoes_e_beneficios": {
        const knowledge = await withTimeout(
          getActiveKnowledge(ctx.workspaceId, ctx.pageType)
        );
        return JSON.stringify({
          ativos: formatActiveKnowledge(knowledge),
          instrucao:
            "Comunique só o que está listado. Se vazio, não invente cupom/desconto. Ofereça ajuda com o produto.",
        });
      }

      default:
        return JSON.stringify({ erro: "ferramenta não disponível" });
    }
  } catch {
    return JSON.stringify({
      erro: "falha temporária ao consultar os dados. Tente responder sem essa informação ou avise o cliente",
    });
  }
}

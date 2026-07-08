// Ferramentas do assistente — whitelist FECHADA e somente-leitura.
//
// A fronteira de segurança real é esta: o LLM só consegue fazer o que estas
// quatro ferramentas permitem. Não existe tool de pedido, cliente, escrita
// ou acesso arbitrário. Adicionar tool aqui = ampliar a superfície — revisar
// com o mesmo rigor.

import type Anthropic from "@anthropic-ai/sdk";
import {
  searchCatalog,
  getProductDetails,
  getSizeAvailability,
  normalizeSize,
} from "./catalog";
import { getActiveKnowledge, formatActiveKnowledge, type ActiveKnowledge } from "./knowledge";
import { lookupOrder } from "./orders";
import { getVitrine, getReviewsForChat } from "./commerce";
import type {
  AssistantProductCard,
  AssistantSettings,
  ReviewsBlockData,
} from "./types";

export const ASSISTANT_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "buscar_produtos",
    description:
      "Busca produtos no catálogo por texto livre e/ou filtros (cor, tecido, modelagem, preço). Use para QUALQUER pedido de categoria, tipo ou gênero: 'produtos femininos', 'linha feminina', 'legging', 'moletom', 'calça cargo', 'camiseta preta'. Entende sinônimos (feminino→linha SEAMLESS) e cor em inglês (rosa→ROSE, preto→BLACK). É a ferramenta padrão pra mostrar/recomendar peças. Retorna nome, preço, disponibilidade, composição e link.",
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
          description:
            "Filtro de LINHA (não é afirmação de composição). dry = linha técnica de secagem rápida pra treino — composição varia por peça (poliamida OU poliéster, quase sempre com elastano), NÃO cravar o material; algodao = linha de algodão premium, mais encorpada. A composição REAL vem da ficha-técnica (campo composition); nunca inferir o material deste rótulo.",
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
        tamanho: {
          type: "string",
          description:
            "Tamanho do cliente (P, M, G, GG, XGG...). Se informado, retorna SÓ produtos disponíveis nesse tamanho. Passe sempre que souber o tamanho dele.",
        },
        entrega: {
          type: "string",
          enum: ["pronta", "sob_demanda"],
          description:
            "Prazo de envio: 'pronta' = pronta entrega (postagem em 24h úteis, a MAIORIA da loja); 'sob_demanda' = produzido após a compra (~10 dias úteis). Use quando o cliente perguntar por pronta entrega.",
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
      "Campanhas, cupons e benefícios ATIVOS AGORA na loja: promoção da barra de topo, régua de COMBO PROGRESSIVO 'compre mais, pague menos' (leve 2/3/4/5 por preço fechado, desconto no carrinho), cupons vigentes (código e desconto), régua de brinde, cashback, benefícios do produto e 'pedir de presente'. Use quando o cliente perguntar sobre COMBO, 'leve mais por menos', 'compre mais pague menos', 'quanto sai levando 3/5', desconto por quantidade, cupom, promoção, frete grátis, brinde, cashback, ou pra fechar a venda. Consulte SEMPRE aqui em vez de supor (a régua de combo NÃO é um KIT/produto — é a promoção progressiva).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "vitrine",
    description:
      "Prateleira GENÉRICA da loja pra montar um CARROSSEL: mais vendidos, novidades, ofertas, populares. Use SÓ pra pedido AMPLO e sem categoria específica: 'o que tem de bom', 'mais vendidos', 'novidades', 'promoções', ou pra abrir a conversa. NÃO use pra categoria/gênero/tipo específico (ex.: 'produtos femininos', 'legging', 'moletom') — nesses casos use buscar_produtos. Depois de chamar, coloque o marcador [[vitrine]] onde o carrossel deve aparecer.",
    input_schema: {
      type: "object",
      properties: {
        prateleira: {
          type: "string",
          enum: ["mais_vendidos", "camisetas_mais_vendidas", "novidades", "ofertas", "populares"],
          description: "Qual prateleira mostrar",
        },
      },
      required: ["prateleira"],
    },
  },
  {
    name: "avaliacoes",
    description:
      "Prova social: nota média e depoimentos reais de clientes. Sem produto_id = destaques da loja inteira; com produto_id = avaliações daquele produto. Use pra dar confiança, responder 'é bom?', 'vale a pena?', ou pra fechar a venda. Depois coloque o marcador [[avaliacoes]] onde o bloco deve aparecer.",
    input_schema: {
      type: "object",
      properties: {
        produto_id: { type: "string", description: "ID do produto (opcional; vazio = loja)" },
      },
    },
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
  /** "global" = página /chat (blocos ricos). "pdp"/undefined = widget v1. */
  surface?: "pdp" | "global";
  // --- Chat Commerce v2: acumuladores pra montar blocos ricos ---
  seenVitrine?: { title: string; products: AssistantProductCard[] };
  seenReviews?: ReviewsBlockData;
  seenKnowledge?: ActiveKnowledge;
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
        const wantSize =
          typeof args.tamanho === "string" ? normalizeSize(args.tamanho) : null;
        const busca = typeof args.busca === "string" ? args.busca.slice(0, 120) : undefined;
        // Kit/combo só entra se o cliente pediu (a busca padrão recomenda peças).
        const allowKits = !!busca && /\b(kit|combo|conjunto)\b/i.test(busca);
        const displayLimit = Math.min(
          Math.max(typeof args.limite === "number" ? args.limite : 6, 1),
          6
        );
        // Com filtro de tamanho, busca um POOL maior e filtra por
        // disponibilidade real; sem, busca direto o número pedido.
        const products = await withTimeout(
          searchCatalog(ctx.workspaceId, {
            query: busca,
            color: typeof args.cor === "string" ? args.cor.slice(0, 40) : undefined,
            fabric:
              args.tecido === "dry" || args.tecido === "algodao" ? args.tecido : undefined,
            fit:
              args.modelagem === "oversized" || args.modelagem === "regular"
                ? args.modelagem
                : undefined,
            maxPrice: typeof args.preco_max === "number" ? args.preco_max : undefined,
            shipping:
              args.entrega === "pronta" || args.entrega === "sob_demanda"
                ? args.entrega
                : undefined,
            allowKits,
            limit: wantSize ? 10 : typeof args.limite === "number" ? args.limite : undefined,
          })
        );

        if (wantSize && products.length > 0) {
          // Checa disponibilidade do tamanho em paralelo (leve, cacheado) e
          // mantém só os que têm o tamanho do cliente.
          const avail = await withTimeout(
            Promise.all(
              products.map((p) =>
                getSizeAvailability(ctx.workspaceId, p.id)
                  .then((sizes) => ({
                    p,
                    ok: sizes.some((s) => s.size === wantSize && s.available),
                  }))
                  .catch(() => ({ p, ok: false }))
              )
            )
          );
          const inSize = avail.filter((a) => a.ok).map((a) => a.p).slice(0, displayLimit);
          inSize.forEach((p) => rememberProduct(ctx, p));
          if (inSize.length === 0) {
            return JSON.stringify({
              resultado: `nenhum produto desses filtros está disponível no tamanho ${wantSize}`,
              instrucao:
                "Diga que no tamanho pedido essas opções esgotaram e ofereça buscar em outra cor/modelagem, ou avise que pode conferir outro tamanho. NÃO recomende produto sem o tamanho do cliente.",
            });
          }
          return JSON.stringify({ produtos: inSize, filtro_tamanho: wantSize });
        }

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
        ctx.seenKnowledge = knowledge; // pros blocos [[beneficios]]/[[promo]] do chat v2
        // A instrução de marcadores ricos ([[promo]]/[[beneficios]]) SÓ vale no
        // chat global — no PDP (v1) o widget não os renderiza e o cliente veria
        // o texto literal do marcador.
        const baseInstr =
          "Comunique só o que está listado. Se vazio, não invente cupom/desconto. Ofereça ajuda com o produto.";
        return JSON.stringify({
          ativos: formatActiveKnowledge(knowledge),
          instrucao:
            ctx.surface === "global"
              ? `${baseInstr} No chat, use [[promo]] pra mostrar as promoções e [[beneficios]] pros benefícios.`
              : baseInstr,
        });
      }

      case "vitrine": {
        const prateleira = String(args.prateleira || "mais_vendidos");
        const titles: Record<string, string> = {
          mais_vendidos: "Mais vendidos",
          camisetas_mais_vendidas: "Camisetas mais vendidas",
          novidades: "Novidades",
          ofertas: "Ofertas",
          populares: "Em alta",
        };
        const products = await withTimeout(getVitrine(ctx.workspaceId, prateleira, 8));
        products.forEach((p) => rememberProduct(ctx, p));
        ctx.seenVitrine = { title: titles[prateleira] || "Destaques", products };
        if (products.length === 0) {
          return JSON.stringify({ resultado: "prateleira vazia no momento" });
        }
        return JSON.stringify({
          prateleira: titles[prateleira],
          produtos: products.map((p) => ({ id: p.id, nome: p.name, preco: p.sale_price ?? p.price })),
          instrucao:
            "Apresente a prateleira e coloque o marcador [[vitrine]] no texto onde o carrossel deve aparecer. Você PODE dizer que estes são os mais vendidos/populares (é o ranking REAL da loja). Comente 1-2 peças pelo BENEFÍCIO (tecido, caimento, versatilidade), não por urgência inventada. NÃO diga 'sai rápido', 'últimas peças', 'estoque baixo' nem número de vendas.",
        });
      }

      case "avaliacoes": {
        const pid =
          typeof args.produto_id === "string" && /^[\w-]{1,40}$/.test(args.produto_id)
            ? args.produto_id
            : null;
        const reviews = await withTimeout(getReviewsForChat(ctx.workspaceId, pid));
        if (!reviews) {
          return JSON.stringify({ resultado: "sem avaliações suficientes pra mostrar" });
        }
        ctx.seenReviews = reviews;
        return JSON.stringify({
          media: reviews.average,
          total: reviews.count,
          escopo: reviews.scope,
          instrucao:
            "Cite a nota média e o total, e coloque [[avaliacoes]] onde o bloco de depoimentos deve aparecer. Use como prova social pra dar confiança.",
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

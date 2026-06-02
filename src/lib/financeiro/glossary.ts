// src/lib/financeiro/glossary.ts
//
// Glossário ÚNICO das métricas do módulo financeiro/simulador. Cada
// métrica exibida na UI tem aqui um texto explicativo que vira o tooltip
// (HelpCircle) ao lado do número — para qualquer pessoa do time entender
// o que está vendo sem precisar abrir o código.
//
// Regra: toda métrica nova exibida no simulador/controle deve ganhar uma
// entrada aqui. O componente <MetricInfo k="..."/> lê deste mapa.

export interface GlossaryEntry {
  /** Nome curto da métrica (como aparece no card). */
  label: string;
  /** Uma linha — o que é, em linguagem de negócio. */
  short: string;
  /** Explicação completa: o que mede, por que importa, e a pegadinha. */
  full: string;
  /** Fórmula em texto, quando ajuda. */
  formula?: string;
  /** Aviso/limitação honesta (ex.: depende de cobertura de custo). */
  caveat?: string;
}

export type MetricKey =
  | "mer_blended"
  | "amer"
  | "roas_plataforma"
  | "cm1"
  | "cm2"
  | "cm3"
  | "breakeven_mer"
  | "healthy_mer"
  | "ncac"
  | "cac_payback"
  | "repeat_rate"
  | "novos_vs_recorrentes"
  | "coverage_pct"
  | "caixa_real"
  | "caixa_receita_menos_ads"
  | "inventory_coverage_days"
  | "ticket_medio"
  | "sazonalidade"
  | "meta_sazonalizada"
  | "safety_margin"
  | "ebitda"
  | "ponto_otimo_escala"
  | "capital_preso_estoque";

export const GLOSSARY: Record<MetricKey, GlossaryEntry> = {
  mer_blended: {
    label: "MER (blended)",
    short: "Quanto de receita real cada R$1 de mídia traz, somando todas as plataformas.",
    full: "MER = receita REAL da loja ÷ investimento TOTAL em mídia (Meta + Google + …). É a leitura honesta de retorno: usa a receita do extrato, não a receita que cada plataforma se atribui. Meta e Google contam a MESMA venda em dobro — por isso não usamos ROAS por plataforma aqui.",
    formula: "MER = receita real ÷ spend total",
    caveat: "É retorno de conta inteira (blended), não por canal. Atribuir receita a Meta vs Google ainda não é mensurável de forma confiável.",
  },
  amer: {
    label: "aMER (marginal)",
    short: "O que o PRÓXIMO real de mídia rende — não a média.",
    full: "aMER = variação de receita ÷ variação de spend entre dois períodos. É o que decide escala: o último real investido sempre rende menos que a média. Escala-se enquanto o aMER estiver acima do MER de breakeven; quando cruza, parou de valer a pena.",
    formula: "aMER = Δreceita ÷ Δspend",
  },
  roas_plataforma: {
    label: "ROAS de plataforma (removido)",
    short: "Métrica que tiramos do painel por mentir.",
    full: "O ROAS que a Meta/Google reportam usa a receita que ELAS se atribuem (action_values). Meta e Google reivindicam a mesma venda, então somar/comparar esses ROAS infla o retorno e double-conta conversão. Substituímos por MER blended, que parte da receita real.",
  },
  cm1: {
    label: "CM1 (margem por pedido)",
    short: "O que sobra de cada pedido antes de gastar com aquisição.",
    full: "CM1 = receita − CMV − frete − desconto − impostos − taxa de pagamento. É a margem de contribuição do pedido em si. CM1 fraco aponta problema de produto (custo), comercial (desconto/frete grátis) ou meio de pagamento (parcelamento).",
    formula: "CM1 = receita − CMV − frete − desconto − impostos − taxa pgto",
    caveat: "Onde o SKU não tem custo real cadastrado, o CMV é estimado (ver Cobertura de custo).",
  },
  cm2: {
    label: "CM2 (margem após mídia)",
    short: "Lucro real antes dos custos fixos. É o número que governa a escala.",
    full: "CM2 = CM1 − investimento em mídia. Mostra se a operação ganha dinheiro depois de pagar a aquisição. Quando o CM2 marginal (do próximo real de spend) vira zero, esse é o teto de escala — não um ROAS<2x hardcoded.",
    formula: "CM2 = CM1 − mídia",
  },
  cm3: {
    label: "CM3 (margem após operação)",
    short: "Sobra depois de fulfillment, SAC e demais despesas operacionais.",
    full: "CM3 = CM2 − outras despesas operacionais variáveis (logística de entrega, atendimento, embalagem…). É a contribuição final antes dos custos fixos da empresa.",
    formula: "CM3 = CM2 − opex variável",
  },
  breakeven_mer: {
    label: "MER de breakeven",
    short: "MER mínimo para a operação não dar prejuízo.",
    full: "É o retorno por real de mídia abaixo do qual a venda queima caixa, dado o espaço de ads que a margem permite e os custos fixos diluídos na receita. MER abaixo do breakeven = escalar destrói dinheiro.",
    formula: "breakeven = 100 ÷ (margem disponível p/ ads %)",
  },
  healthy_mer: {
    label: "MER saudável",
    short: "MER de breakeven + uma folga de segurança configurável.",
    full: "É o MER-alvo para operar com gordura. Antes essa folga era um '-8' mágico cravado no código; agora é a Margem de Segurança que o workspace define e enxerga.",
    formula: "saudável = 100 ÷ (margem disponível p/ ads % − margem de segurança)",
  },
  ncac: {
    label: "nCAC (CAC de cliente novo)",
    short: "Quanto custa adquirir um cliente NOVO.",
    full: "nCAC = investimento total em mídia ÷ clientes NOVOS no período. Diferente do CAC blended, que divide pelo total de clientes e infla o retorno (recompra não custou mídia naquele mês). É o número que diz se a aquisição está cara.",
    formula: "nCAC = spend total ÷ clientes novos",
  },
  cac_payback: {
    label: "Payback de aquisição",
    short: "Quantos pedidos até o cliente pagar o que custou pra adquiri-lo.",
    full: "Quantos pedidos até a margem de contribuição acumulada cobrir o nCAC. Em moda costuma ser 1 a 3. Permite aceitar CM negativo no primeiro pedido de propósito, sabendo que a recompra recupera — em vez de ler todo mês de EBITDA negativo como prejuízo.",
    formula: "payback = nCAC ÷ CM1 por pedido",
  },
  repeat_rate: {
    label: "Taxa de recompra",
    short: "Fatia dos pedidos que veio de cliente que já comprou.",
    full: "Pedidos recorrentes ÷ total de pedidos. Em moda costuma ser 40–60% da receita e NÃO custou mídia naquele mês. Separar isso é essencial: misturar recompra com aquisição infla o MER e esconde o custo real de crescer.",
    formula: "recompra = pedidos recorrentes ÷ total de pedidos",
  },
  novos_vs_recorrentes: {
    label: "Novos vs recorrentes",
    short: "Quanto da receita do mês é aquisição vs base.",
    full: "Decompõe a receita em cliente novo (custou mídia) e recompra (ativação da base). São duas economias diferentes de CAC e margem — 'crescer' significa coisas opostas em cada uma.",
  },
  coverage_pct: {
    label: "Cobertura de custo",
    short: "Quanto da margem é FATO (custo real) vs PREMISSA (default).",
    full: "Fração da receita cujo SKU tem custo real cadastrado em product_costs. No resto, o CMV cai num default de 25% — e a 'margem' vira a própria premissa de volta (circular). Abaixo de ~70%, trate a margem/EBITDA como estimativa, não como fato.",
    formula: "cobertura = receita com custo real ÷ receita total",
    caveat: "Cadastrar custo dos produtos classe A (top da curva ABC) sobe a cobertura rápido.",
  },
  caixa_real: {
    label: "Caixa (contribuição)",
    short: "Receita menos TODOS os custos variáveis e a mídia — não só ads.",
    full: "Aqui 'caixa' já desconta CMV, impostos, frete, desconto e mídia (até CM2). É o dinheiro que de fato sobra da operação, antes dos custos fixos. A versão antiga era 'receita − ads', que ignorava ~36% de custos e mostrava caixa onde não havia.",
    caveat: "Ainda não modela timing de recebível (parcelado/gateway D+X), pagamento de fornecedor nem reposição de estoque — para isso é preciso o fluxo de caixa com capital de giro.",
  },
  caixa_receita_menos_ads: {
    label: "Por que mudou",
    short: "A definição antiga de caixa estava errada.",
    full: "'Caixa = receita − ads' não é caixa, é MER líquido de spend: ignorava CMV (25%), impostos (6%), outras (5%), frete e reposição de estoque. Como essa conta governava a regra de escalar ads, ela liberava escala que destruía caixa real. Trocamos por contribuição (CM2).",
  },
  inventory_coverage_days: {
    label: "Cobertura de estoque",
    short: "Quantos dias o estoque do produto aguenta no ritmo de venda atual.",
    full: "Unidades em mãos ÷ venda diária. Antes de escalar um campeão, é isto que diz se ele aguenta a demanda. Escalar ads num SKU com 4 dias de estoque = pagar tráfego pra empurrar pra ruptura. Estoque encalhado, no outro extremo, é o maior dreno de caixa em moda.",
    formula: "cobertura = unidades em estoque ÷ venda/dia",
  },
  ticket_medio: {
    label: "Ticket médio",
    short: "Receita média por pedido.",
    full: "Receita ÷ pedidos. Ao escalar com tráfego frio, o ticket tende a cair (mix muda) — por isso a projeção não o congela. É uma das duas alavancas da receita (a outra é volume de pedidos).",
    formula: "ticket = receita ÷ pedidos",
  },
  sazonalidade: {
    label: "Sazonalidade",
    short: "Como a receita anual se distribui pelos meses.",
    full: "Peso de cada mês na receita do ano. HOJE é um vetor digitado à mão, não derivado das vendas reais — então pode estar defasado (ex.: se a Black Friday mudou de padrão). Governa metas, ritmo esperado e a regra de escala, então vale validar contra o histórico real.",
    caveat: "Idealmente viria de uma decomposição da série real de crm_vendas, que ainda não persiste (snapshots se sobrescrevem).",
  },
  meta_sazonalizada: {
    label: "Meta do mês",
    short: "Meta de faturamento do mês, ajustada pela sazonalidade.",
    full: "Meta anual × peso do mês na sazonalidade. É a régua de pacing (quanto já realizamos vs o ritmo necessário). Confiável na medida em que a sazonalidade refletir a realidade.",
    formula: "meta do mês = meta anual × peso do mês",
  },
  safety_margin: {
    label: "Margem de segurança",
    short: "Folga (em p.p.) descontada do espaço de ads no MER saudável.",
    full: "Pontos percentuais de gordura que exigimos acima do breakeven ao definir o MER saudável. Substitui o número mágico '-8' que estava cravado no código — agora é configurável por workspace.",
  },
  ebitda: {
    label: "EBITDA",
    short: "Resultado operacional: contribuição menos custos fixos.",
    full: "Margem de contribuição − custos fixos. Cuidado com a média de EBITDA% ao longo de meses (média de percentuais engana): olhe EBITDA total ÷ receita total, e a magnitude dos meses negativos, não só a contagem de meses lucrativos.",
    caveat: "Herda a confiabilidade da cobertura de custo — abaixo de ~70%, é estimativa.",
  },
  ponto_otimo_escala: {
    label: "Ponto ótimo de escala",
    short: "Nível de spend onde o retorno marginal cruza o breakeven.",
    full: "O budget ótimo é onde o aMER (retorno do próximo real) iguala o MER de breakeven — não 'receita máxima com EBITDA ≥ 8%'. Sem série histórica calibrada, a curva de saturação é uma hipótese: trate os cenários como sensibilidade, não previsão.",
  },
  capital_preso_estoque: {
    label: "Capital preso em estoque",
    short: "Dinheiro parado em estoque que não gira, por idade.",
    full: "Valor de estoque imobilizado por faixa de aging (1–30 / 31–90 / 91–120 / 121+ dias). Estoque velho exige markdown para virar caixa — 'capital travado custa mais que a margem perdida'. É o elo direto entre escalar ads e quebrar caixa que o cockpit precisa enxergar.",
  },
};

/** Helper seguro: retorna a entrada do glossário ou um fallback. */
export function glossary(k: MetricKey): GlossaryEntry {
  return GLOSSARY[k];
}

import type {
  MacroSimulateInput,
  MacroSimulateOutput,
  SimulateInput,
  SimulateOutput,
  Veredicto,
} from "./types";

export function simulate(input: SimulateInput): SimulateOutput {
  const {
    precoCheio,
    descontoPct,
    freteGratis,
    custoProdutoPct,
    taxPct,
    outrasDespesasPct,
    custoFreteMedioBrl,
    pisoMargemPct,
    bufferZonaVerdePct,
  } = input;

  const safePreco = Math.max(0, precoCheio);
  const safeDesconto = Math.min(100, Math.max(0, descontoPct));

  const descontoBrl = safePreco * (safeDesconto / 100);
  const precoLiquido = safePreco - descontoBrl;

  const cmvBrl = safePreco * (custoProdutoPct / 100);
  const impostosBrl = precoLiquido * (taxPct / 100);
  const outrosBrl = precoLiquido * (outrasDespesasPct / 100);
  const freteAbsorvidoBrl = freteGratis ? custoFreteMedioBrl : 0;

  const custoTotal = cmvBrl + impostosBrl + outrosBrl + freteAbsorvidoBrl;
  const margemBrl = precoLiquido - custoTotal;
  const margemPct = precoLiquido > 0 ? (margemBrl / precoLiquido) * 100 : 0;

  const limiteVerde = pisoMargemPct + bufferZonaVerdePct;
  let veredicto: Veredicto;
  if (margemPct >= limiteVerde) veredicto = "verde";
  else if (margemPct >= pisoMargemPct) veredicto = "amarelo";
  else veredicto = "vermelho";

  const explicacao = buildExplicacao(veredicto, margemBrl, margemPct, pisoMargemPct, limiteVerde);
  const sugestoes = veredicto === "vermelho" ? buildSugestoes(input, margemPct, pisoMargemPct) : [];

  return {
    precoLiquido,
    descontoBrl,
    cmvBrl,
    impostosBrl,
    outrosBrl,
    freteAbsorvidoBrl,
    custoTotal,
    margemBrl,
    margemPct,
    veredicto,
    explicacao,
    sugestoes,
  };
}

function buildExplicacao(
  veredicto: Veredicto,
  margemBrl: number,
  margemPct: number,
  pisoPct: number,
  limiteVerde: number
): string {
  const formatBrl = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const margemStr = `${formatBrl(margemBrl)} (${margemPct.toFixed(1)}%)`;

  if (veredicto === "verde") {
    return `Margem por venda de ${margemStr} está acima do piso seguro de ${limiteVerde.toFixed(1)}%. Time pode aplicar sem te consultar.`;
  }
  if (veredicto === "amarelo") {
    return `Margem por venda de ${margemStr} está dentro do aceitável (entre piso ${pisoPct.toFixed(1)}% e ${limiteVerde.toFixed(1)}%). Só rodar com motivo claro e prazo definido.`;
  }
  return `Margem por venda de ${margemStr} está abaixo do piso de ${pisoPct.toFixed(1)}%. Movimento bloqueado nesta configuração.`;
}

export function simulateMacro(input: MacroSimulateInput): MacroSimulateOutput {
  const {
    baseline,
    descontoPct,
    coberturaPct,
    incrementoVendasPct,
    freteGratisCobertura,
    custoProdutoPct,
    taxPct,
    outrasDespesasPct,
    adsPct,
    incluirAds,
    custoFreteMedioBrl,
    custoFixoMensal,
    pisoMargemPct,
    bufferZonaVerdePct,
  } = input;

  const safeDesconto = Math.min(100, Math.max(0, descontoPct));
  const safeCobertura = Math.min(100, Math.max(0, coberturaPct)) / 100;
  const safeFreteCob = Math.min(100, Math.max(0, freteGratisCobertura)) / 100;
  const liftFactor = 1 + Math.max(-100, incrementoVendasPct) / 100;
  const adsPctEfetivo = incluirAds ? Math.max(0, adsPct) : 0;

  const ticketBase = baseline.ticketMedio;
  const numPedidosMensalHist = baseline.receitaMediaDiaria > 0
    ? (baseline.numPedidos / Math.max(1, baseline.diasComVenda)) * 30
    : 0;
  const receitaMensalHist = numPedidosMensalHist * ticketBase;

  const histPerOrder = computeMargin({
    receitaUnit: ticketBase,
    descontoBrl: 0,
    cmvBase: ticketBase,
    custoProdutoPct,
    taxPct,
    outrasDespesasPct,
    freteAbsorvido: 0,
  });

  const numPedidosProj = numPedidosMensalHist * liftFactor;
  const numPromo = numPedidosProj * safeCobertura;
  const numCheio = numPedidosProj * (1 - safeCobertura);
  const numComFrete = numPedidosProj * safeFreteCob;

  const descontoBrlPorPedido = ticketBase * (safeDesconto / 100);
  const ticketPromo = ticketBase - descontoBrlPorPedido;

  const promoPerOrder = computeMargin({
    receitaUnit: ticketPromo,
    descontoBrl: descontoBrlPorPedido,
    cmvBase: ticketBase,
    custoProdutoPct,
    taxPct,
    outrasDespesasPct,
    freteAbsorvido: 0,
  });

  const cheioPerOrder = computeMargin({
    receitaUnit: ticketBase,
    descontoBrl: 0,
    cmvBase: ticketBase,
    custoProdutoPct,
    taxPct,
    outrasDespesasPct,
    freteAbsorvido: 0,
  });

  const freteAbsorvidoTotal = numComFrete * custoFreteMedioBrl;

  const receitaProj = numPromo * ticketPromo + numCheio * ticketBase;
  const adsBrlProj = receitaProj * (adsPctEfetivo / 100);
  const margemProj =
    numPromo * promoPerOrder.margemBrl +
    numCheio * cheioPerOrder.margemBrl -
    freteAbsorvidoTotal -
    adsBrlProj;
  const margemPctProj = receitaProj > 0 ? (margemProj / receitaProj) * 100 : 0;
  const ticketMedioProj = numPedidosProj > 0 ? receitaProj / numPedidosProj : ticketBase;
  const lucroOperacionalProj = margemProj - custoFixoMensal;

  const adsBrlHist = receitaMensalHist * (adsPctEfetivo / 100);
  const margemHist = numPedidosMensalHist * histPerOrder.margemBrl - adsBrlHist;
  const margemPctHist = receitaMensalHist > 0 ? (margemHist / receitaMensalHist) * 100 : 0;
  const lucroOperacionalHist = margemHist - custoFixoMensal;

  const limiteVerde = pisoMargemPct + bufferZonaVerdePct;
  let veredicto: Veredicto;
  if (margemPctProj >= limiteVerde) veredicto = "verde";
  else if (margemPctProj >= pisoMargemPct) veredicto = "amarelo";
  else veredicto = "vermelho";

  const explicacao = buildMacroExplicacao(veredicto, margemProj, margemPctProj, pisoMargemPct, limiteVerde);

  return {
    projetadoMensal: {
      receita: receitaProj,
      margemBrl: margemProj,
      margemPct: margemPctProj,
      adsBrl: adsBrlProj,
      custoFixo: custoFixoMensal,
      lucroOperacional: lucroOperacionalProj,
      numPedidos: numPedidosProj,
      ticketMedio: ticketMedioProj,
    },
    historicoMensal: {
      receita: receitaMensalHist,
      margemBrl: margemHist,
      margemPct: margemPctHist,
      adsBrl: adsBrlHist,
      custoFixo: custoFixoMensal,
      lucroOperacional: lucroOperacionalHist,
      numPedidos: numPedidosMensalHist,
      ticketMedio: ticketBase,
    },
    deltaReceita: receitaProj - receitaMensalHist,
    deltaMargemBrl: margemProj - margemHist,
    deltaMargemPct: margemPctProj - margemPctHist,
    deltaLucroOperacional: lucroOperacionalProj - lucroOperacionalHist,
    veredicto,
    explicacao,
  };
}

function computeMargin(input: {
  receitaUnit: number;
  descontoBrl: number;
  cmvBase: number;
  custoProdutoPct: number;
  taxPct: number;
  outrasDespesasPct: number;
  freteAbsorvido: number;
}): { margemBrl: number; custoTotal: number } {
  const cmv = input.cmvBase * (input.custoProdutoPct / 100);
  const impostos = input.receitaUnit * (input.taxPct / 100);
  const outros = input.receitaUnit * (input.outrasDespesasPct / 100);
  const custoTotal = cmv + impostos + outros + input.freteAbsorvido;
  return {
    margemBrl: input.receitaUnit - custoTotal,
    custoTotal,
  };
}

function buildMacroExplicacao(
  veredicto: Veredicto,
  margemBrl: number,
  margemPct: number,
  pisoPct: number,
  limiteVerde: number
): string {
  const fmtBrl = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const margemStr = `${fmtBrl(margemBrl)} (${margemPct.toFixed(1)}%)`;
  if (veredicto === "verde") {
    return `Cenário sustenta margem mensal de ${margemStr}, acima do piso seguro de ${limiteVerde.toFixed(1)}%.`;
  }
  if (veredicto === "amarelo") {
    return `Cenário fica com margem de ${margemStr}, dentro do aceitável (entre piso ${pisoPct.toFixed(1)}% e zona verde ${limiteVerde.toFixed(1)}%). Avalie o impacto.`;
  }
  return `Cenário derruba margem pra ${margemStr}, abaixo do piso de ${pisoPct.toFixed(1)}%. Reduza desconto, cobertura ou frete grátis.`;
}

function buildSugestoes(input: SimulateInput, margemPct: number, pisoPct: number): string[] {
  const sugestoes: string[] = [];
  const gap = pisoPct - margemPct;

  if (input.descontoPct > 0) {
    const descontoSugerido = Math.max(0, input.descontoPct - Math.ceil(gap + 2));
    sugestoes.push(
      `Reduza desconto pra ${descontoSugerido}% (atualmente ${input.descontoPct}%) — recupera margem.`
    );
  }
  if (input.freteGratis) {
    sugestoes.push(
      `Tire frete grátis — devolve R$ ${input.custoFreteMedioBrl.toFixed(2)} pra margem.`
    );
  }
  sugestoes.push("Suba ticket via combo (disponível em fatia futura).");

  return sugestoes;
}

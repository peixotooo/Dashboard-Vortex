import type { SimulateInput, SimulateOutput, Veredicto } from "./types";

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

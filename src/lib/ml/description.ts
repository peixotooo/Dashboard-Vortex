/**
 * Gerador de descrição para anúncios do Mercado Livre (camisetas/regatas Bulking).
 *
 * Baseado na pesquisa (2026-06-17): no ML quem ranqueia é TÍTULO + FICHA TÉCNICA;
 * a descrição serve pra CONVERSÃO. Então o texto é curto, escaneável, texto puro
 * (sem HTML/links/contato), keywords naturais (sem stuffing), foco em tirar dúvida
 * (caimento, tecido, como escolher tamanho, cuidados) + 2 linhas de tom de marca.
 *
 * HONESTIDADE (regra dura da marca): nunca inventar medida nem composição.
 * - Tecido Bulking de camiseta/regata SEMPRE tem elastano (algodão + elastano).
 *   Linha dri-fit (nome contém "DRY") = poliéster + elastano.
 * - % exato só quando vier do campo Eccosys `Composição` (parâmetro `composicao`).
 * - Sem tabela de medidas (não temos os números) — usamos a orientação de oversized.
 */

import { detectColorFromName } from "@/lib/ml/attributes";

// hash determinístico (sem Math.random) p/ variar abertura/fecho sem repetir igual
function pick<T>(arr: T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}

const ABERTURAS = [
  "Pra quem leva o treino e a rotina a sério. A peça vem depois da atitude.",
  "Feita pra quem treina de verdade e veste sem firula no resto do dia.",
  "Conforto pra treinar pesado e atitude pra usar em qualquer lugar.",
  "Do treino à rua, sem mudar de roupa e sem perder a postura.",
];

const FECHOS = [
  "Padrão acima de commodity. Roupa pra quem faz, não pra quem quer parecer. Respect The Hustle.",
  "Sem atalho e sem firula: qualidade pra durar. Respect The Hustle.",
  "Feita pra durar e acompanhar o ritmo. Respect The Hustle.",
];

type GarmentInfo = { tipo: string; manga: string; termoBusca: string };

function detectGarment(name: string): GarmentInfo {
  const n = name.toLowerCase();
  if (/\bregata|\btank\b|\bmachã|\bmachao|cavada\b/.test(n))
    return { tipo: "Regata oversized", manga: "Cava ampla, sem manga", termoBusca: "regata masculina" };
  if (/\bpolo\b/.test(n))
    return { tipo: "Camisa polo", manga: "Manga curta com gola polo", termoBusca: "camisa polo masculina" };
  if (/bermuda|short/.test(n))
    return { tipo: "Bermuda", manga: "", termoBusca: "bermuda masculina" };
  return { tipo: "Camiseta oversized", manga: "Manga curta", termoBusca: "camiseta oversized masculina" };
}

function colorLabel(name: string): string {
  return detectColorFromName(name) || "";
}

export interface DescOpts {
  composicao?: string | null; // campo Eccosys "Composição", se houver (ex.: "96% Algodão 4% Elastano")
}

/**
 * Monta a descrição (texto puro) no padrão Bulking a partir do NOME do produto.
 * Determinístico e honesto: só afirma o que sabemos.
 */
export function buildMlDescription(name: string, opts: DescOpts = {}): string {
  const nome = (name || "").trim();
  const g = detectGarment(nome);
  const cor = colorLabel(nome);
  const isDry = /\bdry\b/i.test(nome);
  const isBermuda = g.tipo === "Bermuda";

  const compExata = (opts.composicao || "").trim();
  // linha de composição (honesta): elastano sempre p/ camiseta/regata
  let tecidoBase: string;
  if (isDry) {
    tecidoBase = compExata ? `Tecido dry com elastano (${compExata})` : "Tecido dry com elastano";
  } else if (isBermuda) {
    tecidoBase = compExata ? `Tecido com elastano (${compExata})` : "Tecido com elastano";
  } else {
    tecidoBase = compExata ? `Algodão premium com elastano (${compExata})` : "Algodão premium com elastano";
  }

  const tecidoFrase = isDry
    ? "Tecido dry levemente encorpado, leve e respirável, com secagem rápida. O elastano dá elasticidade e liberdade de movimento — não restringe no treino e mantém o formato depois das lavagens."
    : isBermuda
    ? "Tecido confortável e respirável com elastano: elasticidade e liberdade de movimento, mantém o formato depois das lavagens."
    : "Levemente encorpada, confortável e respirável. O elastano garante elasticidade e liberdade de movimento — não restringe no treino, não fica transparente e mantém o formato depois das lavagens.";

  const recebe = [
    `- ${g.tipo}${cor ? ` · Cor: ${cor}` : ""}`,
    `- ${tecidoBase}`,
    g.manga ? `- ${g.manga} · caimento estruturado, não marca o corpo` : `- Caimento confortável`,
    `- Ideal pra treino, academia e dia a dia`,
  ].filter(Boolean).join("\n");

  const comoTamanho = isBermuda
    ? "Confira a numeração antes de comprar. Em dúvida entre dois tamanhos, prefira o maior."
    : "Modelagem oversized. Se você prefere um caimento mais justo, peça um número abaixo do seu usual.";

  const cuidados =
    "Lavar do avesso em água fria · não usar alvejante · secar à sombra · ferro morno se precisar.";

  const titulo = nome
    .replace(/\s+/g, " ")
    .replace(/\b([A-ZÀ-Ý]{2,})\b/g, (w) => w.charAt(0) + w.slice(1).toLowerCase()); // tira CAIXA ALTA

  return [
    `${titulo}`,
    ``,
    pick(ABERTURAS, nome),
    ``,
    `O QUE VOCÊ RECEBE`,
    recebe,
    ``,
    `TECIDO E TOQUE`,
    tecidoFrase,
    ``,
    `COMO ESCOLHER O TAMANHO`,
    comoTamanho,
    ``,
    `CUIDADOS`,
    cuidados,
    ``,
    `GARANTIA`,
    `Garantia de fábrica: 90 dias contra defeitos de fabricação.`,
    ``,
    `POR QUE BULKING`,
    pick(FECHOS, nome + "x"),
  ].join("\n");
}

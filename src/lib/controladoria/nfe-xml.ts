// ============================================================
// Leitor de XML de NF-e (modelo 55) → contas a pagar.
//
// Regras fiscais apuradas contra XMLs reais (ver docs/nfe-import.md):
//  - VALOR A PAGAR = total/ICMSTot/vNF. NUNCA IBSCBSTot/vNFTot nem det/vItem:
//    no layout novo da reforma (IBS/CBS) o vNFTot re-soma PIS+COFINS que já
//    estavam embutidos no preço — numa nota real de R$ 25.154,22 o vNFTot era
//    R$ 27.480,98 (+9,25%). Pagar por ele é o erro mais caro possível aqui.
//  - COMPRA se detecta comparando CNPJ (dest = nosso, emit = terceiro).
//    ide/tpNF NÃO serve: toda nota de fornecedor chega com tpNF=1 (saída do
//    emitente), então "tpNF=0 = entrada" rejeitaria 100% das compras.
//  - CFOP do arquivo é o do FORNECEDOR (saída, 5/6/7). Classifica-se pelos
//    3 ÚLTIMOS dígitos, varrendo TODOS os itens.
//  - Parcelas = cobr/dup. Ordenar por vencimento antes de numerar (a ordem no
//    XML não é garantida) e tratar nDup como string ("001", zeros à esquerda).
//
// Parser próprio, sem dependências: não resolve entidades externas (imune a
// XXE/billion-laughs) e é agnóstico a prefixo de namespace (<ns2:nfeProc>).
// ============================================================

// ---------- micro-parser de XML ----------

export interface XmlNode {
  name: string; // local name, sem prefixo de namespace
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X"
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : full;
    }
    return ENTITIES[code] ?? full;
  });
}

const localName = (raw: string) => {
  const i = raw.indexOf(":");
  return i === -1 ? raw : raw.slice(i + 1);
};

/** Parser XML mínimo (elementos, atributos, texto, CDATA). Ignora DTD/PI. */
export function parseXml(xml: string): XmlNode | null {
  let src = xml.replace(/^﻿/, "");
  // remove declaração, comentários, DOCTYPE e instruções de processamento
  src = src.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  src = src.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?[^>]*>/gi, "");

  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  const tagRe = /<(\/?)([A-Za-z_][\w.\-:]*)((?:\s+[\w.\-:]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(src)) !== null) {
    const top = stack[stack.length - 1];
    const between = src.slice(last, m.index);
    if (between.trim()) top.text += decodeEntities(between);
    last = tagRe.lastIndex;

    if (m[5] !== undefined) { top.text += m[5]; continue; } // CDATA

    const [, closing, rawName, rawAttrs, selfClose] = m;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node: XmlNode = { name: localName(rawName), attrs: {}, children: [], text: "" };
    if (rawAttrs) {
      const attrRe = /([\w.\-:]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      while ((a = attrRe.exec(rawAttrs)) !== null) {
        node.attrs[localName(a[1])] = decodeEntities(a[2] ?? a[3] ?? "");
      }
    }
    top.children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root.children[0] ?? null;
}

export const kid = (n: XmlNode | null | undefined, name: string): XmlNode | null =>
  n?.children.find((c) => c.name === name) ?? null;

export const kids = (n: XmlNode | null | undefined, name: string): XmlNode[] =>
  n?.children.filter((c) => c.name === name) ?? [];

/** Texto de um caminho de nomes locais (ex.: path(nfe, "ide", "nNF")). */
export function txt(n: XmlNode | null | undefined, ...path: string[]): string {
  let cur: XmlNode | null | undefined = n;
  for (const p of path) cur = kid(cur, p);
  return (cur?.text ?? "").trim();
}

/** Primeiro descendente com esse nome local, em qualquer profundidade. */
export function deep(n: XmlNode | null, name: string): XmlNode | null {
  if (!n) return null;
  if (n.name === name) return n;
  for (const c of n.children) {
    const found = deep(c, name);
    if (found) return found;
  }
  return null;
}

const num = (s: string): number => {
  const v = Number.parseFloat(s);
  return Number.isFinite(v) ? v : 0;
};
export const onlyDigits = (s: string) => (s ?? "").replace(/\D/g, "");

// ---------- CFOP: classificação pelos 3 últimos dígitos ----------

/** Gera conta a pagar (compra de fato). */
const CFOP_ACEITA = new Set([
  "101", "102", "103", "104", "105", "106", "109", "110",
  "111", "113", "114", "115", "116", "117", "118", "119", "120",
  "122", "123", "124", "125",
  "401", "402", "403", "405", // venda com ST
  "551", // ativo imobilizado (o usuário reclassifica)
  "556", // uso e consumo
]);

/** Nunca é conta a pagar (devolução, transferência, remessa, exportação). */
const CFOP_REJEITA = new Set([
  "201", "202", "208", "209", "210", "211", // devoluções
  "410", "411", "412", "413", "414", "503", "553", "555",
  "660", "661", "662", "918", "919",
  "151", "152", "153", "155", "156", "552", "557", // transferências
  "901", "902", "903", "904", "905", "906", "907", // industrialização p/ encomenda
  "908", "909", // comodato
  "910", "911", "912", "913", "914", "915", "916", "917", // bonificação, amostra, demonstração, conserto
  "920", "921", "922", "923", "924", "925", "926", "934",
  "501", "502", "504", "505", "554", // exportação / armazém
  "251", "252", "253", "254", "255", "256", "257", // energia
  "301", "302", "303", "304", "305", "306", "307",
]);

export type CfopVeredito = "aceita" | "rejeita" | "revisar";

export function classificaCfop(cfop: string): CfopVeredito {
  const c = onlyDigits(cfop);
  if (c.length !== 4) return "revisar";
  if (c[0] === "3" || c[0] === "7") return "revisar"; // importação/exportação
  const sufixo = c.slice(1);
  if (CFOP_REJEITA.has(sufixo)) return "rejeita";
  if (CFOP_ACEITA.has(sufixo)) return "aceita";
  return "revisar"; // 949 e quaisquer não mapeados
}

// ---------- resultado ----------

export interface NfeParcela {
  nDup: string;
  dueDate: string; // AAAA-MM-DD
  amount: number;
  estimada?: boolean; // vencimento inferido (nota sem duplicata)
}

export interface NfeParsed {
  chave: string;
  numero: string;
  serie: string;
  emitCnpj: string;
  emitNome: string;
  emitFantasia: string;
  destCnpj: string;
  emissao: string; // AAAA-MM-DD (data local do emitente)
  natOp: string;
  valor: number; // vNF — o que se paga
  parcelas: NfeParcela[];
  cfops: string[];
  itens: string; // resumo dos produtos
  infCpl: string;
  protocolo: string;
  avisos: string[]; // motivos para revisão humana
}

export type NfeResultado =
  | { ok: true; nfe: NfeParsed }
  | { ok: false; erro: string };

const RAIZ_EVENTO = new Set(["procEventoNFe", "envEvento", "evento", "retEvento", "resEvento"]);
const RAIZ_RESUMO = new Set(["resNFe", "retDistDFeInt"]);
const RAIZ_NFSE = new Set([
  "CompNfse", "Nfse", "ConsultarNfseResposta", "ConsultarNfseRpsResposta",
  "GerarNfseResposta", "EnviarLoteRpsResposta", "ListaNfse",
]);

/**
 * Lê um XML e devolve a NF-e pronta para virar conta a pagar, ou um erro
 * explicando exatamente o que foi encontrado.
 * @param cnpjsEmpresa CNPJs da nossa empresa (matriz + filiais), só dígitos.
 */
export function parseNfe(xmlText: string, cnpjsEmpresa: string[]): NfeResultado {
  let root: XmlNode | null;
  try {
    root = parseXml(xmlText);
  } catch {
    return { ok: false, erro: "Arquivo não é um XML válido." };
  }
  if (!root) return { ok: false, erro: "Arquivo não parece ser um XML (nenhum elemento encontrado)." };

  // --- triagem por raiz ---
  if (RAIZ_EVENTO.has(root.name)) {
    const tp = txt(deep(root, "infEvento"), "tpEvento");
    const nomes: Record<string, string> = {
      "110110": "Carta de Correção", "110111": "Cancelamento",
      "110112": "cancelamento por substituição", "210200": "Confirmação da operação",
      "210210": "Ciência da operação", "210220": "Desconhecimento", "210240": "Operação não realizada",
    };
    return { ok: false, erro: `É um XML de EVENTO (${nomes[tp] ?? `tpEvento ${tp || "?"}`}), não uma nota fiscal.` };
  }
  if (RAIZ_RESUMO.has(root.name)) {
    return { ok: false, erro: "É um XML de RESUMO da distribuição (sem itens nem duplicatas). Baixe o XML completo da nota." };
  }
  if (RAIZ_NFSE.has(root.name) || root.name.toLowerCase().includes("nfse")) {
    return { ok: false, erro: "É uma NFS-e (nota de serviço). O layout varia por município e não é suportado — lance manualmente." };
  }
  if (root.name === "cteProc" || root.name === "CTe") {
    return { ok: false, erro: "É um CT-e (conhecimento de transporte). Ainda não suportado — lance o frete manualmente." };
  }
  if (root.name === "mdfeProc" || root.name === "MDFe") {
    return { ok: false, erro: "É um MDF-e (manifesto de transporte), que nunca gera conta a pagar." };
  }
  if (root.name !== "nfeProc" && root.name !== "NFe") {
    return { ok: false, erro: `Raiz do XML não reconhecida: <${root.name}>. Esperado nfeProc ou NFe (modelo 55).` };
  }

  const infNFe = deep(root, "infNFe");
  if (!infNFe) return { ok: false, erro: "XML sem o bloco infNFe — arquivo incompleto." };
  const ide = kid(infNFe, "ide");
  const emit = kid(infNFe, "emit");
  const dest = kid(infNFe, "dest");
  if (!ide || !emit) return { ok: false, erro: "XML sem os blocos ide/emit — arquivo incompleto." };

  const avisos: string[] = [];

  // --- modelo / ambiente / autorização ---
  const mod = txt(ide, "mod");
  if (mod === "65") {
    return { ok: false, erro: "É uma NFC-e (cupom de venda ao consumidor), não uma nota de fornecedor." };
  }
  if (mod && mod !== "55") {
    return { ok: false, erro: `Modelo de documento ${mod} não suportado (esperado 55).` };
  }
  if (txt(ide, "tpAmb") === "2") {
    return { ok: false, erro: "Nota emitida em ambiente de HOMOLOGAÇÃO (teste), não vale como documento fiscal." };
  }

  const infProt = deep(root, "infProt");
  if (infProt) {
    const cStat = txt(infProt, "cStat");
    if (cStat && cStat !== "100" && cStat !== "150") {
      return { ok: false, erro: `Nota não autorizada pela SEFAZ (cStat ${cStat}: ${txt(infProt, "xMotivo") || "sem motivo"}).` };
    }
  } else {
    avisos.push("XML sem protocolo de autorização — não dá para confirmar que a nota está autorizada.");
  }

  // --- chave de acesso (3 fontes conferidas entre si) ---
  const idAttr = infNFe.attrs["Id"] ?? "";
  const chaveId = onlyDigits(idAttr);
  const chaveProt = onlyDigits(txt(infProt, "chNFe"));
  const chave = chaveId.length === 44 ? chaveId : chaveProt;
  if (chave.length !== 44) {
    return { ok: false, erro: "Chave de acesso ausente ou inválida (esperados 44 dígitos)." };
  }
  if (chaveProt && chaveProt.length === 44 && chaveId.length === 44 && chaveProt !== chaveId) {
    return { ok: false, erro: "Chave de acesso divergente entre a nota e o protocolo — arquivo possivelmente adulterado." };
  }

  // --- é compra nossa? (regra por CNPJ, nunca por tpNF) ---
  const emitCnpj = onlyDigits(txt(emit, "CNPJ") || txt(emit, "CPF"));
  const destCnpj = onlyDigits(txt(dest, "CNPJ") || txt(dest, "CPF"));
  const nossos = cnpjsEmpresa.map(onlyDigits).filter(Boolean);
  if (nossos.length) {
    if (nossos.includes(emitCnpj)) {
      return { ok: false, erro: "Nota emitida pela própria empresa (venda), não é conta a pagar." };
    }
    if (!nossos.includes(destCnpj)) {
      return { ok: false, erro: `A nota não é destinada à empresa (destinatário ${destCnpj || "não informado"}).` };
    }
  } else {
    avisos.push("CNPJ da empresa não configurado — não foi possível confirmar que a nota é uma compra.");
  }

  // --- finalidade ---
  const finNFe = txt(ide, "finNFe");
  if (finNFe === "4") return { ok: false, erro: "É uma nota de DEVOLUÇÃO (finNFe=4), não gera conta a pagar." };
  if (finNFe === "2") avisos.push("Nota COMPLEMENTAR: se for complemento de imposto, não gera pagamento — confirme.");
  if (finNFe === "3") avisos.push("Nota de AJUSTE: confirme se realmente há valor a pagar.");
  if (kid(ide, "NFref")) avisos.push("A nota referencia outra NF (devolução/complemento) — confira antes de lançar.");

  // --- CFOPs (varre todos os itens) ---
  const dets = kids(infNFe, "det");
  const cfops = [...new Set(dets.map((d) => txt(d, "prod", "CFOP")).filter(Boolean))];
  const veredictos = cfops.map(classificaCfop);
  if (cfops.length && veredictos.every((v) => v === "rejeita")) {
    return {
      ok: false,
      erro: `CFOP ${cfops.join(", ")} não gera conta a pagar (devolução, remessa, bonificação ou transferência).`,
    };
  }
  if (veredictos.includes("rejeita")) {
    avisos.push(`A nota mistura CFOPs: ${cfops.join(", ")} — parte não é conta a pagar. Confira o valor.`);
  }
  if (veredictos.includes("revisar")) {
    avisos.push(`CFOP ${cfops.filter((c, i) => veredictos[i] === "revisar").join(", ")} exige conferência manual.`);
  }

  // --- valor: SEMPRE ICMSTot/vNF ---
  const icmsTot = kid(kid(infNFe, "total"), "ICMSTot");
  const valor = num(txt(icmsTot, "vNF"));
  if (!(valor > 0)) {
    return { ok: false, erro: "Nota sem valor total (vNF) — não é possível lançar." };
  }

  // --- data de emissão: respeita o offset local, sem converter p/ UTC ---
  const dhEmi = txt(ide, "dhEmi") || txt(ide, "dEmi");
  const emissao = dhEmi.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(emissao)) {
    return { ok: false, erro: "Data de emissão ausente ou inválida no XML." };
  }

  // --- parcelas ---
  const cobr = kid(infNFe, "cobr");
  const dups = kids(cobr, "dup");
  let parcelas: NfeParcela[] = dups
    .map((d) => ({
      nDup: txt(d, "nDup"),
      dueDate: txt(d, "dVenc").slice(0, 10),
      amount: num(txt(d, "vDup")),
    }))
    .filter((p) => p.amount > 0);

  const semVencimento = parcelas.some((p) => !/^\d{4}-\d{2}-\d{2}$/.test(p.dueDate));
  if (semVencimento) {
    avisos.push("Há duplicata sem data de vencimento no XML — usei a data de emissão; confirme o prazo.");
    parcelas = parcelas.map((p) => (/^\d{4}-\d{2}-\d{2}$/.test(p.dueDate) ? p : { ...p, dueDate: emissao, estimada: true }));
  }

  // ordena por vencimento (a ordem no XML não é garantida) e renumera
  parcelas.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.nDup.localeCompare(b.nDup));

  const pag = kid(infNFe, "pag");
  const detPag = kid(pag, "detPag");
  const tPag = txt(detPag, "tPag");
  const indPag = txt(detPag, "indPag") || txt(ide, "indPag"); // 3.10 punha em ide

  if (!parcelas.length) {
    if (tPag === "90") {
      return { ok: false, erro: "Nota SEM PAGAMENTO (tPag=90) — remessa, bonificação ou amostra." };
    }
    const aVista = indPag === "0" || ["01", "02", "03", "04", "05", "17", "18", "20", "21"].includes(tPag);
    parcelas = [{ nDup: "001", dueDate: emissao, amount: valor, estimada: true }];
    avisos.push(
      aVista
        ? "Nota À VISTA (sem duplicatas): lancei com vencimento na emissão — marque como paga se já foi quitada."
        : "Nota a prazo SEM duplicatas no XML: vencimento estimado na data de emissão — ajuste o prazo real."
    );
  }

  // --- reconciliação: soma das parcelas × vNF ---
  const somaParcelas = parcelas.reduce((a, p) => a + p.amount, 0);
  const tolerancia = 0.01 * parcelas.length + 0.005;
  if (Math.abs(somaParcelas - valor) > tolerancia) {
    avisos.push(
      `Soma das parcelas (R$ ${somaParcelas.toFixed(2)}) difere do total da nota (R$ ${valor.toFixed(2)}). ` +
        "As parcelas são o que se paga — confira antes de confirmar."
    );
  }

  // --- resumo dos itens ---
  const nomes = dets.map((d) => txt(d, "prod", "xProd")).filter(Boolean);
  const itens = nomes.slice(0, 3).join(", ") + (nomes.length > 3 ? ` e mais ${nomes.length - 3} ${nomes.length - 3 === 1 ? "item" : "itens"}` : "");

  return {
    ok: true,
    nfe: {
      chave,
      numero: txt(ide, "nNF"),
      serie: txt(ide, "serie"),
      emitCnpj,
      emitNome: txt(emit, "xNome"),
      emitFantasia: txt(emit, "xFant"),
      destCnpj,
      emissao,
      natOp: txt(ide, "natOp"),
      valor,
      parcelas,
      cfops,
      itens,
      infCpl: txt(kid(infNFe, "infAdic"), "infCpl"),
      protocolo: txt(infProt, "nProt"),
      avisos,
    },
  };
}

// ---------- convenções de lançamento (as que o financeiro já usa) ----------

/** Descrição do lançamento: "NF1356" — padrão real dos 390 lançamentos de 2026. */
export const descricaoNf = (numero: string) => `NF${(numero ?? "").replace(/^0+/, "")}`;

/** Observação: "chave - <44 dígitos>" — formato exato usado hoje (e base da dedup). */
export const observacaoNf = (chave: string) => `chave - ${chave}`;

/** Normaliza nome de parceiro para casar com fin_partners.name. */
export function normalizaNome(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

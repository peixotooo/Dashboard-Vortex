// Inferência de gênero a partir de nome + email.
//
// Estratégia em camadas (primeiro match ganha):
//   1. Nome completo → primeiro token → IBGE_NAMES (alta/média confiança).
//   2. Email local-part → primeiro token "nominal" → IBGE_NAMES
//      (uma camada abaixo da do nome, pois o local-part é mais ruidoso).
//   3. Regra de sufixo do primeiro token do nome (-a / -o) → baixa
//      confiança. Só roda quando o token tem >=4 letras pra evitar
//      falso-positivo em coisas tipo "Mc", "Jr", "Dr".
//
// Confiança é a moeda principal pra segmentação: só vamos comunicar
// como "mulher" quem cair em high+medium, então as regras de subida
// pra essas tiers são conservadoras de propósito.

import { IBGE_NAMES, type IbgeNameEntry } from "./ibge-names";

export type Gender = "female" | "male" | "unknown";
export type Confidence = "high" | "medium" | "low" | "unknown";
export type InferenceSource =
  | "name_ibge"        // primeiro token do nome bateu no dicionário
  | "email_ibge"       // primeiro token do email bateu no dicionário
  | "name_suffix_rule" // heurística de sufixo (-a / -o) sobre o nome
  | "none";            // sem sinal

export type InferenceResult = {
  gender: Gender;
  confidence: Confidence;
  source: InferenceSource;
  matchedName: string | null;   // o token normalizado que casou
  femaleRatio: number | null;   // 0..1, pra transparência/auditoria
};

const HONORIFICS = new Set([
  "sr", "sra", "srta", "dr", "dra", "prof", "profa",
]);

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizeToken(raw: string): string {
  return stripAccents(raw.trim().toLowerCase()).replace(/[^a-z]/g, "");
}

/**
 * Extrai o primeiro nome de um nome completo. Pula honoríficos
 * comuns (sr, dr, prof). Retorna string vazia se não houver token
 * válido.
 */
export function extractFirstName(fullName: string | null | undefined): string {
  if (!fullName) return "";
  const tokens = fullName
    .split(/\s+/)
    .map((t) => normalizeToken(t))
    .filter((t) => t.length > 0);

  for (const t of tokens) {
    if (!HONORIFICS.has(t)) return t;
  }
  return "";
}

/**
 * Extrai o "primeiro nome" do local-part de um email. Pega tudo antes
 * do @, quebra em tokens por separadores comuns (. _ - +) e dígitos,
 * e devolve o primeiro token alfabético com >=3 letras (pra evitar
 * iniciais como "j.silva" virando "j" → false match).
 */
export function extractNameFromEmail(email: string | null | undefined): string {
  if (!email) return "";
  const at = email.indexOf("@");
  if (at <= 0) return "";
  const local = email.slice(0, at);
  const tokens = local
    .split(/[._\-+0-9]+/)
    .map((t) => normalizeToken(t))
    .filter((t) => t.length >= 3);

  for (const t of tokens) {
    if (!HONORIFICS.has(t)) return t;
  }
  return "";
}

/**
 * Converte um match do IBGE_NAMES no nosso resultado de inferência.
 * As faixas de confiança são deliberadamente conservadoras pra
 * proteger campanhas "só mulheres" de falsos positivos.
 */
function classifyFromEntry(
  token: string,
  entry: IbgeNameEntry,
  source: InferenceSource,
): InferenceResult {
  const { femaleRatio, occurrences } = entry;
  let gender: Gender = "unknown";
  let confidence: Confidence = "unknown";

  if (femaleRatio >= 0.97) {
    gender = "female";
    confidence = occurrences === "low" ? "medium" : "high";
  } else if (femaleRatio >= 0.85) {
    gender = "female";
    confidence = "medium";
  } else if (femaleRatio >= 0.6) {
    gender = "female";
    confidence = "low";
  } else if (femaleRatio <= 0.03) {
    gender = "male";
    confidence = occurrences === "low" ? "medium" : "high";
  } else if (femaleRatio <= 0.15) {
    gender = "male";
    confidence = "medium";
  } else if (femaleRatio <= 0.4) {
    gender = "male";
    confidence = "low";
  } else {
    // 0.4 < ratio < 0.6 → genuinamente ambíguo
    gender = "unknown";
    confidence = "unknown";
  }

  // Quando o sinal veio do email (mais ruidoso), abaixamos uma tier.
  if (source === "email_ibge") {
    confidence = downgradeOne(confidence);
  }

  return {
    gender,
    confidence,
    source,
    matchedName: token,
    femaleRatio,
  };
}

function downgradeOne(c: Confidence): Confidence {
  if (c === "high") return "medium";
  if (c === "medium") return "low";
  if (c === "low") return "low";
  return "unknown";
}

/**
 * Heurística de sufixo PT-BR. Só roda quando nada bateu nos
 * dicionários. Mantemos sempre em low confidence — não queremos que
 * "Lima" (sobrenome) ou "Sara" (estrangeiro ambíguo) acabe num
 * segmento de comunicação direta.
 */
function inferFromSuffix(token: string): InferenceResult {
  if (token.length < 4) {
    return { gender: "unknown", confidence: "unknown", source: "none", matchedName: null, femaleRatio: null };
  }
  const last = token[token.length - 1];
  if (last === "a") {
    return { gender: "female", confidence: "low", source: "name_suffix_rule", matchedName: token, femaleRatio: null };
  }
  if (last === "o") {
    return { gender: "male", confidence: "low", source: "name_suffix_rule", matchedName: token, femaleRatio: null };
  }
  return { gender: "unknown", confidence: "unknown", source: "none", matchedName: null, femaleRatio: null };
}

/**
 * Orquestrador principal. Dado nome (preferencial) e email
 * (fallback), retorna o melhor resultado de inferência.
 */
export function inferGender(
  name: string | null | undefined,
  email: string | null | undefined,
): InferenceResult {
  // Camada 1: nome → IBGE
  const nameToken = extractFirstName(name);
  if (nameToken && IBGE_NAMES[nameToken]) {
    return classifyFromEntry(nameToken, IBGE_NAMES[nameToken], "name_ibge");
  }

  // Camada 2: email → IBGE (uma tier abaixo)
  const emailToken = extractNameFromEmail(email);
  if (emailToken && IBGE_NAMES[emailToken]) {
    return classifyFromEntry(emailToken, IBGE_NAMES[emailToken], "email_ibge");
  }

  // Camada 3: sufixo do nome (só se tivermos um token decente)
  if (nameToken) {
    const fromSuffix = inferFromSuffix(nameToken);
    if (fromSuffix.gender !== "unknown") return fromSuffix;
  }

  return {
    gender: "unknown",
    confidence: "unknown",
    source: "none",
    matchedName: null,
    femaleRatio: null,
  };
}

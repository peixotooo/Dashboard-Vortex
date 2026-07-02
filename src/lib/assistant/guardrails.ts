// Guardrails de entrada/saída do assistente.
//
// Defesa em profundidade: a arquitetura já impede vazamento real (o LLM nunca
// vê segredos; tools são somente-leitura), mas aqui a gente ainda valida o que
// entra e varre o que sai antes de mostrar ao cliente e de persistir.

import { createHash } from "crypto";

export const MAX_MESSAGE_CHARS = 500;

/** Valida a mensagem do cliente. Retorna a mensagem normalizada ou null. */
export function validateUserMessage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Remove caracteres de controle (exceto \n) que podem quebrar render/logs
  const cleaned = raw.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim();
  if (!cleaned || cleaned.length > MAX_MESSAGE_CHARS) return null;
  return cleaned;
}

// Padrões que NUNCA devem aparecer numa resposta legítima de vendedor.
// Se aparecer, é sinal de vazamento/injeção — redigimos por segurança.
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g, // chaves estilo OpenAI/OpenRouter
  /Bearer\s+[A-Za-z0-9._~+/-]{16,}/gi,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g, // JWTs
  /\b[A-Fa-f0-9]{40,}\b/g, // hex longo (tokens/hashes)
  /(SUPABASE|VNDA|META|OPENROUTER|ANTHROPIC|ENCRYPTION)[A-Z_]*(KEY|TOKEN|SECRET)/gi,
  /service_role/gi,
];

/** Sanitiza a resposta final do LLM antes de enviar ao widget. */
export function sanitizeReply(text: string): string {
  let out = text.trim();
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[removido]");
  }
  // Resposta de chat não precisa passar de ~2000 chars
  if (out.length > 2000) out = out.slice(0, 2000).trim();
  return out;
}

// PII óbvia que o cliente possa colar no chat — scrub ANTES de persistir a
// transcrição (LGPD: não guardamos CPF/cartão em claro nos logs).
const PII_PATTERNS: RegExp[] = [
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, // CPF
  /\b(?:\d[ -]?){13,19}\b/g, // cartão (sequências longas de dígitos)
];

export function scrubPiiForStorage(text: string): string {
  let out = text;
  for (const pattern of PII_PATTERNS) {
    out = out.replace(pattern, "[dado pessoal removido]");
  }
  return out;
}

/**
 * Extrai marcadores [[produto:ID]] da resposta e devolve o texto limpo +
 * os IDs citados (na ordem, sem duplicar, máx 3).
 */
export function extractProductMarkers(text: string): {
  cleanText: string;
  productIds: string[];
} {
  const ids: string[] = [];
  const cleanText = text
    .replace(/\[\[\s*produto\s*:\s*([\w-]{1,40})\s*\]\]/gi, (_m, id: string) => {
      if (!ids.includes(id) && ids.length < 3) ids.push(id);
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { cleanText, productIds: ids };
}

/** Hash de IP com salt do servidor — nunca armazenamos IP em claro. */
export function hashIp(ip: string): string {
  const salt = process.env.ENCRYPTION_KEY || "assistant-salt";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

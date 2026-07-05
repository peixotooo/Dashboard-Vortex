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

/**
 * Valida o primeiro nome do cliente. Aceita só letras (com acento), espaço,
 * apóstrofo e hífen; devolve o PRIMEIRO nome capitalizado. Rejeita dígitos
 * (evita CPF/telefone colados no campo). null = inválido.
 */
export function validateCustomerName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (!cleaned || cleaned.length > 40) return null;
  if (/\d/.test(cleaned)) return null;
  const first = cleaned.split(/\s+/)[0];
  if (!/^[\p{L}][\p{L}'-]{0,23}$/u.test(first)) return null;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
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

// Emoji/pictogramas: a marca pede "sem emoji" e o modelo às vezes ignora.
// Strip determinístico. Extended_Pictographic pega emoji sem tocar em dígitos,
// pontuação, acentos ou colchetes de marcadores [[...]].
const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{20E3}]/gu;

/** Sanitiza a resposta final do LLM antes de enviar ao widget. */
export function sanitizeReply(text: string): string {
  let out = text.trim();
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[removido]");
  }
  // Travessão/meia-risca entre palavras → vírgula (estilo de chat). Usa [ \t]
  // (NÃO \s) pra não atravessar quebra de linha: um bullet "\n– item" viraria
  // ", item" e juntaria a lista numa linha só. Travessão residual (inclusive em
  // início de linha) vira hífen simples.
  out = out.replace(/[ \t]+[—–][ \t]+/g, ", ").replace(/[—–]/g, "-");
  // Remove emoji e espaços órfãos que sobrarem.
  out = out.replace(EMOJI_RE, "").replace(/[ \t]{2,}/g, " ").replace(/ +([.,!?])/g, "$1");
  // Resposta de chat não precisa passar de ~2000 chars
  if (out.length > 2000) out = out.slice(0, 2000).trim();
  return out.trim();
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
  // E-mails (o cliente digita o e-mail pra consultar pedido): mascara mantendo
  // 1º caractere + domínio (j***@gmail.com) — dá contexto no QA sem guardar
  // o endereço em claro. Nota: o replay do histórico usa o texto mascarado,
  // então o fluxo pede número+e-mail na MESMA mensagem (tool roda no turno).
  out = out.replace(
    /\b([^\s@])[^\s@]*@([^\s@]+\.[^\s@]{2,})\b/g,
    (_m, first: string, domain: string) => `${first}***@${domain}`
  );
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

/**
 * Extrai o marcador [[whatsapp]] (modelo direcionando pro atendimento).
 * O widget converte num botão que abre o WhatsApp da loja.
 */
export function extractWhatsappMarker(text: string): {
  cleanText: string;
  showWhatsapp: boolean;
} {
  let showWhatsapp = false;
  const cleanText = text
    .replace(/\[\[\s*whatsapp\s*\]\]/gi, () => {
      showWhatsapp = true;
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { cleanText, showWhatsapp };
}

/** Hash de IP com salt do servidor — nunca armazenamos IP em claro. */
export function hashIp(ip: string): string {
  const salt = process.env.ENCRYPTION_KEY || "assistant-salt";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

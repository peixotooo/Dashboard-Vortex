// src/lib/iporto/email-marketing.ts
//
// Thin typed client pra iPORTO Email Marketing (transacional).
// Diferente da Locaweb (que faz fan-out via list_ids), iPORTO recebe
// UM destinatário por request — o dispatch-core itera sobre a lista
// resolvida e chama createDelivery por endereço.
//
// Docs: https://doc.iporto.com.br/doc/v3
//
// Auth: Bearer JWT (header Authorization). Token é gerado no painel
// app.iporto.com.br em "Página inicial > API > Nova API". Validade 1 ano.

export interface IportoCreds {
  base_url: string;
  token: string;
}

export interface IportoError {
  status: number;
  body: unknown;
  message: string;
}

async function request<T>(
  creds: IportoCreds,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${creds.base_url.replace(/\/+$/, "")}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${creds.token.trim()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    const bodyPreview =
      typeof parsed === "object" && parsed !== null
        ? JSON.stringify(parsed).slice(0, 500)
        : String(parsed ?? "(empty body)").slice(0, 500);
    console.error(
      `[iPORTO ${method}] ${url} → HTTP ${res.status}\nBody: ${bodyPreview}`
    );
    const err: IportoError = {
      status: res.status,
      body: parsed,
      message: `iPORTO ${method} ${path} → ${res.status}: ${bodyPreview}`,
    };
    throw err;
  }
  // Log respostas 2xx vazias/inesperadas pra debug. iPORTO normalmente
  // devolve { message_id } ou { request_id } no 202 Accepted.
  if (!parsed || typeof parsed !== "object") {
    console.warn(
      `[iPORTO ${method}] ${url} → ${res.status} sem body parseável`
    );
  }
  return (parsed ?? {}) as T;
}

// ---------- Envio transacional (1 destinatário/request) ----------

export interface CreateDeliveryInput {
  subject: string;
  /** Remetente verificado. Não pode ser @gmail/@outlook etc. */
  from: string;
  from_name: string;
  address_to: string;
  address_to_cc?: string;
  html_body: string;
  attachments?: Array<{
    /** URL pública do anexo — iPORTO baixa do lado deles. */
    path: string;
    /** Nome exibido (e.g. "fatura.pdf"). */
    as: string;
    mime: string;
  }>;
  /** Headers customizados — usamos pra carregar nosso dispatch_id e
   *  envio_id (conciliação). */
  headers?: Record<string, string>;
  /** Tags livres — usadas em filtros de relatório. */
  tags?: string[];
  tracking_settings?: {
    track_open?: "yes" | "no";
    track_link?: "yes" | "no";
    track_host?: string;
  };
}

export interface DeliveryRef {
  /** iPORTO devolve um identificador da mensagem enfileirada — usamos
   *  pra correlacionar webhooks. Confirmado em prod (2026-05): o campo
   *  real é `data.message_tracking_code`. SDD documentava
   *  message_id/request_id; mantemos eles como fallback. */
  message_id?: string;
  request_id?: string;
  id?: string;
  message_tracking_code?: string;
  data?: {
    message_id?: string;
    request_id?: string;
    id?: string;
    message_tracking_code?: string;
  };
  status?: string;
  [k: string]: unknown;
}

export async function createDelivery(
  creds: IportoCreds,
  input: CreateDeliveryInput
): Promise<DeliveryRef> {
  // Endpoint v3 padrão para envio transacional. Aceita 202 Accepted no
  // sucesso e devolve message_id/request_id.
  return request<DeliveryRef>(
    creds,
    "POST",
    "/delivery/smtp/queue/api/delivery",
    input
  );
}

/** Procura o identificador da mensagem em todos os campos conhecidos.
 *  iPORTO v3 (prod): retorna { data: { message_tracking_code: "..." } }.
 *  Aceita as variantes mais antigas (message_id/request_id) como fallback
 *  caso a API mude. */
export function extractMessageId(ref: DeliveryRef | undefined | null): string | null {
  if (!ref || typeof ref !== "object") return null;
  return (
    ref.data?.message_tracking_code ??
    ref.message_tracking_code ??
    ref.data?.message_id ??
    ref.message_id ??
    ref.data?.request_id ??
    ref.request_id ??
    ref.data?.id ??
    ref.id ??
    null
  );
}

// ---------- Probe ----------

/** Probe de conectividade. iPORTO não expõe um /ping; chamamos um GET
 *  que devolve 200 com creds válidas e 401 sem. Usamos o endpoint de
 *  status do delivery — qualquer 4xx que não seja 401 conta como
 *  "auth ok" (token válido, só não tem permissão pra esse path). */
export async function ping(creds: IportoCreds): Promise<{ ok: true }> {
  // Tenta um GET barato no domínio. Se der 401/403, throw. Senão, ok.
  const url = `${creds.base_url.replace(/\/+$/, "")}/delivery/smtp/status`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${creds.token.trim()}`,
      Accept: "application/json",
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw {
      status: res.status,
      body: await res.text(),
      message: `iPORTO auth falhou: ${res.status}`,
    } as IportoError;
  }
  return { ok: true };
}

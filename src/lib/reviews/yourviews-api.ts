import { decrypt } from "@/lib/encryption";
import { createAdminClient } from "@/lib/supabase-admin";

// Cliente da API V1 da Yourviews — usada SÓ pra extração em massa das
// avaliações que já temos lá, pra reaproveitar o histórico na nossa
// plataforma. Documentação: docs SDD em yourviews-reviews-extraction-sdd.md.
//
// A V1 é a única que lista TODAS as avaliações da loja paginadas (/review) e
// retorna campos sensíveis (email). Autenticação: Basic Auth (user/senha) +
// StoreKey na URL. Bloqueia CORS, então só roda server-side.

const BASE_HOST = "https://service.yourviews.com.br";

export interface YourViewsConfig {
  storeKey: string;
  apiUsername: string;
  apiPassword: string;
}

// --- Shape cru da resposta da Yourviews (campos que usamos) ---

export interface YvCustomField {
  Name: string;
  Values: string[];
}

export interface YvUser {
  YourviewsUserId?: number;
  Name?: string | null;
  Email?: string | null;
  City?: string | null;
  State?: string | null;
  ZipCode?: string | null;
  IPAddress?: string | null;
}

export interface YvProduct {
  YourviewsProductId?: number;
  ProductId?: string | null;
  Name?: string | null;
  Url?: string | null;
  Image?: string | null;
  IsActive?: boolean;
  Value?: number;
  Category?: string | null;
  Brand?: string | null;
  Sku?: string | null;
}

export interface YvPhoto {
  // A Yourviews varia o shape; cobrimos os nomes mais comuns.
  Url?: string | null;
  Original?: string | null;
  Thumbnail?: string | null;
  Thumb?: string | null;
}

export interface YvReview {
  ReviewId: number;
  Rating: number;
  Review?: string | null;
  Title?: string | null;
  ReviewTitle?: string | null;
  Date?: string | null;
  Likes?: number;
  Dislikes?: number;
  BoughtProduct?: boolean;
  CustomFields?: YvCustomField[] | null;
  User?: YvUser | null;
  Product?: YvProduct | null;
  ReferenceOrder?: string | null;
  CustomerPhotos?: YvPhoto[] | null;
}

interface YvEnvelope {
  HasErrors: boolean;
  Element?: YvReview[] | null;
}

/**
 * Lê as credenciais da Yourviews do workspace (DB, criptografadas) com fallback
 * pra env vars (scripts/cron). Usa o admin client porque a tabela é server-only
 * (RLS sem policies de cliente), igual aos outros *_connections.
 */
export async function getYourViewsConfig(
  workspaceId?: string
): Promise<YourViewsConfig | null> {
  if (workspaceId) {
    try {
      const admin = createAdminClient();
      const { data } = await admin
        .from("yourviews_connections")
        .select("store_key, api_username, api_password")
        .eq("workspace_id", workspaceId)
        .limit(1)
        .single();

      if (data?.store_key && data?.api_username && data?.api_password) {
        return {
          storeKey: decrypt(data.store_key),
          apiUsername: decrypt(data.api_username),
          apiPassword: decrypt(data.api_password),
        };
      }
    } catch {
      // cai pro fallback de env
    }
  }

  const storeKey = process.env.YOURVIEWS_STORE_KEY;
  const apiUsername = process.env.YOURVIEWS_API_USERNAME;
  const apiPassword = process.env.YOURVIEWS_API_PASSWORD;
  if (storeKey && apiUsername && apiPassword) {
    return { storeKey, apiUsername, apiPassword };
  }

  return null;
}

function authHeader(config: YourViewsConfig): string {
  const raw = `${config.apiUsername}:${config.apiPassword}`;
  return "Basic " + Buffer.from(raw).toString("base64");
}

function reviewUrl(
  config: YourViewsConfig,
  page: number,
  count: number,
  dateFrom?: string
): string {
  const params = new URLSearchParams({
    page: String(page),
    count: String(count),
  });
  if (dateFrom) params.set("dateFrom", dateFrom);
  return `${BASE_HOST}/api/${encodeURIComponent(config.storeKey)}/review/?${params.toString()}`;
}

/**
 * Busca uma página de avaliações. Lança em erro de HTTP ou HasErrors=true
 * pra que o chamador trate retry/backoff.
 */
export async function fetchReviewPage(
  config: YourViewsConfig,
  page: number,
  count: number,
  dateFrom?: string
): Promise<YvReview[]> {
  const res = await fetch(reviewUrl(config, page, count, dateFrom), {
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(config),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Yourviews HTTP ${res.status} (page ${page})${body ? `: ${body.slice(0, 200)}` : ""}`);
  }

  const data = (await res.json()) as YvEnvelope;
  if (data.HasErrors) {
    throw new Error(`Yourviews retornou HasErrors=true (page ${page})`);
  }
  return data.Element || [];
}

export interface IterateOptions {
  count?: number;
  dateFrom?: string;
  delayMs?: number;
  maxPages?: number;
  onPage?: (page: number, items: YvReview[]) => void | Promise<void>;
}

/**
 * Itera TODAS as páginas até vir vazio (ou maxPages). Faz backoff exponencial
 * em erro (até 3 tentativas por página) e respeita um delay entre requisições
 * pra não estourar rate limit.
 */
export async function* iterateAllReviews(
  config: YourViewsConfig,
  opts: IterateOptions = {}
): AsyncGenerator<YvReview, void, unknown> {
  const count = opts.count ?? 50;
  const delayMs = opts.delayMs ?? 300;
  const maxPages = opts.maxPages ?? Infinity;

  let page = 1;
  while (page <= maxPages) {
    let items: YvReview[] | null = null;
    let attempt = 0;
    let lastErr: unknown;
    while (attempt < 3 && items === null) {
      try {
        items = await fetchReviewPage(config, page, count, opts.dateFrom);
      } catch (err) {
        lastErr = err;
        attempt++;
        await sleep(delayMs * Math.pow(2, attempt)); // backoff
      }
    }
    if (items === null) throw lastErr ?? new Error("Falha ao buscar página");

    if (items.length === 0) break; // fim dos dados
    if (opts.onPage) await opts.onPage(page, items);
    for (const r of items) yield r;

    page++;
    await sleep(delayMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

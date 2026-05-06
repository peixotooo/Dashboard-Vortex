// src/lib/locaweb/email-marketing.ts
//
// Thin typed client for Locaweb Email Marketing v1 (campaign API). Auth is
// the static X-Auth-Token header per account. Every resource is namespaced
// under /accounts/{accountId}/...
//
// We expose only the surface we need today:
//   - createMessage / getMessage (campaign send + status)
//   - getMessageOverview / getMessageBounces / getMessageClicks (stats)
//   - listLists / listSenders / listDomains (config bootstrap)
//   - addContactsToList / removeContactsFromList (cluster sync, v2)

export interface LocawebCreds {
  base_url: string;
  account_id: string;
  token: string;
}

export interface LocawebError {
  status: number;
  body: unknown;
  message: string;
}

async function request<T>(
  creds: LocawebCreds,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${creds.base_url.replace(/\/+$/, "")}/accounts/${creds.account_id.toString().trim()}${path}`;
  // Trim the token defensively. Locaweb's /senders and /domains endpoints
  // were returning 401 when the stored token had a trailing newline (paste
  // artifact), while /lists tolerated it — this normalizes both cases.
  const res = await fetch(url, {
    method,
    headers: {
      "X-Auth-Token": creds.token.trim(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  // Some Locaweb endpoints return empty body with 200/202 + Location header.
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
    const err: LocawebError = {
      status: res.status,
      body: parsed,
      message: `Locaweb ${method} ${path} → ${res.status} ${
        typeof parsed === "object" && parsed !== null
          ? JSON.stringify(parsed).slice(0, 240)
          : String(parsed).slice(0, 240)
      }`,
    };
    throw err;
  }
  // For async operations, the response carries a Location header pointing at
  // the resource (e.g. POST /messages → /accounts/.../messages/{id}).
  const location = res.headers.get("Location");
  if (parsed && typeof parsed === "object") {
    return { ...(parsed as object), _location: location } as T;
  }
  return (parsed ?? { _location: location }) as T;
}

// ---------- Messages (campaigns) ----------

export interface CreateMessageInput {
  /** Campaign name (we encode the internal draft id here for re-join). */
  name: string;
  subject: string;
  /** Verified sender email. */
  sender: string;
  /** From-name shown to recipients. */
  sender_name: string;
  /** Verified domain id from listDomains. Locaweb accepts numeric or string. */
  domain_id: string | number;
  /** HTML body. Must already be email-safe. */
  html_body: string;
  /** List ids the campaign goes to. */
  list_ids: Array<string | number>;
  /** ISO datetime ("YYYY-MM-DDTHH:mm:ss-03:00") or date ("YYYY-MM-DD").
   *  Locaweb's API accepts both — when only a date is provided the message
   *  goes out at the default morning slot; with a full datetime it
   *  schedules at the specified BRT hour. */
  scheduled_to?: string;
}

export interface MessageRef {
  id?: string;
  name?: string;
  subject?: string;
  status?: string;
  scheduled_to?: string | null;
  /** Set by request() from the Location header. */
  _location?: string | null;
}

export async function createMessage(
  creds: LocawebCreds,
  input: CreateMessageInput
): Promise<MessageRef> {
  return request<MessageRef>(creds, "POST", "/messages", input);
}

export async function getMessage(
  creds: LocawebCreds,
  messageId: string
): Promise<MessageRef> {
  return request<MessageRef>(creds, "GET", `/messages/${messageId}`);
}

export async function deleteMessage(
  creds: LocawebCreds,
  messageId: string
): Promise<void> {
  await request<unknown>(creds, "DELETE", `/messages/${messageId}`);
}

// ---------- Reports ----------

export interface MessageOverview {
  total?: number;
  delivered?: number;
  opens?: number;
  uniq_opens?: number;
  clicks?: number;
  uniq_clicks?: number;
  bounces?: number;
  unsubscribes?: number;
  // Locaweb's exact field names aren't fully documented; we keep this loose
  // and let the stats-sync cron stash the entire body in dispatches.stats.
  [k: string]: unknown;
}

export async function getMessageOverview(
  creds: LocawebCreds,
  messageId: string
): Promise<MessageOverview> {
  return request<MessageOverview>(creds, "GET", `/messages/${messageId}/overview`);
}

export async function getMessageBounces(
  creds: LocawebCreds,
  messageId: string
): Promise<unknown[]> {
  return request<unknown[]>(creds, "GET", `/messages/${messageId}/bounces`);
}

export async function getMessageClicks(
  creds: LocawebCreds,
  messageId: string
): Promise<unknown[]> {
  return request<unknown[]>(creds, "GET", `/messages/${messageId}/clicks`);
}

export async function getMessageUniqOpenings(
  creds: LocawebCreds,
  messageId: string
): Promise<unknown[]> {
  return request<unknown[]>(creds, "GET", `/messages/${messageId}/uniq_openings`);
}

// ---------- Lists / contacts ----------

export interface List {
  /** Locaweb may return numeric ids (e.g. 224323). The createMessage
   *  endpoint accepts either form in `list_ids`. */
  id: string | number;
  name: string;
  /** Tokens are sometimes used in lieu of ids (contact_imports, etc.) */
  token?: string;
  contacts_count?: number;
  [k: string]: unknown;
}

/** Locaweb wraps every list response in { items: [...], page: {...} }.
 *  Older docs / SDK examples sometimes show top-level arrays, so we accept
 *  both shapes defensively. */
function unwrapItems<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items as T[];
    if (Array.isArray(obj.lists)) return obj.lists as T[];
    if (Array.isArray(obj.senders)) return obj.senders as T[];
    if (Array.isArray(obj.domains)) return obj.domains as T[];
  }
  return [];
}

export async function listLists(creds: LocawebCreds): Promise<List[]> {
  const data = await request<unknown>(creds, "GET", "/lists");
  return unwrapItems<List>(data);
}

export async function createList(
  creds: LocawebCreds,
  name: string
): Promise<List> {
  // Locaweb returns the created resource at the top level, but on some
  // endpoints they wrap it under `list` or `data`. We probe both.
  const data = await request<unknown>(creds, "POST", "/lists", { name });
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (obj.id != null) return obj as unknown as List;
    if (obj.list && typeof obj.list === "object") return obj.list as List;
    if (obj.data && typeof obj.data === "object") return obj.data as List;
    // Fall through with what we have, including the _location header set by request().
  }
  return data as List;
}

export interface ContactInput {
  email: string;
  name?: string;
  custom_fields?: Record<string, string | number | boolean>;
}

export async function addContactsToList(
  creds: LocawebCreds,
  listId: string | number,
  contacts: ContactInput[]
): Promise<unknown> {
  return request<unknown>(creds, "POST", `/lists/${listId}/contacts`, {
    contacts,
  });
}

export async function removeContactsFromList(
  creds: LocawebCreds,
  listId: string | number,
  emails: string[]
): Promise<unknown> {
  return request<unknown>(
    creds,
    "PUT",
    `/lists/${listId}/remove_contacts`,
    { emails }
  );
}

// ---------- Senders / domains ----------

export interface Sender {
  id?: string | number;
  email: string;
  /** Locaweb returns 1 = active. */
  status?: string | number;
  [k: string]: unknown;
}

export interface Domain {
  id: string | number;
  name: string;
  default?: boolean;
  status?: string | number;
  [k: string]: unknown;
}

export async function listSenders(creds: LocawebCreds): Promise<Sender[]> {
  const data = await request<unknown>(creds, "GET", "/senders");
  return unwrapItems<Sender>(data);
}

export async function listDomains(creds: LocawebCreds): Promise<Domain[]> {
  const data = await request<unknown>(creds, "GET", "/domains");
  return unwrapItems<Domain>(data);
}

// ---------- Account balance / sending credits ----------

export interface AccountBalance {
  /** Monthly plan ceiling (when known). */
  total?: number;
  /** Sends consumed in the current billing window. */
  used?: number;
  /** Available sends — what we cross-reference with the audience size. */
  remaining?: number;
  /** Raw response from Locaweb so the UI can fall back if the parsed
   *  fields above don't show up. Locaweb's docs aren't crisp on the
   *  exact key names; defensive parsing handles the variants we've seen
   *  ("creditos", "saldo", "monthly_credits_*"). */
  raw: unknown;
}

/**
 * Pulls remaining sending credits for the account. Locaweb exposes this
 * as part of the account resource (`GET /accounts/{accountId}`); some
 * tenants also surface a dedicated `/info` shape. We try the canonical
 * path first and parse the response with a lenient picker.
 */
export async function getAccountBalance(creds: LocawebCreds): Promise<AccountBalance> {
  const raw = await request<unknown>(creds, "GET", "");
  return { ...parseBalance(raw), raw };
}

function parseBalance(data: unknown): { total?: number; used?: number; remaining?: number } {
  if (!data || typeof data !== "object") return {};
  // Locaweb's GET /accounts/{id} response shape (per their docs page):
  //   { id, email, display_name, credits: { ... }, ... }
  // The `credits` object holds the actual numbers. Older / smaller plans
  // sometimes flatten the values onto the root, so we search both the
  // root and the nested object using the same key dictionaries.
  const root = data as Record<string, unknown>;
  const credits =
    root.credits && typeof root.credits === "object"
      ? (root.credits as Record<string, unknown>)
      : null;

  const toNumber = (v: unknown): number | undefined => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
    return undefined;
  };

  const findIn = (
    obj: Record<string, unknown> | null,
    keys: string[]
  ): number | undefined => {
    if (!obj) return undefined;
    for (const k of keys) {
      const direct = toNumber(obj[k]);
      if (direct != null) return direct;
    }
    return undefined;
  };

  const REMAINING_KEYS = [
    "available",
    "available_credits",
    "remaining",
    "remaining_credits",
    "monthly_credits_remaining",
    "saldo",
    "saldo_envios",
    "saldo_disponivel",
    "creditos_disponiveis",
    "disponivel",
    "balance",
  ];
  const USED_KEYS = [
    "used",
    "used_credits",
    "monthly_credits_used",
    "consumed",
    "spent",
    "sent_count",
    "envios_realizados",
    "utilizado",
    "utilizados",
    "creditos_utilizados",
  ];
  const TOTAL_KEYS = [
    "total",
    "total_credits",
    "limit",
    "monthly_limit",
    "monthly_credits_total",
    "plan_credits",
    "creditos_mensais",
    "envios_contratados",
    "limite",
  ];

  // Search the credits object first (canonical), fall back to root for
  // older shapes.
  const remaining = findIn(credits, REMAINING_KEYS) ?? findIn(root, REMAINING_KEYS);
  const used = findIn(credits, USED_KEYS) ?? findIn(root, USED_KEYS);
  const total = findIn(credits, TOTAL_KEYS) ?? findIn(root, TOTAL_KEYS);

  // Derive whichever field is missing when the other two exist — saldo
  // views often only ship two of the three.
  if (remaining == null && total != null && used != null) {
    return { total, used, remaining: Math.max(0, total - used) };
  }
  if (used == null && total != null && remaining != null) {
    return { total, used: Math.max(0, total - remaining), remaining };
  }
  if (total == null && used != null && remaining != null) {
    return { total: used + remaining, used, remaining };
  }
  return { total, used, remaining };
}

// ---------- Connectivity probe ----------

/** Cheap probe used by the settings UI to validate token+account before save. */
export async function ping(creds: LocawebCreds): Promise<{ ok: true; lists: number }> {
  const lists = await listLists(creds);
  return { ok: true, lists: lists.length };
}

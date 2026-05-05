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
  const url = `${creds.base_url.replace(/\/+$/, "")}/accounts/${creds.account_id}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "X-Auth-Token": creds.token,
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
  /** Optional ISO date "YYYY-MM-DD" — granularity is daily. */
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
  return request<List>(creds, "POST", "/lists", { name });
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

// ---------- Connectivity probe ----------

/** Cheap probe used by the settings UI to validate token+account before save. */
export async function ping(creds: LocawebCreds): Promise<{ ok: true; lists: number }> {
  const lists = await listLists(creds);
  return { ok: true, lists: lists.length };
}

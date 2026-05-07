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

// NOTE: Locaweb's POST /contact_imports (async CSV import) is a dead end
// for binding-to-a-list on the v1 API. We probed exhaustively against
// the Bulking account:
//   • Body field names: list_id, list_ids, lists, list_tokens (both as
//     numeric and string), tags, mailing_list_ids, subscribe_list_ids,
//     subscribers_lists, lists.ids
//   • Wrappers: contact_import.{...}, list_import.{...}, import.{...}
//   • Query params: ?list_id=, ?list_ids[]=, ?lists[]=
//   • Methods on /contact_imports/{id}: PUT/PATCH (404)
//   • Per-list paths: /lists/{id}/contact_imports (404),
//     /lists/{id}/import (500 except with {contacts:[...]} which works
//     but doesn't bind), /lists/{id}/{subscribers,subscribe,
//     contacts/bulk,subscribe_csv,import_csv} (404)
//   • API versions: /api/v2 / /api/v3 (all 404)
//
// Every attempt either errored out OR succeeded but returned
// `list_ids: []` and the target list's contacts_count stayed at 0. The
// fabioperrella/locaweb-emailmarketing community library mentions
// `list_tokens` as a required field, but that was for an older API
// version; the field is silently accepted but no-op'd in v1 today.
//
// Locaweb's panel UI does bind imports to lists, but uses an internal
// endpoint we can't reach. The only public path that demonstrably puts
// contacts into a list is POST /lists/{id}/contacts at ~150ms/contact.
// We chunk + parallelize that and warn the user about timing for big
// lists; for >10k they should use the Locaweb panel directly.

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
  /** Plan name from Locaweb (e.g. "Email Marketing I"). */
  plan_name?: string;
  /** Bonus messages above the plan baseline. Locaweb returns this as a
   *  string in some payloads; we normalize to number. */
  extra?: number;
  /** Current billing period (DD/MM/YYYY in Locaweb's response). */
  period_start?: string;
  period_end?: string;
  /** Raw response from Locaweb so the UI can fall back if the parsed
   *  fields above don't show up. Defensive parsing handles known variants
   *  (actual_period.{bought,consumed_this_month,available} on the
   *  current EM API; flat fields on legacy payloads). */
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

interface ParsedBalance {
  total?: number;
  used?: number;
  remaining?: number;
  plan_name?: string;
  extra?: number;
  period_start?: string;
  period_end?: string;
}

function parseBalance(data: unknown): ParsedBalance {
  if (!data || typeof data !== "object") return {};
  // Real Locaweb shape (probed against guilherme@bulking.com.br):
  //   {
  //     id, email, display_name, plan_name, status, ...
  //     actual_period: {
  //       start_on, end_on,
  //       bought,                 // monthly plan ceiling
  //       extra_messages,         // bonus credits (sometimes a string)
  //       consumed_this_month,    // sends already used
  //       available               // remaining
  //     },
  //     next_period: { start_on, end_on, renew_with }
  //   }
  // We also accept a few legacy/alternate shapes (`credits.*`, flat keys
  // on root) so older accounts and any future schema tweaks don't blank
  // the banner without warning.
  const root = data as Record<string, unknown>;
  const period =
    root.actual_period && typeof root.actual_period === "object"
      ? (root.actual_period as Record<string, unknown>)
      : null;
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
    "creditos_disponiveis",
    "disponivel",
    "balance",
  ];
  const USED_KEYS = [
    "consumed_this_month",
    "consumed",
    "used",
    "used_credits",
    "monthly_credits_used",
    "spent",
    "sent_count",
    "envios_realizados",
    "utilizados",
  ];
  const TOTAL_KEYS = [
    "bought",
    "total",
    "total_credits",
    "limit",
    "monthly_limit",
    "monthly_credits_total",
    "plan_credits",
    "creditos_mensais",
    "envios_contratados",
  ];
  const EXTRA_KEYS = ["extra_messages", "extra", "bonus", "extra_credits"];

  const remaining =
    findIn(period, REMAINING_KEYS) ?? findIn(credits, REMAINING_KEYS) ?? findIn(root, REMAINING_KEYS);
  const used =
    findIn(period, USED_KEYS) ?? findIn(credits, USED_KEYS) ?? findIn(root, USED_KEYS);
  const total =
    findIn(period, TOTAL_KEYS) ?? findIn(credits, TOTAL_KEYS) ?? findIn(root, TOTAL_KEYS);
  const extra =
    findIn(period, EXTRA_KEYS) ?? findIn(credits, EXTRA_KEYS) ?? findIn(root, EXTRA_KEYS);

  const plan_name =
    typeof root.plan_name === "string" ? (root.plan_name as string) : undefined;
  const period_start =
    period && typeof period.start_on === "string" ? (period.start_on as string) : undefined;
  const period_end =
    period && typeof period.end_on === "string" ? (period.end_on as string) : undefined;

  // Derive whichever field is missing when the other two exist.
  let resolvedTotal = total;
  let resolvedUsed = used;
  let resolvedRemaining = remaining;
  if (resolvedRemaining == null && resolvedTotal != null && resolvedUsed != null) {
    resolvedRemaining = Math.max(0, resolvedTotal - resolvedUsed);
  }
  if (resolvedUsed == null && resolvedTotal != null && resolvedRemaining != null) {
    resolvedUsed = Math.max(0, resolvedTotal - resolvedRemaining);
  }
  if (resolvedTotal == null && resolvedUsed != null && resolvedRemaining != null) {
    resolvedTotal = resolvedUsed + resolvedRemaining;
  }

  return {
    total: resolvedTotal,
    used: resolvedUsed,
    remaining: resolvedRemaining,
    plan_name,
    extra,
    period_start,
    period_end,
  };
}

// ---------- Connectivity probe ----------

/** Cheap probe used by the settings UI to validate token+account before save. */
export async function ping(creds: LocawebCreds): Promise<{ ok: true; lists: number }> {
  const lists = await listLists(creds);
  return { ok: true, lists: lists.length };
}

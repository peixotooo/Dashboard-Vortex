import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/encryption";

export type VndaImportProgress = (message: string) => void;

type VndaConfig = {
  apiToken: string;
  storeHost: string;
};

type Pagination = {
  total_pages?: number;
  current_page?: number;
  next_page?: number | string | boolean | null;
  total_count?: number;
};

type VndaApiOrderItem = {
  id?: number;
  product_name?: string;
  variant_name?: string | null;
  sku?: string | null;
  reference?: string | null;
  attribute1?: string | null;
  attribute2?: string | null;
  attribute3?: string | null;
  quantity?: number;
  price?: number;
  original_price?: number;
  total?: number;
};

type VndaApiOrder = {
  id: number;
  code?: string | null;
  status?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  cpf?: string | null;
  zip?: string | null;
  city?: string | null;
  state?: string | null;
  neighborhood?: string | null;
  phone_area?: string | null;
  phone?: string | null;
  cellphone_area?: string | null;
  cellphone?: string | null;
  subtotal?: number | null;
  discount_price?: number | null;
  total?: number | null;
  installments?: number | null;
  payment_method?: string | null;
  shipping_method?: string | null;
  shipping_price?: number | null;
  delivery_days?: number | null;
  channel?: string | null;
  coupon_code?: string | null;
  received_at?: string | null;
  confirmed_at?: string | null;
  birthdate?: string | null;
  items?: VndaApiOrderItem[];
  discounts?: Array<{ name?: string; type?: string; value?: number; apply_to?: string; sku?: string | null }>;
  shipping_address?: {
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    neighborhood?: string | null;
    phone?: string | null;
  } | null;
};

type VndaClient = {
  id?: number;
  email?: string | null;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone_area?: string | null;
  phone?: string | null;
  cellphone_area?: string | null;
  cellphone?: string | null;
  tags?: unknown;
  recent_address?: {
    state?: string | null;
    city?: string | null;
    zip?: string | null;
    neighborhood?: string | null;
    phone?: string | null;
  } | null;
};

type CrmImportRow = {
  workspace_id: string;
  cliente: string | null;
  email: string | null;
  telefone: string | null;
  valor: number;
  data_compra: string;
  cupom: string | null;
  numero_pedido: string | null;
  compras_anteriores: number;
  source: "vnda_webhook";
  source_order_id: string;
  cpf: string | null;
  birthdate: string | null;
  state: string | null;
  city: string | null;
  zip: string | null;
  neighborhood: string | null;
  payment_method: string | null;
  installments: number | null;
  shipping_method: string | null;
  shipping_price: number | null;
  delivery_days: number | null;
  subtotal: number | null;
  discount_price: number | null;
  channel: string | null;
  items: Array<Record<string, unknown>> | null;
  discounts: Array<Record<string, unknown>> | null;
};

export type VndaCrmImportOptions = {
  workspaceId: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  dryRun?: boolean;
  includeClients?: boolean;
  syncContactList?: boolean;
  onlyMissingCustomers?: boolean;
  skipOrders?: boolean;
  contactListName?: string;
  orderPageSize?: number;
  clientPageSize?: number;
  maxOrderPages?: number;
  maxClientPages?: number;
  onProgress?: VndaImportProgress;
};

export type VndaCrmImportResult = {
  dryRun: boolean;
  onlyMissingCustomers: boolean;
  dateRange: { startDate: string; endDate: string };
  status: string;
  crmBefore: {
    rowCount: number;
    uniqueEmails: number;
    sourceOrderIds: number;
    orderCodes: number;
    fingerprints: number;
  };
  vndaClients: {
    fetched: number;
    uniqueEmails: number;
    missingInCrmBefore: number;
    remainingWithoutConfirmedOrder: number;
    contactList?: {
      id: string;
      name: string;
      total: number;
      phoneCount: number;
      emailCount: number;
      created: boolean;
    };
  } | null;
  orders: {
    fetched: number;
    uniqueEmails: number;
    newCustomerEmails: number;
    skippedExistingSourceOrder: number;
    skippedExistingOrderCode: number;
    skippedExistingFingerprint: number;
    skippedExistingCustomer: number;
    skippedWithoutEmail: number;
    eligibleForUpsert: number;
    upserted: number;
    batchErrors: number;
  };
  snapshotInvalidated: boolean;
};

const DEFAULT_START_DATE = "2010-01-01";
const DEFAULT_ORDER_PAGE_SIZE = 200;
const DEFAULT_CLIENT_PAGE_SIZE = 100;
const UPSERT_BATCH_SIZE = 500;

function log(progress: VndaImportProgress | undefined, message: string) {
  progress?.(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

function normalizePhone(raw: unknown): string {
  const digits = typeof raw === "string" ? raw.replace(/\D/g, "") : "";
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
}

function normalizeOrderCode(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

function dateKey(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "";
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? trimmed.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function moneyCents(raw: unknown): string {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n * 100));
}

function orderFingerprint(input: { email: unknown; data_compra: unknown; valor: unknown }): string {
  const email = normalizeEmail(input.email);
  const date = dateKey(input.data_compra);
  const cents = moneyCents(input.valor);
  return email && date && cents ? `${email}|${date}|${cents}` : "";
}

function nextPageFromPagination(pagination: Pagination | null, currentPage: number): number | null {
  const raw = pagination?.next_page;
  if (raw === null || raw === undefined || raw === false) {
    const totalPages = typeof pagination?.total_pages === "number" ? pagination.total_pages : 0;
    return totalPages > currentPage ? currentPage + 1 : null;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > currentPage ? raw : currentPage + 1;
  }
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > currentPage) return parsed;
    if (raw.trim()) return currentPage + 1;
    return null;
  }
  return currentPage + 1;
}

function normalizeState(raw: unknown): string | null {
  const uf = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(uf) ? uf : null;
}

function firstNonEmpty(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function parseBirthdate(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function normalizePaymentMethod(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const pm = raw.toLowerCase();
  if (pm.includes("pix")) return "pix";
  if (pm.includes("cart") || pm.includes("credit") || pm.includes("credito") || pm.includes("crédito")) {
    return "credit_card";
  }
  if (pm.includes("boleto")) return "boleto";
  if (pm.includes("debit") || pm.includes("debito") || pm.includes("débito")) return "debit_card";
  return raw;
}

async function vndaGet<T>(
  path: string,
  config: VndaConfig,
  params: Record<string, string>,
  context: string,
): Promise<{ data: T; pagination: Pagination | null }> {
  const url = new URL(`https://api.vnda.com.br/api/v2/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== "") url.searchParams.set(key, value);
  }

  let lastError = "";
  for (let attempt = 1; attempt <= 5; attempt++) {
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          Accept: "application/json",
          "X-Shop-Host": config.storeHost,
        },
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(Math.min(8000, 500 * 2 ** (attempt - 1)));
      continue;
    }

    if (res.ok) {
      const data = (await res.json()) as T;
      let pagination: Pagination | null = null;
      const header = res.headers.get("X-Pagination");
      if (header) {
        try {
          pagination = JSON.parse(header) as Pagination;
        } catch {
          pagination = null;
        }
      }
      return { data, pagination };
    }

    const text = await res.text().catch(() => "");
    lastError = `HTTP ${res.status}: ${text.slice(0, 200)}`;
    if (res.status !== 429 && (res.status < 500 || res.status >= 600)) {
      throw new Error(`VNDA ${context} ${lastError}`);
    }
    await sleep(Math.min(12000, 700 * 2 ** (attempt - 1)));
  }

  throw new Error(`VNDA ${context} falhou apos retries: ${lastError}`);
}

export async function getVndaImportConfig(
  admin: SupabaseClient,
  workspaceId: string,
): Promise<VndaConfig> {
  const { data, error } = await admin
    .from("vnda_connections")
    .select("api_token, store_host")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data?.api_token || !data?.store_host) {
    throw new Error(`VNDA connection not found: ${error?.message ?? "missing credentials"}`);
  }

  let apiToken = String(data.api_token);
  try {
    apiToken = decrypt(apiToken);
  } catch {
    // Some old local setups stored raw tokens.
  }
  return { apiToken, storeHost: String(data.store_host) };
}

async function fetchExistingCrmIndex(
  admin: SupabaseClient,
  workspaceId: string,
): Promise<{
  rowCount: number;
  emails: Set<string>;
  sourceOrderIds: Set<string>;
  orderCodes: Set<string>;
  fingerprints: Set<string>;
}> {
  const emails = new Set<string>();
  const sourceOrderIds = new Set<string>();
  const orderCodes = new Set<string>();
  const fingerprints = new Set<string>();
  let rowCount = 0;
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await admin
      .from("crm_vendas")
      .select("email, source_order_id, numero_pedido, data_compra, valor")
      .eq("workspace_id", workspaceId)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`CRM index fetch failed: ${error.message}`);
    const rows = (data ?? []) as Array<{
      email: string | null;
      source_order_id: string | null;
      numero_pedido: string | null;
      data_compra: string | null;
      valor: number | null;
    }>;
    for (const row of rows) {
      rowCount++;
      const email = normalizeEmail(row.email);
      if (email) emails.add(email);
      if (row.source_order_id) sourceOrderIds.add(String(row.source_order_id));
      const code = normalizeOrderCode(row.numero_pedido);
      if (code) orderCodes.add(code);
      const fingerprint = orderFingerprint(row);
      if (fingerprint) fingerprints.add(fingerprint);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return { rowCount, emails, sourceOrderIds, orderCodes, fingerprints };
}

async function fetchVndaClients(
  config: VndaConfig,
  options: Required<Pick<VndaCrmImportOptions, "clientPageSize">> & Pick<VndaCrmImportOptions, "maxClientPages" | "onProgress">,
): Promise<{ fetched: number; byEmail: Map<string, VndaClient> }> {
  const byEmail = new Map<string, VndaClient>();
  let fetched = 0;
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    if (options.maxClientPages && page > options.maxClientPages) break;
    const { data, pagination } = await vndaGet<VndaClient[]>(
      "clients",
      config,
      { page: String(page), per_page: String(options.clientPageSize) },
      `/clients page ${page}`,
    );
    const clients = data ?? [];
    fetched += clients.length;
    for (const client of clients) {
      const email = normalizeEmail(client.email);
      if (email) byEmail.set(email, client);
    }
    totalPages = pagination?.total_pages ?? totalPages;
    if (page === 1 && totalPages > 1) {
      log(options.onProgress, `[VNDA Import] /clients total pages: ${totalPages}`);
    }
    if (page % 25 === 0 || page === totalPages) {
      log(options.onProgress, `[VNDA Import] /clients page ${page}/${totalPages} (${fetched} fetched)`);
    }
    const nextPage = nextPageFromPagination(pagination, page);
    if (!nextPage) break;
    if (!pagination && clients.length < options.clientPageSize) break;
    page = nextPage;
  }

  return { fetched, byEmail };
}

async function fetchVndaOrders(
  config: VndaConfig,
  options: Required<Pick<VndaCrmImportOptions, "startDate" | "endDate" | "status" | "orderPageSize">> &
    Pick<VndaCrmImportOptions, "maxOrderPages" | "onProgress">,
): Promise<VndaApiOrder[]> {
  const all: VndaApiOrder[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    if (options.maxOrderPages && page > options.maxOrderPages) break;
    const { data, pagination } = await vndaGet<VndaApiOrder[]>(
      "orders",
      config,
      {
        status: options.status,
        start: options.startDate,
        finish: options.endDate,
        page: String(page),
        per_page: String(options.orderPageSize),
      },
      `/orders page ${page}`,
    );
    const orders = data ?? [];
    all.push(...orders);
    totalPages = pagination?.total_pages ?? totalPages;
    if (page === 1 && totalPages > 1) {
      log(options.onProgress, `[VNDA Import] /orders total pages: ${totalPages}`);
    }
    if (page % 25 === 0 || page === totalPages) {
      log(options.onProgress, `[VNDA Import] /orders page ${page}/${totalPages} (${all.length} fetched)`);
    }
    const nextPage = nextPageFromPagination(pagination, page);
    if (!nextPage) break;
    if (!pagination && orders.length < options.orderPageSize) break;
    page = nextPage;
  }

  return all;
}

function mapOrderToCrmRow(order: VndaApiOrder, workspaceId: string): CrmImportRow {
  const name = [order.first_name, order.last_name].filter(Boolean).join(" ").trim();
  const phone = firstNonEmpty(
    order.phone ? `${order.phone_area || ""}${order.phone}` : null,
    order.cellphone ? `${order.cellphone_area || ""}${order.cellphone}` : null,
    order.shipping_address?.phone,
  );

  const items = (order.items || []).map((item) => ({
    name: item.product_name ?? null,
    sku: item.sku ?? null,
    quantity: item.quantity ?? 1,
    price: item.price ?? 0,
    original_price: item.original_price ?? item.price ?? 0,
    total: item.total ?? 0,
    reference: item.reference ?? null,
    variant_name: item.variant_name ?? null,
    attribute1: item.attribute1 ?? null,
    attribute2: item.attribute2 ?? null,
    attribute3: item.attribute3 ?? null,
  }));

  const discounts = (order.discounts || []).map((discount) => ({
    name: discount.name ?? null,
    type: discount.type ?? null,
    value: discount.value ?? 0,
    apply_to: discount.apply_to ?? null,
    sku: discount.sku ?? null,
  }));

  return {
    workspace_id: workspaceId,
    cliente: name || null,
    email: normalizeEmail(order.email) || null,
    telefone: phone,
    valor: order.total ?? 0,
    data_compra: order.confirmed_at || order.received_at || new Date().toISOString(),
    cupom: order.coupon_code || null,
    numero_pedido: order.code || null,
    compras_anteriores: 0,
    source: "vnda_webhook",
    source_order_id: String(order.id),
    cpf: order.cpf || null,
    birthdate: parseBirthdate(order.birthdate),
    state: normalizeState(order.shipping_address?.state) || normalizeState(order.state),
    city: order.shipping_address?.city || order.city || null,
    zip: order.shipping_address?.zip || order.zip || null,
    neighborhood: order.shipping_address?.neighborhood || order.neighborhood || null,
    payment_method: normalizePaymentMethod(order.payment_method),
    installments: order.installments ?? null,
    shipping_method: order.shipping_method || null,
    shipping_price: order.shipping_price ?? null,
    delivery_days: order.delivery_days ?? null,
    subtotal: order.subtotal ?? null,
    discount_price: order.discount_price ?? null,
    channel: order.channel || null,
    items: items.length ? items : null,
    discounts: discounts.length ? discounts : null,
  };
}

function clientToContact(client: VndaClient): { email?: string; phone?: string; name?: string } | null {
  const email = normalizeEmail(client.email);
  const phone = normalizePhone(
    firstNonEmpty(
      client.cellphone ? `${client.cellphone_area || ""}${client.cellphone}` : null,
      client.phone ? `${client.phone_area || ""}${client.phone}` : null,
      client.recent_address?.phone,
    ) || "",
  );
  const name = firstNonEmpty(
    client.name,
    [client.first_name, client.last_name].filter(Boolean).join(" ").trim(),
  );
  if (!isValidEmail(email) && phone.length < 10) return null;
  return {
    ...(isValidEmail(email) ? { email } : {}),
    ...(phone.length >= 10 ? { phone } : {}),
    ...(name ? { name } : {}),
  };
}

async function syncVndaContactList(
  admin: SupabaseClient,
  workspaceId: string,
  clientsByEmail: Map<string, VndaClient>,
  name: string,
): Promise<NonNullable<NonNullable<VndaCrmImportResult["vndaClients"]>["contactList"]>> {
  const contacts = [...clientsByEmail.values()]
    .map(clientToContact)
    .filter((contact): contact is { email?: string; phone?: string; name?: string } => Boolean(contact));
  const phoneCount = contacts.filter((contact) => contact.phone).length;
  const emailCount = contacts.filter((contact) => contact.email).length;

  const { data: existing, error: selectError } = await admin
    .from("crm_contact_lists")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("name", name)
    .limit(1)
    .maybeSingle();
  if (selectError) throw new Error(`contact list lookup failed: ${selectError.message}`);

  if (existing?.id) {
    const { error } = await admin
      .from("crm_contact_lists")
      .update({
        description: "Lista sincronizada automaticamente a partir da base de clientes da VNDA.",
        contacts,
        total_count: contacts.length,
        phone_count: phoneCount,
        email_count: emailCount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) throw new Error(`contact list update failed: ${error.message}`);
    return { id: String(existing.id), name, total: contacts.length, phoneCount, emailCount, created: false };
  }

  const { data: created, error } = await admin
    .from("crm_contact_lists")
    .insert({
      workspace_id: workspaceId,
      name,
      description: "Lista sincronizada automaticamente a partir da base de clientes da VNDA.",
      contacts,
      total_count: contacts.length,
      phone_count: phoneCount,
      email_count: emailCount,
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(`contact list create failed: ${error?.message ?? "no row"}`);
  return { id: String(created.id), name, total: contacts.length, phoneCount, emailCount, created: true };
}

export async function runVndaCrmImport(
  admin: SupabaseClient,
  options: VndaCrmImportOptions,
): Promise<VndaCrmImportResult> {
  const endDate = options.endDate || new Date().toISOString().slice(0, 10);
  const startDate = options.startDate || DEFAULT_START_DATE;
  const status = options.status || "confirmed";
  const includeClients = options.includeClients ?? true;
  const dryRun = options.dryRun ?? false;
  const onlyMissingCustomers = options.onlyMissingCustomers ?? false;
  const skipOrders = options.skipOrders ?? false;
  const orderPageSize = options.orderPageSize ?? DEFAULT_ORDER_PAGE_SIZE;
  const clientPageSize = options.clientPageSize ?? DEFAULT_CLIENT_PAGE_SIZE;

  const config = await getVndaImportConfig(admin, options.workspaceId);
  log(options.onProgress, `[VNDA Import] host=${config.storeHost} range=${startDate}..${endDate} status=${status}`);

  const crmBefore = await fetchExistingCrmIndex(admin, options.workspaceId);
  log(options.onProgress, `[VNDA Import] CRM before: ${crmBefore.rowCount} rows, ${crmBefore.emails.size} unique emails`);

  const clients = includeClients
    ? await fetchVndaClients(config, { clientPageSize, maxClientPages: options.maxClientPages, onProgress: options.onProgress })
    : null;

  const orders = skipOrders
    ? []
    : await fetchVndaOrders(config, {
        startDate,
        endDate,
        status,
        orderPageSize,
        maxOrderPages: options.maxOrderPages,
        onProgress: options.onProgress,
      });
  if (skipOrders) {
    log(options.onProgress, "[VNDA Import] order import skipped");
  }

  const rows = orders.map((order) => mapOrderToCrmRow(order, options.workspaceId));
  const orderEmails = new Set<string>();
  const eligibleRows: CrmImportRow[] = [];
  let skippedExistingSourceOrder = 0;
  let skippedExistingOrderCode = 0;
  let skippedExistingFingerprint = 0;
  let skippedExistingCustomer = 0;
  let skippedWithoutEmail = 0;

  for (const row of rows) {
    const email = normalizeEmail(row.email);
    if (!email) {
      skippedWithoutEmail++;
      continue;
    }
    orderEmails.add(email);
    if (onlyMissingCustomers && crmBefore.emails.has(email)) {
      skippedExistingCustomer++;
      continue;
    }
    if (crmBefore.sourceOrderIds.has(row.source_order_id)) {
      skippedExistingSourceOrder++;
      continue;
    }
    const code = normalizeOrderCode(row.numero_pedido);
    if (code && crmBefore.orderCodes.has(code)) {
      skippedExistingOrderCode++;
      continue;
    }
    const fingerprint = orderFingerprint(row);
    if (fingerprint && crmBefore.fingerprints.has(fingerprint)) {
      skippedExistingFingerprint++;
      continue;
    }
    eligibleRows.push(row);
  }

  const newCustomerEmails = [...orderEmails].filter((email) => !crmBefore.emails.has(email)).length;
  let upserted = 0;
  let batchErrors = 0;

  if (!dryRun) {
    for (let i = 0; i < eligibleRows.length; i += UPSERT_BATCH_SIZE) {
      const batch = eligibleRows.slice(i, i + UPSERT_BATCH_SIZE);
      const { error } = await admin
        .from("crm_vendas")
        .upsert(batch, { onConflict: "workspace_id, source, source_order_id", ignoreDuplicates: false });
      if (error) {
        batchErrors++;
        log(options.onProgress, `[VNDA Import] upsert batch ${i / UPSERT_BATCH_SIZE + 1} failed: ${error.message}`);
      } else {
        upserted += batch.length;
      }
    }
  }

  let contactList: NonNullable<NonNullable<VndaCrmImportResult["vndaClients"]>["contactList"]> | undefined;
  if (!dryRun && options.syncContactList && clients) {
    contactList = await syncVndaContactList(
      admin,
      options.workspaceId,
      clients.byEmail,
      options.contactListName || "VNDA · Todos os clientes",
    );
  }

  let snapshotInvalidated = false;
  if (!dryRun && upserted > 0) {
    // Keep the last good snapshot available. The large Bulking recompute can
    // hit transient Supabase 522/timeouts; deleting first makes the CRM render
    // as zero until the recompute succeeds.
    snapshotInvalidated = true;
  }

  const clientEmails = clients?.byEmail ? new Set(clients.byEmail.keys()) : null;
  const missingInCrmBefore = clientEmails
    ? [...clientEmails].filter((email) => !crmBefore.emails.has(email)).length
    : 0;
  const remainingWithoutConfirmedOrder = clientEmails
    ? [...clientEmails].filter((email) => !crmBefore.emails.has(email) && !orderEmails.has(email)).length
    : 0;

  return {
    dryRun,
    onlyMissingCustomers,
    dateRange: { startDate, endDate },
    status,
    crmBefore: {
      rowCount: crmBefore.rowCount,
      uniqueEmails: crmBefore.emails.size,
      sourceOrderIds: crmBefore.sourceOrderIds.size,
      orderCodes: crmBefore.orderCodes.size,
      fingerprints: crmBefore.fingerprints.size,
    },
    vndaClients: clients
      ? {
          fetched: clients.fetched,
          uniqueEmails: clients.byEmail.size,
          missingInCrmBefore,
          remainingWithoutConfirmedOrder,
          contactList,
        }
      : null,
    orders: {
      fetched: orders.length,
      uniqueEmails: orderEmails.size,
      newCustomerEmails,
      skippedExistingSourceOrder,
      skippedExistingOrderCode,
      skippedExistingFingerprint,
      skippedExistingCustomer,
      skippedWithoutEmail,
      eligibleForUpsert: eligibleRows.length,
      upserted,
      batchErrors,
    },
    snapshotInvalidated,
  };
}

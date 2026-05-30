import type { SupabaseClient } from "@supabase/supabase-js";

export type EccosysImportProgress = (message: string) => void;

type EccosysConfig = {
  apiToken: string;
  ambiente: string;
};

type EccosysClient = {
  id?: number;
  nome?: string | null;
  email?: string | null;
  cnpj?: string | null;
  cpf?: string | null;
  documento?: string | null;
  fone?: string | null;
  celular?: string | null;
  dataAlteracao?: string | null;
  dataNascimento?: string | null;
  dataUltimaCompra?: string | null;
  dtCriacao?: string | null;
  uf?: string | null;
  cidade?: string | null;
  cep?: string | null;
  bairro?: string | null;
};

type EccosysOrder = {
  id?: number;
  numeroPedido?: string | null;
  data?: string | null;
  dataPagamento?: string | null;
  dataFaturamento?: string | null;
  dtCriacaoVenda?: string | null;
  totalProdutos?: string | number | null;
  totalVenda?: string | number | null;
  desconto?: string | number | null;
  frete?: string | number | null;
  situacao?: number | string | null;
  situacaoDescricao?: string | null;
  transportador?: string | null;
  tipoPagamento?: string | null;
  canalDeVenda?: string | null;
  servicePlatformOrigin?: string | null;
  _Parcelas?: Array<{ formaPagamento?: string | null; valor?: string | number | null }>;
};

type EccosysOrderItem = {
  id?: number;
  idProduto?: number | string | null;
  codigo?: string | null;
  descricao?: string | null;
  quantidade?: string | number | null;
  valor?: string | number | null;
  valorComImpostos?: string | number | null;
  precoLista?: string | number | null;
  valorDesconto?: string | number | null;
  valorFrete?: string | number | null;
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
  source: string;
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

type ExistingCrmIndex = {
  rowCount: number;
  emails: Set<string>;
  sourceOrderIds: Set<string>;
  orderCodes: Set<string>;
  fingerprints: Set<string>;
};

export type EccosysCrmImportOptions = {
  workspaceId: string;
  startDate?: string;
  dryRun?: boolean;
  onlyMissingCustomers?: boolean;
  clientPageSize?: number;
  orderPageSize?: number;
  startOffset?: number;
  maxClientPages?: number;
  maxClients?: number;
  maxOrdersPerClient?: number;
  fetchItems?: boolean;
  itemsFromDate?: string;
  source?: string;
  channel?: string;
  syncContactList?: boolean;
  contactListName?: string;
  onProgress?: EccosysImportProgress;
};

export type EccosysCrmImportResult = {
  dryRun: boolean;
  source: string;
  channel: string;
  startDate: string;
  crmBefore: {
    rowCount: number;
    uniqueEmails: number;
    sourceOrderIds: number;
    orderCodes: number;
    fingerprints: number;
  };
  clients: {
    fetched: number;
    eligible: number;
    skippedExistingCustomer: number;
    skippedWithoutEmail: number;
    skippedWithoutDocument: number;
    skippedBeforeStartDate: number;
  };
  orders: {
    fetched: number;
    itemFetches: number;
    eligibleForUpsert: number;
    upserted: number;
    skippedBeforeStartDate: number;
    skippedExistingSourceOrder: number;
    skippedExistingOrderCode: number;
    skippedExistingFingerprint: number;
    skippedInvalid: number;
    batchErrors: number;
  };
  contactList?: {
    id: string;
    name: string;
    total: number;
    phoneCount: number;
    emailCount: number;
    created: boolean;
  };
  snapshotInvalidated: boolean;
};

const DEFAULT_START_DATE = "2020-01-01";
const DEFAULT_CLIENT_PAGE_SIZE = 100;
const DEFAULT_ORDER_PAGE_SIZE = 20;
const DEFAULT_SOURCE = "eccosys_clientes_api";
const DEFAULT_CHANNEL = "eccosys_clientes_api";
const DEFAULT_ITEMS_FROM_DATE = "2025-01-01";
const UPSERT_BATCH_SIZE = 500;
const THROTTLE_MS = 1050;

function log(progress: EccosysImportProgress | undefined, message: string) {
  progress?.(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

function normalizePhone(...values: unknown[]): string | null {
  for (const value of values) {
    const digits = typeof value === "string" ? value.replace(/\D/g, "") : "";
    if (!digits) continue;
    if (digits.startsWith("55") && digits.length >= 12) return digits;
    if (digits.length === 10 || digits.length === 11) return `55${digits}`;
    return digits;
  }
  return null;
}

function onlyDigits(raw: unknown): string {
  return typeof raw === "string" || typeof raw === "number" ? String(raw).replace(/\D/g, "") : "";
}

function parseNumber(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return 0;
  const normalized = raw.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function dateKey(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "";
  const trimmed = raw.trim();
  if (trimmed.startsWith("0000")) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function parseBirthdate(raw: unknown): string | null {
  const date = dateKey(raw);
  return date || null;
}

function normalizeState(raw: unknown): string | null {
  const uf = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(uf) ? uf : null;
}

function normalizeOrderCode(raw: unknown): string {
  return typeof raw === "string" || typeof raw === "number" ? String(raw).trim().toLowerCase() : "";
}

function moneyCents(raw: unknown): string {
  const n = parseNumber(raw);
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n * 100));
}

function orderFingerprint(input: { email: unknown; data_compra: unknown; valor: unknown }): string {
  const email = normalizeEmail(input.email);
  const date = dateKey(input.data_compra);
  const cents = moneyCents(input.valor);
  return email && date && cents ? `${email}|${date}|${cents}` : "";
}

function getEccosysConfig(): EccosysConfig {
  const apiToken = process.env.ECCOSYS_API_TOKEN;
  const ambiente = (process.env.ECCOSYS_AMBIENTE || "producao").toLowerCase();
  if (!apiToken) {
    throw new Error("ECCOSYS_API_TOKEN ausente");
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(ambiente)) {
    throw new Error(`ECCOSYS_AMBIENTE invalido: ${ambiente}`);
  }
  return { apiToken, ambiente };
}

async function eccosysGet<T>(
  config: EccosysConfig,
  path: string,
  params: Record<string, string>,
  context: string,
): Promise<{ data: T; notFound: boolean }> {
  const url = new URL(`https://${config.ambiente}.eccosys.com.br/api${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let lastError = "";
  for (let attempt = 1; attempt <= 4; attempt++) {
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(Math.min(8000, 700 * 2 ** (attempt - 1)));
      continue;
    }

    if (res.status === 404) {
      return { data: [] as T, notFound: true };
    }
    if (res.ok) {
      return { data: (await res.json()) as T, notFound: false };
    }

    const text = await res.text().catch(() => "");
    lastError = `HTTP ${res.status}: ${text.slice(0, 200)}`;
    if (res.status !== 429 && (res.status < 500 || res.status >= 600)) {
      throw new Error(`Eccosys ${context} ${lastError}`);
    }
    await sleep(Math.min(10000, 900 * 2 ** (attempt - 1)));
  }
  throw new Error(`Eccosys ${context} falhou apos retries: ${lastError}`);
}

async function fetchExistingCrmIndex(admin: SupabaseClient, workspaceId: string): Promise<ExistingCrmIndex> {
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

function isClientFromStartDate(client: EccosysClient, startDate: string): boolean {
  return [client.dtCriacao, client.dataAlteracao, client.dataUltimaCompra]
    .map(dateKey)
    .some((date) => date && date >= startDate);
}

function clientDocument(client: EccosysClient): string {
  return onlyDigits(client.cnpj || client.cpf || client.documento);
}

async function fetchEligibleClients(
  config: EccosysConfig,
  crmBefore: ExistingCrmIndex,
  options: Required<Pick<EccosysCrmImportOptions, "clientPageSize" | "startDate" | "startOffset" | "onlyMissingCustomers">> &
    Pick<EccosysCrmImportOptions, "maxClientPages" | "maxClients" | "onProgress">,
): Promise<{
  fetched: number;
  eligible: EccosysClient[];
  skippedExistingCustomer: number;
  skippedWithoutEmail: number;
  skippedWithoutDocument: number;
  skippedBeforeStartDate: number;
}> {
  const eligible: EccosysClient[] = [];
  const seenEmails = new Set<string>();
  let fetched = 0;
  let skippedExistingCustomer = 0;
  let skippedWithoutEmail = 0;
  let skippedWithoutDocument = 0;
  let skippedBeforeStartDate = 0;
  let offset = options.startOffset;
  let pages = 0;

  while (true) {
    if (options.maxClientPages && pages >= options.maxClientPages) break;
    if (options.maxClients && eligible.length >= options.maxClients) break;

    const { data, notFound } = await eccosysGet<EccosysClient[]>(
      config,
      "/clientes",
      { $count: String(options.clientPageSize), $offset: String(offset) },
      `/clientes offset ${offset}`,
    );
    const clients = Array.isArray(data) ? data : [];
    if (notFound || clients.length === 0) break;

    fetched += clients.length;
    pages++;
    for (const client of clients) {
      const email = normalizeEmail(client.email);
      if (!email) {
        skippedWithoutEmail++;
        continue;
      }
      if (seenEmails.has(email)) continue;
      if (options.onlyMissingCustomers && crmBefore.emails.has(email)) {
        skippedExistingCustomer++;
        continue;
      }
      if (!clientDocument(client)) {
        skippedWithoutDocument++;
        continue;
      }
      if (!isClientFromStartDate(client, options.startDate)) {
        skippedBeforeStartDate++;
        continue;
      }
      eligible.push(client);
      seenEmails.add(email);
      if (options.maxClients && eligible.length >= options.maxClients) break;
    }

    log(
      options.onProgress,
      `[Eccosys Import] /clientes offset ${offset} fetched=${fetched} eligible=${eligible.length}`,
    );
    if (clients.length < options.clientPageSize) break;
    offset += options.clientPageSize;
    await sleep(THROTTLE_MS);
  }

  return {
    fetched,
    eligible,
    skippedExistingCustomer,
    skippedWithoutEmail,
    skippedWithoutDocument,
    skippedBeforeStartDate,
  };
}

async function fetchOrdersForDocument(
  config: EccosysConfig,
  document: string,
  options: Required<Pick<EccosysCrmImportOptions, "orderPageSize" | "maxOrdersPerClient">>,
): Promise<EccosysOrder[]> {
  const orders: EccosysOrder[] = [];
  let offset = 0;
  while (orders.length < options.maxOrdersPerClient) {
    const count = Math.min(options.orderPageSize, options.maxOrdersPerClient - orders.length);
    const { data, notFound } = await eccosysGet<EccosysOrder[]>(
      config,
      `/pedidos/documento/${encodeURIComponent(document)}`,
      { $count: String(count), $offset: String(offset) },
      `/pedidos/documento offset ${offset}`,
    );
    const page = Array.isArray(data) ? data : [];
    if (notFound || page.length === 0) break;
    orders.push(...page);
    if (page.length < count) break;
    offset += count;
    await sleep(THROTTLE_MS);
  }
  return orders;
}

async function fetchOrderItems(config: EccosysConfig, orderId: number | string): Promise<EccosysOrderItem[]> {
  const { data, notFound } = await eccosysGet<EccosysOrderItem[]>(
    config,
    `/pedidos/${encodeURIComponent(String(orderId))}/items`,
    {},
    `/pedidos/${orderId}/items`,
  );
  if (notFound || !Array.isArray(data)) return [];
  return data;
}

function mapEccosysItems(items: EccosysOrderItem[]): Array<Record<string, unknown>> | null {
  const mapped = items.map((item) => {
    const quantity = parseNumber(item.quantidade) || 1;
    const price = parseNumber(item.valorComImpostos) || parseNumber(item.valor);
    return {
      name: item.descricao || null,
      sku: item.codigo || null,
      quantity,
      price,
      original_price: parseNumber(item.precoLista) || price,
      total: price * quantity,
      reference: item.idProduto ? String(item.idProduto) : null,
      eccosys_item_id: item.id ? String(item.id) : null,
      discount: parseNumber(item.valorDesconto) || 0,
      freight: parseNumber(item.valorFrete) || 0,
    };
  });
  return mapped.length ? mapped : null;
}

function mapEccosysOrderToCrmRow(
  client: EccosysClient,
  order: EccosysOrder,
  items: EccosysOrderItem[],
  options: Required<Pick<EccosysCrmImportOptions, "workspaceId" | "source" | "channel">>,
): CrmImportRow | null {
  if (!order.id) return null;
  const email = normalizeEmail(client.email);
  if (!email) return null;
  const dataCompra = dateKey(order.dataPagamento) || dateKey(order.data) || dateKey(order.dtCriacaoVenda);
  const valor = parseNumber(order.totalVenda);
  if (!dataCompra || valor <= 0) return null;

  const document = clientDocument(client);
  const parcelas = Array.isArray(order._Parcelas) ? order._Parcelas : [];
  const paymentMethod = parcelas[0]?.formaPagamento || order.tipoPagamento || null;

  return {
    workspace_id: options.workspaceId,
    cliente: client.nome?.trim() || null,
    email,
    telefone: normalizePhone(client.celular, client.fone),
    valor,
    data_compra: dataCompra,
    cupom: null,
    numero_pedido: order.numeroPedido ? String(order.numeroPedido) : null,
    compras_anteriores: 0,
    source: options.source,
    source_order_id: `${options.source}:${order.id}`,
    cpf: document.length === 11 ? document : null,
    birthdate: parseBirthdate(client.dataNascimento),
    state: normalizeState(client.uf),
    city: client.cidade?.trim() || null,
    zip: client.cep?.trim() || null,
    neighborhood: client.bairro?.trim() || null,
    payment_method: paymentMethod ? String(paymentMethod) : null,
    installments: parcelas.length || null,
    shipping_method: order.transportador || null,
    shipping_price: parseNumber(order.frete) || null,
    delivery_days: null,
    subtotal: parseNumber(order.totalProdutos) || null,
    discount_price: parseNumber(order.desconto) || null,
    channel: options.channel,
    items: mapEccosysItems(items),
    discounts: null,
  };
}

async function syncImportedContactList(
  admin: SupabaseClient,
  workspaceId: string,
  rows: CrmImportRow[],
  source: string,
  name: string,
): Promise<NonNullable<EccosysCrmImportResult["contactList"]>> {
  const byEmail = new Map<string, { email?: string; phone?: string; name?: string }>();
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await admin
      .from("crm_vendas")
      .select("email, telefone, cliente")
      .eq("workspace_id", workspaceId)
      .eq("source", source)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`contact list crm fetch failed: ${error.message}`);
    const existingRows = (data ?? []) as Array<{ email: string | null; telefone: string | null; cliente: string | null }>;
    for (const row of existingRows) {
      const email = normalizeEmail(row.email);
      if (!email) continue;
      byEmail.set(email, {
        email,
        ...(row.telefone ? { phone: row.telefone } : {}),
        ...(row.cliente ? { name: row.cliente } : {}),
      });
    }
    if (existingRows.length < pageSize) break;
    from += pageSize;
  }

  for (const row of rows) {
    const email = normalizeEmail(row.email);
    if (!email) continue;
    byEmail.set(email, {
      email,
      ...(row.telefone ? { phone: row.telefone } : {}),
      ...(row.cliente ? { name: row.cliente } : {}),
    });
  }
  const contacts = [...byEmail.values()];
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

  const payload = {
    description: "Clientes importados do Eccosys via /clientes + /pedidos/documento, identificados por source=eccosys_clientes_api.",
    contacts,
    total_count: contacts.length,
    phone_count: phoneCount,
    email_count: emailCount,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { error } = await admin
      .from("crm_contact_lists")
      .update(payload)
      .eq("id", existing.id);
    if (error) throw new Error(`contact list update failed: ${error.message}`);
    return { id: String(existing.id), name, total: contacts.length, phoneCount, emailCount, created: false };
  }

  const { data: created, error } = await admin
    .from("crm_contact_lists")
    .insert({
      workspace_id: workspaceId,
      name,
      ...payload,
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(`contact list create failed: ${error?.message ?? "no row"}`);
  return { id: String(created.id), name, total: contacts.length, phoneCount, emailCount, created: true };
}

export async function runEccosysCrmImport(
  admin: SupabaseClient,
  options: EccosysCrmImportOptions,
): Promise<EccosysCrmImportResult> {
  const startDate = options.startDate || DEFAULT_START_DATE;
  const dryRun = options.dryRun ?? true;
  const onlyMissingCustomers = options.onlyMissingCustomers ?? true;
  const clientPageSize = options.clientPageSize ?? DEFAULT_CLIENT_PAGE_SIZE;
  const orderPageSize = options.orderPageSize ?? DEFAULT_ORDER_PAGE_SIZE;
  const startOffset = options.startOffset ?? 0;
  const maxOrdersPerClient = options.maxOrdersPerClient ?? 50;
  const fetchItems = options.fetchItems ?? true;
  const itemsFromDate = options.itemsFromDate || DEFAULT_ITEMS_FROM_DATE;
  const source = options.source || DEFAULT_SOURCE;
  const channel = options.channel || DEFAULT_CHANNEL;

  const config = getEccosysConfig();
  log(
    options.onProgress,
    `[Eccosys Import] ambiente=${config.ambiente} startDate=${startDate} source=${source} itemsFrom=${fetchItems ? itemsFromDate : "disabled"}`,
  );

  const crmBefore = await fetchExistingCrmIndex(admin, options.workspaceId);
  log(options.onProgress, `[Eccosys Import] CRM before: ${crmBefore.rowCount} rows, ${crmBefore.emails.size} unique emails`);

  const clientResult = await fetchEligibleClients(config, crmBefore, {
    clientPageSize,
    startDate,
    startOffset,
    onlyMissingCustomers,
    maxClientPages: options.maxClientPages,
    maxClients: options.maxClients,
    onProgress: options.onProgress,
  });

  const eligibleRows: CrmImportRow[] = [];
  const seenSourceIds = new Set<string>();
  const seenOrderCodes = new Set<string>();
  const seenFingerprints = new Set<string>();
  let ordersFetched = 0;
  let itemFetches = 0;
  let skippedBeforeStartDate = 0;
  let skippedExistingSourceOrder = 0;
  let skippedExistingOrderCode = 0;
  let skippedExistingFingerprint = 0;
  let skippedInvalid = 0;

  for (let i = 0; i < clientResult.eligible.length; i++) {
    const client = clientResult.eligible[i];
    const document = clientDocument(client);
    const orders = await fetchOrdersForDocument(config, document, { orderPageSize, maxOrdersPerClient });
    ordersFetched += orders.length;

    for (const order of orders) {
      const orderDate = dateKey(order.dataPagamento) || dateKey(order.data) || dateKey(order.dtCriacaoVenda);
      if (!orderDate || orderDate < startDate) {
        skippedBeforeStartDate++;
        continue;
      }

      const sourceOrderId = order.id ? `${source}:${order.id}` : "";
      if (!sourceOrderId) {
        skippedInvalid++;
        continue;
      }
      if (crmBefore.sourceOrderIds.has(sourceOrderId) || seenSourceIds.has(sourceOrderId)) {
        skippedExistingSourceOrder++;
        continue;
      }

      const code = normalizeOrderCode(order.numeroPedido);
      if (code && (crmBefore.orderCodes.has(code) || seenOrderCodes.has(code))) {
        skippedExistingOrderCode++;
        continue;
      }

      const email = normalizeEmail(client.email);
      const valor = parseNumber(order.totalVenda);
      const fingerprint = orderFingerprint({ email, data_compra: orderDate, valor });
      if (fingerprint && (crmBefore.fingerprints.has(fingerprint) || seenFingerprints.has(fingerprint))) {
        skippedExistingFingerprint++;
        continue;
      }

      let items: EccosysOrderItem[] = [];
      if (fetchItems && order.id && orderDate >= itemsFromDate) {
        items = await fetchOrderItems(config, order.id);
        itemFetches++;
        await sleep(THROTTLE_MS);
      }

      const row = mapEccosysOrderToCrmRow(client, order, items, {
        workspaceId: options.workspaceId,
        source,
        channel,
      });
      if (!row) {
        skippedInvalid++;
        continue;
      }

      eligibleRows.push(row);
      seenSourceIds.add(sourceOrderId);
      if (code) seenOrderCodes.add(code);
      if (fingerprint) seenFingerprints.add(fingerprint);
    }

    if ((i + 1) % 25 === 0 || i + 1 === clientResult.eligible.length) {
      log(
        options.onProgress,
        `[Eccosys Import] clients ${i + 1}/${clientResult.eligible.length} orders=${ordersFetched} eligibleRows=${eligibleRows.length}`,
      );
    }
    await sleep(THROTTLE_MS);
  }

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
        log(options.onProgress, `[Eccosys Import] upsert batch ${i / UPSERT_BATCH_SIZE + 1} failed: ${error.message}`);
      } else {
        upserted += batch.length;
      }
    }
  }

  let contactList: EccosysCrmImportResult["contactList"];
  if (!dryRun && options.syncContactList && eligibleRows.length > 0) {
    contactList = await syncImportedContactList(
      admin,
      options.workspaceId,
      eligibleRows,
      source,
      options.contactListName || "Eccosys - Importados CRM 2020+",
    );
  }

  let snapshotInvalidated = false;
  if (!dryRun && upserted > 0) {
    const { error } = await admin
      .from("crm_rfm_snapshots")
      .delete()
      .eq("workspace_id", options.workspaceId);
    if (error) throw new Error(`snapshot invalidation failed: ${error.message}`);
    snapshotInvalidated = true;
  }

  return {
    dryRun,
    source,
    channel,
    startDate,
    crmBefore: {
      rowCount: crmBefore.rowCount,
      uniqueEmails: crmBefore.emails.size,
      sourceOrderIds: crmBefore.sourceOrderIds.size,
      orderCodes: crmBefore.orderCodes.size,
      fingerprints: crmBefore.fingerprints.size,
    },
    clients: {
      fetched: clientResult.fetched,
      eligible: clientResult.eligible.length,
      skippedExistingCustomer: clientResult.skippedExistingCustomer,
      skippedWithoutEmail: clientResult.skippedWithoutEmail,
      skippedWithoutDocument: clientResult.skippedWithoutDocument,
      skippedBeforeStartDate: clientResult.skippedBeforeStartDate,
    },
    orders: {
      fetched: ordersFetched,
      itemFetches,
      eligibleForUpsert: eligibleRows.length,
      upserted,
      skippedBeforeStartDate,
      skippedExistingSourceOrder,
      skippedExistingOrderCode,
      skippedExistingFingerprint,
      skippedInvalid,
      batchErrors,
    },
    contactList,
    snapshotInvalidated,
  };
}

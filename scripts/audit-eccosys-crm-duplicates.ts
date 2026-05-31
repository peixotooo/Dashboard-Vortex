/**
 * Audita/limpa possiveis duplicidades Eccosys x VNDA no CRM.
 *
 * O caso principal e quando a VNDA salvou o pedido pelo codigo externo
 * (OC/OC completa), enquanto a Eccosys retorna outro numero interno em
 * numeroPedido. Para esses casos usamos numeroDaOrdemDeCompra e referencias
 * externas do pedido Eccosys como chaves equivalentes.
 *
 * Uso:
 *   npx tsx scripts/audit-eccosys-crm-duplicates.ts --workspace=<uuid>
 *   npx tsx scripts/audit-eccosys-crm-duplicates.ts --workspace=<uuid> --apply
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

type CrmRow = {
  id: string;
  source: string | null;
  source_order_id: string | null;
  numero_pedido: string | null;
  email: string | null;
  data_compra: string | null;
  valor: number | null;
};

type EccosysOrder = {
  id?: string | number | null;
  numeroPedido?: string | null;
  numeroDaOrdemDeCompra?: string | null;
  idPedidoOrigem?: string | number | null;
  idMarketplacePedidoMaster?: string | number | null;
  paymentOrderID?: string | number | null;
  servicePlatformOrigin?: string | null;
};

type Args = {
  workspaceId?: string;
  apply: boolean;
  limit?: number;
  startIndex: number;
  source: string;
  throttleMs: number;
};

const CONTACT_LIST_NAME = "Eccosys - Importados CRM 2020+";

function readArgs(): Args {
  const args: Args = {
    apply: false,
    startIndex: 0,
    source: "eccosys_clientes_api",
    throttleMs: 900,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg.startsWith("--workspace=")) args.workspaceId = arg.slice("--workspace=".length);
    else if (arg.startsWith("--source=")) args.source = arg.slice("--source=".length);
    else if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) args.limit = n;
    } else if (arg.startsWith("--start-index=")) {
      const n = Number(arg.slice("--start-index=".length));
      if (Number.isFinite(n) && n >= 0) args.startIndex = n;
    } else if (arg.startsWith("--throttle-ms=")) {
      const n = Number(arg.slice("--throttle-ms=".length));
      if (Number.isFinite(n) && n >= 0) args.throttleMs = n;
    }
  }
  return args;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeOrderCode(raw: unknown): string {
  return typeof raw === "string" || typeof raw === "number" ? String(raw).trim().toLowerCase() : "";
}

function orderCodeVariants(...values: unknown[]): string[] {
  const variants = new Set<string>();
  for (const value of values) {
    const normalized = normalizeOrderCode(value);
    if (!normalized || normalized === "0") continue;
    variants.add(normalized);

    const compact = normalized.replace(/[^a-z0-9]/g, "");
    if (compact.length >= 8) variants.add(compact);

    const digits = normalized.replace(/\D/g, "");
    if (digits.length >= 8) variants.add(digits);
  }
  return [...variants];
}

function externalReferenceVariants(order: EccosysOrder): string[] {
  const serviceOriginOrderRefs = normalizeOrderCode(order.servicePlatformOrigin)
    .split(/[_\s|/]+/)
    .filter((part) => part.includes("-") || part.replace(/\D/g, "").length >= 10);
  return orderCodeVariants(
    order.numeroDaOrdemDeCompra,
    order.idPedidoOrigem,
    order.idMarketplacePedidoMaster,
    order.paymentOrderID,
    order.servicePlatformOrigin,
    ...serviceOriginOrderRefs,
  );
}

function preferredOrderCode(order: EccosysOrder): string | null {
  return normalizeOrderCode(order.numeroDaOrdemDeCompra) || normalizeOrderCode(order.numeroPedido) || null;
}

function sameDay(a: string | null, b: string | null): boolean {
  return !!a && !!b && a.slice(0, 10) === b.slice(0, 10);
}

function closeValue(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) < 0.02;
}

function normalizeEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

async function fetchAllCrmRows(admin: any, workspaceId: string): Promise<CrmRow[]> {
  const rows: CrmRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("crm_vendas")
      .select("id, source, source_order_id, numero_pedido, email, data_compra, valor")
      .eq("workspace_id", workspaceId)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`CRM fetch failed: ${error.message}`);
    rows.push(...((data ?? []) as CrmRow[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function fetchEccosysOrder(id: string): Promise<EccosysOrder | null> {
  const token = process.env.ECCOSYS_API_TOKEN;
  if (!token) throw new Error("ECCOSYS_API_TOKEN ausente");
  const ambiente = (process.env.ECCOSYS_AMBIENTE || "producao").toLowerCase();
  const url = `https://${ambiente}.eccosys.com.br/api/pedidos/${encodeURIComponent(id)}`;

  let lastError = "";
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 404) return null;
      const text = await res.text();
      if (!res.ok) {
        lastError = `HTTP ${res.status}: ${text.slice(0, 200)}`;
        if (res.status === 429) {
          console.log(`[Eccosys Duplicate Audit] rate limit em pedido ${id}; aguardando 65s`);
          await sleep(65000);
          attempt--;
          continue;
        }
        if (res.status !== 429 && (res.status < 500 || res.status >= 600)) {
          throw new Error(lastError);
        }
      } else {
        const parsed = JSON.parse(text);
        return (Array.isArray(parsed) ? parsed[0] : parsed) ?? null;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(Math.min(8000, 700 * 2 ** (attempt - 1)));
  }
  throw new Error(`Pedido Eccosys ${id} falhou apos retries: ${lastError}`);
}

async function syncContactList(admin: any, workspaceId: string, source: string) {
  const contactsByEmail = new Map<string, { email?: string; phone?: string; name?: string }>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("crm_vendas")
      .select("email, telefone, cliente")
      .eq("workspace_id", workspaceId)
      .eq("source", source)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`contact list fetch failed: ${error.message}`);
    for (const row of data ?? []) {
      const email = normalizeEmail((row as { email?: string | null }).email);
      if (!email) continue;
      contactsByEmail.set(email, {
        email,
        ...((row as { telefone?: string | null }).telefone ? { phone: (row as { telefone: string }).telefone } : {}),
        ...((row as { cliente?: string | null }).cliente ? { name: (row as { cliente: string }).cliente } : {}),
      });
    }
    if (!data || data.length < pageSize) break;
  }

  const contacts = [...contactsByEmail.values()];
  const payload = {
    contacts,
    total_count: contacts.length,
    phone_count: contacts.filter((contact) => contact.phone).length,
    email_count: contacts.filter((contact) => contact.email).length,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin
    .from("crm_contact_lists")
    .update(payload)
    .eq("workspace_id", workspaceId)
    .eq("name", CONTACT_LIST_NAME);
  if (error) throw new Error(`contact list update failed: ${error.message}`);
}

async function main() {
  const args = readArgs();
  if (!args.workspaceId) {
    console.error("Uso: npx tsx scripts/audit-eccosys-crm-duplicates.ts --workspace=<uuid> [--apply]");
    process.exit(1);
  }

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios em .env.local");
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const rows = await fetchAllCrmRows(admin, args.workspaceId);
  const externalCodeIndex = new Map<string, CrmRow[]>();
  const eccosysRows = rows.filter((row) => row.source === args.source);

  for (const row of rows) {
    if (row.source === args.source) continue;
    const values = row.source === "vnda_webhook"
      ? [row.numero_pedido]
      : [row.numero_pedido, row.source_order_id];
    for (const code of orderCodeVariants(...values)) {
      const arr = externalCodeIndex.get(code) ?? [];
      arr.push(row);
      externalCodeIndex.set(code, arr);
    }
  }

  const duplicates: Array<{
    eccosysRow: CrmRow;
    eccosysOrderId: string;
    preferredCode: string | null;
    matchedCode: string;
    matchedRows: CrmRow[];
  }> = [];
  const updates: Array<{ id: string; numero_pedido: string }> = [];
  const checked = args.limit
    ? eccosysRows.slice(args.startIndex, args.startIndex + args.limit)
    : eccosysRows.slice(args.startIndex);

  for (let i = 0; i < checked.length; i++) {
    const row = checked[i];
    const eccosysOrderId = String(row.source_order_id || "").split(":").pop() || "";
    if (!eccosysOrderId) continue;
    const order = await fetchEccosysOrder(eccosysOrderId);
    if (!order) continue;

    const refs = externalReferenceVariants(order);
    const preferredCode = preferredOrderCode(order);
    let matchedCode = "";
    let matchedRows: CrmRow[] = [];
    for (const ref of refs) {
      const matches = (externalCodeIndex.get(ref) ?? []).filter((candidate) => {
        const sameEmail = normalizeEmail(candidate.email) && normalizeEmail(candidate.email) === normalizeEmail(row.email);
        return sameEmail || sameDay(candidate.data_compra, row.data_compra) || closeValue(candidate.valor, row.valor);
      });
      if (matches.length > 0) {
        matchedCode = ref;
        matchedRows = matches;
        break;
      }
    }

    if (matchedRows.length > 0) {
      duplicates.push({ eccosysRow: row, eccosysOrderId, preferredCode, matchedCode, matchedRows });
    } else if (preferredCode && normalizeOrderCode(row.numero_pedido) !== preferredCode) {
      updates.push({ id: row.id, numero_pedido: preferredCode });
    }

    if ((i + 1) % 50 === 0 || i + 1 === checked.length) {
      console.log(`[Eccosys Duplicate Audit] checked=${i + 1}/${checked.length} duplicates=${duplicates.length} updates=${updates.length}`);
    }
    await sleep(args.throttleMs);
  }

  if (args.apply) {
    for (let i = 0; i < duplicates.length; i += 500) {
      const batch = duplicates.slice(i, i + 500).map((item) => item.eccosysRow.id);
      const { error } = await admin.from("crm_vendas").delete().in("id", batch);
      if (error) throw new Error(`delete batch failed: ${error.message}`);
    }
    for (let i = 0; i < updates.length; i += 500) {
      const batch = updates.slice(i, i + 500);
      for (const update of batch) {
        const { error } = await admin
          .from("crm_vendas")
          .update({ numero_pedido: update.numero_pedido })
          .eq("id", update.id);
        if (error) throw new Error(`update ${update.id} failed: ${error.message}`);
      }
    }
    if (duplicates.length > 0 || updates.length > 0) {
      const { error } = await admin.from("crm_rfm_snapshots").delete().eq("workspace_id", args.workspaceId);
      if (error) throw new Error(`snapshot invalidation failed: ${error.message}`);
      await syncContactList(admin, args.workspaceId, args.source);
    }
  }

  console.log("\n=== Resultado ===");
  console.log(JSON.stringify({
    dryRun: !args.apply,
    startIndex: args.startIndex,
    checked: checked.length,
    duplicates: duplicates.length,
    updates: updates.length,
    sampleDuplicates: duplicates.slice(0, 10).map((item) => ({
      eccosysCrmId: item.eccosysRow.id,
      eccosysOrderId: item.eccosysOrderId,
      eccosysNumeroPedido: item.eccosysRow.numero_pedido,
      preferredCode: item.preferredCode,
      matchedCode: item.matchedCode,
      matched: item.matchedRows.slice(0, 3).map((row) => ({
        id: row.id,
        source: row.source,
        source_order_id: row.source_order_id,
        numero_pedido: row.numero_pedido,
        email: row.email,
        data_compra: row.data_compra,
        valor: row.valor,
      })),
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

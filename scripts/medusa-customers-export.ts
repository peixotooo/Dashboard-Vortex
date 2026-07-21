/**
 * medusa-customers-export.ts
 * Exporta os CLIENTES da loja VNDA pro JSON que o importador do Medusa lê
 * (migração de plataforma VNDA → Medusa).
 *
 * Uso:
 *   npx tsx scripts/medusa-customers-export.ts --dry
 *   npx tsx scripts/medusa-customers-export.ts --limit 500
 *   npx tsx scripts/medusa-customers-export.ts                # tudo (~58k)
 *   npx tsx scripts/medusa-customers-export.ts --discover-tags # só tally de tags
 *
 * Saída: output/medusa/customers-export.json  (NÃO versionar — dado pessoal)
 *
 * ── CREDENCIAIS ────────────────────────────────────────────────────────────
 * Não vêm de env: saem da tabela `vnda_connections` do Supabase (api_token
 * criptografado com AES-256-GCM, chave `ENCRYPTION_KEY`), igual ao resto do
 * dashboard. Fallback: VNDA_API_TOKEN + VNDA_STORE_HOST.
 *
 * ── FORMATOS EMPÍRICOS (probe em 2026-07-21) ──────────────────────────────
 * - GET /api/v2/clients?page=N&per_page=100 → ARRAY direto; header X-Pagination
 *   = {"total_pages","total_count","current_page","prev_page","next_page"}.
 *   Conta Bulking: 57.941 clientes.
 * - NUNCA usar `tags` como QUERY no search da VNDA (HTTP 500). Aqui lemos a
 *   LISTAGEM e as tags vêm no próprio objeto do cliente — sem 2ª chamada.
 * - `tags` vem ora como string[] , ora como "a,b,c", ora null.
 * - Campos do cliente: id, email, first_name, last_name, phone, phone_area,
 *   cpf, cnpj, birthdate, gender, tags, recent_address, updated_at,
 *   orders_total, confirmed_orders_count… (+ auth_token e renew_password, que
 *   NUNCA são exportados).
 * - NÃO existe `created_at` no cliente da VNDA. A única data disponível é
 *   `updated_at` — exportada como `updated_at` e usada como aproximação de
 *   "data de cadastro" (o campo `created_at` do contrato recebe null quando a
 *   VNDA não informa; ver docs/import-clientes-pedidos.md).
 * - Endereço: `recent_address` traz o endereço completo (street_name,
 *   street_number, complement, neighborhood, city, state, zip, reference).
 *   `GET /clients/{id}/addresses` responde 200 mas veio vazio nos testes — não
 *   dependemos dele.
 *
 * ── LGPD ───────────────────────────────────────────────────────────────────
 * Clientes com a tag `solicitacao-esquecimento` (direito ao esquecimento) são
 * PULADOS: pediram apagamento, não podem ser recriados na plataforma nova.
 */
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const CONTRACT_VERSION = 1;
const WORKSPACE_ID = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04"; // Bulking
const PER_PAGE = 100;
const THROTTLE_MS = 180;
const MAX_RETRIES = 5;
const OUT_DIR = path.join(process.cwd(), "output", "medusa");
const OUT_FILE = path.join(OUT_DIR, "customers-export.json");

/** Tag de cliente → customer_group do Medusa. Nomes reais medidos na conta. */
const TAG_TO_GROUP: Record<string, string> = {
  "bulking-club": "club",
  "team-bulking": "team",
};

/** Direito ao esquecimento (LGPD): não exportar. */
const FORGET_TAG = "solicitacao-esquecimento";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- tipos ----------
interface VndaRecentAddress {
  street_name?: string | null;
  street_number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  reference?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  first_phone?: string | null;
  first_phone_area?: string | null;
}

interface VndaClientRaw {
  id?: number;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  phone_area?: string | null;
  tags?: unknown;
  recent_address?: VndaRecentAddress | null;
  updated_at?: string | null;
  orders_total?: number | null;
  confirmed_orders_count?: number | null;
}

interface ExportAddress {
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  address_1: string | null;
  address_2: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  country_code: string;
  phone: string | null;
  is_default_shipping: boolean;
  is_default_billing: boolean;
  metadata: Record<string, unknown> | null;
}

interface ExportCustomer {
  vnda_id: number | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  created_at: string | null;
  updated_at: string | null;
  tags: string[];
  groups: string[];
  addresses: ExportAddress[];
}

// ---------- credenciais ----------
function decryptToken(payload: string): string {
  const key = Buffer.from((process.env.ENCRYPTION_KEY || "").trim(), "hex");
  const [ivHex, tagHex, dataHex] = payload.split(":");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return (
    decipher.update(Buffer.from(dataHex, "hex")).toString("utf8") +
    decipher.final("utf8")
  );
}

async function getVndaConfig(): Promise<{ token: string; host: string }> {
  const envToken = process.env.VNDA_API_TOKEN?.trim();
  const envHost = process.env.VNDA_STORE_HOST?.trim();
  if (envToken && envHost) return { token: envToken, host: envHost };

  const db = createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim(),
    (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
    { auth: { persistSession: false } },
  );
  const { data, error } = await db
    .from("vnda_connections")
    .select("api_token, store_host")
    .eq("workspace_id", WORKSPACE_ID)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error(
      `Sem conexão VNDA no Supabase (workspace ${WORKSPACE_ID}): ${error?.message ?? "não encontrada"}. ` +
        `Alternativa: exportar VNDA_API_TOKEN e VNDA_STORE_HOST no ambiente.`,
    );
  }
  return { token: decryptToken(data.api_token), host: data.store_host };
}

// ---------- HTTP ----------
interface Pagination {
  total_pages?: number;
  total_count?: number;
  current_page?: number;
  next_page?: boolean;
}

async function vndaGetClients(
  cfg: { token: string; host: string },
  page: number,
): Promise<{ rows: VndaClientRaw[]; pagination: Pagination | null }> {
  const url = `https://api.vnda.com.br/api/v2/clients?page=${page}&per_page=${PER_PAGE}`;
  const headers = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: "application/json",
    "X-Shop-Host": cfg.host,
  };

  let lastErr = "";
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, { headers });

    if (res.ok) {
      const body = await res.json();
      let pagination: Pagination | null = null;
      const raw = res.headers.get("x-pagination");
      if (raw) {
        try {
          pagination = JSON.parse(raw) as Pagination;
        } catch {
          /* header malformado — seguimos pelo tamanho da página */
        }
      }
      return { rows: Array.isArray(body) ? body : [], pagination };
    }

    // 4xx (fora 429) é fatal: token errado, permissão, rota inválida.
    if (res.status < 500 && res.status !== 429) {
      throw new Error(`GET /clients page=${page} → HTTP ${res.status}`);
    }

    lastErr = `HTTP ${res.status}`;
    await sleep(Math.min(8000, 500 * 2 ** (attempt - 1)));
  }

  throw new Error(`GET /clients page=${page} falhou após ${MAX_RETRIES}: ${lastErr}`);
}

// ---------- normalização ----------
function normTags(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  return [
    ...new Set(
      list
        .map((t) => (typeof t === "string" ? t.trim().toLowerCase() : ""))
        .filter(Boolean),
    ),
  ];
}

function joinPhone(area?: string | null, number?: string | null): string | null {
  const a = (area ?? "").replace(/\D/g, "");
  const n = (number ?? "").replace(/\D/g, "");
  if (!n) return null;
  const full = `${a}${n}`;
  // 10-11 dígitos = telefone BR com DDD → E.164.
  if (full.length >= 10 && full.length <= 11) return `+55${full}`;
  return full;
}

function toAddress(
  a: VndaRecentAddress | null | undefined,
): ExportAddress | null {
  if (!a) return null;
  const street = (a.street_name ?? "").trim();
  const number = (a.street_number ?? "").trim();
  if (!street && !a.zip) return null;

  return {
    first_name: a.first_name?.trim() || null,
    last_name: a.last_name?.trim() || null,
    company: a.company_name?.trim() || null,
    // O Medusa não tem campo de "número": vai junto no address_1, como a loja
    // já monta no checkout.
    address_1: [street, number].filter(Boolean).join(", ") || null,
    address_2: a.complement?.trim() || null,
    city: a.city?.trim() || null,
    province: a.state?.trim()?.toUpperCase() || null,
    postal_code: a.zip?.replace(/\D/g, "") || null,
    country_code: "br",
    phone: joinPhone(a.first_phone_area, a.first_phone),
    is_default_shipping: true,
    is_default_billing: true,
    // Bairro e referência não têm campo no Medusa — preservados no metadata
    // (o checkout BR usa bairro pro cálculo de frete).
    metadata: {
      neighborhood: a.neighborhood?.trim() || null,
      reference: a.reference?.trim() || null,
      street_number: number || null,
    },
  };
}

function normalizeClient(c: VndaClientRaw): ExportCustomer | null {
  const email = (c.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) return null;

  const tags = normTags(c.tags);
  if (tags.includes(FORGET_TAG)) return null; // LGPD

  const groups = [
    ...new Set(tags.map((t) => TAG_TO_GROUP[t]).filter(Boolean)),
  ];

  const address = toAddress(c.recent_address);

  return {
    vnda_id: typeof c.id === "number" ? c.id : null,
    email,
    first_name: c.first_name?.trim() || null,
    last_name: c.last_name?.trim() || null,
    phone: joinPhone(c.phone_area, c.phone),
    // A VNDA não expõe data de cadastro do cliente (só updated_at).
    created_at: null,
    updated_at: c.updated_at ?? null,
    tags,
    groups,
    addresses: address ? [address] : [],
  };
}

// ---------- CLI ----------
interface Args {
  limit: number | null;
  dry: boolean;
  discoverTags: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let limit: number | null = null;
  let dry = false;
  let discoverTags = false;

  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--dry") dry = true;
    else if (t === "--discover-tags") discoverTags = true;
    else if (t === "--limit") limit = Number(argv[++i]);
    else if (t.startsWith("--limit=")) limit = Number(t.split("=")[1]);
    else throw new Error(`Argumento desconhecido: ${t}`);
  }

  if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error("--limit precisa ser inteiro > 0");
  }
  return { limit, dry, discoverTags };
}

// ---------- main ----------
async function main() {
  const { limit, dry, discoverTags } = parseArgs();
  const cfg = await getVndaConfig();

  console.log(
    `[customers-export] host=${cfg.host} limit=${limit ?? "todos"} dry=${dry}`,
  );

  const customers: ExportCustomer[] = [];
  const tagTally = new Map<string, number>();
  let totalCount: number | null = null;
  let totalPages: number | null = null;
  let seen = 0;
  let skippedNoEmail = 0;
  let skippedLgpd = 0;
  let withAddress = 0;

  for (let page = 1; ; page++) {
    const { rows, pagination } = await vndaGetClients(cfg, page);

    if (pagination) {
      totalCount ??= pagination.total_count ?? null;
      totalPages ??= pagination.total_pages ?? null;
    }

    for (const raw of rows) {
      seen++;
      for (const t of normTags(raw.tags)) {
        tagTally.set(t, (tagTally.get(t) ?? 0) + 1);
      }

      if (discoverTags) continue;

      const c = normalizeClient(raw);
      if (!c) {
        if (normTags(raw.tags).includes(FORGET_TAG)) skippedLgpd++;
        else skippedNoEmail++;
        continue;
      }
      if (c.addresses.length) withAddress++;
      customers.push(c);
    }

    const done =
      rows.length === 0 ||
      (pagination?.next_page === false) ||
      (totalPages !== null && page >= totalPages) ||
      (limit !== null && (discoverTags ? seen : customers.length) >= limit);

    if (page % 25 === 0 || done) {
      console.log(
        `  página ${page}${totalPages ? `/${totalPages}` : ""} — ${seen} lidos, ${customers.length} exportáveis`,
      );
    }
    if (done) break;

    await sleep(THROTTLE_MS);
  }

  const tags = [...tagTally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count, group: TAG_TO_GROUP[tag] ?? null }));

  if (discoverTags) {
    console.log(`\nTAGS DE CLIENTE (amostra de ${seen}):`);
    for (const t of tags) {
      console.log(
        `  ${String(t.count).padStart(6)}  ${t.tag}${t.group ? `  → grupo "${t.group}"` : ""}`,
      );
    }
    return;
  }

  const trimmed = limit !== null ? customers.slice(0, limit) : customers;

  const payload = {
    version: CONTRACT_VERSION,
    exported_at: new Date().toISOString(),
    source: "vnda_api:/api/v2/clients",
    store_host: cfg.host,
    stats: {
      vnda_total_count: totalCount,
      lidos: seen,
      exportados: trimmed.length,
      pulados_sem_email: skippedNoEmail,
      pulados_lgpd: skippedLgpd,
      com_endereco: withAddress,
      por_grupo: {
        club: trimmed.filter((c) => c.groups.includes("club")).length,
        team: trimmed.filter((c) => c.groups.includes("team")).length,
      },
      tags_encontradas: tags,
    },
    customers: trimmed,
  };

  console.log(`\n[customers-export] ${JSON.stringify(payload.stats, null, 2)}`);

  if (dry) {
    console.log("\n[dry] nada foi escrito em disco.");
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");
  console.log(`\n✓ ${OUT_FILE} (${trimmed.length} clientes)`);
}

main().catch((err) => {
  console.error(`[customers-export] ERRO: ${err?.message ?? err}`);
  process.exitCode = 1;
});

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { eccosys } from "@/lib/eccosys/client";
import type { EccosysEstoque } from "@/types/hub";

export const maxDuration = 300;

const MEDUSA_PAGE_SIZE = 200;
const UPDATE_CONCURRENCY = 4;
const SAFETY_MARGIN_MS = 30_000;

// Snapshot mode (?source=snapshot) reads the local Medusa catalog export instead
// of calling the Eccosys API — used for local end-to-end testing without the ERP.
const SNAPSHOT_DIR = path.join(process.cwd(), "output", "medusa");
const DEFAULT_SNAPSHOT_FILE = "catalog-export.json";
const SAFE_SNAPSHOT_FILE_RE = /^[a-zA-Z0-9._-]+\.json$/;

interface MedusaLocationLevel {
  location_id: string;
  stocked_quantity: number;
}

interface MedusaInventoryItem {
  id: string;
  sku: string | null;
  location_levels?: MedusaLocationLevel[] | null;
}

interface MedusaListResponse {
  inventory_items: MedusaInventoryItem[];
  count: number;
  offset: number;
  limit: number;
}

interface MedusaConfig {
  baseUrl: string;
  authHeader: string;
}

interface StockDiff {
  inventory_item_id: string;
  location_id: string;
  sku: string;
  from: number;
  to: number;
}

interface SnapshotVariant {
  sku?: unknown;
  stock?: unknown;
}

interface SnapshotCatalog {
  products?: Array<{ variants?: SnapshotVariant[] }>;
}

function intEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Clamp to >= 0 and truncate to integer. */
function normalizeStock(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.trunc(n);
}

function getMedusaConfig(): MedusaConfig | null {
  const baseUrl = (process.env.MEDUSA_BACKEND_URL || "").replace(/\/+$/, "");
  const apiKey = process.env.MEDUSA_ADMIN_API_KEY;
  if (!baseUrl || !apiKey) return null;
  // Medusa secret API keys authenticate via HTTP Basic: base64("sk_...:").
  // Confirmed empirically against Medusa v2 local — Bearer returns 401.
  const authHeader = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
  return { baseUrl, authHeader };
}

async function medusaGet<T>(config: MedusaConfig, pathAndQuery: string): Promise<T> {
  const res = await fetch(`${config.baseUrl}${pathAndQuery}`, {
    headers: { Authorization: config.authHeader },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Medusa GET ${pathAndQuery} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

async function medusaUpdateLevel(config: MedusaConfig, diff: StockDiff): Promise<void> {
  // Confirmed shape on Medusa v2 local: POST /admin/inventory-items/{id}/location-levels/{location_id}
  // with body {stocked_quantity: N} → 200.
  const res = await fetch(
    `${config.baseUrl}/admin/inventory-items/${encodeURIComponent(diff.inventory_item_id)}/location-levels/${encodeURIComponent(diff.location_id)}`,
    {
      method: "POST",
      headers: { Authorization: config.authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ stocked_quantity: diff.to }),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Medusa ${res.status}: ${text.slice(0, 300)}`);
  }
}

async function loadSnapshotStockMap(fileName: string): Promise<Map<string, number>> {
  if (!SAFE_SNAPSHOT_FILE_RE.test(fileName)) {
    throw new Error(`snapshot_file invalido: "${fileName}" (apenas nome de arquivo .json, sem path)`);
  }
  const raw = await readFile(path.join(SNAPSHOT_DIR, fileName), "utf8");
  const parsed = JSON.parse(raw) as SnapshotCatalog;
  const map = new Map<string, number>();
  for (const product of parsed.products || []) {
    for (const variant of product.variants || []) {
      if (typeof variant.sku === "string" && variant.sku) {
        map.set(variant.sku, normalizeStock(variant.stock));
      }
    }
  }
  return map;
}

async function loadEccosysStockMap(): Promise<Map<string, number>> {
  const stocks = await eccosys.listAll<EccosysEstoque>("/estoques", undefined, {}, 100);
  const map = new Map<string, number>();
  for (const es of stocks) {
    if (typeof es.codigo === "string" && es.codigo) {
      map.set(es.codigo, normalizeStock(es.estoqueDisponivel));
    }
  }
  return map;
}

/**
 * GET — Cron: sync stock Eccosys → Medusa (loja nova).
 * Source of truth: Eccosys estoqueDisponivel por codigo (SKU).
 * Target: Medusa inventory levels (assume 1 stock location; first level).
 *
 * Query params:
 *   ?dry=1              — compute diffs, write nothing
 *   ?force=1            — bypass the mass-diff safety guard
 *   ?source=snapshot    — read stock from local catalog export instead of Eccosys (testing)
 *   ?snapshot_file=x.json — alternate snapshot file inside output/medusa/ (testing)
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const deadlineAt = startedAt + maxDuration * 1000 - SAFETY_MARGIN_MS;
  const timeLeft = () => deadlineAt - Date.now();

  const { searchParams } = new URL(request.url);
  const dry = searchParams.get("dry") === "1";
  const force = searchParams.get("force") === "1";
  const source = searchParams.get("source") === "snapshot" ? "snapshot" : "eccosys";
  const snapshotFile = searchParams.get("snapshot_file") || DEFAULT_SNAPSHOT_FILE;

  const minCodes = intEnv("MEDUSA_STOCK_SYNC_MIN_CODES", 1000);
  const maxDiffPct = intEnv("MEDUSA_STOCK_SYNC_MAX_DIFF_PCT", 40);

  const config = getMedusaConfig();
  if (!config) {
    return NextResponse.json(
      { ok: false, error: "MEDUSA_BACKEND_URL / MEDUSA_ADMIN_API_KEY nao configurados" },
      { status: 500 }
    );
  }

  const base = { dry, source, duration_ms: 0 };

  // --- 1. Source stock map (Eccosys ou snapshot local) ---
  let sourceStock: Map<string, number>;
  try {
    sourceStock = source === "snapshot" ? await loadSnapshotStockMap(snapshotFile) : await loadEccosysStockMap();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    console.error(`[medusa-stock-sync] Falha ao carregar estoque (${source}): ${msg}`);
    return NextResponse.json(
      { ...base, ok: false, aborted: true, reason: `source_fetch_failed: ${msg}`, duration_ms: Date.now() - startedAt },
      { status: 502 }
    );
  }

  // --- Trava 1: resposta parcial do ERP nao pode zerar a loja ---
  if (sourceStock.size < minCodes) {
    const reason = `min_codes: fonte (${source}) devolveu ${sourceStock.size} codigos < MEDUSA_STOCK_SYNC_MIN_CODES=${minCodes} — abortado sem escrever`;
    console.error(`[medusa-stock-sync] ABORT ${reason}`);
    return NextResponse.json({
      ...base,
      ok: false,
      aborted: true,
      reason,
      eccosys_codes: sourceStock.size,
      duration_ms: Date.now() - startedAt,
    });
  }

  // --- 2. Medusa inventory items (paginado) ---
  const medusaItems: MedusaInventoryItem[] = [];
  let offset = 0;
  let partial = false;
  try {
    while (true) {
      if (timeLeft() <= 0) {
        partial = true;
        break;
      }
      const page = await medusaGet<MedusaListResponse>(
        config,
        `/admin/inventory-items?limit=${MEDUSA_PAGE_SIZE}&offset=${offset}&fields=id,sku,*location_levels`
      );
      medusaItems.push(...page.inventory_items);
      offset += page.inventory_items.length;
      if (page.inventory_items.length === 0 || offset >= page.count) break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    console.error(`[medusa-stock-sync] Falha ao listar inventory-items do Medusa: ${msg}`);
    return NextResponse.json(
      { ...base, ok: false, aborted: true, reason: `medusa_list_failed: ${msg}`, duration_ms: Date.now() - startedAt },
      { status: 502 }
    );
  }

  if (partial) {
    // Sem tempo para o diff/updates com margem de seguranca — proxima rodada recomeca (idempotente).
    console.warn(`[medusa-stock-sync] PARTIAL: deadline atingido listando Medusa em offset=${offset}`);
    return NextResponse.json({
      ...base,
      ok: false,
      partial: true,
      cursor: offset,
      checked_medusa: medusaItems.length,
      eccosys_codes: sourceStock.size,
      reason: "deadline durante listagem do Medusa — proxima rodada continua",
      duration_ms: Date.now() - startedAt,
    });
  }

  // --- 3. Diff ---
  const diffs: StockDiff[] = [];
  const matchedCodes = new Set<string>();
  const missingInEccosysSample: string[] = [];
  let missingInEccosys = 0;
  let skippedNoSku = 0;
  let skippedNoLevel = 0;

  for (const item of medusaItems) {
    if (!item.sku) {
      skippedNoSku++;
      continue;
    }
    const desired = sourceStock.get(item.sku);
    if (desired === undefined) {
      // SKU existe no Medusa mas nao veio do Eccosys → NAO tocar.
      missingInEccosys++;
      if (missingInEccosysSample.length < 20) missingInEccosysSample.push(item.sku);
      continue;
    }
    matchedCodes.add(item.sku);
    const level = item.location_levels?.[0];
    if (!level) {
      skippedNoLevel++;
      continue;
    }
    if (level.stocked_quantity !== desired) {
      diffs.push({
        inventory_item_id: item.id,
        location_id: level.location_id,
        sku: item.sku,
        from: level.stocked_quantity,
        to: desired,
      });
    }
  }

  const missingInMedusa = sourceStock.size - matchedCodes.size;

  // --- Trava 2: mudanca em massa suspeita ---
  const diffPct = medusaItems.length > 0 ? (diffs.length / medusaItems.length) * 100 : 0;
  if (diffPct > maxDiffPct && !force) {
    const reason = `max_diff_pct: ${diffs.length} diffs = ${diffPct.toFixed(1)}% dos ${medusaItems.length} SKUs do Medusa (> ${maxDiffPct}%) — mudanca em massa suspeita; confirme e re-execute com ?force=1`;
    console.error(`[medusa-stock-sync] ABORT ${reason}`);
    return NextResponse.json({
      ...base,
      ok: false,
      aborted: true,
      reason,
      checked_medusa: medusaItems.length,
      eccosys_codes: sourceStock.size,
      diffs: diffs.length,
      missing_in_eccosys: missingInEccosys,
      missing_in_medusa: missingInMedusa,
      duration_ms: Date.now() - startedAt,
    });
  }

  // --- 4. Updates (concorrencia 4) ---
  let updated = 0;
  let failed = 0;
  const failedDetails: string[] = [];
  let updatePartial = false;

  if (!dry && diffs.length > 0) {
    let cursor = 0;
    const worker = async () => {
      while (true) {
        if (timeLeft() <= 0) {
          updatePartial = true;
          return;
        }
        const index = cursor++;
        if (index >= diffs.length) return;
        const diff = diffs[index];
        try {
          await medusaUpdateLevel(config, diff);
          updated++;
        } catch (err) {
          failed++;
          const msg = err instanceof Error ? err.message : "Erro desconhecido";
          if (failedDetails.length < 20) failedDetails.push(`${diff.sku}: ${msg}`);
          console.error(`[medusa-stock-sync] Erro SKU ${diff.sku}: ${msg}`);
        }
      }
    };
    await Promise.all(Array.from({ length: UPDATE_CONCURRENCY }, () => worker()));
  }

  const durationMs = Date.now() - startedAt;
  const summary = {
    ok: failed === 0 && !updatePartial,
    dry,
    source,
    checked_medusa: medusaItems.length,
    eccosys_codes: sourceStock.size,
    diffs: diffs.length,
    diffs_sample: diffs.slice(0, 20).map((d) => ({ sku: d.sku, from: d.from, to: d.to })),
    updated,
    failed,
    failed_details: failedDetails,
    missing_in_eccosys: missingInEccosys,
    missing_in_eccosys_sample: missingInEccosysSample,
    missing_in_medusa: missingInMedusa,
    skipped_no_sku: skippedNoSku,
    skipped_no_level: skippedNoLevel,
    ...(updatePartial ? { partial: true, reason: "deadline durante updates — proxima rodada continua (idempotente)" } : {}),
    duration_ms: durationMs,
  };

  console.log(
    `[medusa-stock-sync] Done: source=${source} dry=${dry} medusa=${medusaItems.length} eccosys=${sourceStock.size} diffs=${diffs.length} updated=${updated} failed=${failed} missing_ecc=${missingInEccosys} missing_medusa=${missingInMedusa} partial=${updatePartial} duration=${durationMs}ms`
  );

  return NextResponse.json(summary);
}

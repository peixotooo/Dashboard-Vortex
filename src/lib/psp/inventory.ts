import type { SupabaseClient } from "@supabase/supabase-js";
import { eccosys } from "@/lib/eccosys/client";
import type { EccosysEstoque } from "@/types/hub";

const UPSERT_CHUNK_SIZE = 500;

type InventorySnapshotRow = {
  workspace_id: string;
  sku: string;
  parent_sku: string;
  product_id: string | null;
  name: string | null;
  stock_real: number;
  stock_available: number;
  source: "eccosys";
  captured_at: string;
};

function parentSkuOf(sku: string): string {
  return sku.trim().replace(/-\d+$/, "");
}

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    out.push(rows.slice(index, index + size));
  }
  return out;
}

export async function persistPspInventorySnapshot(
  client: SupabaseClient,
  workspaceId: string,
  stocks: EccosysEstoque[],
  capturedAt = new Date().toISOString()
): Promise<number> {
  const rowsBySku = new Map<string, InventorySnapshotRow>();
  for (const stock of stocks) {
    const sku = String(stock.codigo ?? "").trim();
    if (!sku) continue;
    rowsBySku.set(sku, {
      workspace_id: workspaceId,
      sku,
      parent_sku: parentSkuOf(sku),
      product_id: stock.idProduto ? String(stock.idProduto) : null,
      name: stock.nome ? String(stock.nome) : null,
      stock_real: Number.isFinite(Number(stock.estoqueReal))
        ? Math.round(Number(stock.estoqueReal))
        : 0,
      stock_available: Number.isFinite(Number(stock.estoqueDisponivel))
        ? Math.round(Number(stock.estoqueDisponivel))
        : 0,
      source: "eccosys",
      captured_at: capturedAt,
    });
  }
  const rows = [...rowsBySku.values()];

  for (const batch of chunks(rows, UPSERT_CHUNK_SIZE)) {
    const { error } = await client
      .from("psp_inventory_snapshots")
      .upsert(batch, { onConflict: "workspace_id,sku" });
    if (error) throw new Error(`PSP inventory snapshot failed: ${error.message}`);
  }
  return rows.length;
}

export async function refreshPspInventorySnapshot(
  client: SupabaseClient,
  workspaceId: string
): Promise<{ count: number; capturedAt: string; eccosysRequests: 1 }> {
  const stocks = await eccosys.listStockBulk<EccosysEstoque>(workspaceId);
  const capturedAt = new Date().toISOString();
  const count = await persistPspInventorySnapshot(client, workspaceId, stocks, capturedAt);
  return { count, capturedAt, eccosysRequests: 1 };
}

export function isMissingPspSchema(error: unknown): boolean {
  const value = error as { code?: string; message?: string } | null;
  const text = `${value?.code ?? ""} ${value?.message ?? ""}`.toLowerCase();
  return (
    text.includes("psp_settings") ||
    text.includes("psp_product_settings") ||
    text.includes("psp_inventory_snapshots")
  ) && (text.includes("schema cache") || text.includes("does not exist") || text.includes("pgrst"));
}

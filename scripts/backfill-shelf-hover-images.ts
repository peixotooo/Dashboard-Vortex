import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { decrypt } from "../src/lib/encryption";
import { createAdminClient } from "../src/lib/supabase-admin";
import {
  pickShelfImages,
  shelfImageKey,
  type VndaCatalogImage,
} from "../src/lib/shelves/image-utils";

interface ShelfRow {
  product_id: string;
  name: string;
  image_url: string | null;
  image_url_2: string | null;
}

const delayMs = Number(process.env.SHELF_HOVER_BACKFILL_DELAY_MS || 2500);
const limit = Number(process.env.SHELF_HOVER_BACKFILL_LIMIT || 0);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasDistinctHover(row: ShelfRow): boolean {
  return !!row.image_url_2 && shelfImageKey(row.image_url_2) !== shelfImageKey(row.image_url);
}

async function fetchImages(args: {
  token: string;
  storeHost: string;
  productId: string;
}): Promise<VndaCatalogImage[]> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(
      `https://api.vnda.com.br/api/v2/products/${encodeURIComponent(args.productId)}/images`,
      {
        headers: {
          Authorization: `Bearer ${args.token}`,
          Accept: "application/json",
          "X-Shop-Host": args.storeHost,
        },
      }
    );

    if (res.status === 429) {
      const wait = 12000 + attempt * 8000;
      console.log(`  429 ${args.productId}; aguardando ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.log(`  erro ${res.status} ${args.productId}: ${text.slice(0, 100)}`);
      return [];
    }

    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as VndaCatalogImage[]) : [];
  }

  return [];
}

async function main() {
  const admin = createAdminClient();
  const workspaceId = process.env.WORKSPACE_ID;
  const { data: ws, error: wsErr } = workspaceId
    ? await admin.from("workspaces").select("id, name").eq("id", workspaceId).single()
    : await admin.from("workspaces").select("id, name").ilike("name", "%bulking%").limit(1).single();
  if (wsErr || !ws) throw new Error(wsErr?.message || "workspace nao encontrado");

  const { data: conn, error: connErr } = await admin
    .from("vnda_connections")
    .select("api_token, store_host")
    .eq("workspace_id", ws.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (connErr || !conn?.api_token || !conn?.store_host) {
    throw new Error(connErr?.message || "conexao VNDA nao encontrada");
  }

  const { data: rowsRaw, error: rowsErr } = await admin
    .from("shelf_products")
    .select("product_id, name, image_url, image_url_2")
    .eq("workspace_id", ws.id)
    .eq("active", true)
    .eq("in_stock", true)
    .order("updated_at", { ascending: false });
  if (rowsErr) throw new Error(rowsErr.message);

  const rows = ((rowsRaw ?? []) as ShelfRow[]).filter((row) => !hasDistinctHover(row));
  const queue = limit > 0 ? rows.slice(0, limit) : rows;
  console.log(`Workspace: ${ws.name} (${ws.id})`);
  console.log(`Produtos ativos sem hover valido: ${rows.length}`);
  console.log(`Processando: ${queue.length} com delay ${delayMs}ms`);

  const token = decrypt(conn.api_token as string);
  let updated = 0;
  let skipped = 0;

  for (const row of queue) {
    const images = await fetchImages({
      token,
      storeHost: conn.store_host as string,
      productId: row.product_id,
    });
    const { imageUrl2 } = pickShelfImages({
      primaryImage: row.image_url,
      images,
    });

    if (imageUrl2) {
      const { error } = await admin
        .from("shelf_products")
        .update({ image_url_2: imageUrl2 })
        .eq("workspace_id", ws.id)
        .eq("product_id", row.product_id);
      if (error) throw new Error(error.message);
      updated++;
      console.log(`  ok ${row.product_id} ${row.name}`);
    } else {
      skipped++;
      console.log(`  sem segunda imagem ${row.product_id} ${row.name}`);
    }

    await sleep(delayMs);
  }

  console.log(`Concluido. Atualizados: ${updated}. Sem segunda imagem: ${skipped}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

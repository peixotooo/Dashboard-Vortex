// src/app/api/crm/email-templates/vnda-search/route.ts
//
// Searches the workspace's local VNDA mirror (shelf_products) by product name
// for the compose page. Returns up to 12 matches as ProductSnapshot-shaped
// objects so the editor can drop them straight into ctx.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

interface ShelfRow {
  product_id: string;
  name: string;
  price: number | null;
  sale_price: number | null;
  image_url: string | null;
  product_url: string | null;
  tags: unknown;
}

function abs(url: string | null): string {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function toSnapshot(row: ShelfRow) {
  const price = Number(row.sale_price ?? row.price ?? 0);
  const old_price =
    row.sale_price != null && row.price != null && Number(row.price) > Number(row.sale_price)
      ? Number(row.price)
      : undefined;
  const tags: string[] = Array.isArray(row.tags)
    ? (row.tags as Array<{ name?: string } | string>)
        .map((t) => (typeof t === "string" ? t : t?.name ?? ""))
        .filter(Boolean)
    : [];
  return {
    vnda_id: row.product_id,
    name: row.name,
    price,
    old_price,
    image_url: abs(row.image_url),
    url: row.product_url ?? "",
    tags,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const term = (new URL(req.url).searchParams.get("q") ?? "").trim();
    const supabase = createAdminClient();
    let query = supabase
      .from("shelf_products")
      .select("product_id, name, price, sale_price, image_url, product_url, tags")
      .eq("workspace_id", workspaceId)
      .eq("active", true)
      .not("image_url", "is", null);
    if (term.length >= 2) {
      query = query.ilike("name", `%${term}%`);
    } else {
      // No query → return latest in-stock products so the library can pick a
      // default sample product without requiring the user to search first.
      query = query.eq("in_stock", true);
    }
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(12);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ products: (data ?? []).map(toSnapshot) });
  } catch (err) {
    return handleAuthError(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";
import type { EccosysProduto } from "@/types/hub";

export const maxDuration = 120;

/**
 * GET — List available Eccosys products (for the operator to choose which to pull).
 * Returns products with `already_in_hub` flag.
 */
export async function GET(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const page = parseInt(searchParams.get("page") || "0", 10);
  const search = searchParams.get("search") || "";
  const pageSize = 50;

  try {
    const params: Record<string, string> = {
      $offset: String(page * pageSize),
      $count: String(pageSize),
      $situacao: "A",
    };
    if (search) {
      params.$filter = search;
    }

    const products = await eccosys.get<EccosysProduto[]>(
      "/produtos",
      workspaceId,
      params
    );

    if (!Array.isArray(products)) {
      return NextResponse.json({ products: [], page, hasMore: false });
    }

    // Check which SKUs are already in hub
    const skus = products.map((p) => p.codigo);
    const supabase = createAdminClient();
    const { data: existing } = await supabase
      .from("hub_products")
      .select("sku")
      .eq("workspace_id", workspaceId)
      .in("sku", skus);

    const existingSkus = new Set((existing || []).map((r) => r.sku));

    const result = products.map((p) => ({
      id: p.id,
      sku: p.codigo,
      nome: p.nome,
      preco: p.preco,
      situacao: p.situacao,
      idProdutoPai: p.idProdutoPai,
      codigoPai: p.codigoPai,
      foto: p.foto1 || null,
      already_in_hub: existingSkus.has(p.codigo),
    }));

    return NextResponse.json({
      products: result,
      page,
      hasMore: products.length === pageSize,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST — Pull selected products from Eccosys into the hub.
 * Body: { skus: string[] } or { ids: number[] }
 */
export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const body = await req.json();
  const productIds: number[] = body.ids || [];

  if (productIds.length === 0) {
    return NextResponse.json(
      { error: "ids (array de IDs Eccosys) obrigatorio" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const results: { sku: string; status: "imported" | "updated" | "error"; error?: string }[] = [];

  for (const eccId of productIds) {
    try {
      // 1. Fetch product details
      const produto = await eccosys.get<EccosysProduto>(
        `/produtos/${eccId}`,
        workspaceId
      );

      // 2. Fetch stock
      let estoque = 0;
      try {
        const estoqueData = await eccosys.get<{ estoqueDisponivel?: number }>(
          `/estoques/${produto.codigo}`,
          workspaceId
        );
        estoque = estoqueData?.estoqueDisponivel ?? 0;
      } catch {
        // Stock endpoint may fail for some products — continue with 0
      }

      // 3. Fetch images (Eccosys returns string[] directly from /imagens)
      let fotos: string[] = [];
      try {
        const imagens = await eccosys.get<unknown>(
          `/produtos/${eccId}/imagens`,
          workspaceId
        );
        if (Array.isArray(imagens)) {
          fotos = imagens
            .map((item) => (typeof item === "string" ? item : (item as { url?: string })?.url))
            .filter((u): u is string => !!u);
        }
      } catch {
        // Fallback to inline photo fields
      }

      // Fallback: use foto1-foto6 from product if no images endpoint
      if (fotos.length === 0) {
        fotos = [
          produto.foto1,
          produto.foto2,
          produto.foto3,
          produto.foto4,
          produto.foto5,
          produto.foto6,
        ].filter((f): f is string => !!f);
      }

      // 4. Fetch attributes (Eccosys uses descricao + valor)
      let atributos: Record<string, string> = {};
      try {
        const attrs = await eccosys.get<Array<{ descricao?: string; nome?: string; valor: string }>>(
          `/produtos/${eccId}/atributos`,
          workspaceId
        );
        if (Array.isArray(attrs)) {
          atributos = Object.fromEntries(
            attrs.map((a) => [a.descricao || a.nome || "", a.valor]).filter(([k]) => !!k)
          );
        }
      } catch {
        // Attributes may not exist for all products
      }

      // 5. Upsert into hub_products
      const row = {
        workspace_id: workspaceId,
        ecc_id: produto.id,
        sku: produto.codigo,
        nome: produto.nome,
        preco: produto.preco,
        preco_promocional: produto.precoPromocional,
        estoque,
        gtin: produto.gtin,
        peso: produto.peso,
        largura: produto.largura,
        altura: produto.altura,
        comprimento: produto.comprimento,
        descricao: produto.descricaoEcommerce,
        fotos,
        situacao: produto.situacao || "A",
        ecc_pai_id: produto.idProdutoPai,
        ecc_pai_sku: produto.codigoPai,
        atributos,
        source: "eccosys" as const,
        sync_status: "draft" as const,
        last_ecc_sync: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { error: upsertError } = await supabase
        .from("hub_products")
        .upsert(row, { onConflict: "workspace_id,sku" });

      if (upsertError) {
        results.push({
          sku: produto.codigo,
          status: "error",
          error: upsertError.message,
        });
      } else {
        results.push({ sku: produto.codigo, status: "imported" });
      }

      // Log success
      await supabase.from("hub_logs").insert({
        workspace_id: workspaceId,
        action: "pull_eccosys",
        entity: "product",
        entity_id: produto.codigo,
        direction: "ecc_to_hub",
        status: upsertError ? "error" : "ok",
        details: upsertError ? { error: upsertError.message } : { ecc_id: eccId },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      results.push({ sku: `id:${eccId}`, status: "error", error: message });

      await supabase.from("hub_logs").insert({
        workspace_id: workspaceId,
        action: "pull_eccosys",
        entity: "product",
        entity_id: String(eccId),
        direction: "ecc_to_hub",
        status: "error",
        details: { error: message },
      });
    }
  }

  const imported = results.filter((r) => r.status === "imported").length;
  const errors = results.filter((r) => r.status === "error").length;

  return NextResponse.json({ imported, errors, results });
}

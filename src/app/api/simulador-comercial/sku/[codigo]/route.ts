import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

function createSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {},
      },
    }
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  try {
    const { codigo } = await params;
    const skuOrCode = decodeURIComponent(codigo).trim();
    if (!skuOrCode) {
      return NextResponse.json({ error: "Código vazio" }, { status: 400 });
    }

    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const { data: shelf, error: shelfError } = await supabase
      .from("shelf_products")
      .select("product_id, sku, name, category, price, sale_price, image_url, in_stock")
      .eq("workspace_id", workspaceId)
      .or(`sku.eq.${skuOrCode},product_id.eq.${skuOrCode}`)
      .limit(1)
      .maybeSingle();

    if (shelfError) {
      console.error("[Commercial Simulator SKU] shelf_products error:", shelfError);
    }

    let nome: string | null = null;
    let precoCheio = 0;
    let salePrice: number | null = null;
    let imagem: string | null = null;
    let categoria: string | null = null;
    let inStock = true;
    let foundShelf = false;

    if (shelf) {
      foundShelf = true;
      nome = shelf.name;
      precoCheio = Number(shelf.price ?? 0);
      salePrice = shelf.sale_price != null ? Number(shelf.sale_price) : null;
      imagem = shelf.image_url ?? null;
      categoria = shelf.category ?? null;
      inStock = shelf.in_stock !== false;
    }

    const { data: hub } = await supabase
      .from("hub_products")
      .select("sku, nome, preco, preco_promocional, estoque")
      .eq("workspace_id", workspaceId)
      .eq("sku", skuOrCode)
      .limit(1)
      .maybeSingle();

    let estoque: number | null = null;
    if (hub) {
      estoque = hub.estoque != null ? Number(hub.estoque) : null;
      if (!foundShelf) {
        nome = hub.nome ?? skuOrCode;
        precoCheio = Number(hub.preco ?? 0);
        salePrice = hub.preco_promocional != null ? Number(hub.preco_promocional) : null;
      }
    }

    if (!foundShelf && !hub) {
      return NextResponse.json({ error: "SKU não encontrado" }, { status: 404 });
    }

    if (precoCheio <= 0) {
      return NextResponse.json({ error: "Produto sem preço cadastrado" }, { status: 422 });
    }

    return NextResponse.json({
      codigo: skuOrCode,
      nome: nome ?? skuOrCode,
      precoCheio,
      salePrice,
      estoque,
      categoria,
      imagem,
      inStock,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

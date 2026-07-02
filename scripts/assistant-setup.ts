// Setup do Assistente de Vendas — habilita o widget para UM produto piloto.
//
// Uso:
//   npx tsx scripts/assistant-setup.ts                    → mostra estado atual (dry-run)
//   npx tsx scripts/assistant-setup.ts --product 1271     → habilita p/ o produto 1271
//   npx tsx scripts/assistant-setup.ts --disable          → desliga o assistente
//
// Requer migration-126-store-assistant.sql aplicada no Supabase.

import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const STORE_INFO_DEFAULT = [
  "Frete: calculado no checkout pelo CEP.",
  "Trocas e devoluções: primeira troca grátis; solicitar pelo portal de trocas da loja (link no rodapé do site). Prazo de arrependimento: 7 dias corridos após o recebimento (CDC).",
  "Pagamento: cartão de crédito, Pix e boleto no checkout.",
].join("\n");

(async () => {
  const args = process.argv.slice(2);
  const disable = args.includes("--disable");
  const productIdx = args.indexOf("--product");
  const productId = productIdx >= 0 ? args[productIdx + 1] : null;

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: conn } = await sb
    .from("vnda_connections")
    .select("workspace_id, store_host")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conn) {
    console.error("Nenhuma vnda_connection encontrada — configure a VNDA primeiro.");
    process.exit(1);
  }
  const ws = conn.workspace_id as string;
  console.log(`workspace: ${ws} (${conn.store_host})`);

  const { data: current, error: readError } = await sb
    .from("assistant_settings")
    .select("*")
    .eq("workspace_id", ws)
    .maybeSingle();

  if (readError) {
    console.error(
      `Erro lendo assistant_settings: ${readError.message}\n` +
        "→ A migration-126-store-assistant.sql já foi aplicada no Supabase?"
    );
    process.exit(1);
  }

  console.log(
    "estado atual:",
    current
      ? { enabled: current.enabled, product_ids: current.product_ids, model: current.model }
      : "(sem linha — desabilitado)"
  );

  if (disable) {
    await sb
      .from("assistant_settings")
      .upsert({ workspace_id: ws, enabled: false, updated_at: new Date().toISOString() });
    console.log("✓ assistente DESLIGADO");
    return;
  }

  if (!productId) {
    console.log("\nDry-run. Para habilitar: npx tsx scripts/assistant-setup.ts --product <ID_VNDA>");
    return;
  }

  if (!/^[\w-]{1,40}$/.test(productId)) {
    console.error(`product_id inválido: ${productId}`);
    process.exit(1);
  }

  // Confere se o produto existe no espelho do catálogo
  const { data: product } = await sb
    .from("shelf_products")
    .select("product_id, name, in_stock")
    .eq("workspace_id", ws)
    .eq("product_id", productId)
    .maybeSingle();
  if (!product) {
    console.error(
      `Produto ${productId} não encontrado em shelf_products — confirme o ID VNDA.`
    );
    process.exit(1);
  }
  console.log(`produto piloto: ${product.name} (in_stock=${product.in_stock})`);

  const { error } = await sb.from("assistant_settings").upsert(
    {
      workspace_id: ws,
      enabled: true,
      product_ids: [productId],
      store_info: current?.store_info?.trim() ? current.store_info : STORE_INFO_DEFAULT,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" }
  );
  if (error) {
    console.error("Falha ao salvar:", error.message);
    process.exit(1);
  }

  console.log(`✓ assistente HABILITADO para o produto ${productId}`);
  console.log("  (config pública propaga em ~2min por causa do cache do CDN)");
  console.log("  Teste na PDP e acompanhe as conversas em /assistente no dashboard.");
})();

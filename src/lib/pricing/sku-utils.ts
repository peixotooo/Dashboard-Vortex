// Normalização de SKU pra agrupamento por referência pai.
//
// shelf_products.sku usa a referência sem variação de tamanho (ex: "256391234").
// CSV, Eccosys /estoques e crm_vendas.items[] usam SKU com sufixo de tamanho
// (ex: "256391234-1", "256391234-2", ...). Pra cruzar dessas fontes com o
// shelf, removemos o sufixo "-N" e agregamos.

export function baseSkuOf(sku: string | null | undefined): string {
  if (!sku) return "";
  return String(sku).replace(/-\d+$/, "");
}

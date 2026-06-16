/**
 * Categoria-padrão de vestuário no Mercado Livre para os produtos da Bulking
 * (todos camisetas/regatas).
 *
 * O `domain_discovery` / `category_predictor` do ML às vezes devolve a
 * categoria-GÊMEA de MERCHANDISING como 1ª predição: ela tem o mesmo nome de
 * folha ("Camisetas e Regatas"), mas fica numa árvore errada
 * ("Indústria e Comércio > Publicidade e Promoção > Merchandising"), o que faz o
 * anúncio ser classificado como brinde promocional em vez de vestuário.
 *
 * Como a categoria NÃO pode ser alterada depois do anúncio publicado, o default
 * precisa estar certo ANTES do push. Por isso forçamos a categoria de vestuário
 * como padrão e remapeamos a gêmea de merchandising.
 */

// Calçados, Roupas e Bolsas > Camisetas e Regatas (vestuário — a correta)
export const DEFAULT_ML_CATEGORY_ID = "MLB31447";

// Indústria e Comércio > Publicidade e Promoção > Merchandising > Camisetas e Regatas
export const MERCHANDISING_TSHIRT_CATEGORY_ID = "MLB439327";

export const DEFAULT_ML_CATEGORY = {
  category_id: DEFAULT_ML_CATEGORY_ID,
  name: "Camisetas e Regatas",
  path: "Calçados, Roupas e Bolsas > Camisetas e Regatas",
  probability: "default",
};

/**
 * Normaliza uma categoria ML para publicação: cai no default de vestuário
 * quando a categoria está vazia ou quando é a gêmea de merchandising.
 */
export function resolveMlCategoryId(raw?: string | null): string {
  if (!raw || raw === MERCHANDISING_TSHIRT_CATEGORY_ID) {
    return DEFAULT_ML_CATEGORY_ID;
  }
  return raw;
}

/**
 * Sanitização de atributos do ML antes de publicar.
 *
 * PROBLEMA: o enrichment (import-family) copia atributos de um anúncio ML de
 * referência (cross-ref) da mesma categoria. O atributo de COR vem junto e fica
 * ERRADO — ex.: uma regata BRANCA herdando COLOR="Preto" da referência preta.
 * Resultado: títulos como "Regata Full Heavy Branca Preta".
 *
 * A cor real NÃO existe nos atributos do Eccosys — só no NOME do produto
 * ("REGATA FULL HEAVY BRANCA"). Então derivamos a cor do nome e corrigimos o
 * atributo COLOR antes de qualquer publicação. Se o nome não tiver cor
 * reconhecível, deixamos o atributo como está (não inventamos cor).
 *
 * Os valores de destino são apenas os ACEITOS pelo ML em camisetas/regatas
 * (categoria MLB31447, atributo COLOR — 51 valores). Cores PT sem equivalente
 * exato caem no mais próximo válido (ex.: "chumbo" -> "Cinza-escuro").
 */

// token PT (sem acento, minúsculo) -> valor de COLOR aceito pelo ML.
// Tokens compostos (multi-palavra) e a desambiguação por posição no nome são
// tratados em detectColorFromName (não dependa da ordem deste array).
const COLOR_TOKENS: Array<[string, string]> = [
  // compostos
  ["off white", "Creme"],
  ["off-white", "Creme"],
  ["azul marinho", "Azul-marinho"],
  ["azul claro", "Azul-claro"],
  ["azul escuro", "Azul-escuro"],
  ["azul petroleo", "Azul-petróleo"],
  ["azul turquesa", "Azul-turquesa"],
  ["azul celeste", "Azul-celeste"],
  ["verde militar", "Verde-musgo"],
  ["verde musgo", "Verde-musgo"],
  ["verde claro", "Verde-claro"],
  ["verde escuro", "Verde-escuro"],
  ["verde limao", "Verde-limão"],
  ["cinza escuro", "Cinza-escuro"],
  ["cinza claro", "Cinza"],
  ["marrom claro", "Marrom-claro"],
  ["marrom escuro", "Marrom-escuro"],
  ["rosa claro", "Rosa-claro"],
  // simples
  ["preta", "Preto"],
  ["preto", "Preto"],
  ["branca", "Branco"],
  ["branco", "Branco"],
  ["gelo", "Branco"],
  ["off", "Creme"],
  ["mescla", "Cinza"],
  ["cinza", "Cinza"],
  ["chumbo", "Cinza-escuro"],
  ["grafite", "Cinza-escuro"],
  ["azul", "Azul"],
  ["turquesa", "Azul-turquesa"],
  ["celeste", "Azul-celeste"],
  ["indigo", "Índigo"],
  ["ciano", "Ciano"],
  ["verde", "Verde"],
  ["oliva", "Verde-musgo"],
  ["vermelha", "Vermelho"],
  ["vermelho", "Vermelho"],
  ["amarela", "Amarelo"],
  ["amarelo", "Amarelo"],
  ["mostarda", "Ocre"],
  ["ocre", "Ocre"],
  ["laranja", "Laranja"],
  ["coral", "Coral"],
  ["salmao", "Coral"],
  ["rosa", "Rosa"],
  ["pink", "Rosa"],
  ["fucsia", "Fúcsia"],
  ["roxa", "Violeta"],
  ["roxo", "Violeta"],
  ["violeta", "Violeta"],
  ["lilas", "Lilás"],
  ["lavanda", "Lavanda"],
  ["marrom", "Marrom"],
  ["caramelo", "Marrom-claro"],
  ["chocolate", "Chocolate"],
  ["caqui", "Cáqui"],
  ["bege", "Bege"],
  ["areia", "Bege"],
  ["nude", "Nude"],
  ["creme", "Creme"],
  ["palha", "Palha"],
  ["bordo", "Bordô"],
  ["vinho", "Bordô"],
  ["terracota", "Terracota"],
  ["dourado", "Dourado"],
  ["dourada", "Dourado"],
  ["prata", "Prateado"],
  ["prateado", "Prateado"],
  ["prateada", "Prateado"],
];

// Domínio do MAIN_COLOR é MENOR (16 valores) e diferente do COLOR. Mapeamos
// cada valor de COLOR para a base válida em MAIN_COLOR; só usamos isso pra
// CORRIGIR um MAIN_COLOR já preenchido (nunca preencher um vazio com inválido).
const MAIN_COLOR_VALUES = new Set([
  "Preto", "Azul", "Vermelho", "Violeta", "Marrom", "Verde", "Laranja",
  "Azul celeste", "Rosa", "Dourado", "Prateado", "Amarelo", "Cinza",
  "Branco", "Multicolorido", "Bege",
]);
const MAIN_COLOR_BASE: Record<string, string> = {
  Preto: "Preto", Branco: "Branco", Cinza: "Cinza", "Cinza-escuro": "Cinza",
  Azul: "Azul", "Azul-marinho": "Azul", "Azul-claro": "Azul", "Azul-escuro": "Azul",
  "Azul-petróleo": "Azul", "Azul-turquesa": "Azul", "Azul-aço": "Azul",
  "Azul-celeste": "Azul celeste", "Índigo": "Azul", Ciano: "Azul", "Água": "Azul",
  Verde: "Verde", "Verde-musgo": "Verde", "Verde-claro": "Verde",
  "Verde-escuro": "Verde", "Verde-limão": "Verde",
  Vermelho: "Vermelho", "Bordô": "Vermelho",
  Amarelo: "Amarelo", Ocre: "Amarelo", Palha: "Amarelo",
  Laranja: "Laranja", Coral: "Laranja", "Coral-claro": "Laranja",
  "Laranja-claro": "Laranja", "Laranja-escuro": "Laranja",
  Rosa: "Rosa", "Rosa-claro": "Rosa", "Rosa-pálido": "Rosa",
  "Rosa-chiclete": "Rosa", "Fúcsia": "Rosa",
  Violeta: "Violeta", "Violeta-escuro": "Violeta", Lavanda: "Violeta", "Lilás": "Violeta",
  Marrom: "Marrom", "Marrom-claro": "Marrom", "Marrom-escuro": "Marrom",
  Chocolate: "Marrom", "Cáqui": "Marrom", Terracota: "Marrom",
  Bege: "Bege", Nude: "Bege", Creme: "Bege",
  Dourado: "Dourado", "Dourado-escuro": "Dourado", Prateado: "Prateado",
};

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Detecta a cor a partir do nome do produto. Retorna o valor de COLOR aceito
 * pelo ML, ou null se o nome não contiver nenhuma cor reconhecível.
 *
 * Desambiguação: quando há mais de uma cor no nome (ex.: bicolor ou o título
 * corrompido "Branca Preta"), vence a cor que aparece PRIMEIRO no nome — que em
 * nomes PT é quase sempre a cor real do produto. Empate (mesma posição) vence o
 * token mais longo (composto, ex.: "azul marinho" > "azul"). Match por limite
 * de palavra e tolerante a múltiplos espaços/hífens.
 */
export function detectColorFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const hay = stripAccents(name.toLowerCase()).replace(/\s+/g, " ");
  let best: { value: string; start: number; len: number } | null = null;
  for (const [token, value] of COLOR_TOKENS) {
    const t = stripAccents(token).replace(/[-\s]+/g, "[-\\s]+");
    const re = new RegExp(`(^|[^a-z0-9])(${t})([^a-z0-9]|$)`, "i");
    const m = re.exec(hay);
    if (!m) continue;
    const start = m.index + m[1].length; // posição do token em si
    const len = m[2].length;
    if (!best || start < best.start || (start === best.start && len > best.len)) {
      best = { value, start, len };
    }
  }
  return best ? best.value : null;
}

type MlAttr = { id: string; value_name: string };

/**
 * Corrige a COR a partir do nome do produto. Não-destrutivo e idempotente:
 * - COLOR: define/substitui pelo valor derivado do nome (adiciona se faltar).
 * - MAIN_COLOR: só corrige se já estiver PREENCHIDO, mapeando pro próprio
 *   domínio (16 valores); nunca preenche um MAIN_COLOR vazio nem grava valor
 *   fora do domínio (evita rejeição do ML).
 * Se o nome não tem cor reconhecível, retorna os atributos inalterados.
 * Genérico: preserva os campos extras de cada atributo (name/required/source).
 */
export function sanitizeColorAttribute<T extends MlAttr>(
  attrs: T[],
  productName: string | null | undefined
): T[] {
  const color = detectColorFromName(productName);
  if (!color) return attrs;
  const mainBase = MAIN_COLOR_BASE[color];

  const out = attrs.map((a) => {
    if (a.id === "COLOR") return { ...a, value_name: color };
    if (a.id === "MAIN_COLOR") {
      // só corrige se já tem valor E temos uma base válida no domínio dele
      if (a.value_name && mainBase && MAIN_COLOR_VALUES.has(mainBase)) {
        return { ...a, value_name: mainBase };
      }
      return a; // vazio ou sem base válida: deixa intacto (cleanAttributes dropa vazio)
    }
    return a;
  });

  // garante COLOR (obrigatório em MLB31447), preservando a forma dos demais attrs
  if (!out.some((a) => a.id === "COLOR")) {
    const template = (attrs[0] ?? {}) as Record<string, unknown>;
    const added: Record<string, unknown> = { ...template, id: "COLOR", value_name: color };
    if ("name" in template) added.name = "Cor";
    if ("source" in template) added.source = "name";
    if ("required" in template) added.required = true;
    out.push(added as unknown as T);
  }
  return out;
}

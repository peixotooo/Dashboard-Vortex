// Template recomendado para a feature "Pedir de presente".
//
// Estratégia para a Meta classificar como UTILITY (custo ~10x menor que
// MARKETING):
//
// 1) NOME do template: neutro/operacional ("bkng_share_message_v<ts>"),
//    nunca "gift", "request", "promo", "discount".
//
// 2) BODY do template: quebras de linha (\n) e labels descritivos
//    ("Produto:", "Ver aqui:") ficam AQUI. O body fixo do template aceita
//    \n sem restrição.
//
// 3) VARIÁVEIS de runtime ({{1}}, {{2}}, {{3}}): a Meta IMPÕE 3 regras:
//      - Não podem ter \n (newline)
//      - Não podem ter \t (tab)
//      - Não podem ter mais de 4 espaços consecutivos
//    Por isso usamos 3 slots: introdução, nome do produto, URL — cada um
//    sem newline interno, separados estruturalmente pelo body do template.

// Body do template com 3 slots — preserva a estrutura visual que valida no
// WhatsApp. NÃO começa com variável, NÃO termina com variável, variáveis
// não são adjacentes (sempre há texto entre elas).
export const UTILITY_TEMPLATE_BODY =
  "Oi, tudo bem?\n\n{{1}}\n\nProduto:\n*{{2}}*\n\nVer aqui:\n{{3}}\n\nAgora é com você.";

// Exemplos para Meta avaliar — neutros e SEM \n nas variáveis.
export const UTILITY_TEMPLATE_EXAMPLE_BODY_TEXT = [
  [
    "Recebi uma menção sua sobre um item",
    "produto exemplo",
    "https://exemplo.com.br/p/x",
  ],
];

// Mapping padrão. NADA de \n dentro de cada slot — só travessões (—) e
// pontuação. As quebras visuais vêm do body do template.
//
// Copy SEM gênero — funciona pra qualquer combinação solicitante/destinatário.
export const DEFAULT_VARIABLE_MAPPING: Record<string, string> = {
  "1":
    "text:{{requester_name}} deixou uma dica pra você 🎁 — tem grandes chances desse ser o presente certo 😅",
  "2": "text:{{product_name}}",
  "3": "text:{{product_url}}",
};

// Variação alternativa — mais sóbria, sem o emoji 😅
export const NEUTRAL_VARIABLE_MAPPING: Record<string, string> = {
  "1":
    "text:{{requester_name}} deixou uma dica pra você — esse produto entrou na lista de desejos.",
  "2": "text:{{product_name}}",
  "3": "text:{{product_url}}",
};

// Template recomendado para a feature "Pedir de presente".
//
// Estratégia para a Meta classificar como UTILITY (custo ~10x menor que
// MARKETING):
//
// 1) NOME do template: neutro/operacional ("bkng_share_message_v<ts>"),
//    nunca "gift", "request", "promo", "discount".
//
// 2) BODY do template: conversacional, sem CTA comercial. Quebras de linha
//    (\n) vão AQUI — o body fixo do template aceita \n sem restrição.
//
// 3) VARIÁVEIS de runtime ({{1}}, {{2}}): a Meta IMPÕE 3 regras:
//      - Não podem ter \n (newline)
//      - Não podem ter \t (tab)
//      - Não podem ter mais de 4 espaços consecutivos
//    Quem viola recebe: HTTP 400 (#100) "Param text cannot have new-line
//    /tab characters or more than 4 consecutive spaces".
//    Solução: usar pontuação (—, ·, ".") em vez de \n. Quebras visuais
//    de leitura vêm do body do template, não das variáveis.

// Body do template: as quebras estão aqui. UTILITY-friendly.
export const UTILITY_TEMPLATE_BODY =
  "Oi, tudo bem?\n\n{{1}}\n\n{{2}}\n\nPode responder por aqui.";

// Exemplos para Meta avaliar — neutros e SEM \n nas variáveis (o exemplo
// também é validado pelas mesmas regras).
export const UTILITY_TEMPLATE_EXAMPLE_BODY_TEXT = [
  [
    "Recebi uma menção sua sobre um item interessante.",
    "Item: produto X — para acessar use https://exemplo.com.br/p/x",
  ],
];

// Mapping padrão. NADA de \n dentro de cada slot — só travessões (—) e
// pontuação. As "quebras visuais" entre os slots vêm do body do template
// (que tem \n\n entre {{1}} e {{2}}).
export const DEFAULT_VARIABLE_MAPPING: Record<string, string> = {
  "1":
    "text:{{requester_name}} deixou uma dica pra você 🎁 — ela viu esse produto e pensou: \"era exatamente isso que eu queria ganhar.\"",
  "2":
    "text:O desejo dela: *{{product_name}}* — confere aqui: {{product_url}}. Não vai deixar ela só na vontade né? 😉",
};

// Variação alternativa — mais sóbria, sem o "ela". Útil quando o solicitante
// prefere mensagem neutra.
export const NEUTRAL_VARIABLE_MAPPING: Record<string, string> = {
  "1":
    "text:{{requester_name}} deixou uma dica pra você 🎁 — esse produto entrou na lista de desejos.",
  "2":
    "text:*{{product_name}}* — confere aqui: {{product_url}}. Se quiser surpreender, dá uma olhada.",
};

// Template recomendado para a feature "Pedir de presente".
//
// Estratégia para a Meta classificar como UTILITY (custo ~10x menor que
// MARKETING):
//
// 1) NOME do template: neutro/operacional ("bkng_share_message_v<ts>"),
//    nunca "gift", "request", "promo", "discount" — palavras assim levam
//    a Meta a tender a MARKETING.
//
// 2) BODY do template: conversacional, sem CTA comercial, sem emojis no
//    texto LITERAL. Saudação genérica "Oi, tudo bem?" — não personaliza
//    com o nome do destinatário porque não temos esse dado (a presenteadora
//    é quem recebe; só temos o WhatsApp dela).
//
// 3) Conteúdo "que pode soar comercial" (nome do produto, link, copy de
//    convite) entra como VARIÁVEL de runtime ({{1}}/{{2}}). A Meta avalia
//    só o body literal do template, não o valor das variáveis.

// Regras Meta pra body:
//   - NÃO pode começar com variável  ← OK ("Oi, tudo bem?" começa com texto)
//   - NÃO pode terminar com variável ← OK ("Pode responder por aqui.")
//   - Variáveis não podem ser adjacentes ← OK (separadas por \n\n)
export const UTILITY_TEMPLATE_BODY =
  "Oi, tudo bem?\n\n{{1}}\n\n{{2}}\n\nPode responder por aqui.";

// Exemplos pra Meta avaliar — neutros e operacionais. NÃO devem refletir
// a copy "comercial" final, senão a Meta usa os exemplos pra classificar.
export const UTILITY_TEMPLATE_EXAMPLE_BODY_TEXT = [
  [
    "Recebi uma menção sua relacionada a um item. Detalhes a seguir.",
    "Item: produto X. Para verificar, acesse: https://exemplo.com.br/p/produto-x",
  ],
];

// Mapping padrão pros slots do template.
//
// {{1}} = bloco de abertura: quem mandou + o "pensamento" dela
// {{2}} = bloco do produto: nome, link, fechamento
//
// {{requester_name}}, {{product_name}} e {{product_url}} são interpoladas
// em runtime (via `interpolate` em cart-recovery/variables.ts, reusado).
export const DEFAULT_VARIABLE_MAPPING: Record<string, string> = {
  "1":
    "text:{{requester_name}} deixou uma dica pra você 🎁\n\nEla viu esse produto e pensou:\n\"era exatamente isso que eu queria ganhar.\"",
  "2":
    "text:O desejo dela:\n*{{product_name}}*\n\nVer aqui:\n{{product_url}}\n\nNão vai deixar ela só na vontade né?",
};

// Variação alternativa — mais sóbria, sem o "ela" gendered. Útil quando o
// solicitante prefere uma mensagem neutra.
export const NEUTRAL_VARIABLE_MAPPING: Record<string, string> = {
  "1":
    "text:{{requester_name}} deixou uma dica pra você 🎁\n\nEsse produto entrou na lista de desejos:",
  "2":
    "text:*{{product_name}}*\n\nVer aqui:\n{{product_url}}\n\nSe quiser surpreender, dá uma olhada.",
};

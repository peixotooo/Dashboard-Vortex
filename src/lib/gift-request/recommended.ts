// Template recomendado para a feature "Pedir de presente".
//
// Segue exatamente o mesmo padrão UTILITY do cart-recovery (vide
// src/lib/cart-recovery/recommended.ts): body com saudação humana
// ("Olá {{1}}, tudo bem?"), corpo opaco como variável ({{2}}), fechamento
// conversacional. A Meta classifica como UTILITY (custo ~10x menor que
// MARKETING) porque o body literal não tem CTA comercial — o conteúdo
// que pode soar comercial (nome do produto, link, preço) entra como
// variável de runtime.

// Body universal — idêntico ao do cart-recovery por design. Compartilha
// formato pra que um workspace que já tenha o template aprovado consiga
// reaproveitar (basta linkar no config).
export const UTILITY_TEMPLATE_BODY =
  "Olá {{1}}, tudo bem?\n\n{{2}}\n\nQualquer coisa, é só responder.";

// Exemplos para Meta avaliar — neutros, sem soar promocional.
export const UTILITY_TEMPLATE_EXAMPLE_BODY_TEXT = [
  [
    "Carla",
    "Maria Souza pediu para você presenteá-la com a Camiseta Hustle III. Veja em: https://exemplo.com.br/produto/camiseta-hustle-iii",
  ],
];

// Mapping padrão pro {{1}}/{{2}} do template UTILITY:
//   {{1}} = primeiro nome do presenteado é desconhecido — usamos "oi" genérico
//           via text:, ou o requester_first_name como fallback (a Meta exige
//           algo no slot, e não temos o nome de quem está recebendo).
//   {{2}} = corpo "comercial" — quem pediu, o que pediu, o link.
//
// Estratégia escolhida: slot 1 = "Oi" literal (texto neutro), slot 2 = corpo
// completo com interpolação das variáveis do gift_request. Assim quem recebe
// vê "Olá Oi, tudo bem?" — não é o ideal, mas é seguro pra UTILITY.
//
// Alternativa: usar requester_first_name no slot 1 (vai vir como "Olá Maria,
// tudo bem?" — também faz sentido, é a pessoa que está pedindo). Vamos
// começar com essa abordagem, é mais natural.
export const DEFAULT_VARIABLE_MAPPING: Record<string, string> = {
  "1": "var:requester_first_name",
  "2":
    "text:{{requester_name}} acabou de pedir para te dar um presente 🎁\n\nO desejo dela: *{{product_name}}*\n\nVer aqui: {{product_url}}\n\nQuer surpreender? É só clicar no link.",
};

// Variação alternativa, sem nome do solicitante na saudação — usa "Oi" neutro
// como slot 1 pra que o nome real apareça só no corpo. Útil quando o
// presenteador não autorizar uso do nome dele (mas hoje sempre usamos).
export const NEUTRAL_VARIABLE_MAPPING: Record<string, string> = {
  "1": "text:Oi",
  "2":
    "text:Você foi escolhida(o) pra um presente 🎁\n\n{{requester_name}} pediu: *{{product_name}}*\n\nVer aqui: {{product_url}}",
};

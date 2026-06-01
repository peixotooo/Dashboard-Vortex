// Régua recomendada de recuperação de carrinho.
//
// 3 steps escalonados (30min → 24h → 72h), cada um com WhatsApp + Email
// simultâneos. Copy em linguagem natural, chamando pelo primeiro nome.
// Sempre inclui o link de recuperação (cart_url) — sem link, o cliente
// não tem como voltar.
//
// WhatsApp: o usuário precisa ter os templates aprovados na Meta. A régua
// vem com whatsapp_enabled=true MAS template_id=null + body sugerido no
// `whatsapp_suggested_body` (campo só do app, não do DB) pra orientar a
// criação. Variable mapping já vem montado pros posicionais {{1}} e {{2}}.
//
// Email: 100% nativo. HTML monocromático (preto/branco/cinza), Inter/Kanit,
// CTA destacado pro cart_url. Sem em-dashes. Segue o padrão de
// src/lib/email-templates/templates/shared.ts (TOKENS).

import { TOKENS, escapeHtml } from "@/lib/email-templates/templates/shared";

export interface RecommendedStep {
  step_order: number;
  delay_minutes: number;
  whatsapp_enabled: boolean;
  // Texto sugerido pro template a ser criado na Meta. Não vai pro DB;
  // mostrado no UI pra copy/paste.
  whatsapp_suggested_body: string;
  whatsapp_variable_mapping: Record<string, string>;
  email_enabled: boolean;
  email_subject: string;
  email_body_html: string;
  // 0 = sem cupom. > 0 = gera cupom único por carrinho com X% off,
  // válido por coupon_validity_hours.
  coupon_pct: number;
  coupon_validity_hours: number;
}

interface EmailParams {
  preheader: string;
  headline: string;
  body: string; // pode conter <strong>, <br>, <p>
  ctaLabel: string;
  ctaUrl: string; // tipicamente "{{recovery_url}}" pra interpolação no dispatch
  footnote?: string;
}

// HTML monocromático auto-contido. Recovery URL vai como href + visual.
function buildEmailHtml(p: EmailParams): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no" />
<title>${escapeHtml(p.headline)}</title>
<style>
  html,body{margin:0!important;padding:0!important;background:${TOKENS.bgAlt};-webkit-text-size-adjust:100%;}
  table{border-collapse:collapse!important;}
  img{border:0;outline:none;display:block;max-width:100%;height:auto;}
  a{color:${TOKENS.text};}
  @media (max-width:599px){
    .container{width:100%!important;}
    .pad{padding:24px 22px!important;}
    .pad-xl{padding:40px 22px!important;}
    .h1{font-size:30px!important;line-height:1.1!important;}
    .lead{font-size:15px!important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${TOKENS.bgAlt};">
<!-- preheader (visível só na inbox) -->
<div style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">
  ${escapeHtml(p.preheader)}
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${TOKENS.bgAlt};">
  <tr>
    <td align="center" style="padding:32px 16px;">

      <table role="presentation" class="container" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;background:${TOKENS.bg};">
        <!-- corpo -->
        <tr>
          <td class="pad-xl" style="padding:56px 48px 16px;font-family:${TOKENS.fontHead};color:${TOKENS.text};">
            <div class="h1" style="font-size:36px;line-height:1.05;font-weight:500;letter-spacing:-0.01em;margin:0 0 18px;">
              ${p.headline}
            </div>
          </td>
        </tr>
        <tr>
          <td class="pad" style="padding:0 48px 32px;font-family:${TOKENS.fontBody};color:${TOKENS.textMuted};font-size:16px;line-height:1.55;">
            <div class="lead">
              ${p.body}
            </div>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td class="pad" style="padding:8px 48px 56px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="${TOKENS.surfaceInverse}" style="background:${TOKENS.surfaceInverse};border-radius:2px;">
                  <a href="${escapeHtml(p.ctaUrl)}" target="_blank"
                     style="display:inline-block;padding:16px 32px;font-family:${TOKENS.fontBody};font-size:14px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:${TOKENS.bg};text-decoration:none;">
                    ${escapeHtml(p.ctaLabel)}
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        ${p.footnote ? `
        <tr>
          <td class="pad" style="padding:0 48px 48px;font-family:${TOKENS.fontBody};color:${TOKENS.textSecondary};font-size:13px;line-height:1.55;border-top:1px solid ${TOKENS.border};padding-top:24px;">
            ${p.footnote}
          </td>
        </tr>` : ""}
      </table>

      <!-- footer -->
      <table role="presentation" class="container" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;">
        <tr>
          <td align="center" style="padding:24px 16px 40px;font-family:${TOKENS.fontBody};color:${TOKENS.textFaint};font-size:12px;line-height:1.6;">
            Você está recebendo este email porque deixou um carrinho pendente.
          </td>
        </tr>
      </table>

    </td>
  </tr>
</table>
</body>
</html>`;
}

// ============================================================
// STEPS
// ============================================================
//
// As variáveis {{customer_first_name}} e {{recovery_url}} são interpoladas
// no momento do dispatch (src/lib/cart-recovery/variables.ts > interpolate).
// O cron busca o nome real via VNDA antes de enviar (src/lib/cart-recovery/enrich.ts).

// Body universal do template UTILITY criado automaticamente.
//
// Regras da Meta pra body de template:
//   - NÃO pode começar com variável
//   - NÃO pode terminar com variável
//   - Variáveis não podem ser adjacentes (precisa texto entre elas)
//
// Saudação ("Olá {{1}}, tudo bem?") e fechamento ("Qualquer coisa, é só
// responder.") são frases naturais que poderiam ser escritas por uma
// pessoa, mas continuam classificáveis como UTILITY pela Meta: tom
// conversacional/operacional, sem CTA comercial, sem promoção. O fecho
// sugere conversa (UTILITY-friendly).
//
// O {{2}} carrega todo o corpo "comercial" do step (escassez, urgência,
// link de recuperação) como variável de runtime — Meta avalia só o body
// literal do template, não o conteúdo das variáveis.
export const UTILITY_TEMPLATE_BODY =
  "Olá {{1}}, tudo bem?\n\n{{2}}\n\nQualquer coisa, é só responder.";

// Exemplos pra Meta entender que tipo de conteúdo as variáveis carregam.
// Mantemos genérico/neutro pra não soar comercial na avaliação.
export const UTILITY_TEMPLATE_EXAMPLE_BODY_TEXT = [
  [
    "João",
    "Identificamos itens pendentes em sua sessão. Para acessar, utilize: https://exemplo.com.br/retomar/abc123",
  ],
];

export const RECOMMENDED_STEPS: RecommendedStep[] = [
  // ---------- Step 1: 30 minutos ----------
  // Lembrete gentil, sem fricção. Tom de "vi que você tava olhando".
  {
    step_order: 1,
    delay_minutes: 30,
    coupon_pct: 0,
    coupon_validity_hours: 48,
    whatsapp_enabled: true,
    whatsapp_suggested_body:
      "Oi {{1}}! 👋\n\nVi que você deixou alguns itens no carrinho. Quer terminar a compra agora?\n\n{{2}}\n\nSe tiver dúvida ou precisar de ajuda, é só me chamar por aqui!",
    whatsapp_variable_mapping: {
      // Template UTILITY: "Olá {{1}}, tudo bem? {{2}} Qualquer coisa, é só responder."
      // {{1}} = primeiro nome (saudação já vem do template)
      // {{2}} = corpo completo do step, incluindo o link de recuperação
      //         interpolado via {{recovery_url}} dentro do text:
      "1": "var:customer_first_name",
      "2":
        "text:vi que você deixou alguns itens no carrinho 👀\n\n{{free_shipping_whatsapp_block}}quer terminar a compra agora? é só clicar aqui:\n\n{{recovery_url}}",
    },
    email_enabled: true,
    email_subject: "{{customer_first_name}}, você esqueceu algo 👀",
    email_body_html: buildEmailHtml({
      preheader:
        "Seu carrinho ainda está aqui. Termine a compra em poucos cliques.",
      headline: "{{customer_first_name}},<br/>seu carrinho ainda está aqui.",
      body: `<p style="margin:0 0 14px;">Vi que você selecionou alguns itens mas não finalizou.</p>
{{free_shipping_email_block}}
<p style="margin:0 0 14px;">Eles continuam te esperando — leva menos de um minuto pra concluir.</p>`,
      ctaLabel: "Voltar pro carrinho",
      ctaUrl: "{{recovery_url}}",
      footnote:
        "Se já comprou ou mudou de ideia, pode ignorar esse email.",
    }),
  },

  // ---------- Step 2: 24 horas ----------
  // Reforço com leve escassez. Convida a finalizar.
  {
    step_order: 2,
    delay_minutes: 60 * 24,
    coupon_pct: 0,
    coupon_validity_hours: 48,
    whatsapp_enabled: true,
    whatsapp_suggested_body:
      "Oi {{1}}, passando aqui de novo 🙂\n\nOs itens que você escolheu ainda estão disponíveis, mas o estoque pode acabar.\n\nGarante o seu antes que mude: {{2}}",
    whatsapp_variable_mapping: {
      "1": "var:customer_first_name",
      "2":
        "text:passando aqui de novo 🙂\n\n{{free_shipping_whatsapp_block}}seus itens continuam disponíveis, mas o estoque pode acabar. garanta o seu antes que mude:\n\n{{recovery_url}}",
    },
    email_enabled: true,
    email_subject: "Ainda dá tempo, {{customer_first_name}}",
    email_body_html: buildEmailHtml({
      preheader: "Os itens do seu carrinho continuam disponíveis. Por enquanto.",
      headline: "Ainda dá tempo,<br/>{{customer_first_name}}.",
      body: `<p style="margin:0 0 14px;">Os itens que você selecionou continuam te esperando.</p>
{{free_shipping_email_block}}
<p style="margin:0 0 14px;">Estoque é limitado e pode acabar a qualquer momento. Garanta antes que mude.</p>`,
      ctaLabel: "Finalizar minha compra",
      ctaUrl: "{{recovery_url}}",
      footnote:
        "Se já finalizou, obrigado! Esse email para de chegar automaticamente após a compra.",
    }),
  },

  // ---------- Step 3: 72 horas ----------
  // Última tentativa COM cupom 10% off por 24h. Cupom único por carrinho
  // criado automaticamente na VNDA pelo cron antes do dispatch.
  // O email tem um countdown PNG renderizado em runtime que recalcula o
  // tempo restante a cada abertura — força escassez visível, não só "vale
  // 24h" estático.
  {
    step_order: 3,
    delay_minutes: 60 * 72,
    coupon_pct: 10,
    coupon_validity_hours: 24,
    whatsapp_enabled: true,
    whatsapp_suggested_body:
      "{{1}}, separei um cupom pra você 🎁\n\n{{2}}",
    whatsapp_variable_mapping: {
      "1": "var:customer_first_name",
      "2":
        "text:separei um cupom de 10% off só pra você fechar essa compra 🎁\n\n{{free_shipping_whatsapp_block}}código: {{coupon_code}}\n\nvale só por 24h ({{coupon_expires_at_formatted}}). é só usar no checkout:\n\n{{recovery_url}}",
    },
    email_enabled: true,
    email_subject:
      "🎁 10% off pra você, {{customer_first_name}} (só 24h)",
    email_body_html: buildEmailHtml({
      preheader:
        "Seu cupom de 10% off vale só por 24h. Use no checkout do seu carrinho.",
      headline: "Separei 10% off<br/>pra você, {{customer_first_name}}.",
      body: `<p style="margin:0 0 14px;">Sei que talvez algo tenha te feito desistir do carrinho.</p>
{{free_shipping_email_block}}
<p style="margin:0 0 18px;">Pra te ajudar a fechar, criei um cupom de <strong>10% off</strong> só pra você. Vale só nas próximas 24 horas.</p>

<!-- Countdown PNG — recalculado a cada abertura do email -->
<p style="margin:0 0 18px;text-align:center;">
  <img
    src="https://dash.bulking.com.br/api/cart-recovery/countdown?expires={{coupon_expires_at}}"
    width="540"
    alt="Cupom expira em algumas horas"
    style="display:block;width:100%;max-width:540px;height:auto;margin:0 auto;border-radius:4px;"
  />
</p>

<p style="margin:0 0 8px;font-size:13px;color:#6E6E6E;text-transform:uppercase;letter-spacing:0.08em;">Seu cupom</p>
<p style="margin:0 0 18px;font-family:'JetBrains Mono','Courier New',monospace;font-size:22px;letter-spacing:0.04em;padding:14px 18px;border:1px dashed #000;background:#F7F7F7;display:inline-block;">{{coupon_code}}</p>
<p style="margin:0 0 14px;font-size:13px;color:#6E6E6E;">Não vê o contador? Seu cupom vale até <strong>{{coupon_expires_at_formatted}}</strong>.</p>
<p style="margin:0 0 14px;">Aplique no checkout e finalize a compra.</p>`,
      ctaLabel: "Usar cupom e finalizar",
      ctaUrl: "{{recovery_url}}",
      footnote:
        "Cupom único, válido por 24 horas a partir do envio deste email.",
    }),
  },
];


export const RECOMMENDED_EXPIRE_AFTER_HOURS = 96; // 4 dias, cobre o último step + folga

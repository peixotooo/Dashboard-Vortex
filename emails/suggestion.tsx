// emails/suggestion.tsx
//
// React-email template for the daily Suggestion drop. Previewable via
// `npm run email` (mounted at http://localhost:3333). Uses
// @react-email/components primitives — they emit bulletproof MSO/VML markup
// for Outlook and ship known-good resets, which is what we needed to stop
// the inbox-rendering issues (collapsed buttons, off-by-one spacing,
// linkified telephone numbers, dark-mode color flips).
//
// This is the canonical reference template. The production renderer in
// src/lib/email-templates/templates/shared.ts mirrors the same structure so
// daily emails composed by the cron orchestrator render the same way as
// what you preview here.

import {
  Body,
  Button,
  Column,
  Container,
  Font,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import { TOKENS } from "./components/tokens";

export interface SuggestionEmailProps {
  subject?: string;
  preview?: string;
  hook?: string;
  headline?: string;
  lead?: string;
  hero_url?: string;
  hero_alt?: string;
  product?: {
    name: string;
    price: number;
    old_price?: number;
    url: string;
  };
  cta_text?: string;
  cta_url?: string;
  related_products?: Array<{
    name: string;
    price: number;
    old_price?: number;
    image_url: string;
    url: string;
  }>;
  coupon?: {
    code: string;
    discount_percent: number;
    product_name: string;
  };
  unsubscribe_url?: string;
}

const DEFAULTS: Required<
  Omit<SuggestionEmailProps, "coupon" | "related_products" | "product">
> = {
  subject: "O top 1 da semana",
  preview: "Selecionado pra você. Disponível agora.",
  hook: "O TOP 1 DA SEMANA",
  headline: "A peça que define o conjunto",
  lead: "Selecionada pelo time. Disponível em todos os tamanhos.",
  hero_url:
    "https://cdn.vnda.com.br/bulking/2024/05/02/12_50_43_493_hero-placeholder.jpg",
  hero_alt: "Bulking — peça em destaque",
  cta_text: "Ver agora",
  cta_url: "https://www.bulking.com.br?utm_source=bulking-vortex&utm_medium=email&utm_campaign=preview",
  unsubscribe_url: "https://www.bulking.com.br/account/preferences",
};

const BULKING_LOGO_URL =
  "https://cdn.vnda.com.br/bulking/2023/12/01/18_12_2_290_logobulkingsite.svg?v=1701465320";

function brl(value: number): string {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

export function SuggestionEmail(rawProps: SuggestionEmailProps = {}) {
  const props = { ...DEFAULTS, ...rawProps } as SuggestionEmailProps &
    typeof DEFAULTS;
  const product = rawProps.product ?? {
    name: "Camiseta Oversized Heritage",
    price: 169.9,
    old_price: 219.9,
    url: DEFAULTS.cta_url,
  };
  const related = rawProps.related_products ?? [];
  const coupon = rawProps.coupon;

  return (
    <Html lang="pt-BR">
      <Head>
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light" />
        <meta
          name="format-detection"
          content="telephone=no, date=no, address=no, email=no, url=no"
        />
        <Font
          fontFamily="Kanit"
          fallbackFontFamily="Helvetica"
          webFont={{
            url: "https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600&display=swap",
            format: "woff2",
          }}
          fontWeight={500}
          fontStyle="normal"
        />
        <Font
          fontFamily="Inter"
          fallbackFontFamily="Helvetica"
          webFont={{
            url: "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap",
            format: "woff2",
          }}
          fontWeight={400}
          fontStyle="normal"
        />
      </Head>
      <Preview>{props.preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={headerSection}>
            <Link
              href="https://www.bulking.com.br"
              style={{ textDecoration: "none" }}
            >
              <Img
                src={BULKING_LOGO_URL}
                alt="BULKING"
                width="148"
                height="30"
                style={{ display: "inline-block", border: 0, outline: "none" }}
              />
            </Link>
          </Section>

          <Section style={hookSection}>
            <Text style={hookText}>{props.hook}</Text>
          </Section>

          <Section style={{ padding: 0 }}>
            <Img
              src={props.hero_url}
              alt={props.hero_alt}
              width="600"
              height="800"
              style={heroImage}
            />
          </Section>

          <Section style={{ padding: "56px 40px 14px" }}>
            <Heading as="h1" style={headingStyle}>
              {props.headline}
            </Heading>
          </Section>

          <Section style={{ padding: "0 40px 40px" }}>
            <Text style={leadText}>{props.lead}</Text>
          </Section>

          <Section style={{ padding: "0 40px 28px", textAlign: "center" }}>
            <Text style={productName}>{product.name}</Text>
            <Text style={{ margin: 0 }}>
              {product.old_price && product.old_price > product.price ? (
                <span style={oldPriceStyle}>{brl(product.old_price)}</span>
              ) : null}
              <span style={priceStyle}>{brl(product.price)}</span>
            </Text>
          </Section>

          {coupon ? (
            <Section style={{ padding: "8px 40px 28px" }}>
              <table
                role="presentation"
                width="100%"
                cellPadding={0}
                cellSpacing={0}
                style={{
                  border: `1px solid ${TOKENS.text}`,
                  borderCollapse: "collapse",
                }}
              >
                <tbody>
                  <tr>
                    <td align="center" style={{ padding: "30px 24px" }}>
                      <Text style={couponLabel}>Cupom exclusivo</Text>
                      <span style={couponCode}>{coupon.code}</span>
                      <Text style={couponHint}>
                        {coupon.discount_percent}% off em {coupon.product_name}
                      </Text>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>
          ) : null}

          <Section style={{ padding: "8px 40px 56px", textAlign: "center" }}>
            <Button href={props.cta_url} style={buttonStyle}>
              {props.cta_text}
            </Button>
          </Section>

          {related.length > 0 ? (
            <>
              <Hr style={hrStyle} />
              <Section style={{ padding: "64px 40px 12px", textAlign: "center" }}>
                <Text style={relatedTitle}>Selecionados pra você</Text>
              </Section>
              <Section style={{ padding: "0 40px 32px", textAlign: "center" }}>
                <Text style={relatedSub}>
                  Mais peças que combinam com a sua rotina.
                </Text>
              </Section>
              <Section style={{ padding: "0 30px 32px" }}>
                <Row>
                  {related.slice(0, 3).map((p, i) => (
                    <Column
                      key={i}
                      align="center"
                      valign="top"
                      style={{ padding: "0 10px 40px" }}
                    >
                      <Link href={p.url} style={{ textDecoration: "none" }}>
                        <Img
                          src={p.image_url}
                          alt={p.name}
                          width="180"
                          height="225"
                          style={relatedImg}
                        />
                        <Text style={relatedName}>{p.name}</Text>
                        {p.old_price && p.old_price > p.price ? (
                          <Text style={relatedOld}>{brl(p.old_price)}</Text>
                        ) : null}
                        <Text style={relatedPrice}>{brl(p.price)}</Text>
                        <Text style={relatedLink}>Ver produto</Text>
                      </Link>
                    </Column>
                  ))}
                </Row>
              </Section>
            </>
          ) : null}

          <Hr style={hrStyle} />

          <Section style={{ padding: "56px 40px 48px", textAlign: "center" }}>
            <Text style={footerTagline}>Respect the Hustle.</Text>
            <Text style={footerCopy}>
              Bulking ·{" "}
              <Link href="https://www.bulking.com.br" style={footerLink}>
                bulking.com.br
              </Link>
              <br />
              Você está recebendo este email porque é cliente Bulking.{" "}
              <Link href={props.unsubscribe_url} style={footerLink}>
                Descadastrar
              </Link>
              .
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default SuggestionEmail;

const body: React.CSSProperties = {
  margin: 0,
  padding: 0,
  background: TOKENS.bgAlt,
  fontFamily: TOKENS.fontBody,
};

const container: React.CSSProperties = {
  width: "600px",
  maxWidth: "600px",
  margin: "0 auto",
  background: TOKENS.bg,
};

const headerSection: React.CSSProperties = {
  padding: "48px 32px 36px",
  borderBottom: `1px solid ${TOKENS.border}`,
  textAlign: "center",
};

const hookSection: React.CSSProperties = {
  padding: "40px 32px 12px",
  textAlign: "center",
};

const hookText: React.CSSProperties = {
  margin: 0,
  fontFamily: TOKENS.fontBody,
  fontSize: "11px",
  fontWeight: 500,
  color: TOKENS.textSecondary,
  letterSpacing: "0.32em",
  textTransform: "uppercase",
};

const heroImage: React.CSSProperties = {
  width: "100%",
  maxWidth: "600px",
  height: "auto",
  display: "block",
  border: 0,
  outline: "none",
  background: TOKENS.bgAlt,
};

const headingStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: TOKENS.fontHead,
  fontSize: "38px",
  fontWeight: 500,
  lineHeight: 1.1,
  letterSpacing: "-0.005em",
  color: TOKENS.text,
  textAlign: "center",
};

const leadText: React.CSSProperties = {
  margin: 0,
  fontFamily: TOKENS.fontBody,
  fontSize: "16px",
  fontWeight: 400,
  color: TOKENS.textMuted,
  lineHeight: 1.7,
  textAlign: "center",
  maxWidth: "480px",
  marginLeft: "auto",
  marginRight: "auto",
};

const productName: React.CSSProperties = {
  margin: "0 0 8px",
  fontFamily: TOKENS.fontBody,
  fontSize: "15px",
  fontWeight: 500,
  color: TOKENS.textMuted,
  letterSpacing: "0.04em",
  textAlign: "center",
};

const oldPriceStyle: React.CSSProperties = {
  fontFamily: TOKENS.fontBody,
  fontSize: "14px",
  fontWeight: 400,
  color: TOKENS.textFaint,
  textDecoration: "line-through",
  marginRight: "12px",
};

const priceStyle: React.CSSProperties = {
  fontFamily: TOKENS.fontHead,
  fontSize: "22px",
  fontWeight: 600,
  color: TOKENS.text,
};

const buttonStyle: React.CSSProperties = {
  background: TOKENS.text,
  color: TOKENS.bg,
  fontFamily: TOKENS.fontHead,
  fontSize: "13px",
  fontWeight: 600,
  letterSpacing: "0.28em",
  textTransform: "uppercase",
  textDecoration: "none",
  padding: "20px 44px",
  display: "inline-block",
};

const couponLabel: React.CSSProperties = {
  margin: "0 0 14px",
  fontFamily: TOKENS.fontBody,
  fontSize: "11px",
  fontWeight: 500,
  letterSpacing: "0.32em",
  color: TOKENS.textSecondary,
  textTransform: "uppercase",
};

const couponCode: React.CSSProperties = {
  display: "inline-block",
  fontFamily: TOKENS.fontMono,
  fontSize: "22px",
  fontWeight: 500,
  letterSpacing: "0.18em",
  color: TOKENS.text,
  background: TOKENS.bgAlt,
  padding: "16px 26px",
};

const couponHint: React.CSSProperties = {
  margin: "18px 0 0",
  fontFamily: TOKENS.fontBody,
  fontSize: "14px",
  fontWeight: 400,
  color: TOKENS.textSecondary,
};

const hrStyle: React.CSSProperties = {
  border: 0,
  borderTop: `1px solid ${TOKENS.border}`,
  margin: 0,
};

const relatedTitle: React.CSSProperties = {
  margin: 0,
  fontFamily: TOKENS.fontHead,
  fontSize: "13px",
  fontWeight: 500,
  letterSpacing: "0.32em",
  color: TOKENS.text,
  textTransform: "uppercase",
};

const relatedSub: React.CSSProperties = {
  margin: 0,
  fontFamily: TOKENS.fontBody,
  fontSize: "14px",
  fontWeight: 400,
  color: TOKENS.textSecondary,
};

const relatedImg: React.CSSProperties = {
  width: "180px",
  height: "auto",
  display: "block",
  marginLeft: "auto",
  marginRight: "auto",
  border: 0,
  outline: "none",
  background: TOKENS.bgAlt,
};

const relatedName: React.CSSProperties = {
  margin: "14px 0 8px",
  fontFamily: TOKENS.fontBody,
  fontSize: "14px",
  fontWeight: 500,
  color: TOKENS.text,
  lineHeight: 1.4,
  textAlign: "center",
};

const relatedOld: React.CSSProperties = {
  margin: "0 0 2px",
  fontFamily: TOKENS.fontBody,
  fontSize: "12px",
  fontWeight: 400,
  color: TOKENS.textFaint,
  textDecoration: "line-through",
  textAlign: "center",
};

const relatedPrice: React.CSSProperties = {
  margin: "0 0 14px",
  fontFamily: TOKENS.fontHead,
  fontSize: "16px",
  fontWeight: 500,
  color: TOKENS.text,
  textAlign: "center",
};

const relatedLink: React.CSSProperties = {
  margin: 0,
  display: "inline-block",
  fontFamily: TOKENS.fontBody,
  fontSize: "11px",
  fontWeight: 500,
  letterSpacing: "0.28em",
  color: TOKENS.text,
  textTransform: "uppercase",
  borderBottom: `1px solid ${TOKENS.text}`,
  paddingBottom: "3px",
};

const footerTagline: React.CSSProperties = {
  margin: "0 0 16px",
  fontFamily: TOKENS.fontHead,
  fontSize: "12px",
  fontWeight: 500,
  letterSpacing: "0.32em",
  color: TOKENS.text,
  textTransform: "uppercase",
};

const footerCopy: React.CSSProperties = {
  margin: 0,
  fontFamily: TOKENS.fontBody,
  fontSize: "12px",
  fontWeight: 400,
  color: TOKENS.textSecondary,
  lineHeight: 1.8,
};

const footerLink: React.CSSProperties = {
  color: TOKENS.textSecondary,
  textDecoration: "underline",
};

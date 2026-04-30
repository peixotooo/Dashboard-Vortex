// scripts/test-email-templates-libs.ts
/**
 * Smoke verification for email-templates pure libs (no DB / no network).
 *
 * Validates:
 *   - countdown.sign + verify roundtrip and tampering detection
 *   - buildCountdownUrl shape
 *   - renderBestseller / renderSlowmoving / renderNewarrival templates
 *
 * Usage: npx tsx scripts/test-email-templates-libs.ts
 */
import {
  sign,
  verify,
  buildCountdownUrl,
} from "../src/lib/email-templates/countdown";
import { renderBestseller } from "../src/lib/email-templates/templates/bestseller";
import { renderSlowmoving } from "../src/lib/email-templates/templates/slowmoving";
import { renderNewarrival } from "../src/lib/email-templates/templates/newarrival";
import type { TemplateRenderContext } from "../src/lib/email-templates/types";

process.env.EMAIL_COUNTDOWN_SECRET = process.env.EMAIL_COUNTDOWN_SECRET || "test-secret";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`✗ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

console.log("[countdown] sign + verify roundtrip");
const expires = "2026-05-02T15:00:00.000Z";
const sig = sign(expires);
assert(verify(expires, sig), "valid signature verifies");
assert(!verify(expires, sig.slice(0, -2) + "ff"), "tampered signature fails");
const url = buildCountdownUrl({
  base_url: "https://example.com",
  expires_at: new Date(expires),
});
assert(
  url.startsWith("https://example.com/api/email-countdown.png?"),
  "url shape correct"
);
assert(url.includes(`expires=${encodeURIComponent(expires)}`), "url has expires");
assert(url.includes("sig="), "url has sig");

console.log("\n[templates] render bestseller");
const baseCtx: TemplateRenderContext = {
  product: {
    vnda_id: "1",
    name: "Camiseta Hustle Preta",
    price: 89.9,
    image_url: "https://cdn.example.com/img.jpg",
    url: "https://www.bulking.com.br/produto/x",
  },
  copy: {
    subject: "Top 1 da semana",
    headline: "O mais vestido da semana.",
    lead: "Lorem ipsum dolor sit amet.",
    cta_text: "Ver na loja",
    cta_url: "https://www.bulking.com.br/produto/x",
  },
  workspace: { name: "Bulking" },
};
const html1 = renderBestseller(baseCtx);
assert(html1.includes("BULKING"), "header present");
assert(html1.includes("TOP 1 DA SEMANA"), "bestseller badge present");
assert(html1.includes("Respect the Hustle"), "footer present");
assert(html1.length > 1000 && html1.length < 50000, "html size sane");

console.log("\n[templates] render slowmoving");
const html2 = renderSlowmoving({
  ...baseCtx,
  coupon: {
    code: "EMAIL-SLOWMOV-A7K2X",
    discount_percent: 10,
    expires_at: new Date(expires),
    countdown_url: url,
  },
});
assert(html2.includes("EMAIL-SLOWMOV-A7K2X"), "coupon code in html");
assert(html2.includes("ÚLTIMAS PEÇAS"), "slowmoving badge present");
assert(html2.includes(url), "countdown img src present");

console.log("\n[templates] render newarrival");
const html3 = renderNewarrival(baseCtx);
assert(html3.includes("ACABOU DE CHEGAR"), "newarrival badge present");
assert(!html3.includes("EMAIL-SLOWMOV-"), "no coupon in newarrival");

console.log("\n✅ ALL SMOKE TESTS PASSED");

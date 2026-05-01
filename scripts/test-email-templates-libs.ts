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
  url.startsWith("https://example.com/api/email-countdown.gif?"),
  "url shape correct"
);
assert(url.includes(`expires=${encodeURIComponent(expires)}`), "url has expires");
assert(url.includes("sig="), "url has sig");

console.log("\n[templates] render bestseller");
const baseCtx: TemplateRenderContext = {
  related_products: [
    { vnda_id: "2", name: "Regata Hustle Verde", price: 79.9, image_url: "https://cdn.example.com/r1.jpg", url: "https://www.bulking.com.br/produto/r1" },
    { vnda_id: "3", name: "Jogger Bulking", price: 149.9, old_price: 179.9, image_url: "https://cdn.example.com/r2.jpg", url: "https://www.bulking.com.br/produto/r2" },
    { vnda_id: "4", name: "Boné Hustle", price: 59.9, image_url: "https://cdn.example.com/r3.jpg", url: "https://www.bulking.com.br/produto/r3" },
  ],
  hook: "O top 1 da semana",
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
const futureExpires = new Date(Date.now() + 48 * 60 * 60 * 1000);
const html2 = renderSlowmoving({
  ...baseCtx,
  hook: "Estoque acabando",
  coupon: {
    code: "EMAIL-SLOWMOV-A7K2X",
    discount_percent: 10,
    expires_at: futureExpires,
    countdown_url: url,
  },
});
assert(html2.includes("EMAIL-SLOWMOV-A7K2X"), "coupon code in html");
assert(html2.includes("ÚLTIMAS PEÇAS"), "slowmoving badge present");
assert(/email-countdown\.gif/.test(html2), "animated countdown gif present");
// Countdown sits between the BULKING logo and the hook — top of the email.
const headerIdx = html2.indexOf("BULKING");
const countdownIdx = html2.indexOf("email-countdown.gif");
const hookIdx = html2.indexOf("Estoque acabando");
assert(
  headerIdx > -1 && countdownIdx > headerIdx && hookIdx > countdownIdx,
  "countdown is at the TOP of the email (header → countdown → hook)"
);

console.log("\n[templates] render newarrival");
const html3 = renderNewarrival(baseCtx);
assert(html3.includes("ACABOU DE CHEGAR"), "newarrival badge present");
assert(!html3.includes("EMAIL-SLOWMOV-"), "no coupon in newarrival");

console.log("\n✅ ALL SMOKE TESTS PASSED");

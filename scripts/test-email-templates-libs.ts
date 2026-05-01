// scripts/test-email-templates-libs.ts
/**
 * Smoke verification for email-templates pure libs (no DB / no network).
 *
 * Validates:
 *   - countdown.sign + verify roundtrip and tampering detection
 *   - buildCountdownUrl shape
 *   - Every layout in the registry renders email-safe HTML for slots 1, 2, 3
 *   - No em-dashes, no green accent, no font-weight 700/800 in output
 *
 * Usage: npx tsx scripts/test-email-templates-libs.ts
 */
import {
  sign,
  verify,
  buildCountdownUrl,
} from "../src/lib/email-templates/countdown";
import { LAYOUTS, LAYOUT_IDS, pickLayout } from "../src/lib/email-templates/layouts";
import type { TemplateRenderContext, Slot } from "../src/lib/email-templates/types";

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

const futureExpires = new Date(Date.now() + 48 * 60 * 60 * 1000);

function ctxFor(slot: Slot): TemplateRenderContext {
  return {
    slot,
    product: {
      vnda_id: "1",
      name: "Camiseta Hustle Preta",
      price: 89.9,
      old_price: slot === 2 ? 119.9 : undefined,
      image_url: "https://cdn.example.com/img.jpg",
      url: "https://www.bulking.com.br/produto/x",
    },
    related_products: [
      { vnda_id: "2", name: "Regata Hustle Verde", price: 79.9, image_url: "https://cdn.example.com/r1.jpg", url: "https://www.bulking.com.br/produto/r1" },
      { vnda_id: "3", name: "Jogger Bulking Cinza", price: 149.9, old_price: 179.9, image_url: "https://cdn.example.com/r2.jpg", url: "https://www.bulking.com.br/produto/r2" },
      { vnda_id: "4", name: "Boné Hustle", price: 59.9, image_url: "https://cdn.example.com/r3.jpg", url: "https://www.bulking.com.br/produto/r3" },
    ],
    copy: {
      subject: "A peça mais vestida da semana",
      headline: "Top 1 e dá pra ver por quê.",
      lead: "Caimento pra quem treina, design feito pra durar.",
      cta_text: "Ver na loja",
      cta_url: "https://www.bulking.com.br/produto/x",
    },
    workspace: { name: "Bulking" },
    coupon: slot === 2
      ? { code: "EMAIL-SLOWMOV-A7K2X", discount_percent: 10, expires_at: futureExpires, countdown_url: url }
      : undefined,
  };
}

console.log("\n[layouts] each layout renders all slots cleanly");
for (const id of LAYOUT_IDS) {
  const layout = LAYOUTS[id];
  for (const slot of layout.slots) {
    const html = layout.render(ctxFor(slot));
    assert(html.startsWith("<!DOCTYPE html>"), `${id} slot ${slot}: starts with doctype`);
    assert(html.length > 1500 && html.length < 80000, `${id} slot ${slot}: html size sane (${html.length})`);
    assert(!/—/.test(html), `${id} slot ${slot}: no em-dashes`);
    assert(!/49E472/i.test(html), `${id} slot ${slot}: no green accent`);
    assert(!/font-weight:(700|800)/.test(html), `${id} slot ${slot}: no font-weight 700/800`);
    if (slot === 2) {
      assert(/EMAIL-SLOWMOV-A7K2X/.test(html), `${id} slot 2: coupon code rendered`);
    }
  }
}

console.log("\n[picker] pickLayout is deterministic");
const a = pickLayout({ workspace_id: "ws-1", date: "2026-05-01", slot: 1 });
const b = pickLayout({ workspace_id: "ws-1", date: "2026-05-01", slot: 1 });
assert(a.id === b.id, "same triple picks same layout");
const c = pickLayout({ workspace_id: "ws-1", date: "2026-05-02", slot: 1 });
assert(c.id !== a.id || LAYOUT_IDS.length === 1, "different date can pick different layout");

console.log("\n✅ ALL SMOKE TESTS PASSED");

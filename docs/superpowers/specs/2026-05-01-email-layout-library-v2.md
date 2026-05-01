# Email Layout Library v2 Spec

> Status: pending implementation. Triggered by feedback on 2026-05-01.

## Context

The Bulking email design system was overhauled on 2026-05-01:

- Monochrome only (white / black / grays). No saturated accent in copy or CTAs.
- Type weights cap at 600 (no 700/800). Editorial weights, not loud.
- Generous whitespace.
- No em dashes anywhere in rendered copy.
- Copy passes Andre Chaperon (intimate) + Eugene Schwartz (awareness routing) heuristics.

Current production has three templates: `bestseller`, `slowmoving`, `newarrival`. They share the same single layout pattern (header → top-countdown if slot 2 → hook → hero → headline → stars → lead → meta → CTA → related grid → footer).

The user requested a **layout library**: study the 10 hero references in `public/Hero Emails/` and produce **2 variations of each = 20 total** so the system can rotate compositions and avoid email fatigue.

## Reference catalog

| # | File | Pattern name | Visual signature |
|---|------|--------------|------------------|
| 1 | `Black Friday Email Templates.jfif` | `editorial-overlay` | Massive split headline ("BLACK / FRIDAY") with the hero image punched between the words. |
| 2 | `Creative Design @atcastudio.jfif` (FLAW 2024) | `reviews-side-hero` | Three star reviews stacked on the left rail, hero photo on the right, thumb strip on the far right. |
| 3 | `Void Studios New Collection.jfif` | `logo-asym-narrative` | Small wordmark + 2-line headline left, hero portrait right, trio of detail shots beneath. |
| 4 | `download_5.jfif` (Society Studios) | `overlay-dual-cta` | Hero photo with overlaid bold headline + two outline CTA buttons; 2x2 product grid below. |
| 5 | `download_6.jfif` (Represent Maroon Edition) | `edition-narrative` | Small mark, "MAROON / EDITION" headline, narrative paragraph, multi-shot row at bottom. |
| 6 | `download_7.jfif` (Cold Outfit Ideas) | `numbered-grid-2x2` | "OUTFIT IDEAS" header, 4 numbered (handwritten) full-figure shots in a 2x2. |
| 7 | `download_8.jfif` (The Initial Collection) | `uniform-grid-3x3` | "THE INITIAL / COLLECTION" header, 9 uniform thumbnails in a strict 3x3. |
| 8 | `download_9.jfif` (Collared Puffer) | `single-detail-hero` | Single full-bleed product photo with paragraph + brand wordmark anchored bottom-left. |
| 9 | `download_10.jfif` (Asics × BEAMS) | `slash-labels` | Hero photo with caption labels separated by `/` floating in the negative space. |
| 10 | `Дизайн_сайта.jfif` (FAINE) | `blur-hero-bestsellers` | Dark mode blurry hero with huge wordmark, bestsellers row of 4 small cards underneath. |

## 20 layout variations

For each reference, two variations differ only in **mode** (light vs dark). Both keep the monochrome rule. Naming convention: `<pattern>-<mode>`.

| # | Layout id | Description |
|---|-----------|-------------|
| 1 | `editorial-overlay-light` | Pattern 1, white surface, black type. |
| 2 | `editorial-overlay-dark` | Pattern 1, black surface, white type. |
| 3 | `reviews-side-hero-light` | Pattern 2, white surface. |
| 4 | `reviews-side-hero-dark` | Pattern 2, black surface. |
| 5 | `logo-asym-narrative-light` | Pattern 3, white surface, gray narrative paragraph. |
| 6 | `logo-asym-narrative-dark` | Pattern 3, black surface. |
| 7 | `overlay-dual-cta-light` | Pattern 4, light overlay (text on top of bright hero). |
| 8 | `overlay-dual-cta-dark` | Pattern 4, dark overlay (text on top of moody hero). |
| 9 | `edition-narrative-light` | Pattern 5, white surface. |
| 10 | `edition-narrative-dark` | Pattern 5, black surface. |
| 11 | `numbered-grid-2x2-light` | Pattern 6, light cream surface, sketch numbers. |
| 12 | `numbered-grid-2x2-dark` | Pattern 6, dark surface, white sketch numbers. |
| 13 | `uniform-grid-3x3-light` | Pattern 7, white surface. |
| 14 | `uniform-grid-3x3-dark` | Pattern 7, black surface. |
| 15 | `single-detail-light` | Pattern 8, light. Single full-bleed hero with caption. |
| 16 | `single-detail-dark` | Pattern 8, dark. Heavier mood. |
| 17 | `slash-labels-light` | Pattern 9, light surface, slash captions. |
| 18 | `slash-labels-dark` | Pattern 9, dark surface, slash captions. |
| 19 | `blur-bestsellers-light` | Pattern 10, light blurred hero with bestsellers row. |
| 20 | `blur-bestsellers-dark` | Pattern 10, dark blurred hero (closest to FAINE original). |

## File structure

```
src/lib/email-templates/layouts/
  index.ts                 -- export const LAYOUTS: Record<LayoutId, LayoutDef>
  types.ts                 -- LayoutDef, LayoutId, slot compatibility
  editorial-overlay.ts     -- exports light + dark variants
  reviews-side-hero.ts
  logo-asym-narrative.ts
  overlay-dual-cta.ts
  edition-narrative.ts
  numbered-grid-2x2.ts
  uniform-grid-3x3.ts
  single-detail.ts
  slash-labels.ts
  blur-bestsellers.ts
```

`LayoutDef`:

```ts
interface LayoutDef {
  id: LayoutId;
  pattern_name: string;            // human-readable
  reference_image: string;         // path under public/Hero Emails/
  mode: "light" | "dark";
  slots: Array<1 | 2 | 3>;          // which suggestion slots can use this layout
  product_count: 1 | 4 | 9;         // expected related_products count
  render: (ctx: TemplateRenderContext) => string;
}
```

## Orchestrator integration

Add `email_template_settings.preferred_layouts: text[]` (nullable). Empty = use all. The orchestrator picks a layout per (slot, day) by:

1. Filter `LAYOUTS` to those compatible with the slot.
2. Filter to preferred_layouts if set.
3. Hash-based pick using `(workspace_id + date + slot)` for stable deterministic rotation. The same slot on the same day uses the same layout, but the layout rotates day to day.
4. Adjust `pickRelatedProducts(... limit)` to match `layout.product_count`.

## Success criteria

- 20 layout files compile and render valid email-safe HTML.
- Smoke test renders one frame from each, asserts no em dash, no `#49E472` in the HTML, no `font-weight:700|800`.
- Rotation produces different `rendered_html` snapshots on consecutive days for the same slot.
- All 20 visually distinct from each other (manual review against the 10 reference images).

## Out of scope (v3)

- Hero **image generation**. Today the hero comes from `product.image_url` (VNDA). v3 will accept a separate document specifying how to compose / generate hero shots inspired by the references.
- Live A/B by layout (would need disparo feedback). The system stays open-loop until then.

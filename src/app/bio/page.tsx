import type { CSSProperties } from "react";
import { headers } from "next/headers";
import { ArrowUpRight, MessageCircle, Package, ShieldCheck, Star, Truck } from "lucide-react";
import { BioTracker } from "@/app/bio/bio-tracker";
import { resolveBioPageData } from "@/lib/bio/resolve";
import type { BioPageData, BioResolvedBlock } from "@/lib/bio/types";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Bulking | Link da Bio",
  description: "Ofertas, produtos mais vendidos, grupo VIP e beneficios Bulking.",
};

function getClickHref({
  data,
  block,
  url,
  event,
  productId,
  category,
  campaignId,
}: {
  data: BioPageData;
  block: BioResolvedBlock;
  url: string;
  event?: string;
  productId?: string;
  category?: string;
  campaignId?: string | null;
}) {
  const params = new URLSearchParams({
    w: data.workspaceId,
    to: url,
    block_id: block.id,
    block_type: block.type,
  });
  if (event) params.set("event", event);
  if (productId) params.set("product_id", productId);
  if (category) params.set("category", category);
  if (campaignId) params.set("campaign_id", campaignId);
  return `/api/bio/click?${params.toString()}`;
}

function formatCountdown(target?: string | null): string | null {
  if (!target) return null;
  const date = new Date(target);
  if (Number.isNaN(date.getTime()) || date.getTime() < Date.now()) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function ProductImage({ src, name }: { src: string | null; name: string }) {
  if (!src) {
    return (
      <div className="flex aspect-[2/3] items-center justify-center rounded-md bg-neutral-100 text-neutral-400">
        <Package className="h-6 w-6" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      className="aspect-[2/3] w-full rounded-md bg-neutral-100 object-cover"
    />
  );
}

function ProductsBlock({ data, block }: { data: BioPageData; block: Extract<BioResolvedBlock, { type: "products" }> }) {
  return (
    <section data-bio-block={block.id} data-bio-type={block.type} className="space-y-3">
      <BlockHeader title={block.title} subtitle={block.subtitle} />
      <div className="grid grid-cols-2 gap-3">
        {block.products.map((product, index) => {
          const productUrl = product.product_url || data.storeBaseUrl;
          const price = product.sale_price && product.sale_price > 0 ? product.sale_price : product.price;
          return (
            <a
              key={`${block.id}-${product.product_id}-${index}`}
              href={getClickHref({
                data,
                block,
                url: productUrl,
                event: "bio_product_clicked",
                productId: product.product_id,
              })}
              className="group rounded-lg border border-[var(--bio-border)] bg-[var(--bio-card)] p-2 transition hover:-translate-y-0.5 hover:border-neutral-900"
            >
              <ProductImage src={product.image_url} name={product.name} />
              <div className="mt-2 min-h-[74px]">
                <p className="line-clamp-2 text-sm font-semibold leading-tight text-[var(--bio-fg)]">
                  {product.name}
                </p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-[var(--bio-fg)]">{formatCurrency(price || 0)}</p>
                  <ArrowUpRight className="h-4 w-4 text-neutral-500 transition group-hover:text-neutral-950" />
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}

function BlockHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="text-[15px] font-bold uppercase tracking-[0.18em] text-[var(--bio-fg)]">{title}</h2>
      {subtitle ? <p className="mt-1 text-sm leading-snug text-[var(--bio-muted)]">{subtitle}</p> : null}
    </div>
  );
}

function HeroBlock({ data, block }: { data: BioPageData; block: Extract<BioResolvedBlock, { type: "hero" }> }) {
  const countdown = formatCountdown(block.countdown_target);
  return (
    <section
      data-bio-block={block.id}
      data-bio-type={block.type}
      className="rounded-xl border border-neutral-900 bg-neutral-950 p-5 text-white"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]">
          {block.badge || "Bulking"}
        </span>
        {countdown ? (
          <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-neutral-950">
            Ate {countdown}
          </span>
        ) : null}
      </div>
      <h1 className="mt-5 text-3xl font-black leading-none">{block.title}</h1>
      {block.subtitle ? <p className="mt-3 text-sm leading-relaxed text-white/72">{block.subtitle}</p> : null}
      {block.url ? (
        <a
          href={getClickHref({
            data,
            block,
            url: block.url,
            event: "bio_cta_clicked",
            campaignId: block.campaign_id,
          })}
          className="mt-5 flex h-12 items-center justify-center rounded-md bg-white px-4 text-sm font-black uppercase text-neutral-950"
        >
          {block.cta_label || "Conferir agora"}
        </a>
      ) : null}
    </section>
  );
}

function CategoriesBlock({ data, block }: { data: BioPageData; block: Extract<BioResolvedBlock, { type: "categories" }> }) {
  return (
    <section data-bio-block={block.id} data-bio-type={block.type} className="space-y-3">
      <BlockHeader title={block.title} subtitle={block.subtitle} />
      <div className="grid gap-2">
        {block.items.map((item) => (
          <a
            key={item.id}
            href={getClickHref({
              data,
              block,
              url: item.url,
              event: "bio_category_clicked",
              category: item.label,
            })}
            className="flex items-center justify-between rounded-lg border border-[var(--bio-border)] bg-[var(--bio-card)] px-4 py-3 text-[var(--bio-fg)] transition hover:border-neutral-900"
          >
            <div>
              <p className="font-bold">{item.label}</p>
              {item.description || item.metric ? (
                <p className="text-xs text-[var(--bio-muted)]">
                  {[item.description, item.metric].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </div>
            <ArrowUpRight className="h-4 w-4 text-neutral-500" />
          </a>
        ))}
      </div>
    </section>
  );
}

function LinkBlock({ data, block }: { data: BioPageData; block: Extract<BioResolvedBlock, { type: "group" | "club" | "shipping" }> }) {
  const Icon = block.type === "group" ? MessageCircle : block.type === "shipping" ? Truck : ShieldCheck;
  const event =
    block.type === "group"
      ? "bio_group_clicked"
      : block.type === "club"
        ? "bio_club_clicked"
        : "bio_shipping_clicked";

  return (
    <section data-bio-block={block.id} data-bio-type={block.type}>
      <a
        href={getClickHref({ data, block, url: block.url || data.storeBaseUrl, event })}
        className="flex items-center gap-3 rounded-lg border border-[var(--bio-border)] bg-[var(--bio-card)] p-4 transition hover:border-neutral-900"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-neutral-950 text-white">
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-[var(--bio-fg)]">{block.title}</span>
          {block.subtitle ? <span className="mt-0.5 block text-sm leading-snug text-[var(--bio-muted)]">{block.subtitle}</span> : null}
        </span>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-neutral-500" />
      </a>
    </section>
  );
}

function ReviewsBlock({ block }: { block: Extract<BioResolvedBlock, { type: "reviews" }> }) {
  return (
    <section data-bio-block={block.id} data-bio-type={block.type} className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <BlockHeader title={block.title} subtitle={block.subtitle} />
        <div className="shrink-0 text-right">
          <p className="text-xl font-black text-[var(--bio-fg)]">{block.summary.average.toFixed(1)}</p>
          <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--bio-muted)]">{block.summary.total} reviews</p>
        </div>
      </div>
      <div className="flex snap-x gap-3 overflow-x-auto pb-1">
        {block.reviews.map((review) => (
          <article
            key={review.id}
            className="min-w-[78%] snap-start rounded-lg border border-[var(--bio-border)] bg-[var(--bio-card)] p-4"
          >
            <div className="mb-3 flex items-center gap-1 text-neutral-950">
              <Star className="h-4 w-4 fill-current" />
              <span className="text-sm font-bold">{review.rating.toFixed(1)}</span>
            </div>
            <p className="text-sm leading-relaxed text-[var(--bio-fg)]">"{review.body}"</p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--bio-muted)]">
              {review.author}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ResolvedBlock({ data, block }: { data: BioPageData; block: BioResolvedBlock }) {
  if (block.type === "hero") return <HeroBlock data={data} block={block} />;
  if (block.type === "products") return <ProductsBlock data={data} block={block} />;
  if (block.type === "categories") return <CategoriesBlock data={data} block={block} />;
  if (block.type === "reviews") return <ReviewsBlock block={block} />;
  return <LinkBlock data={data} block={block} />;
}

export default async function BioPage() {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") || headerList.get("host") || "";
  const data = await resolveBioPageData(host);

  if (!data) {
    return (
      <main className="grid min-h-screen place-items-center bg-neutral-950 p-6 text-white">
        <div className="max-w-sm text-center">
          <h1 className="text-2xl font-black">Bio indisponivel</h1>
          <p className="mt-2 text-sm text-white/60">Nao encontramos uma configuracao ativa para este link.</p>
        </div>
      </main>
    );
  }

  const style = {
    "--bio-bg": data.config.theme.background,
    "--bio-fg": data.config.theme.foreground,
    "--bio-muted": data.config.theme.muted,
    "--bio-card": data.config.theme.card,
    "--bio-border": data.config.theme.border,
    "--bio-accent": data.config.theme.accent,
    "--bio-accent-fg": data.config.theme.accentForeground,
  } as CSSProperties;

  if (!data.config.enabled) {
    return (
      <main className="grid min-h-screen place-items-center bg-neutral-950 p-6 text-white">
        <div className="max-w-sm text-center">
          <h1 className="text-2xl font-black">Link pausado</h1>
          <p className="mt-2 text-sm text-white/60">A bio da Bulking esta temporariamente desativada.</p>
        </div>
      </main>
    );
  }

  return (
    <main style={style} className="min-h-screen bg-[var(--bio-bg)] text-[var(--bio-fg)]">
      <BioTracker
        workspaceId={data.workspaceId}
        blocks={data.blocks.map((block) => ({ id: block.id, type: block.type }))}
      />
      <div className="mx-auto min-h-screen w-full max-w-[520px] px-4 py-5">
        <header className="mb-4 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-neutral-950 text-lg font-black text-white">
            {data.config.avatar_url ? (
              <img src={data.config.avatar_url} alt={data.config.brand_name} className="h-full w-full rounded-lg object-cover" />
            ) : (
              data.config.brand_name.slice(0, 1).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <p className="text-lg font-black leading-tight">{data.config.headline}</p>
            <p className="line-clamp-2 text-sm leading-snug text-[var(--bio-muted)]">{data.config.subtitle}</p>
          </div>
        </header>

        <div className="space-y-5">
          {data.blocks.map((block) => (
            <ResolvedBlock key={block.id} data={data} block={block} />
          ))}
        </div>

        <footer className="py-8 text-center text-xs uppercase tracking-[0.18em] text-[var(--bio-muted)]">
          bulking.com.br
        </footer>
      </div>
    </main>
  );
}

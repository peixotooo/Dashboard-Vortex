import type { CSSProperties } from "react";
import { headers } from "next/headers";
import { unstable_cache } from "next/cache";
import { ArrowUpRight, ChevronRight, Flame, MessageCircle, Package, ShieldCheck, ShoppingBag, Star, Truck } from "lucide-react";
import { BioTracker } from "@/app/bio/bio-tracker";
import { BioCountdown } from "@/app/bio/bio-countdown";
import { resolveBioPageData } from "@/lib/bio/resolve";
import type { BioPageData, BioResolvedBlock } from "@/lib/bio/types";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Bulking | Link da Bio",
  description: "Ofertas, produtos mais vendidos, grupo VIP e beneficios Bulking.",
};

const getCachedBioPageData = unstable_cache(
  async (host: string) => resolveBioPageData(host),
  ["bio-page-data"],
  { revalidate: 120, tags: ["bio-page"] }
);

function getClickHref({
  data, block, url, event, productId, category, campaignId,
}: {
  data: BioPageData; block: BioResolvedBlock; url: string; event?: string;
  productId?: string; category?: string; campaignId?: string | null;
}) {
  const params = new URLSearchParams({ w: data.workspaceId, to: url, block_id: block.id, block_type: block.type });
  if (event) params.set("event", event);
  if (productId) params.set("product_id", productId);
  if (category) params.set("category", category);
  if (campaignId) params.set("campaign_id", campaignId);
  return `/api/bio/click?${params.toString()}`;
}

function ProductImage({ src, name, eager }: { src: string | null; name: string; eager?: boolean }) {
  if (!src) {
    return (
      <div className="flex aspect-[3/4] items-center justify-center rounded-xl bg-neutral-100 text-neutral-300">
        <Package className="h-6 w-6" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "auto"}
      className="aspect-[3/4] w-full rounded-xl bg-neutral-100 object-cover"
    />
  );
}

function BlockHeader({ kicker, title, subtitle }: { kicker?: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-3.5 px-0.5">
      {kicker ? (
        <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--bio-muted)]">{kicker}</p>
      ) : null}
      <h2 className="text-[19px] font-black leading-tight tracking-tight text-[var(--bio-fg)]">{title}</h2>
      {subtitle ? <p className="mt-1 text-[13.5px] leading-snug text-[var(--bio-muted)]">{subtitle}</p> : null}
    </div>
  );
}

// --- Hero (acao ativa) — bloco focal escuro com countdown VIVO ---
function HeroBlock({ data, block }: { data: BioPageData; block: Extract<BioResolvedBlock, { type: "hero" }> }) {
  const live = block.badge === "Acao ativa";
  return (
    <section data-bio-block={block.id} data-bio-type={block.type}
      className="overflow-hidden rounded-2xl bg-neutral-950 p-5 text-white shadow-[0_18px_40px_-22px_rgba(0,0,0,0.5)]">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white/85">
        {live ? <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" /></span> : null}
        {block.badge || "Bulking"}
      </span>
      <h1 className="mt-4 text-[30px] font-black leading-[0.98] tracking-tight">{block.title}</h1>
      {block.subtitle ? <p className="mt-2.5 line-clamp-2 text-[14px] leading-relaxed text-white/70">{block.subtitle}</p> : null}
      {block.countdown_target ? <div className="mt-4"><BioCountdown target={block.countdown_target} /></div> : null}
      {block.url ? (
        <a href={getClickHref({ data, block, url: block.url, event: "bio_cta_clicked", campaignId: block.campaign_id })}
          className="mt-5 flex h-[52px] items-center justify-center gap-2 rounded-xl bg-white px-4 text-[15px] font-black uppercase tracking-tight text-neutral-950 transition active:scale-[0.99] hover:bg-neutral-100">
          <ShoppingBag className="h-[18px] w-[18px]" />
          {block.cta_label || "Conferir agora"}
        </a>
      ) : null}
    </section>
  );
}

// --- Frete: barra fina de incentivo (nao card grande) ---
function ShippingBar({ data, block }: { data: BioPageData; block: Extract<BioResolvedBlock, { type: "group" | "club" | "shipping" }> }) {
  return (
    <a data-bio-block={block.id} data-bio-type={block.type}
      href={getClickHref({ data, block, url: block.url || data.storeBaseUrl, event: "bio_shipping_clicked" })}
      className="flex items-center gap-2.5 rounded-xl border border-[var(--bio-border)] bg-[var(--bio-card)] px-4 py-3 shadow-sm transition active:scale-[0.99]">
      <Truck className="h-[18px] w-[18px] shrink-0 text-neutral-950" />
      <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-[var(--bio-fg)]">{block.title}</span>
      {block.subtitle ? <span className="hidden shrink-0 text-[12px] text-[var(--bio-muted)] sm:inline">{block.subtitle}</span> : null}
      <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" />
    </a>
  );
}

// --- Produtos (isca) — selo #1 + de/por ---
function ProductsBlock({ data, block }: { data: BioPageData; block: Extract<BioResolvedBlock, { type: "products" }> }) {
  const ranked = block.algorithm === "bestsellers" || block.algorithm === "bestseller_camisetas" || block.algorithm === "most_popular";
  return (
    <section data-bio-block={block.id} data-bio-type={block.type}>
      <BlockHeader kicker={ranked ? "Em alta agora" : undefined} title={block.title} subtitle={block.subtitle} />
      <div className="flex snap-x gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {block.products.map((product, index) => {
          const productUrl = product.product_url || data.storeBaseUrl;
          const sale = product.sale_price && product.sale_price > 0 && (!product.price || product.sale_price < product.price) ? product.sale_price : null;
          const show = sale ?? product.price ?? product.sale_price ?? 0;
          const off = sale && product.price ? Math.round((1 - sale / product.price) * 100) : 0;
          return (
            <a key={`${block.id}-${product.product_id}-${index}`}
              href={getClickHref({ data, block, url: productUrl, event: "bio_product_clicked", productId: product.product_id })}
              className="group relative min-w-[150px] snap-start rounded-2xl border border-[var(--bio-border)] bg-[var(--bio-card)] p-2 shadow-sm transition active:scale-[0.99] sm:min-w-[166px]">
              {ranked && index === 0 ? (
                <span className="absolute left-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-neutral-950 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
                  <Flame className="h-3 w-3" />#1
                </span>
              ) : null}
              {off >= 10 ? (
                <span className="absolute right-3 top-3 z-10 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-black text-white">-{off}%</span>
              ) : null}
              <ProductImage src={product.image_url} name={product.name} eager={index === 0} />
              <div className="mt-2.5 px-0.5 pb-1">
                <p className="line-clamp-2 min-h-[34px] text-[12.5px] font-semibold leading-tight text-[var(--bio-fg)]">{product.name}</p>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <p className="text-[16px] font-black leading-none text-[var(--bio-fg)]">{formatCurrency(show)}</p>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-white">
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}

function CategoriesBlock({ data, block }: { data: BioPageData; block: Extract<BioResolvedBlock, { type: "categories" }> }) {
  return (
    <section data-bio-block={block.id} data-bio-type={block.type}>
      <BlockHeader title={block.title} subtitle={block.subtitle} />
      <div className="grid grid-cols-2 gap-3">
        {block.items.map((item, index) => (
          <a key={item.id}
            href={getClickHref({ data, block, url: item.url, event: "bio_category_clicked", category: item.label })}
            className="group relative flex aspect-[4/5] items-end overflow-hidden rounded-2xl border border-[var(--bio-border)] bg-neutral-900 shadow-sm transition active:scale-[0.98]">
            {item.cover_image_url ? (
              <img
                src={item.cover_image_url}
                alt={item.label}
                loading={index < 2 ? "eager" : "lazy"}
                className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-neutral-900 text-white/15">
                <ShoppingBag className="h-9 w-9" />
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
            <div className="relative z-10 flex w-full items-center justify-between gap-1 p-3">
              <div className="min-w-0">
                <span className="block truncate text-[15px] font-black uppercase leading-tight tracking-tight text-white drop-shadow">{item.label}</span>
                {item.metric ? (
                  <span className="mt-0.5 block text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/70">{item.metric}</span>
                ) : null}
              </div>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/95 text-neutral-950">
                <ArrowUpRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

function LinkBlock({ data, block }: { data: BioPageData; block: Extract<BioResolvedBlock, { type: "group" | "club" | "shipping" }> }) {
  const isGroup = block.type === "group";
  const Icon = isGroup ? MessageCircle : ShieldCheck;
  const event = isGroup ? "bio_group_clicked" : "bio_club_clicked";
  const cta = block.cta_label || (isGroup ? "Entrar" : "Ativar");
  const accent = isGroup
    ? { card: "border-emerald-300 bg-emerald-50", icon: "bg-emerald-500" }
    : { card: "border-amber-300 bg-amber-50", icon: "bg-neutral-950" };
  return (
    <a data-bio-block={block.id} data-bio-type={block.type}
      href={getClickHref({ data, block, url: block.url || data.storeBaseUrl, event })}
      className={`flex items-center gap-3.5 rounded-2xl border-2 ${accent.card} p-4 shadow-sm transition active:scale-[0.99]`}>
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${accent.icon} text-white`}>
        <Icon className="h-[22px] w-[22px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-black leading-tight text-neutral-950">{block.title}</span>
        {block.subtitle ? <span className="mt-0.5 block text-[12.5px] font-medium leading-snug text-neutral-600">{block.subtitle}</span> : null}
      </span>
      <span className="shrink-0 rounded-full bg-neutral-950 px-3.5 py-2 text-[12px] font-black uppercase tracking-tight text-white">{cta}</span>
    </a>
  );
}

function ReviewsBlock({ block }: { block: Extract<BioResolvedBlock, { type: "reviews" }> }) {
  return (
    <section data-bio-block={block.id} data-bio-type={block.type}>
      <div className="mb-3.5 flex items-end justify-between gap-3 px-0.5">
        <div>
          <h2 className="text-[19px] font-black leading-tight tracking-tight text-[var(--bio-fg)]">{block.title}</h2>
          {block.subtitle ? <p className="mt-1 text-[13.5px] leading-snug text-[var(--bio-muted)]">{block.subtitle}</p> : null}
        </div>
        <div className="shrink-0 rounded-xl border border-[var(--bio-border)] bg-[var(--bio-card)] px-3 py-1.5 text-center shadow-sm">
          <p className="flex items-center gap-1 text-[17px] font-black leading-none text-[var(--bio-fg)]"><Star className="h-3.5 w-3.5 fill-current" />{block.summary.average.toFixed(1)}</p>
          <p className="mt-0.5 text-[10px] font-semibold text-[var(--bio-muted)]">{block.summary.total} avaliações</p>
        </div>
      </div>
      <div className="flex snap-x gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {block.reviews.map((review) => (
          <article key={review.id} className="min-w-[80%] snap-start rounded-2xl border border-[var(--bio-border)] bg-[var(--bio-card)] p-4 shadow-sm sm:min-w-[72%]">
            <div className="mb-2.5 flex items-center gap-0.5 text-neutral-950">
              {Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`h-3.5 w-3.5 ${i < Math.round(review.rating) ? "fill-current" : "text-neutral-200"}`} />)}
            </div>
            <p className="text-[13.5px] leading-relaxed text-[var(--bio-fg)]">"{review.body}"</p>
            <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--bio-muted)]">{review.author}</p>
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
  if (block.type === "shipping") return <ShippingBar data={data} block={block} />;
  return <LinkBlock data={data} block={block} />;
}

export default async function BioPage() {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") || headerList.get("host") || "";
  const data = await getCachedBioPageData(host);

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

  const reviewsBlock = data.blocks.find(
    (block): block is Extract<BioResolvedBlock, { type: "reviews" }> => block.type === "reviews"
  );

  return (
    <main style={style} className="min-h-screen overflow-x-hidden bg-[var(--bio-bg)] text-[var(--bio-fg)]">
      <BioTracker workspaceId={data.workspaceId} blocks={data.blocks.map((block) => ({ id: block.id, type: block.type }))} />
      <div className="mx-auto min-h-screen w-full max-w-[480px] px-4 pb-12 pt-5">
        {/* Header — enxuto, com indicador "ao vivo" */}
        <header className="mb-5 flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-neutral-950 text-lg font-black text-white">
            {data.config.avatar_url ? (
              <img src={data.config.avatar_url} alt={data.config.brand_name} loading="eager" className="h-full w-full object-cover" />
            ) : (data.config.brand_name.slice(0, 1).toUpperCase())}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-black leading-tight tracking-tight">{data.config.headline}</p>
            {reviewsBlock ? (
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] leading-snug text-[var(--bio-muted)]">
                <span className="inline-flex items-center gap-1 font-bold text-[var(--bio-fg)]">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  {reviewsBlock.summary.average.toFixed(1)}
                </span>
                <span>{reviewsBlock.summary.total.toLocaleString("pt-BR")}+ avaliacoes</span>
                <span className="inline-flex items-center gap-1">
                  <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" /></span>
                  ao vivo
                </span>
              </p>
            ) : (
              <p className="mt-0.5 flex items-center gap-1.5 text-[12px] leading-snug text-[var(--bio-muted)]">
                <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" /></span>
                Ofertas atualizadas agora
              </p>
            )}
          </div>
        </header>

        <div className="space-y-5">
          {data.blocks.map((block) => (
            <ResolvedBlock key={block.id} data={data} block={block} />
          ))}
        </div>

        <footer className="px-4 pt-9 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--bio-muted)]">
          bulking.com.br
        </footer>
      </div>
    </main>
  );
}

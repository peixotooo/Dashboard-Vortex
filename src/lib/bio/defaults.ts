import type { BioBlockConfig, BioPageConfig, BioThemeConfig } from "@/lib/bio/types";

export const BIO_PUBLIC_HOSTS = (
  process.env.BIO_PUBLIC_HOSTS || "bio.bulking.com.br"
)
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);

export const BIO_DEFAULT_PUBLIC_DOMAIN =
  process.env.BIO_PUBLIC_DOMAIN || BIO_PUBLIC_HOSTS[0] || "bio.bulking.com.br";

export const BIO_DEFAULT_STORE_URL =
  (process.env.BIO_STORE_BASE_URL || "https://www.bulking.com.br").replace(/\/$/, "");

export const BIO_DEFAULT_UTM_CAMPAIGN =
  process.env.BIO_DEFAULT_UTM_CAMPAIGN || "instagram_bio";

export const BIO_THEME_DEFAULT: BioThemeConfig = {
  background: "#f5f5f4",
  foreground: "#0a0a0a",
  muted: "#737373",
  card: "#ffffff",
  border: "#dedbd5",
  accent: "#0a0a0a",
  accentForeground: "#ffffff",
};

export const BIO_DEFAULT_BLOCKS: BioBlockConfig[] = [
  {
    id: "hero",
    type: "hero",
    enabled: true,
    title: "O que esta valendo agora na Bulking",
    subtitle: "Ofertas ativas, produtos mais buscados e atalhos rapidos para comprar sem perder tempo.",
    cta_label: "Ver acao atual",
    url: `${BIO_DEFAULT_STORE_URL}/combos`,
    source: "active_topbar",
  },
  {
    id: "categories",
    type: "categories",
    enabled: true,
    title: "Ir direto para",
    subtitle: "Os caminhos mais rapidos da loja hoje.",
    source: "automatic",
    items: [
      { id: "combos", label: "Combos", url: `${BIO_DEFAULT_STORE_URL}/combos` },
      { id: "camisetas", label: "Camisetas", url: `${BIO_DEFAULT_STORE_URL}/camisetas` },
      { id: "lancamentos", label: "Lancamentos", url: `${BIO_DEFAULT_STORE_URL}/lancamentos` },
      { id: "mais-vendidos", label: "Mais vendidos", url: `${BIO_DEFAULT_STORE_URL}/mais-vendidos` },
    ],
  },
  {
    id: "bestsellers",
    type: "products",
    enabled: true,
    title: "Mais vendidos agora",
    subtitle: "Uma selecao curta do que mais esta saindo.",
    algorithm: "bestsellers",
    limit: 4,
  },
  {
    id: "offers",
    type: "products",
    enabled: true,
    title: "Ofertas em destaque",
    subtitle: "Boas oportunidades com estoque ativo.",
    algorithm: "offers",
    limit: 4,
  },
  {
    id: "group",
    type: "group",
    enabled: true,
    title: "Grupo VIP no WhatsApp",
    subtitle: "Drops, condicoes e avisos antes de todo mundo.",
    cta_label: "Entrar no grupo",
    url: "https://grupos.bulking.com.br",
    pool_slug: "vip",
  },
  {
    id: "club",
    type: "club",
    enabled: true,
    title: "Bulking Club",
    subtitle: "Cashback, beneficios e vantagens para voltar comprando melhor.",
    cta_label: "Conhecer o clube",
    url: BIO_DEFAULT_STORE_URL,
  },
  {
    id: "shipping",
    type: "shipping",
    enabled: true,
    title: "Frete e beneficios",
    subtitle: "Veja as regras ativas antes de finalizar.",
    cta_label: "Ver ofertas com frete",
    url: `${BIO_DEFAULT_STORE_URL}/combos`,
  },
  {
    id: "reviews",
    type: "reviews",
    enabled: true,
    title: "Quem compra, volta",
    subtitle: "Avaliacoes reais recentes da loja.",
    limit: 5,
  },
];

export function getDefaultBioConfig(workspaceId: string): BioPageConfig {
  return {
    workspace_id: workspaceId,
    enabled: true,
    slug: "bulking",
    public_domain: BIO_DEFAULT_PUBLIC_DOMAIN,
    store_base_url: BIO_DEFAULT_STORE_URL,
    brand_name: "Bulking",
    headline: "Bulking",
    subtitle: "Ofertas, mais vendidos, grupo VIP e beneficios em um lugar so.",
    avatar_url: null,
    default_utm_campaign: BIO_DEFAULT_UTM_CAMPAIGN,
    blocks: BIO_DEFAULT_BLOCKS.map((block) => ({ ...block })),
    theme: { ...BIO_THEME_DEFAULT },
    updated_at: null,
  };
}

export interface Feature {
  id: string;
  label: string;
  description: string;
  routes: string[];
  /**
   * If set, this feature is a sub-feature of the given parent.
   * Granting the parent ID implicitly grants every sub-feature under it.
   * Granting a sub ID only grants that specific sub-feature.
   */
  parent?: string;
}

export const FEATURES: Feature[] = [
  // ===== Time =====
  {
    id: "team",
    label: "Time",
    description: "Mission Control, Chat, Kanban, Entregas e Planejamento",
    routes: ["/team"],
  },
  {
    id: "team.mission_control",
    label: "Mission Control",
    description: "Reports, COO Review, Growth Board e Learnings",
    routes: ["/team/mission-control"],
    parent: "team",
  },
  {
    id: "team.chat",
    label: "Chat",
    description: "Chat do time",
    routes: ["/team/chat"],
    parent: "team",
  },
  {
    id: "team.kanban",
    label: "Kanban",
    description: "Quadro Kanban do time",
    routes: ["/team/kanban"],
    parent: "team",
  },
  {
    id: "team.deliverables",
    label: "Entregas",
    description: "Entregas do time",
    routes: ["/team/deliverables"],
    parent: "team",
  },
  {
    id: "team.planning",
    label: "Planejamento",
    description: "Calendario de planejamento",
    routes: ["/team/planning"],
    parent: "team",
  },
  {
    id: "team.agents",
    label: "Agents",
    description: "Agents internos do time",
    routes: ["/team/agents"],
    parent: "team",
  },

  // ===== Vortex IA =====
  {
    id: "agent",
    label: "Vortex IA",
    description: "Agente de inteligencia artificial",
    routes: ["/agent"],
  },

  // ===== Marketing =====
  {
    id: "meta_ads",
    label: "Meta Ads",
    description: "Campanhas, Audiencias e Criativos",
    routes: ["/campaigns", "/audiences", "/creatives"],
  },
  {
    id: "meta_ads.campaigns",
    label: "Campanhas",
    description: "Campanhas Meta Ads",
    routes: ["/campaigns"],
    parent: "meta_ads",
  },
  {
    id: "meta_ads.audiences",
    label: "Audiencias",
    description: "Audiencias Meta Ads",
    routes: ["/audiences"],
    parent: "meta_ads",
  },
  {
    id: "meta_ads.creatives",
    label: "Criativos",
    description: "Criativos Meta Ads",
    routes: ["/creatives"],
    parent: "meta_ads",
  },
  {
    id: "google_ads",
    label: "Google Ads",
    description: "Campanhas Google Ads",
    routes: ["/google-ads"],
  },
  {
    id: "ga4",
    label: "Google Analytics",
    description: "Dados do GA4",
    routes: ["/ga4"],
  },

  // ===== Loja =====
  {
    id: "loja",
    label: "Loja",
    description: "Produtos, Prateleiras, Régua de Brinde, Etiquetas e Cupons",
    routes: ["/vnda", "/products", "/shelves", "/gift-bar", "/promo-tags", "/coupons"],
  },
  {
    id: "loja.vnda",
    label: "Loja (VNDA)",
    description: "Dashboard da loja",
    routes: ["/vnda"],
    parent: "loja",
  },
  {
    id: "loja.products",
    label: "Produtos",
    description: "Catalogo de produtos",
    routes: ["/products"],
    parent: "loja",
  },
  {
    id: "loja.shelves",
    label: "Prateleiras",
    description: "Prateleiras de recomendacao",
    routes: ["/shelves"],
    parent: "loja",
  },
  {
    id: "loja.gift_bar",
    label: "Régua de Brinde",
    description: "Régua de brindes",
    routes: ["/gift-bar"],
    parent: "loja",
  },
  {
    id: "loja.promo_tags",
    label: "Etiquetas Promo",
    description: "Etiquetas promocionais",
    routes: ["/promo-tags"],
    parent: "loja",
  },
  {
    id: "loja.coupons",
    label: "Cupons Auto",
    description: "Cupons automaticos",
    routes: ["/coupons"],
    parent: "loja",
  },

  // ===== CRM =====
  {
    id: "crm",
    label: "CRM",
    description: "CRM, Cashback, WhatsApp, Email e Grupos",
    routes: ["/crm", "/whatsapp-groups"],
  },
  {
    id: "crm.dashboard",
    label: "CRM Dashboard",
    description: "Dashboard CRM",
    routes: ["/crm"],
    parent: "crm",
  },
  {
    id: "crm.cashback",
    label: "Cashback",
    description: "Cashback de clientes",
    routes: ["/crm/cashback"],
    parent: "crm",
  },
  {
    id: "crm.whatsapp",
    label: "WhatsApp",
    description: "WhatsApp 1-a-1",
    routes: ["/crm/whatsapp"],
    parent: "crm",
  },
  {
    id: "crm.email_templates",
    label: "Email Templates",
    description: "Templates e disparos de email",
    routes: ["/crm/email-templates"],
    parent: "crm",
  },
  {
    id: "crm.whatsapp_groups",
    label: "WhatsApp Grupos",
    description: "Disparos via grupos do WhatsApp",
    routes: ["/whatsapp-groups"],
    parent: "crm",
  },

  // ===== Hub ML =====
  {
    id: "hub",
    label: "Hub ML",
    description: "Integracao Eccosys e Mercado Livre",
    routes: ["/hub"],
  },
  {
    id: "hub.dashboard",
    label: "Hub Dashboard",
    description: "Dashboard do Hub",
    routes: ["/hub"],
    parent: "hub",
  },
  {
    id: "hub.produtos",
    label: "Hub Produtos",
    description: "Produtos sincronizados",
    routes: ["/hub/produtos"],
    parent: "hub",
  },
  {
    id: "hub.pedidos",
    label: "Hub Pedidos",
    description: "Pedidos do Hub",
    routes: ["/hub/pedidos"],
    parent: "hub",
  },
  {
    id: "hub.pre_cadastro",
    label: "Pre-Cadastro",
    description: "Pre-cadastro de produtos",
    routes: ["/hub/pre-cadastro"],
    parent: "hub",
  },
  {
    id: "hub.logs",
    label: "Hub Logs",
    description: "Logs de sincronizacao",
    routes: ["/hub/logs"],
    parent: "hub",
  },

  // ===== Financeiro =====
  {
    id: "financeiro",
    label: "Financeiro",
    description: "Simulador, Diagnostico, Escala, Config e Comercial",
    routes: ["/simulador", "/simulador-comercial"],
  },
  {
    id: "financeiro.simulador",
    label: "Simulador",
    description: "Simulador financeiro",
    routes: ["/simulador"],
    parent: "financeiro",
  },
  {
    id: "financeiro.diagnostico",
    label: "Diagnostico",
    description: "Diagnostico financeiro",
    routes: ["/simulador/diagnostico"],
    parent: "financeiro",
  },
  {
    id: "financeiro.escala",
    label: "Escala",
    description: "Projecao de escala",
    routes: ["/simulador/escala"],
    parent: "financeiro",
  },
  {
    id: "financeiro.config",
    label: "Configuracoes Financeiro",
    description: "Configuracoes do simulador",
    routes: ["/simulador/config"],
    parent: "financeiro",
  },
  {
    id: "financeiro.comercial",
    label: "Comercial",
    description: "Simulador comercial por produto + macro",
    routes: ["/simulador-comercial"],
    parent: "financeiro",
  },

  // ===== Galeria =====
  {
    id: "media",
    label: "Galeria",
    description: "Galeria de midia",
    routes: ["/media"],
  },
];

export const PARENT_FEATURES: Feature[] = FEATURES.filter((f) => !f.parent);
export const ALL_FEATURE_IDS = FEATURES.map((f) => f.id);
export const PARENT_FEATURE_IDS = PARENT_FEATURES.map((f) => f.id);

const FEATURE_BY_ID = new Map<string, Feature>();
for (const f of FEATURES) FEATURE_BY_ID.set(f.id, f);

const SUBS_BY_PARENT = new Map<string, Feature[]>();
for (const f of FEATURES) {
  if (f.parent) {
    if (!SUBS_BY_PARENT.has(f.parent)) SUBS_BY_PARENT.set(f.parent, []);
    SUBS_BY_PARENT.get(f.parent)!.push(f);
  }
}

export function getSubFeatures(parentId: string): Feature[] {
  return SUBS_BY_PARENT.get(parentId) || [];
}

export function getFeatureById(id: string): Feature | undefined {
  return FEATURE_BY_ID.get(id);
}

const ROUTE_TO_FEATURE: Array<{ route: string; featureId: string }> = [];
for (const feature of FEATURES) {
  for (const route of feature.routes) {
    ROUTE_TO_FEATURE.push({ route, featureId: feature.id });
  }
}
// Sort longest first so longest-prefix wins (sub-features beat parents).
ROUTE_TO_FEATURE.sort((a, b) => b.route.length - a.route.length);

/**
 * Given a pathname, return the most specific feature ID it belongs to.
 * Returns null for unrestricted routes (Overview, Settings).
 */
export function getFeatureForPath(pathname: string): string | null {
  for (const { route, featureId } of ROUTE_TO_FEATURE) {
    if (pathname === route) return featureId;
    if (pathname.startsWith(route + "/")) return featureId;
  }
  return null;
}

/**
 * Whether a user with the given role and features list can access pathname.
 *
 * Rules:
 * - owner/admin: always allowed
 * - features === null: full access (legacy behavior)
 * - exact-match feature granted: allowed
 * - parent of matched sub-feature granted: allowed (granting parent grants subs)
 * - matched is a parent and user has any sub-feature under it: allowed
 *   (so they can navigate the parent route and reach their granted subs)
 */
export function canAccessPath(
  pathname: string,
  role: string | null,
  features: string[] | null
): boolean {
  if (role === "owner" || role === "admin") return true;
  const matchedId = getFeatureForPath(pathname);
  if (!matchedId) return true;
  if (!features) return true;

  if (features.includes(matchedId)) return true;

  const matched = FEATURE_BY_ID.get(matchedId);
  if (matched?.parent && features.includes(matched.parent)) return true;

  if (!matched?.parent) {
    // matched is a parent — allow if user has any sub under it
    const subs = SUBS_BY_PARENT.get(matchedId) || [];
    if (subs.some((s) => features.includes(s.id))) return true;
  }

  return false;
}

/**
 * Given a member's features array, expand parent IDs into all their
 * sub-feature IDs. Useful for UI rendering where each toggle is independent.
 */
export function expandFeatures(features: string[] | null): string[] {
  if (!features) return [...ALL_FEATURE_IDS];
  const out = new Set<string>();
  for (const id of features) {
    out.add(id);
    const subs = SUBS_BY_PARENT.get(id);
    if (subs) for (const s of subs) out.add(s.id);
  }
  return [...out];
}

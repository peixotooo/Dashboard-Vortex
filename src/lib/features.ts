export interface Feature {
  id: string;
  label: string;
  description: string;
  routes: string[];
}

export const FEATURES: Feature[] = [
  {
    id: "mission_control",
    label: "Mission Control",
    description: "Cerebro operacional do Atlas — demandas, cobrancas, bloqueios, decisoes e aprendizados",
    routes: ["/mission-control"],
  },
  {
    id: "team",
    label: "Time",
    description: "Chat, Kanban, Entregas e Planejamento",
    routes: ["/team"],
  },
  {
    id: "agent",
    label: "Vortex IA",
    description: "Agente de inteligencia artificial",
    routes: ["/agent"],
  },
  {
    id: "meta_ads",
    label: "Meta Ads",
    description: "Campanhas, Audiencias e Criativos",
    routes: ["/campaigns", "/audiences", "/creatives"],
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
  {
    id: "loja",
    label: "Loja",
    description: "Produtos, Prateleiras e Régua de Brinde",
    routes: ["/vnda", "/products", "/shelves", "/gift-bar"],
  },
  {
    id: "crm",
    label: "CRM",
    description: "CRM, WhatsApp e WhatsApp Grupos",
    routes: ["/crm", "/whatsapp-groups"],
  },
  {
    id: "hub",
    label: "Hub ML",
    description: "Integracao Eccosys e Mercado Livre",
    routes: ["/hub"],
  },
  {
    id: "financeiro",
    label: "Financeiro",
    description: "Simulador, Diagnostico, Escala e Configuracoes",
    routes: ["/simulador"],
  },
  {
    id: "media",
    label: "Galeria",
    description: "Galeria de midia",
    routes: ["/media"],
  },
];

export const ALL_FEATURE_IDS = FEATURES.map((f) => f.id);

const ROUTE_TO_FEATURE = new Map<string, string>();
for (const feature of FEATURES) {
  for (const route of feature.routes) {
    ROUTE_TO_FEATURE.set(route, feature.id);
  }
}

/**
 * Given a pathname, return the feature ID it belongs to,
 * or null if it's an unrestricted route (Overview, Settings).
 */
export function getFeatureForPath(pathname: string): string | null {
  if (ROUTE_TO_FEATURE.has(pathname)) {
    return ROUTE_TO_FEATURE.get(pathname)!;
  }
  let bestMatch: string | null = null;
  let bestLen = 0;
  for (const [route, featureId] of ROUTE_TO_FEATURE) {
    if (pathname.startsWith(route) && route.length > bestLen) {
      bestMatch = featureId;
      bestLen = route.length;
    }
  }
  return bestMatch;
}

/**
 * Check whether a user with the given role and features list
 * can access the given pathname.
 */
export function canAccessPath(
  pathname: string,
  role: string | null,
  features: string[] | null
): boolean {
  if (role === "owner" || role === "admin") return true;
  const featureId = getFeatureForPath(pathname);
  if (!featureId) return true;
  if (!features) return true;
  return features.includes(featureId);
}

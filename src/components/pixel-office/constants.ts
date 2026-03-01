// --- Types ---

export interface AgentWithStats {
  id: string;
  name: string;
  slug: string;
  description: string;
  avatar_color: string;
  is_default: boolean;
  status: string;
  active_tasks: number;
  total_deliverables: number;
}

export interface DepartmentDef {
  id: string;
  label: string;
  color: string;
  slugs: string[];
}

// --- Departments ---

export const DEPARTMENTS: DepartmentDef[] = [
  {
    id: "copy",
    label: "Copy & Comunicacao",
    color: "#EC4899",
    slugs: ["copywriting", "copy-editing", "email-sequence", "cold-email"],
  },
  {
    id: "seo",
    label: "SEO & Conteudo",
    color: "#10B981",
    slugs: [
      "seo-audit",
      "ai-seo",
      "programmatic-seo",
      "schema-markup",
      "site-architecture",
      "content-strategy",
      "social-content",
    ],
  },
  {
    id: "cro",
    label: "CRO",
    color: "#EF4444",
    slugs: [
      "page-cro",
      "form-cro",
      "signup-flow-cro",
      "onboarding-cro",
      "popup-cro",
      "paywall-upgrade-cro",
      "ab-test-setup",
    ],
  },
  {
    id: "ads",
    label: "Midia Paga",
    color: "#3B82F6",
    slugs: ["paid-ads", "ad-creative", "analytics-tracking"],
  },
  {
    id: "strategy",
    label: "Estrategia",
    color: "#8B5CF6",
    slugs: [
      "launch-strategy",
      "pricing-strategy",
      "marketing-psychology",
      "marketing-ideas",
      "free-tool-strategy",
    ],
  },
  {
    id: "revenue",
    label: "Revenue",
    color: "#14B8A6",
    slugs: [
      "churn-prevention",
      "referral-program",
      "revops",
      "sales-enablement",
      "competitor-alternatives",
    ],
  },
];

// --- Sprite Data ---

// 16 wide x 20 tall pixel character (seated at desk)
// Tokens: _ transparent, H hair, S skin, E eye, M mouth, B body (shirt), A arm, P pants
export const SPRITE_NORMAL: string[][] = [
  //0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
  ["_","_","_","_","_","H","H","H","H","H","H","_","_","_","_","_"], // 0
  ["_","_","_","_","H","H","H","H","H","H","H","H","_","_","_","_"], // 1
  ["_","_","_","H","H","H","H","H","H","H","H","H","H","_","_","_"], // 2
  ["_","_","_","H","H","H","H","H","H","H","H","H","H","_","_","_"], // 3
  ["_","_","_","S","S","S","S","S","S","S","S","S","S","_","_","_"], // 4
  ["_","_","_","S","S","E","S","S","S","E","S","S","S","_","_","_"], // 5
  ["_","_","_","S","S","E","S","S","S","E","S","S","S","_","_","_"], // 6
  ["_","_","_","S","S","S","S","S","S","S","S","S","S","_","_","_"], // 7
  ["_","_","_","S","S","S","S","M","S","S","S","S","S","_","_","_"], // 8
  ["_","_","_","_","S","S","S","S","S","S","S","S","_","_","_","_"], // 9
  ["_","_","_","_","_","B","B","B","B","B","B","_","_","_","_","_"], // 10 neck
  ["_","_","A","B","B","B","B","B","B","B","B","B","B","A","_","_"], // 11
  ["_","_","A","B","B","B","B","B","B","B","B","B","B","A","_","_"], // 12
  ["_","_","A","B","B","B","B","B","B","B","B","B","B","A","_","_"], // 13
  ["_","_","S","B","B","B","B","B","B","B","B","B","B","S","_","_"], // 14 hands
  ["_","_","_","B","B","B","B","B","B","B","B","B","B","_","_","_"], // 15
  ["_","_","_","P","P","P","P","P","P","P","P","P","P","_","_","_"], // 16
  ["_","_","_","P","P","P","P","P","P","P","P","P","P","_","_","_"], // 17
  ["_","_","_","P","P","P","_","_","_","P","P","P","_","_","_","_"], // 18
  ["_","_","_","P","P","P","_","_","_","P","P","P","_","_","_","_"], // 19
];

// CMO variant: has suit jacket collar + crown
export const SPRITE_CMO_CROWN: string[][] = [
  //0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
  ["_","_","_","_","_","_","C","_","C","_","C","_","_","_","_","_"], // crown
  ["_","_","_","_","_","C","C","C","C","C","C","C","_","_","_","_"], // crown base
];

// --- Color Palettes ---

export const HAIR_COLORS = [
  "#1a1a2e", // very dark blue-black
  "#2d1b00", // dark brown
  "#4a2800", // brown
  "#1a0a00", // near black
  "#3d2b1f", // dark auburn
  "#0d0d0d", // black
];

export const SKIN_COLORS = [
  "#e8b887", // light
  "#d4956b", // medium
  "#b5784e", // tan
  "#8d5c3e", // dark
];

export const CROWN_COLOR = "#fbbf24"; // amber-400
export const EYE_COLOR = "#0f0f1a";
export const MOUTH_COLOR = "#c4856a";
export const PANTS_COLOR = "#1e1e2e";

// --- Helpers ---

export function hashSlug(slug: string): number {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function darkenColor(hex: string, amount: number): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

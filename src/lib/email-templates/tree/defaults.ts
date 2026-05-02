// src/lib/email-templates/tree/defaults.ts
//
// Factory + palette descriptor for the tree editor's "Adicionar bloco" tab.
// Mirrors the legacy block palette but emits LeafNode shapes instead.

import type { LeafNode } from "./schema";
import { newId } from "./schema";

export type LeafType = LeafNode["type"];

export function defaultLeaf(type: LeafType): LeafNode {
  const id = newId();
  switch (type) {
    case "heading":
      return { id, type, text: "Título", align: "center" };
    case "text":
      return { id, type, text: "Escreva aqui...", align: "center" };
    case "eyebrow":
      return { id, type, text: "EYEBROW", align: "center" };
    case "button":
      return { id, type, text: "Ver na loja", href: "https://www.bulking.com.br", variant: "primary" };
    case "image":
      return { id, type, src: "", alt: "", ratio: "3:4" };
    case "spacer":
      return { id, type, height: 24 };
    case "divider":
      return { id, type };
    case "rating":
      return { id, type, rating: 5 };
    case "discount-badge":
      return { id, type, discount_percent: 10 };
    case "coupon":
      return { id, type, code: "EMAIL-XXXXX", discount_percent: 10, product_name: "Produto" };
    case "countdown":
      return { id, type, expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() };
    case "product-meta":
      return { id, type, name: "Produto", price: 0 };
    case "product-card":
      return {
        id,
        type,
        product: {
          vnda_id: "",
          name: "Produto",
          price: 0,
          image_url: "",
          url: "",
        },
      };
    case "product-grid":
      return { id, type, products: [], columns: 3 };
    case "slash-labels":
      return { id, type, labels: ["BULKING", "2026"], align: "center" };
    case "logo":
      return {
        id,
        type,
        image_url:
          "https://cdn.vnda.com.br/bulking/2023/12/01/18_12_2_290_logobulkingsite.svg?v=1701465320",
        width: 148,
        alt: "BULKING",
      };
  }
}

export const TREE_PALETTE: Array<{
  type: LeafType;
  label: string;
  description: string;
  group: "header" | "content" | "commerce" | "structural";
}> = [
  { type: "eyebrow", label: "Eyebrow", description: "Tagline acima do conteúdo", group: "header" },
  { type: "image", label: "Imagem", description: "Hero / produto / banner", group: "header" },
  { type: "heading", label: "Headline", description: "Título grande", group: "content" },
  { type: "text", label: "Texto", description: "Parágrafo", group: "content" },
  { type: "rating", label: "Estrelas", description: "Avaliação 0–5", group: "content" },
  { type: "button", label: "Botão CTA", description: "Botão preto com link", group: "content" },
  { type: "product-meta", label: "Preço + nome", description: "Bloco de preço", group: "commerce" },
  { type: "product-card", label: "Card de produto", description: "Card com foto + preço + botão", group: "commerce" },
  { type: "product-grid", label: "Grade de produtos", description: "2/3/4 cells por linha", group: "commerce" },
  { type: "discount-badge", label: "Selo de %", description: "Badge com desconto", group: "commerce" },
  { type: "coupon", label: "Cupom", description: "Código + % off", group: "commerce" },
  { type: "countdown", label: "Countdown", description: "Timer animado", group: "commerce" },
  { type: "slash-labels", label: "Slash labels", description: "AUTHENTIC / WORN / TESTED", group: "content" },
  { type: "spacer", label: "Espaço", description: "Espaço vertical", group: "structural" },
  { type: "divider", label: "Divisor", description: "Linha horizontal", group: "structural" },
];

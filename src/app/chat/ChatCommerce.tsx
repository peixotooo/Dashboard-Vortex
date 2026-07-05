"use client";

// Chat Commerce v2 — vitrine + vendedor + caixa numa página de chat.
//
// Dark, mobile-first (estilo app). O cliente conversa, vê carrosséis de produto,
// prova social, benefícios e promoções, e vai montando a SACOLA dentro do chat.
// Ao finalizar, um handoff leva os itens pro carrinho da loja (VNDA) e checkout.
//
// Segurança: só consome os endpoints públicos do assistente (chat + cart-resolve),
// sempre com a API key pública. Nenhum segredo aqui.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Send,
  ShoppingBag,
  Star,
  Check,
  Plus,
  Minus,
  X,
  Loader2,
  ArrowRight,
  Sparkles,
  BadgePercent,
  MessageCircle,
  Trash2,
  Flame,
  Shirt,
  Venus,
  Wand2,
} from "lucide-react";

// ---- Tipos (espelho de AssistantBlock, lado cliente) ----

export interface ChatBootstrap {
  publicKey: string;
  title: string;
  welcome: string;
  suggestions: string[];
  askName: boolean;
  storeUrl: string;
  whatsapp: string;
  giftSteps: Array<{ threshold: number; gift: string }>;
  /** Mais vendidos pré-carregados pro onboarding (carrossel na tela inicial). */
  bestsellers?: ProductCard[];
}

// Atalhos de categoria do onboarding: cada um manda uma pergunta pro assistente.
const ONBOARDING_SHORTCUTS: Array<{ label: string; query: string; icon: React.ReactNode }> = [
  { label: "Mais vendidos", query: "Quais são os mais vendidos?", icon: <Flame className="h-4 w-4" /> },
  { label: "Lançamentos", query: "Me mostra os lançamentos", icon: <Sparkles className="h-4 w-4" /> },
  { label: "Camisetas", query: "Me mostra as camisetas", icon: <Shirt className="h-4 w-4" /> },
  { label: "Feminino", query: "Quero ver a linha feminina", icon: <Venus className="h-4 w-4" /> },
  { label: "Promoções", query: "Quais as promoções de hoje?", icon: <BadgePercent className="h-4 w-4" /> },
  { label: "Montar um look", query: "Me ajuda a montar um look", icon: <Wand2 className="h-4 w-4" /> },
];

interface ProductCard {
  id: string;
  name: string;
  url: string;
  image_url: string | null;
  price: number | null;
  sale_price: number | null;
  available: boolean;
}

type Block =
  | { type: "text"; text: string }
  | { type: "products"; layout: "carousel" | "cards"; title?: string; products: ProductCard[] }
  | {
      type: "reviews";
      data: {
        scope: "product" | "store";
        productName?: string;
        average: number;
        count: number;
        highlights: Array<{ rating: number; body: string; author: string }>;
      };
    }
  | { type: "benefits"; data: { items: string[]; cashbackPercent: number } }
  | { type: "promo"; data: { lines: string[] } }
  | { type: "cart_add"; data: { productId: string; size: string | null } }
  | { type: "whatsapp" };

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text?: string;
  blocks?: Block[];
  pending?: boolean;
}

interface CartItem {
  sku: string;
  productId: string;
  size: string | null;
  name: string;
  price: number; // preço vigente (sale se houver)
  image: string | null;
  url: string | null;
  qty: number;
}

// ---- Helpers ----

function brl(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  return `R$ ${v.toFixed(2).replace(".", ",")}`;
}

// UTMs em TODO link que sai pra loja (card, "ver na loja", handoff) pra o GA4
// da loja atribuir a visita/compra ao chat.
function withUtm(url: string, productId?: string): string {
  if (!url) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("utm_source", "chat");
    u.searchParams.set("utm_medium", "assistant");
    u.searchParams.set("utm_campaign", "chat_commerce");
    if (productId) u.searchParams.set("utm_content", productId);
    return u.toString();
  } catch {
    return url;
  }
}

// Faixa de valor (nunca o R$ cru no cliente — o valor real entra server-side
// via webhook VNDA). Alinha com o value_bucket do funil de tracking.
function valueBucket(v: number): string {
  if (v < 100) return "0-99";
  if (v < 200) return "100-199";
  if (v < 350) return "200-349";
  if (v < 600) return "350-599";
  return "600+";
}

function effectivePrice(p: ProductCard): number | null {
  if (p.sale_price !== null && p.price !== null && p.sale_price < p.price) return p.sale_price;
  if (p.sale_price !== null) return p.sale_price;
  return p.price;
}

function uid(prefix: string, seed: number): string {
  return `${prefix}-${seed}`;
}

interface ResolveResult {
  product_id: string;
  name: string;
  price: number | null;
  sale_price: number | null;
  image_url: string | null;
  url: string | null;
}

interface ProductDetail {
  id: string;
  name: string;
  url: string;
  price: number | null;
  sale_price: number | null;
  available: boolean;
  images: string[];
  composition: string | null;
  fit: string;
  fabric: string;
  shipping: string;
  description: string | null;
  sizes: Array<{ size: string; available: boolean }>;
  size_guide: string | null;
  badges: string[];
}

interface ProductDetailResponse {
  product: ProductDetail;
  reviews: {
    average: number;
    count: number;
    highlights: Array<{ rating: number; body: string; author: string }>;
  } | null;
  benefits: string[];
  cashback_percent: number;
}

function cardFromResolve(r: ResolveResult): ProductCard {
  return {
    id: r.product_id,
    name: r.name,
    url: r.url || "",
    image_url: r.image_url,
    price: r.price,
    sale_price: r.sale_price,
    available: true,
  };
}

// Renderiza texto simples com **negrito** e links (sem HTML cru = XSS-safe).
function RichText({ text }: { text: string }) {
  // remove qualquer marcador residual [[...]]
  const clean = text.replace(/\[\[[^\]]*\]\]/g, "").trim();
  const nodes: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*)|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(clean)) !== null) {
    if (m.index > last) nodes.push(clean.slice(last, m.index));
    if (m[1]) {
      nodes.push(<strong key={k++}>{m[1].slice(2, -2)}</strong>);
    } else if (m[2]) {
      let href = m[2];
      try {
        const u = new URL(href);
        const okHost = /(^|\.)(bulking\.com\.br|troque\.app\.br)$/i.test(u.hostname) || u.hostname === "wa.me";
        if (!okHost) {
          nodes.push(href);
          last = re.lastIndex;
          continue;
        }
      } catch {
        nodes.push(href);
        last = re.lastIndex;
        continue;
      }
      nodes.push(
        <a key={k++} href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-white/30 underline-offset-2 hover:decoration-white">
          {href.replace(/^https?:\/\//, "").replace(/\/$/, "")}
        </a>
      );
    }
    last = re.lastIndex;
  }
  if (last < clean.length) nodes.push(clean.slice(last));
  return <p className="whitespace-pre-wrap leading-relaxed">{nodes}</p>;
}

function Stars({ value, size = 13 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 align-middle">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          style={{ width: size, height: size }}
          className={i <= Math.round(value) ? "fill-amber-400 text-amber-400" : "fill-transparent text-white/25"}
        />
      ))}
    </span>
  );
}

// ---- Componente principal ----

export default function ChatCommerce({ bootstrap }: { bootstrap: ChatBootstrap }) {
  const { publicKey, title, welcome, suggestions, askName, storeUrl, whatsapp, giftSteps } = bootstrap;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [name, setName] = useState<string>("");
  const [nameAsked, setNameAsked] = useState(!askName);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [sizePicker, setSizePicker] = useState<{ product: ProductCard; sizes: string[]; auto?: boolean } | null>(null);
  // Detalhe de produto aberto no chat (galeria/medidas/avaliações/benefícios).
  const [detailView, setDetailView] = useState<{
    product: ProductCard;
    data: ProductDetailResponse | null;
    loading: boolean;
  } | null>(null);
  // Intenção guardada quando pedimos o nome antes da primeira mensagem
  const [pendingIntent, setPendingIntent] = useState<string | null>(null);
  // Blocos [[carrinho]] cujo auto-add falhou (productId → motivo curto)
  const [cartAddFailed, setCartAddFailed] = useState<Record<string, string>>({});

  const seedRef = useRef(0);
  const nextId = () => uid("m", ++seedRef.current);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const processedCartAdds = useRef<Set<string>>(new Set());
  // SKUs já adicionados por marcador/seletor (dedup do fluxo automático). Impede
  // a cobrança dupla quando o modelo repete o [[carrinho]] sem→com tamanho.
  const autoAddedSkus = useRef<Set<string>>(new Set());

  // Telemetria de funil: POST best-effort pra /api/assistant/events. Nunca
  // bloqueia a UI nem quebra se o endpoint falhar (adblock/rede).
  const sendAssistantEvent = useCallback(
    (eventType: string, fields?: Record<string, unknown>) => {
      // atk = sessionId é obrigatório na tabela; sem sessão ainda (antes da 1ª
      // mensagem) não há o que atribuir. O server já emite session_started.
      if (!sessionId) return;
      try {
        // O endpoint lê product_id/value_bucket/product_ids como COLUNAS de topo
        // (não dentro de metadata) — separa esses campos aqui; o resto vira
        // metadata (allowlist no servidor).
        const { product_id, value_bucket, product_ids, ...meta } = fields || {};
        const body = JSON.stringify({
          key: publicKey,
          event_type: eventType,
          session_id: sessionId,
          surface: "global",
          product_id,
          value_bucket,
          product_ids,
          path: typeof window !== "undefined" ? window.location.pathname : undefined,
          metadata: meta,
          occurred_at: new Date().toISOString(),
        });
        if (typeof navigator !== "undefined" && navigator.sendBeacon) {
          navigator.sendBeacon("/api/assistant/events", new Blob([body], { type: "application/json" }));
        } else {
          fetch("/api/assistant/events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        /* ignore */
      }
    },
    [publicKey, sessionId]
  );

  // Restaura sessão/sacola/nome (localStorage) — refresh não perde a sacola.
  // Se houver carimbo de handoff (cliente já foi mandado pro checkout da loja),
  // limpa a sacola AGORA (no retorno ao /chat), não antes do bridge rodar.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = localStorage.getItem("bk_chat_v2");
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.sessionId === "string") setSessionId(s.sessionId);
      if (typeof s.name === "string" && s.name) {
        setName(s.name);
        setNameAsked(true);
      }
      const handedOff = typeof s.handoffAt === "number" && s.handoffAt > 0;
      if (handedOff) {
        // Já finalizou (ou tentou) na loja: começa a sacola zerada e apaga o carimbo.
        setCart([]);
        localStorage.setItem(
          "bk_chat_v2",
          JSON.stringify({ sessionId: s.sessionId, cart: [], name: s.name })
        );
      } else if (Array.isArray(s.cart)) {
        // Valida o schema da sacola salva (evita NaN/sku undefined no checkout).
        const restored = s.cart.filter(
          (i: unknown): i is CartItem =>
            !!i &&
            typeof (i as CartItem).sku === "string" &&
            Number.isFinite((i as CartItem).price) &&
            Number.isFinite((i as CartItem).qty) &&
            (i as CartItem).qty > 0
        );
        setCart(restored);
        // Semeia o dedup com os SKUs já na sacola: sem isso, após um reload o
        // autoAddedSkus (ref em memória) zera e um [[carrinho]] repetido do
        // modelo re-somaria itens que o cliente já tinha (bug da sacola dobrada).
        for (const i of restored) autoAddedSkus.current.add(i.sku);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Persiste estado leve
  useEffect(() => {
    try {
      localStorage.setItem("bk_chat_v2", JSON.stringify({ sessionId, cart, name }));
    } catch {
      /* ignore */
    }
  }, [sessionId, cart, name]);

  // Auto-scroll pro fim quando chega mensagem
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // Funil: cliente abriu a sacola.
  useEffect(() => {
    if (cartOpen) sendAssistantEvent("cart_viewed");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartOpen]);

  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  const cartSubtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);

  // Régua de brinde: próximo degrau ainda não atingido
  const nextGift = useMemo(() => {
    const steps = [...(giftSteps || [])].sort((a, b) => a.threshold - b.threshold);
    return steps.find((s) => cartSubtotal < s.threshold) || null;
  }, [giftSteps, cartSubtotal]);
  const topGift = useMemo(() => {
    const steps = [...(giftSteps || [])].sort((a, b) => b.threshold - a.threshold);
    return steps[0] || null;
  }, [giftSteps]);

  // ---- Carrinho ----

  const addResolvedToCart = useCallback(
    (
      r: {
        sku: string;
        size: string | null;
        product_id: string;
        name: string;
        price: number | null;
        sale_price: number | null;
        image_url: string | null;
        url: string | null;
      },
      dedupe = false
    ) => {
      // dedupe = fluxo automático (marcador/seletor): se o SKU já entrou por esse
      // caminho, NÃO soma de novo (evita a cobrança dupla do sem-tamanho→tamanho).
      if (dedupe && autoAddedSkus.current.has(r.sku)) return;
      autoAddedSkus.current.add(r.sku);
      const price =
        r.sale_price !== null && r.price !== null && r.sale_price < r.price
          ? r.sale_price
          : r.sale_price ?? r.price ?? 0;
      setCart((prev) => {
        const idx = prev.findIndex((i) => i.sku === r.sku);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = { ...copy[idx], qty: copy[idx].qty + 1 };
          return copy;
        }
        return [
          ...prev,
          {
            sku: r.sku,
            productId: r.product_id,
            size: r.size,
            name: r.name,
            price: Number(price) || 0,
            image: r.image_url,
            url: r.url,
            qty: 1,
          },
        ];
      });
      setToast({ text: `Adicionado à sacola: ${r.name}${r.size ? ` (${r.size})` : ""}`, ok: true });
      sendAssistantEvent("add_to_cart", {
        product_id: r.product_id,
        size_present: !!r.size,
      });
    },
    [sendAssistantEvent]
  );

  // Resolve produto+tamanho no SKU e adiciona. Sem tamanho e multi-size → abre picker.
  // dedupe = veio do fluxo automático (marcador do modelo) — não pode somar 2x.
  const addToCart = useCallback(
    async (product: ProductCard, size: string | null, dedupe = false) => {
      try {
        const res = await fetch("/api/assistant/cart-resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: publicKey, product_id: product.id, size }),
        });
        const d = await res.json();
        if (d.ok) {
          addResolvedToCart(d, dedupe);
          return;
        }
        if (d.error === "need_size" || d.error === "size_unavailable") {
          const sizes: string[] = Array.isArray(d.available_sizes) ? d.available_sizes.filter(Boolean) : [];
          if (sizes.length) {
            setSizePicker({ product, sizes, auto: dedupe });
            return;
          }
        }
        setToast({
          text:
            d.error === "unavailable" || d.error === "size_unavailable" || d.error === "need_size"
              ? "Esse item está esgotado no momento."
              : "Não consegui adicionar agora. Tenta de novo?",
          ok: false,
        });
      } catch {
        setToast({ text: "Falha ao adicionar à sacola. Tenta de novo.", ok: false });
      }
    },
    [publicKey, addResolvedToCart]
  );

  // Abre o detalhe de produto no chat: registra o clique (funil) e busca os
  // dados ricos (galeria, medidas, avaliações, benefícios).
  const openProductDetail = useCallback(
    async (product: ProductCard) => {
      sendAssistantEvent("product_card_click", { product_id: product.id });
      setDetailView({ product, data: null, loading: true });
      try {
        const res = await fetch("/api/assistant/product-detail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: publicKey, product_id: product.id }),
        });
        const d = await res.json();
        if (d.ok) {
          setDetailView((cur) =>
            cur && cur.product.id === product.id
              ? { product, data: d as ProductDetailResponse, loading: false }
              : cur
          );
        } else {
          setDetailView((cur) => (cur && cur.product.id === product.id ? { ...cur, loading: false } : cur));
        }
      } catch {
        setDetailView((cur) => (cur && cur.product.id === product.id ? { ...cur, loading: false } : cur));
      }
    },
    [publicKey, sendAssistantEvent]
  );

  const setQty = (sku: string, delta: number) =>
    setCart((prev) => {
      const next = prev
        .map((i) => (i.sku === sku ? { ...i, qty: i.qty + delta } : i))
        .filter((i) => i.qty > 0);
      // Item zerado sai do dedup, pra poder voltar por marcador depois.
      if (!next.some((i) => i.sku === sku)) autoAddedSkus.current.delete(sku);
      return next;
    });
  const removeItem = (sku: string) => {
    // Libera o SKU (dedup por SKU) E as chaves de marcador (dedup por
    // produto:tamanho) do item removido, pra ele poder ser re-adicionado depois
    // pelo mesmo [[carrinho:ID:tam]]. Sem limpar processedCartAdds, o marcador
    // repetido seria ignorado e o item nunca voltaria.
    autoAddedSkus.current.delete(sku);
    setCart((prev) => {
      const item = prev.find((i) => i.sku === sku);
      if (item) {
        const sz = item.size || "";
        processedCartAdds.current.delete(`${item.productId}:${sz}`);
        processedCartAdds.current.delete(`${item.productId}:`);
        setCartAddFailed((f) => {
          if (!(item.productId in f)) return f;
          const next = { ...f };
          delete next[item.productId];
          return next;
        });
      }
      return prev.filter((i) => i.sku !== sku);
    });
  };

  // ---- Checkout handoff ----
  // Leva os itens pro carrinho da loja via hash. O shelves.js (já presente em
  // toda página da loja) lê #vtx_cart, faz os POST /carrinho/adicionar
  // same-origin e redireciona pro /checkout. Cross-origin seguro (sem CORS).
  const goToCheckout = useCallback(() => {
    if (cart.length === 0) return;
    const payload = cart.map((i) => ({ sku: i.sku, quantity: i.qty }));
    let hash = "";
    try {
      hash = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    } catch {
      hash = "";
    }
    // Telemetria de funil: início de checkout (fire-and-forget, não bloqueia).
    sendAssistantEvent("checkout_handoff", {
      cart_lines: cart.length,
      cart_qty: cart.reduce((s, i) => s + i.qty, 0),
      value_bucket: valueBucket(cartSubtotal),
    });
    // NÃO zera a sacola aqui: se o bridge (shelves.js) não rodar na página de
    // destino, o cliente não perde tudo. Carimba o handoff; a sacola é limpa no
    // PRÓXIMO mount do /chat (quando o cliente volta), não antes do bridge.
    try {
      localStorage.setItem(
        "bk_chat_v2",
        JSON.stringify({ sessionId, cart, name, handoffAt: Date.now() })
      );
    } catch {
      /* ignore */
    }
    // atk (= sessionId) num parâmetro SEPARADO do hash: shelves.js novo grava o
    // cookie de atribuição; shelves.js antigo (em cache) ignora sem quebrar.
    const atk = sessionId ? `&vtx_atk=${encodeURIComponent(sessionId)}` : "";
    const url = hash
      ? withUtm(`${storeUrl}/#vtx_cart=${encodeURIComponent(hash)}${atk}`)
      : withUtm(`${storeUrl}/carrinho`);
    window.location.href = url;
  }, [cart, cartSubtotal, storeUrl, sessionId, name, sendAssistantEvent]);

  // ---- Envio de mensagem ----

  const send = useCallback(
    async (text: string) => {
      const msg = text.trim();
      if (!msg || sending) return;

      const userMsg: ChatMessage = { id: nextId(), role: "user", text: msg };
      const pendingId = nextId();
      setMessages((prev) => [...prev, userMsg, { id: pendingId, role: "assistant", pending: true }]);
      setInput("");
      setSending(true);

      try {
        const res = await fetch("/api/assistant/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: publicKey,
            global: true,
            session_id: sessionId,
            message: msg,
            customer_name: name || undefined,
          }),
        });
        const d = await res.json();

        if (d.session_id) setSessionId(d.session_id);

        const blocks: Block[] =
          Array.isArray(d.blocks) && d.blocks.length
            ? d.blocks
            : [{ type: "text", text: String(d.reply || "") }];

        // cart_add: adiciona automaticamente. Dedup por produto+tamanho no
        // NÍVEL DA SESSÃO (sem o id da mensagem) — se o modelo repetir o mesmo
        // [[carrinho:ID:tam]] num turno seguinte, não soma quantidade de novo.
        for (const b of blocks) {
          if (b.type !== "cart_add") continue;
          const key = `${b.data.productId}:${b.data.size || ""}`;
          if (processedCartAdds.current.has(key)) continue;
          processedCartAdds.current.add(key);
          const productId = b.data.productId;
          fetch("/api/assistant/cart-resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: publicKey, product_id: productId, size: b.data.size }),
          })
            .then((r) => r.json())
            .then((cr) => {
              if (cr.ok) {
                addResolvedToCart(cr, true);
                return;
              }
              // Falha: nunca deixa o bloco mentir "Adicionado". Se dá pra escolher
              // tamanho, abre o seletor; senão marca como indisponível.
              const sizes: string[] = Array.isArray(cr.available_sizes)
                ? cr.available_sizes.filter(Boolean)
                : [];
              if ((cr.error === "need_size" || cr.error === "size_unavailable") && sizes.length && cr.product_id) {
                setSizePicker({ product: cardFromResolve(cr), sizes, auto: true });
                // remove da lista de processados pra o retry pelo picker valer
                processedCartAdds.current.delete(key);
              } else {
                setCartAddFailed((prev) => ({
                  ...prev,
                  [productId]:
                    cr.error === "unavailable" || cr.error === "size_unavailable"
                      ? "esgotado"
                      : "indisponível",
                }));
              }
            })
            .catch(() => {
              setCartAddFailed((prev) => ({ ...prev, [productId]: "indisponível" }));
            });
        }

        setMessages((prev) =>
          prev.map((m) => (m.id === pendingId ? { id: pendingId, role: "assistant", blocks } : m))
        );
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? {
                  id: pendingId,
                  role: "assistant",
                  blocks: [{ type: "text", text: "Tive um problema de conexão agora. Pode tentar de novo?" }],
                }
              : m
          )
        );
      } finally {
        setSending(false);
        inputRef.current?.focus();
      }
    },
    [sending, publicKey, sessionId, name, addResolvedToCart]
  );

  const startWith = (text: string) => {
    if (askName && !nameAsked && !name.trim()) {
      // sem nome ainda: guarda a intenção e pede o nome primeiro
      setPendingIntent(text);
      return;
    }
    send(text);
  };

  const confirmName = () => {
    setNameAsked(true);
    const intent = pendingIntent;
    setPendingIntent(null);
    if (intent) send(intent);
  };

  const showWelcome = messages.length === 0;

  // ---- Render de um bloco ----
  const renderBlock = (block: Block, key: string) => {
    switch (block.type) {
      case "text":
        return block.text.trim() ? (
          <div key={key} className="text-[15px] text-neutral-100">
            <RichText text={block.text} />
          </div>
        ) : null;

      case "products": {
        const carousel = block.layout === "carousel";
        return (
          <div key={key} className="space-y-2">
            {block.title && (
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400 px-0.5">
                {block.title}
              </p>
            )}
            <div className={carousel ? "flex gap-3 overflow-x-auto -mx-1 px-1 pb-1 snap-x" : "grid gap-3"}>
              {block.products.map((p) => (
                <ProductCardView
                  key={p.id}
                  p={p}
                  carousel={carousel}
                  onAdd={() => addToCart(p, null)}
                  onView={() => openProductDetail(p)}
                />
              ))}
            </div>
          </div>
        );
      }

      case "reviews": {
        const d = block.data;
        return (
          <div key={key} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Stars value={d.average} size={16} />
              <span className="text-sm font-semibold text-white">{d.average.toFixed(1)}</span>
              <span className="text-xs text-neutral-400">
                · {d.count} {d.scope === "store" ? "avaliações da loja" : "avaliações"}
              </span>
            </div>
            <div className="space-y-2.5">
              {d.highlights.map((h, i) => (
                <div key={i} className="rounded-xl bg-white/[0.03] border border-white/5 p-3">
                  <Stars value={h.rating} />
                  <p className="text-[13.5px] text-neutral-200 mt-1 leading-snug">“{h.body}”</p>
                  <p className="text-[11px] text-neutral-500 mt-1">— {h.author}</p>
                </div>
              ))}
            </div>
          </div>
        );
      }

      case "benefits": {
        const d = block.data;
        return (
          <div key={key} className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4 space-y-2.5">
            <p className="text-[13px] font-semibold text-emerald-300 flex items-center gap-1.5">
              <Sparkles className="h-4 w-4" /> Comprar na Bulking
            </p>
            <ul className="space-y-1.5">
              {d.cashbackPercent > 0 && (
                <li className="flex items-start gap-2 text-[13.5px] text-neutral-100">
                  <Check className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                  <span>
                    <b>{d.cashbackPercent}% de cashback</b> pra usar na próxima compra
                  </span>
                </li>
              )}
              {d.items.map((it, i) => (
                <li key={i} className="flex items-start gap-2 text-[13.5px] text-neutral-100">
                  <Check className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      }

      case "promo": {
        const d = block.data;
        return (
          <div key={key} className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] p-4 space-y-2">
            <p className="text-[13px] font-semibold text-amber-300 flex items-center gap-1.5">
              <BadgePercent className="h-4 w-4" /> Ativo agora
            </p>
            <ul className="space-y-1.5">
              {d.lines.map((l, i) => (
                <li key={i} className="text-[13.5px] text-neutral-100 flex items-start gap-2">
                  <span className="text-amber-400 mt-0.5">•</span>
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      }

      case "cart_add": {
        // Casa por produto E tamanho: senão um "Adicionado" de outro tamanho do
        // mesmo produto mostraria o tamanho errado no card.
        const wantSize = block.data.size ? block.data.size.toUpperCase() : null;
        const item =
          cart.find(
            (i) => i.productId === block.data.productId && (!wantSize || (i.size || "").toUpperCase() === wantSize)
          ) || cart.find((i) => i.productId === block.data.productId);
        const failed = cartAddFailed[block.data.productId];
        // Só diz "Adicionado" quando o item REALMENTE está na sacola.
        if (!item) {
          if (failed) {
            return (
              <div
                key={key}
                className="w-full flex items-center gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-3"
              >
                <div className="h-11 w-11 rounded-xl bg-amber-400/15 flex items-center justify-center shrink-0">
                  <ShoppingBag className="h-5 w-5 text-amber-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-white">
                    {failed === "need_size" ? "Escolha o tamanho" : "Não deu pra adicionar"}
                  </p>
                  <p className="text-[12px] text-neutral-400">
                    {failed === "esgotado"
                      ? "Esse tamanho esgotou."
                      : failed === "need_size"
                      ? "Me diga o tamanho no chat que eu adiciono."
                      : "Item indisponível agora."}
                  </p>
                </div>
              </div>
            );
          }
          // ainda resolvendo
          return (
            <div
              key={key}
              className="w-full flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3"
            >
              <Loader2 className="h-5 w-5 text-neutral-400 animate-spin shrink-0" />
              <p className="text-[13px] text-neutral-300">Adicionando à sacola…</p>
            </div>
          );
        }
        return (
          <button
            key={key}
            onClick={() => setCartOpen(true)}
            className="w-full flex items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] p-3 text-left hover:bg-emerald-400/[0.09] transition-colors"
          >
            <div className="h-11 w-11 rounded-xl bg-emerald-400/15 flex items-center justify-center shrink-0">
              <Check className="h-5 w-5 text-emerald-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-white">Adicionado à sacola</p>
              <p className="text-[12px] text-neutral-400 truncate">
                {`${item.name}${item.size ? ` · ${item.size}` : ""}`}
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-neutral-500 shrink-0" />
          </button>
        );
      }

      case "whatsapp":
        return (
          <a
            key={key}
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-[#25D366] text-black px-4 py-2 text-[13px] font-semibold"
          >
            <MessageCircle className="h-4 w-4" /> Falar com atendimento
          </a>
        );

      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-neutral-950 text-neutral-100 [color-scheme:dark]">
      {/* Header */}
      <header className="shrink-0 flex items-center justify-between gap-3 px-4 h-14 border-b border-white/10 bg-neutral-950/90 backdrop-blur">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-8 w-8 rounded-full bg-white text-neutral-900 flex items-center justify-center font-black text-sm shrink-0">
            B
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold leading-tight truncate">{title}</p>
            <p className="text-[11px] text-emerald-400 leading-tight flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" /> online agora
            </p>
          </div>
        </div>
        <button
          onClick={() => setCartOpen(true)}
          className="relative flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3.5 py-2 text-[13px] font-semibold hover:bg-white/10 transition-colors"
        >
          <ShoppingBag className="h-4 w-4" />
          <span className="hidden sm:inline">Sacola</span>
          {cartCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-400 text-neutral-950 text-[11px] font-bold flex items-center justify-center">
              {cartCount}
            </span>
          )}
        </button>
      </header>

      {/* Mensagens */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
        <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
          {showWelcome ? (
            <WelcomeHero
              welcome={welcome}
              suggestions={suggestions}
              pendingIntent={pendingIntent}
              name={name}
              setName={setName}
              onConfirmName={confirmName}
              onPick={startWith}
              bestsellers={bootstrap.bestsellers || []}
              onProductView={openProductDetail}
              onProductAdd={(p) => addToCart(p, null)}
            />
          ) : (
            messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-white text-neutral-900 px-4 py-2.5 text-[15px] leading-relaxed">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex flex-col items-start gap-2 max-w-[92%]">
                  {m.pending ? (
                    <div className="flex items-center gap-1.5 rounded-2xl bg-white/[0.04] border border-white/10 px-4 py-3">
                      <Dot /> <Dot delay={0.15} /> <Dot delay={0.3} />
                    </div>
                  ) : (
                    <div className="w-full space-y-3">
                      {(m.blocks || []).map((b, i) => renderBlock(b, `${m.id}-${i}`))}
                    </div>
                  )}
                </div>
              )
            )
          )}
        </div>
      </div>

      {/* Sugestões rápidas (quando já há conversa) */}
      {!showWelcome && suggestions.length > 0 && messages.length <= 2 && (
        <div className="shrink-0 px-4 pb-1.5 flex gap-2 overflow-x-auto max-w-2xl mx-auto w-full">
          {suggestions.slice(0, 4).map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              disabled={sending}
              className="shrink-0 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-[12.5px] text-neutral-200 hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Composer */}
      <div className="shrink-0 border-t border-white/10 bg-neutral-950/95 backdrop-blur px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="max-w-2xl mx-auto flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                startWith(input);
              }
            }}
            rows={1}
            placeholder="Escreva o que você procura…"
            className="flex-1 resize-none rounded-2xl border border-white/15 bg-white/[0.04] px-4 py-3 text-[15px] text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/30 max-h-32"
            style={{ minHeight: 48 }}
          />
          <button
            onClick={() => startWith(input)}
            disabled={sending || !input.trim()}
            className="h-12 w-12 shrink-0 rounded-2xl bg-white text-neutral-900 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-neutral-200 transition-colors"
            aria-label="Enviar"
          >
            {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Toast — verde+check no sucesso, âmbar+X no erro (nunca "falha" verde) */}
      {toast && (
        <div
          className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 rounded-full px-4 py-2 text-[13px] font-semibold shadow-lg flex items-center gap-2 animate-in fade-in ${
            toast.ok ? "bg-emerald-400 text-neutral-950" : "bg-amber-500 text-neutral-950"
          }`}
        >
          {toast.ok ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />} {toast.text}
        </div>
      )}

      {/* Detalhe de produto (galeria, medidas, avaliações, benefícios) */}
      {detailView && (
        <ProductDetailSheet
          view={detailView}
          storeHref={withUtm(detailView.product.url || storeUrl, detailView.product.id)}
          onClose={() => setDetailView(null)}
          onAdd={(size) => {
            const prod = detailView.product;
            setDetailView(null);
            addToCart(prod, size);
          }}
        />
      )}

      {/* Seletor de tamanho */}
      {sizePicker && (
        <SizePickerSheet
          product={sizePicker.product}
          sizes={sizePicker.sizes}
          onPick={(sz) => {
            const p = sizePicker.product;
            const auto = sizePicker.auto;
            setSizePicker(null);
            addToCart(p, sz, auto);
          }}
          onClose={() => {
            // Fechou sem escolher um add AUTOMÁTICO: não deixa o bloco "Adicionando…"
            // girando pra sempre — marca como pendente de escolha.
            if (sizePicker.auto) {
              setCartAddFailed((prev) => ({ ...prev, [sizePicker.product.id]: "need_size" }));
            }
            setSizePicker(null);
          }}
        />
      )}

      {/* Sacola */}
      {cartOpen && (
        <CartSheet
          cart={cart}
          subtotal={cartSubtotal}
          nextGift={nextGift}
          topGift={topGift}
          onClose={() => setCartOpen(false)}
          onQty={setQty}
          onRemove={removeItem}
          onCheckout={goToCheckout}
          onKeepShopping={() => setCartOpen(false)}
        />
      )}
    </div>
  );
}

// ---- Subcomponentes ----

function Dot({ delay = 0 }: { delay?: number }) {
  return (
    <span
      className="h-2 w-2 rounded-full bg-neutral-400 animate-bounce"
      style={{ animationDelay: `${delay}s`, animationDuration: "1s" }}
    />
  );
}

function ProductCardView({
  p,
  carousel,
  onAdd,
  onView,
}: {
  p: ProductCard;
  carousel: boolean;
  onAdd: () => void;
  onView?: () => void;
}) {
  const price = effectivePrice(p);
  const hasSale = p.sale_price !== null && p.price !== null && p.sale_price < p.price;
  const [adding, setAdding] = useState(false);
  return (
    <div
      className={`${carousel ? "w-40 shrink-0 snap-start" : "w-full flex gap-3"} rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden`}
    >
      <div className={carousel ? "" : "shrink-0"}>
        <button type="button" onClick={onView} className="block w-full text-left" aria-label={`Ver ${p.name}`}>
          {p.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={p.image_url}
              alt=""
              className={carousel ? "w-full aspect-[3/4] object-cover" : "w-24 h-full aspect-[3/4] object-cover"}
            />
          ) : (
            <div className={`${carousel ? "w-full aspect-[3/4]" : "w-24 h-32"} bg-white/5 flex items-center justify-center text-[10px] text-neutral-500`}>
              sem foto
            </div>
          )}
        </button>
      </div>
      <div className={`${carousel ? "p-2.5" : "flex-1 py-2.5 pr-2.5"} flex flex-col min-w-0`}>
        <button type="button" onClick={onView} className="min-w-0 text-left">
          <p className="text-[12.5px] font-medium text-neutral-100 leading-tight line-clamp-2 hover:text-white">{p.name}</p>
        </button>
        <div className="mt-1 mb-2">
          {hasSale && <span className="text-[11px] text-neutral-500 line-through mr-1">{brl(p.price)}</span>}
          <span className="text-[13.5px] font-bold text-white">
            {price !== null && price !== undefined ? brl(price) : "Sob consulta"}
          </span>
        </div>
        <button
          onClick={async () => {
            setAdding(true);
            await onAdd();
            setAdding(false);
          }}
          disabled={!p.available || adding}
          className="mt-auto w-full rounded-full bg-white text-neutral-900 text-[12.5px] font-semibold py-1.5 flex items-center justify-center gap-1 disabled:opacity-40 hover:bg-neutral-200 transition-colors"
        >
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          {p.available ? "Adicionar" : "Esgotado"}
        </button>
      </div>
    </div>
  );
}

function WelcomeHero({
  welcome,
  suggestions,
  pendingIntent,
  name,
  setName,
  onConfirmName,
  onPick,
  bestsellers,
  onProductView,
  onProductAdd,
}: {
  welcome: string;
  suggestions: string[];
  pendingIntent: string | null;
  name: string;
  setName: (s: string) => void;
  onConfirmName: () => void;
  onPick: (s: string) => void;
  bestsellers: ProductCard[];
  onProductView: (p: ProductCard) => void;
  onProductAdd: (p: ProductCard) => void;
}) {
  // Pediu o nome só quando o cliente ENGAJA (tem uma intenção pendente) — a tela
  // inicial mostra valor primeiro (atalhos + mais vendidos), sem gate na cara.
  if (pendingIntent) {
    return (
      <div className="pt-6 pb-2">
        <div className="h-12 w-12 rounded-2xl bg-white text-neutral-900 flex items-center justify-center font-black text-xl mb-4">
          B
        </div>
        <h1 className="text-[22px] font-bold text-white leading-tight mb-2">Só uma coisa antes…</h1>
        <p className="text-[15px] text-neutral-300 leading-relaxed mb-5">
          Como posso te chamar? Assim o atendimento fica mais pessoal. (opcional)
        </p>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onConfirmName();
              }}
              placeholder="Seu primeiro nome"
              maxLength={40}
              autoFocus
              className="flex-1 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5 text-[15px] text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/30"
            />
            <button
              onClick={onConfirmName}
              className="rounded-xl bg-white text-neutral-900 px-4 text-[14px] font-semibold"
            >
              Continuar
            </button>
          </div>
          <button onClick={onConfirmName} className="text-[12.5px] text-neutral-500 hover:text-neutral-300">
            Pular
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-6 pb-2 space-y-6">
      <div>
        <div className="h-12 w-12 rounded-2xl bg-white text-neutral-900 flex items-center justify-center font-black text-xl mb-4">
          B
        </div>
        <h1 className="text-[22px] font-bold text-white leading-tight mb-2">
          {name ? `Fala, ${name.split(" ")[0]}!` : "Bem-vindo à Bulking"}
        </h1>
        <p className="text-[15px] text-neutral-300 leading-relaxed">
          {welcome} Escolhe por onde começar ou me diz o que procura, e eu monto tudo aqui no chat.
        </p>
      </div>

      {/* Atalhos de categoria — onboarding: o cliente entende na hora o que dá pra fazer */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400 mb-2">Explorar</p>
        <div className="grid grid-cols-2 gap-2">
          {ONBOARDING_SHORTCUTS.map((s) => (
            <button
              key={s.label}
              onClick={() => onPick(s.query)}
              className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-[14px] text-neutral-100 hover:bg-white/[0.06] hover:border-white/20 transition-colors text-left"
            >
              <span className="text-neutral-400 shrink-0">{s.icon}</span>
              <span className="truncate">{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Mais vendidos — já mostra produtos reais na abertura */}
      {bestsellers.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400 px-0.5">
            Mais vendidos agora
          </p>
          <div className="flex gap-3 overflow-x-auto -mx-1 px-1 pb-1 snap-x">
            {bestsellers.map((p) => (
              <ProductCardView
                key={p.id}
                p={p}
                carousel
                onAdd={() => onProductAdd(p)}
                onView={() => onProductView(p)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Sugestões custom do lojista (texto), se houver */}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.slice(0, 4).map((s) => (
            <button
              key={s}
              onClick={() => onPick(s)}
              className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-[12.5px] text-neutral-300 hover:bg-white/[0.06] hover:text-neutral-100 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SizePickerSheet({
  product,
  sizes,
  onPick,
  onClose,
}: {
  product: ProductCard;
  sizes: string[];
  onPick: (s: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full sm:max-w-sm bg-neutral-900 border-t sm:border border-white/10 rounded-t-3xl sm:rounded-3xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">Escolha o tamanho</p>
            <p className="text-[15px] font-semibold text-white truncate">{product.name}</p>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-white p-1">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {sizes.map((s) => (
            <button
              key={s}
              onClick={() => onPick(s)}
              className="rounded-xl border border-white/15 bg-white/5 py-3 text-[15px] font-semibold text-white hover:bg-white hover:text-neutral-900 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProductDetailSheet({
  view,
  storeHref,
  onClose,
  onAdd,
}: {
  view: { product: ProductCard; data: ProductDetailResponse | null; loading: boolean };
  storeHref: string;
  onClose: () => void;
  onAdd: (size: string | null) => void;
}) {
  const [size, setSize] = useState<string | null>(null);
  const sizeRef = useRef<HTMLDivElement>(null);
  const [flashSize, setFlashSize] = useState(false);
  const p = view.data?.product;
  const reviews = view.data?.reviews || null;
  const benefits = view.data?.benefits || [];
  const cashback = view.data?.cashback_percent || 0;
  const card = view.product;

  const price = p ? (p.sale_price ?? p.price) : effectivePrice(card);
  const listPrice = p ? p.price : card.price;
  const hasSale = p ? p.sale_price !== null && p.price !== null && p.sale_price < p.price : false;
  const images = p?.images && p.images.length ? p.images : card.image_url ? [card.image_url] : [];
  const sizes = p?.sizes || [];
  const hasSizes = sizes.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full sm:max-w-md bg-neutral-900 border-t sm:border border-white/10 rounded-t-3xl sm:rounded-3xl flex flex-col max-h-[92dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-white/10 shrink-0">
          <p className="text-[15px] font-semibold text-white truncate pr-3">{p?.name || card.name}</p>
          <button onClick={onClose} className="text-neutral-500 hover:text-white p-1 shrink-0" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Galeria */}
          {images.length > 0 && (
            <div className="flex gap-2 overflow-x-auto -mx-1 px-1 snap-x">
              {images.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={src}
                  alt=""
                  className="h-56 aspect-[3/4] object-cover rounded-xl shrink-0 snap-start bg-white/5"
                />
              ))}
            </div>
          )}

          {/* Preço */}
          <div className="flex items-baseline gap-2">
            {hasSale && <span className="text-sm text-neutral-500 line-through">{brl(listPrice)}</span>}
            <span className="text-[22px] font-bold text-white">
              {price !== null && price !== undefined ? brl(price) : "Sob consulta"}
            </span>
          </div>

          {/* Etiquetas */}
          {p?.badges && p.badges.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {p.badges.map((b, i) => (
                <span key={i} className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11.5px] text-neutral-200">
                  {b}
                </span>
              ))}
            </div>
          )}

          {view.loading && !p && (
            <div className="flex items-center gap-2 text-[13px] text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando detalhes…
            </div>
          )}

          {/* Descrição */}
          {p?.description && (
            <p className="text-[13.5px] text-neutral-300 leading-relaxed line-clamp-6">{p.description}</p>
          )}

          {/* Tabela de medidas */}
          {p?.size_guide && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[12px] font-semibold text-neutral-300 mb-1.5">Tabela de medidas</p>
              <pre className="text-[12px] text-neutral-300 whitespace-pre-wrap font-sans leading-snug">{p.size_guide}</pre>
            </div>
          )}

          {/* Benefícios */}
          {(benefits.length > 0 || cashback > 0) && (
            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3.5 space-y-1.5">
              {cashback > 0 && (
                <div className="flex items-start gap-2 text-[13px] text-neutral-100">
                  <Check className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                  <span><b>{cashback}% de cashback</b> pra próxima compra</span>
                </div>
              )}
              {benefits.map((b, i) => (
                <div key={i} className="flex items-start gap-2 text-[13px] text-neutral-100">
                  <Check className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                  <span>{b}</span>
                </div>
              ))}
            </div>
          )}

          {/* Avaliações */}
          {reviews && reviews.count > 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 space-y-2.5">
              <div className="flex items-center gap-2">
                <Stars value={reviews.average} size={15} />
                <span className="text-sm font-semibold text-white">{reviews.average.toFixed(1)}</span>
                <span className="text-xs text-neutral-400">· {reviews.count} avaliações</span>
              </div>
              {reviews.highlights.map((h, i) => (
                <div key={i} className="rounded-xl bg-white/[0.03] border border-white/5 p-2.5">
                  <Stars value={h.rating} />
                  <p className="text-[13px] text-neutral-200 mt-1 leading-snug">“{h.body}”</p>
                  <p className="text-[11px] text-neutral-500 mt-1">— {h.author}</p>
                </div>
              ))}
            </div>
          )}

          {/* Seletor de tamanho */}
          {hasSizes && (
            <div
              ref={sizeRef}
              className={`rounded-2xl -mx-1 px-1 py-1 transition-all ${
                flashSize ? "ring-2 ring-white/60 bg-white/[0.04]" : ""
              }`}
            >
              <p className="text-[12px] text-neutral-400 mb-1.5">
                Tamanho{flashSize && !size ? " · escolha um pra continuar" : ""}
              </p>
              <div className="grid grid-cols-5 gap-2">
                {sizes.map((s) => (
                  <button
                    key={s.size}
                    disabled={!s.available}
                    onClick={() => {
                      setSize(s.size);
                      setFlashSize(false);
                    }}
                    className={`rounded-xl border py-2.5 text-[14px] font-semibold transition-colors ${
                      size === s.size
                        ? "bg-white text-neutral-900 border-white"
                        : s.available
                        ? "border-white/15 bg-white/5 text-white hover:bg-white/10"
                        : "border-white/5 bg-white/[0.02] text-neutral-600 line-through cursor-not-allowed"
                    }`}
                  >
                    {s.size}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-white/10 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-2 shrink-0">
          <button
            onClick={() => {
              // Sem tamanho escolhido: em vez de botão morto, ROLA até o seletor
              // e destaca — o cliente vê onde escolher sem procurar.
              if (hasSizes && !size) {
                sizeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                setFlashSize(true);
                window.setTimeout(() => setFlashSize(false), 1600);
                return;
              }
              onAdd(hasSizes ? size : null);
            }}
            className="w-full rounded-full bg-white text-neutral-900 py-3 text-[15px] font-bold flex items-center justify-center gap-2 hover:bg-neutral-200 transition-colors"
          >
            <Plus className="h-4.5 w-4.5" />
            {hasSizes && !size ? "Escolha o tamanho" : "Adicionar à sacola"}
          </button>
          <a
            href={storeHref}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full text-center text-[13px] text-neutral-400 hover:text-white py-1"
          >
            Ver na loja
          </a>
        </div>
      </div>
    </div>
  );
}

function CartSheet({
  cart,
  subtotal,
  nextGift,
  topGift,
  onClose,
  onQty,
  onRemove,
  onCheckout,
  onKeepShopping,
}: {
  cart: CartItem[];
  subtotal: number;
  nextGift: { threshold: number; gift: string } | null;
  topGift: { threshold: number; gift: string } | null;
  onClose: () => void;
  onQty: (sku: string, delta: number) => void;
  onRemove: (sku: string) => void;
  onCheckout: () => void;
  onKeepShopping: () => void;
}) {
  const progress = topGift ? Math.min(100, (subtotal / topGift.threshold) * 100) : 0;
  const missing = nextGift ? nextGift.threshold - subtotal : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full sm:max-w-md bg-neutral-900 border-t sm:border border-white/10 rounded-t-3xl sm:rounded-3xl flex flex-col max-h-[88dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-white/10">
          <p className="text-[16px] font-bold text-white flex items-center gap-2">
            <ShoppingBag className="h-4.5 w-4.5" /> Sua sacola
          </p>
          <button onClick={onClose} className="text-neutral-500 hover:text-white p-1">
            <X className="h-5 w-5" />
          </button>
        </div>

        {cart.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <ShoppingBag className="h-10 w-10 text-neutral-700 mx-auto mb-3" />
            <p className="text-[15px] text-neutral-300 font-medium">Sua sacola está vazia</p>
            <p className="text-[13px] text-neutral-500 mt-1">Peça uma recomendação no chat pra começar.</p>
            <button
              onClick={onKeepShopping}
              className="mt-5 rounded-full bg-white text-neutral-900 px-5 py-2.5 text-[14px] font-semibold"
            >
              Voltar ao chat
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
              {/* Régua de brinde */}
              {topGift && (
                <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-3">
                  {nextGift ? (
                    <p className="text-[12.5px] text-neutral-300">
                      Faltam <b className="text-white">{brl(missing)}</b> pra ganhar{" "}
                      <b className="text-amber-300">{nextGift.gift}</b>
                    </p>
                  ) : (
                    <p className="text-[12.5px] text-emerald-300 font-medium">
                      🎁 Você já garantiu {topGift.gift}!
                    </p>
                  )}
                  <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-amber-300 transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

              {cart.map((i) => (
                <div key={i.sku} className="flex gap-3 items-center">
                  <div className="h-16 w-14 rounded-xl overflow-hidden bg-white/5 shrink-0">
                    {i.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={i.image} alt="" className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-medium text-white leading-tight line-clamp-2">{i.name}</p>
                    <p className="text-[12px] text-neutral-400 mt-0.5">
                      {i.size ? `Tam ${i.size} · ` : ""}
                      {brl(i.price)}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="flex items-center rounded-full border border-white/15">
                        <button onClick={() => onQty(i.sku, -1)} className="p-1.5 text-neutral-300 hover:text-white">
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="text-[13px] font-semibold text-white w-5 text-center">{i.qty}</span>
                        <button onClick={() => onQty(i.sku, 1)} className="p-1.5 text-neutral-300 hover:text-white">
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <button
                        onClick={() => onRemove(i.sku)}
                        className="text-neutral-500 hover:text-red-400 p-1"
                        aria-label="Remover"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <p className="text-[13.5px] font-bold text-white shrink-0">{brl(i.price * i.qty)}</p>
                </div>
              ))}
            </div>

            <div className="border-t border-white/10 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[14px] text-neutral-300">Subtotal</span>
                <span className="text-[18px] font-bold text-white">{brl(subtotal)}</span>
              </div>
              <button
                onClick={onCheckout}
                className="w-full rounded-full bg-emerald-400 text-neutral-950 py-3.5 text-[15px] font-bold flex items-center justify-center gap-2 hover:bg-emerald-300 transition-colors"
              >
                Finalizar compra <ArrowRight className="h-4.5 w-4.5" />
              </button>
              <button
                onClick={onKeepShopping}
                className="w-full text-center text-[13px] text-neutral-400 hover:text-white"
              >
                Continuar comprando
              </button>
              <p className="text-[11px] text-neutral-600 text-center leading-snug">
                Você finaliza no ambiente seguro da loja. Frete e cupons são calculados no checkout.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

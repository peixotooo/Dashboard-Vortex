// Conhecimento dinâmico do assistente: CAMPANHAS e BENEFÍCIOS ATIVOS AGORA.
//
// Lê ao vivo do banco (não cacheia em coluna) porque muda toda hora. Reusa a
// MESMA lógica de "ativo agora" dos endpoints públicos da loja, então o que o
// assistente diz bate com o que o cliente vê no site (topbar, badges, régua).
//
// SEGURANÇA: só devolve o que já é público na vitrine (mensagem do topbar,
// código de cupom ativo, % de desconto, degraus da régua, % de cashback).
// Nunca receita atribuída, product_id interno de cupom, nem métricas.

import { createAdminClient } from "@/lib/supabase-admin";
import { resolveActiveCampaign, effectiveCountdownTarget } from "@/lib/topbar/resolve";
import { normalizeTopbarSlides } from "@/lib/topbar/slides";

export interface ActiveCoupon {
  code: string;
  discount: string; // "10%" ou "R$ 20,00"
  expiresAt: string | null;
  /** Cupons auto são quase sempre por produto — null = cupom geral. */
  productId: string | null;
  productName: string | null;
}

export interface ActiveKnowledge {
  topbarMessages: string[];
  topbarCountdownTarget: string | null;
  coupons: ActiveCoupon[];
  giftBar: {
    active: boolean;
    steps: Array<{ threshold: number; gift: string }>;
    message: string | null;
  };
  benefits: string[];
  cashbackPercent: number;
  giftRequestActive: boolean;
}

function fmtBrl(n: number): string {
  return `R$ ${n.toFixed(2).replace(".", ",")}`;
}

export async function getActiveKnowledge(
  workspaceId: string,
  pageType: string
): Promise<ActiveKnowledge> {
  const admin = createAdminClient();
  const now = new Date();
  const nowIso = now.toISOString();

  const [topbar, couponsRes, giftBarRes, cashbackRes, giftReqRes] = await Promise.all([
    resolveActiveCampaign(workspaceId, pageType, now).catch(() => null),
    admin
      .from("promo_active_coupons")
      .select(
        "vnda_coupon_code, discount_pct, discount_unit, discount_value_brl, expires_at, product_id"
      )
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .gt("expires_at", nowIso)
      .order("expires_at", { ascending: true })
      .limit(10),
    admin
      .from("gift_bar_configs")
      .select(
        "enabled, threshold, gift_name, message_progress, steps, " +
          "show_product_benefits, product_benefits"
      )
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    admin
      .from("cashback_config")
      .select("percentage")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    admin
      .from("gift_request_configs")
      .select("enabled, wa_template_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
  ]);

  // --- Topbar (mensagens da campanha ativa) ---
  let topbarMessages: string[] = [];
  let topbarCountdownTarget: string | null = null;
  if (topbar?.campaign) {
    const c = topbar.campaign;
    const slides = normalizeTopbarSlides(null, c.title, c.message, {
      fallbackLinkUrl: c.link_url,
      fallbackLinkLabel: c.link_label,
    });
    topbarMessages = slides
      .map((s) => [s.title, s.message].filter(Boolean).join(": "))
      .filter((m) => m.trim().length > 0)
      .slice(0, 6);
    topbarCountdownTarget = topbar.countdownTarget || effectiveCountdownTarget(c, now);
  }

  // --- Cupons ativos (públicos: já viram badge na loja) ---
  // Cupons auto são por PRODUTO — resolve o nome pra o vendedor deixar claro
  // "válido só para X" em vez de oferecer como desconto geral.
  const couponProductIds = [
    ...new Set(
      (couponsRes.data || [])
        .map((r) => (r.product_id != null ? String(r.product_id) : null))
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const productNames = new Map<string, string>();
  if (couponProductIds.length) {
    const { data: prodRows } = await admin
      .from("shelf_products")
      .select("product_id, name")
      .eq("workspace_id", workspaceId)
      .in("product_id", couponProductIds);
    for (const p of prodRows || []) {
      productNames.set(String(p.product_id), String(p.name));
    }
  }

  const coupons: ActiveCoupon[] = (couponsRes.data || [])
    .filter((r) => r.vnda_coupon_code)
    .map((r) => {
      const unit = String(r.discount_unit || "pct");
      const discount =
        unit === "brl" && r.discount_value_brl != null
          ? fmtBrl(Number(r.discount_value_brl))
          : r.discount_pct != null
          ? `${Number(r.discount_pct)}%`
          : "";
      const productId = r.product_id != null ? String(r.product_id) : null;
      return {
        code: String(r.vnda_coupon_code).toUpperCase(),
        discount,
        expiresAt: r.expires_at ? String(r.expires_at) : null,
        productId,
        productName: productId ? productNames.get(productId) || null : null,
      };
    })
    .filter((c) => c.discount);

  // --- Régua de brinde + benefícios PDP ---
  const giftBarData = giftBarRes.data as
    | {
        enabled?: boolean;
        threshold?: number;
        gift_name?: string;
        message_progress?: string;
        steps?: unknown;
        show_product_benefits?: boolean;
        product_benefits?: unknown;
      }
    | null;

  const steps: Array<{ threshold: number; gift: string }> = [];
  if (giftBarData?.enabled) {
    const rawSteps = Array.isArray(giftBarData.steps) ? giftBarData.steps : [];
    for (const s of rawSteps) {
      if (s && typeof s === "object") {
        const o = s as { threshold?: unknown; label?: unknown; gift_name?: unknown };
        const th = Number(o.threshold);
        if (Number.isFinite(th) && th > 0) {
          steps.push({ threshold: th, gift: String(o.gift_name || o.label || "brinde") });
        }
      }
    }
    // fallback: régua de degrau único
    if (steps.length === 0 && Number(giftBarData.threshold) > 0) {
      steps.push({
        threshold: Number(giftBarData.threshold),
        gift: String(giftBarData.gift_name || "brinde"),
      });
    }
  }

  // Benefícios PDP ativos (só o título — é o que o card mostra na loja)
  const benefits: string[] = [];
  if (giftBarData?.show_product_benefits && Array.isArray(giftBarData.product_benefits)) {
    const nowMs = now.getTime();
    for (const b of giftBarData.product_benefits) {
      if (!b || typeof b !== "object") continue;
      const o = b as { enabled?: boolean; starts_at?: string; ends_at?: string; title?: unknown };
      if (o.enabled === false) continue;
      if (o.starts_at && Date.parse(o.starts_at) > nowMs) continue;
      if (o.ends_at && Date.parse(o.ends_at) < nowMs) continue;
      const title = String(o.title || "").trim();
      if (title) benefits.push(title.slice(0, 120));
      if (benefits.length >= 6) break;
    }
  }

  const cashbackPercent = cashbackRes.data?.percentage
    ? Number(cashbackRes.data.percentage)
    : 0;

  const giftRequestActive = Boolean(
    giftReqRes.data?.enabled && giftReqRes.data?.wa_template_id
  );

  return {
    topbarMessages,
    topbarCountdownTarget,
    coupons,
    giftBar: {
      active: steps.length > 0,
      steps,
      message: giftBarData?.enabled ? giftBarData.message_progress || null : null,
    },
    benefits,
    cashbackPercent,
    giftRequestActive,
  };
}

/** Formata o conhecimento ativo num texto compacto pra ferramenta do LLM. */
export function formatActiveKnowledge(k: ActiveKnowledge): string {
  const lines: string[] = [];

  if (k.topbarMessages.length) {
    lines.push("CAMPANHA ATIVA AGORA (barra de topo da loja):");
    k.topbarMessages.forEach((m) => lines.push(`- ${m}`));
    if (k.topbarCountdownTarget) {
      lines.push(`- (com contador regressivo até ${k.topbarCountdownTarget})`);
    }
  }

  // Cupom por produto sem nome resolvido não é apresentável — descarta em vez
  // de arriscar o vendedor oferecer desconto que não aplica no carrinho.
  const presentable = k.coupons.filter((c) => !c.productId || c.productName);
  if (presentable.length) {
    lines.push(
      "CUPONS ATIVOS (ATENÇÃO: cupom marcado 'SÓ para' um produto NÃO vale para o resto da loja. Ofereça APENAS quando o cliente estiver comprando aquele produto exato; nunca apresente como desconto geral):"
    );
    presentable.forEach((c) => {
      const exp = c.expiresAt ? ` (expira em ${c.expiresAt})` : "";
      if (c.productId && c.productName) {
        lines.push(
          `- ${c.code}: ${c.discount} SÓ para o produto "${c.productName}" (id ${c.productId})${exp}`
        );
      } else {
        lines.push(`- ${c.code}: ${c.discount} de desconto${exp}`);
      }
    });
  }

  if (k.giftBar.active) {
    lines.push("RÉGUA DE BRINDE (ganha brinde ao atingir valor no carrinho):");
    k.giftBar.steps.forEach((s) =>
      lines.push(`- gastando ${fmtBrl(s.threshold)} ganha ${s.gift}`)
    );
  }

  if (k.cashbackPercent > 0) {
    lines.push(
      `CASHBACK: ${k.cashbackPercent}% do valor da compra vira crédito pra próxima compra.`
    );
  }

  if (k.benefits.length) {
    lines.push("BENEFÍCIOS DA LOJA (mostrados na página do produto):");
    k.benefits.forEach((b) => lines.push(`- ${b}`));
  }

  if (k.giftRequestActive) {
    lines.push(
      "PEDIR DE PRESENTE: o cliente pode pedir que alguém o presenteie: há um botão 'Pedir de presente' na página do produto que avisa a pessoa pelo WhatsApp."
    );
  }

  if (lines.length === 0) {
    return "Nenhuma campanha, cupom ou benefício especial ativo no momento além das condições gerais da loja.";
  }

  return lines.join("\n");
}

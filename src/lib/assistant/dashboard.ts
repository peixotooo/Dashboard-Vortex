// Agregados do dashboard do assistente (/assistente).
//
// Tudo deriva do que JÁ é persistido: conversas, mensagens (com feedback) e
// telemetria de tools (role='tool'). A telemetria é o pulo do gato: cada tool
// chamada revela a INTENÇÃO da conversa (tamanho? rastreio? cupom? política?).
//
// Volumes são pequenos (cap diário ~1500 msgs) — agregamos em JS com caps de
// linhas e colunas mínimas. Se um dia crescer 10x, migrar pra RPC/SQL.

import type { SupabaseClient } from "@supabase/supabase-js";

const TZ = "America/Sao_Paulo";

export interface AssistantDashboard {
  kpis: {
    conversations_7d: number;
    conversations_prev7d: number;
    user_messages_7d: number;
    user_messages_prev7d: number;
    feedback_up_30d: number;
    feedback_down_30d: number;
    avg_msgs_per_conversation_30d: number;
    messages_today: number;
    daily_cap: number;
    named_rate_30d: number; // 0..1
  };
  daily: Array<{ date: string; conversas: number; mensagens: number }>; // 14d
  intents: Array<{ intent: string; conversations: number; pct: number }>; // 30d
  top_products: Array<{ product_id: string; name: string; conversations: number }>;
  hourly: Array<{ hour: number; count: number }>; // msgs de cliente 14d, hora SP
  negative_feedback: Array<{
    message_id: number;
    conversation_id: string;
    excerpt: string;
    created_at: string;
  }>;
  /** Funil de conversão do Chat Commerce (null se migration-133 pendente). */
  funnel: AssistantFunnel | null;
}

export interface AssistantFunnel {
  window_days: number;
  steps: {
    sessions: number;
    viewed_product: number;
    added_to_cart: number;
    checkout: number;
    purchased: number;
  };
  rates: {
    atc_rate: number; // add-to-cart / sessions
    handoff_rate: number; // checkout / add-to-cart
    conversion_rate: number; // comprou / sessions
  };
  revenue_confirmed: number;
  orders_confirmed: number;
  avg_ticket: number;
  pending_attribution: number; // pedidos atribuídos ainda sem receita confirmada
  top_products: Array<{ sku: string; name: string; orders: number; revenue: number }>;
}

const INTENT_LABELS: Record<string, string> = {
  buscar_produtos: "Recomendações de produto",
  guia_de_tamanhos: "Tamanho e medidas",
  detalhes_produto: "Detalhes do produto",
  consultar_pedido: "Rastreio de pedido",
  promocoes_e_beneficios: "Promoções e cupons",
  informacoes_da_loja: "Políticas da loja",
};

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
  }).format(d);
}

function hourInTz(d: Date): number {
  return Number(
    new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "numeric", hour12: false }).format(d)
  );
}

export async function buildAssistantDashboard(
  admin: SupabaseClient,
  workspaceId: string,
  dailyCap: number,
  messagesToday: number
): Promise<AssistantDashboard> {
  const now = Date.now();
  const d7 = new Date(now - 7 * 86400_000).toISOString();
  const d14 = new Date(now - 14 * 86400_000).toISOString();
  const d30 = new Date(now - 30 * 86400_000).toISOString();

  const [
    convs7,
    convsPrev7,
    msgs7,
    msgsPrev7,
    fbUp,
    fbDown,
    convs30Res,
    userMsgs14Res,
    toolRows30Res,
    negativeRes,
  ] = await Promise.all([
    admin
      .from("assistant_conversations")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("created_at", d7),
    admin
      .from("assistant_conversations")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("created_at", d14)
      .lt("created_at", d7),
    admin
      .from("assistant_messages")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("role", "user")
      .gte("created_at", d7),
    admin
      .from("assistant_messages")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("role", "user")
      .gte("created_at", d14)
      .lt("created_at", d7),
    admin
      .from("assistant_messages")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("feedback", 1)
      .gte("created_at", d30),
    admin
      .from("assistant_messages")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("feedback", -1)
      .gte("created_at", d30),
    admin
      .from("assistant_conversations")
      .select("product_id, customer_name, message_count, created_at")
      .eq("workspace_id", workspaceId)
      .gte("created_at", d30)
      .limit(5000),
    admin
      .from("assistant_messages")
      .select("created_at")
      .eq("workspace_id", workspaceId)
      .eq("role", "user")
      .gte("created_at", d14)
      .limit(20000),
    admin
      .from("assistant_messages")
      .select("conversation_id, content")
      .eq("workspace_id", workspaceId)
      .eq("role", "tool")
      .gte("created_at", d30)
      .limit(5000),
    admin
      .from("assistant_messages")
      .select("id, conversation_id, content, created_at")
      .eq("workspace_id", workspaceId)
      .eq("feedback", -1)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const convs30 = convs30Res.data || [];
  const userMsgs14 = userMsgs14Res.data || [];
  const toolRows30 = toolRows30Res.error ? [] : toolRows30Res.data || [];

  // --- Série diária (14 dias, fuso SP) ---
  const dayKeys: string[] = [];
  const daily = new Map<string, { conversas: number; mensagens: number }>();
  for (let i = 13; i >= 0; i--) {
    const k = fmtDate(new Date(now - i * 86400_000));
    dayKeys.push(k);
    daily.set(k, { conversas: 0, mensagens: 0 });
  }
  for (const c of convs30) {
    const k = fmtDate(new Date(String(c.created_at)));
    const b = daily.get(k);
    if (b) b.conversas++;
  }
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  for (const m of userMsgs14) {
    const dt = new Date(String(m.created_at));
    const b = daily.get(fmtDate(dt));
    if (b) b.mensagens++;
    const h = hourInTz(dt);
    if (h >= 0 && h < 24) hourly[h].count++;
  }

  // --- Intenções por conversa (telemetria de tools) ---
  const intentConvs = new Map<string, Set<string>>();
  for (const row of toolRows30) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(row.content));
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const t of parsed) {
      const name = t && typeof t === "object" ? String((t as { name?: unknown }).name || "") : "";
      const label = INTENT_LABELS[name];
      if (!label) continue;
      if (!intentConvs.has(label)) intentConvs.set(label, new Set());
      intentConvs.get(label)!.add(String(row.conversation_id));
    }
  }
  const totalConvs30 = convs30.length || 1;
  const intents = [...intentConvs.entries()]
    .map(([intent, convSet]) => ({
      intent,
      conversations: convSet.size,
      pct: Math.round((convSet.size / totalConvs30) * 100),
    }))
    .sort((a, b) => b.conversations - a.conversations);

  // --- Top produtos (nome via shelf_products) ---
  const prodCount = new Map<string, number>();
  for (const c of convs30) {
    const pid = c.product_id ? String(c.product_id) : null;
    if (pid) prodCount.set(pid, (prodCount.get(pid) || 0) + 1);
  }
  const topIds = [...prodCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id]) => id);
  const names = new Map<string, string>();
  if (topIds.length) {
    const { data: prods } = await admin
      .from("shelf_products")
      .select("product_id, name")
      .eq("workspace_id", workspaceId)
      .in("product_id", topIds);
    for (const p of prods || []) names.set(String(p.product_id), String(p.name));
  }
  const top_products = topIds.map((id) => ({
    product_id: id,
    name: names.get(id) || `Produto ${id}`,
    conversations: prodCount.get(id) || 0,
  }));

  // --- Funil de conversão (Chat Commerce) — isolado: tabelas da migration-133
  // podem não existir; falha vira funnel:null sem derrubar o resto. ---
  const funnel = await buildFunnel(admin, workspaceId, d30).catch(() => null);

  // --- KPIs ---
  const named = convs30.filter((c) => c.customer_name).length;
  const totalMsgs30 = convs30.reduce((acc, c) => acc + (Number(c.message_count) || 0), 0);

  return {
    kpis: {
      conversations_7d: convs7.count || 0,
      conversations_prev7d: convsPrev7.count || 0,
      user_messages_7d: msgs7.count || 0,
      user_messages_prev7d: msgsPrev7.count || 0,
      feedback_up_30d: fbUp.error ? 0 : fbUp.count || 0,
      feedback_down_30d: fbDown.error ? 0 : fbDown.count || 0,
      avg_msgs_per_conversation_30d:
        convs30.length > 0 ? Math.round((totalMsgs30 / convs30.length) * 10) / 10 : 0,
      messages_today: messagesToday,
      daily_cap: dailyCap,
      named_rate_30d: convs30.length > 0 ? Math.round((named / convs30.length) * 100) / 100 : 0,
    },
    daily: dayKeys.map((date) => ({ date, ...daily.get(date)! })),
    intents,
    top_products,
    hourly,
    negative_feedback: (negativeRes.error ? [] : negativeRes.data || []).map((m) => ({
      message_id: Number(m.id),
      conversation_id: String(m.conversation_id),
      excerpt: String(m.content || "").slice(0, 220),
      created_at: String(m.created_at),
    })),
    funnel,
  };
}

// SKU-pai a partir do SKU de variante ("778165581-2" → "778165581").
function parentSku(sku: string): string {
  const m = String(sku || "").match(/^(.+)-\d{1,5}$/);
  return m ? m[1] : String(sku || "");
}

async function buildFunnel(
  admin: SupabaseClient,
  workspaceId: string,
  d30: string
): Promise<AssistantFunnel | null> {
  // Eventos do funil (30d). Volume pequeno no início; agrega em JS como o resto.
  const { data: eventRows, error: evErr } = await admin
    .from("assistant_events")
    .select("atk, event_type")
    .eq("workspace_id", workspaceId)
    .gte("occurred_at", d30)
    .limit(100000);
  if (evErr) return null; // tabela ausente (migration-133 pendente) → sem funil

  // Conjunto de tipos de evento por sessão (atk).
  const byAtk = new Map<string, Set<string>>();
  for (const r of eventRows || []) {
    const atk = String(r.atk || "");
    if (!atk) continue;
    if (!byAtk.has(atk)) byAtk.set(atk, new Set());
    byAtk.get(atk)!.add(String(r.event_type || ""));
  }
  const has = (types: Set<string>, ...names: string[]) => names.some((n) => types.has(n));
  let sessions = 0;
  let viewed = 0;
  let added = 0;
  let checkout = 0;
  for (const types of byAtk.values()) {
    // "sessão" = engajou (mandou mensagem) ou o server marcou session_started.
    if (has(types, "session_started", "message_sent")) sessions++;
    if (types.has("products_shown")) viewed++;
    if (types.has("add_to_cart")) added++;
    if (types.has("checkout_handoff")) checkout++;
  }

  // Atribuições (30d): pedidos ligados a uma sessão do chat.
  const { data: attrRows } = await admin
    .from("assistant_attributions")
    .select("atk, order_total, order_items, revenue_confirmed")
    .eq("workspace_id", workspaceId)
    .gte("created_at", d30)
    .not("atk", "is", null)
    .limit(20000);

  const purchasedAtk = new Set<string>();
  let revenue = 0;
  let ordersConfirmed = 0;
  let pending = 0;
  const skuAgg = new Map<string, { orders: number; revenue: number }>();
  for (const r of attrRows || []) {
    const atk = String(r.atk || "");
    if (atk) purchasedAtk.add(atk);
    if (r.revenue_confirmed) {
      ordersConfirmed++;
      revenue += Number(r.order_total) || 0;
      const items = Array.isArray(r.order_items) ? (r.order_items as Array<Record<string, unknown>>) : [];
      for (const it of items) {
        const sku = parentSku(String(it.sku || ""));
        if (!sku) continue;
        const agg = skuAgg.get(sku) || { orders: 0, revenue: 0 };
        agg.orders += 1;
        agg.revenue += Number(it.total) || 0;
        skuAgg.set(sku, agg);
      }
    } else {
      pending++;
    }
  }
  const purchased = purchasedAtk.size;

  // Nomes dos SKUs-pai que mais converteram (best-effort via shelf_products.sku).
  const topSkus = [...skuAgg.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 8);
  const skuNames = new Map<string, string>();
  if (topSkus.length) {
    const { data: prods } = await admin
      .from("shelf_products")
      .select("sku, name")
      .eq("workspace_id", workspaceId)
      .in("sku", topSkus.map(([sku]) => sku));
    for (const p of prods || []) skuNames.set(String(p.sku), String(p.name));
  }

  const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 1000 : 0);

  return {
    window_days: 30,
    steps: { sessions, viewed_product: viewed, added_to_cart: added, checkout, purchased },
    rates: {
      atc_rate: rate(added, sessions),
      handoff_rate: rate(checkout, added),
      conversion_rate: rate(purchased, sessions),
    },
    revenue_confirmed: Math.round(revenue * 100) / 100,
    orders_confirmed: ordersConfirmed,
    avg_ticket: ordersConfirmed > 0 ? Math.round((revenue / ordersConfirmed) * 100) / 100 : 0,
    pending_attribution: pending,
    top_products: topSkus.map(([sku, agg]) => ({
      sku,
      name: skuNames.get(sku) || `SKU ${sku}`,
      orders: agg.orders,
      revenue: Math.round(agg.revenue * 100) / 100,
    })),
  };
}

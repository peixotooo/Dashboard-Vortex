// Sync genérico de auto_segment lists.
//
// O webhook de pedido confirmado chama syncCustomerToAutoSegmentLists
// uma vez por pedido. Aqui dentro a gente itera TODAS as listas
// auto-segmentadas do workspace e dispara o evaluator do tipo certo.
//
// Tipos suportados hoje:
//   - 'gender'  → evaluator que roda inferência (nome/email) e checa
//                 gender + confidence.
//   - 'state'   → evaluator que casa a UF brasileira do pedido.
//
// Adicionar um tipo novo = adicionar uma branch no `evaluateMatch`
// e (opcional) um materialize endpoint pra criar a lista on demand.

import type { SupabaseClient } from "@supabase/supabase-js";
import { inferGender, type InferenceResult } from "@/lib/gender/inference";

type AdminClient = SupabaseClient;

export type GenderAutoSegment = {
  type: "gender";
  gender: "female" | "male";
  min_confidence: "high" | "medium";
};

export type StateAutoSegment = {
  type: "state";
  state: string; // UF (SP, RJ, MG...)
};

export type AutoSegmentConfig = GenderAutoSegment | StateAutoSegment;

export type CustomerContext = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  /** UF do pedido — vem do payload do webhook (shipping_address.state OU state). */
  state?: string | null;
};

export type AutoSegmentMatchResult =
  | { listId: string; appended: true }
  | { listId: string; appended: false; reason: "duplicate" | "no_match" | "rpc_error"; error?: string };

type AutoSegmentListRow = {
  id: string;
  auto_segment: AutoSegmentConfig;
};

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1, unknown: 0 } as const;

function normalizeState(s: string | null | undefined): string {
  return (s ?? "").trim().toUpperCase();
}

/**
 * Evaluator central: dado um auto_segment e o contexto do cliente,
 * retorna true se deve apendar. Para 'gender', calcula inferência
 * uma vez por chamada (cacheável fora se múltiplas listas gender
 * existirem — passamos o inferenceCache opcional).
 */
function evaluateMatch(
  cfg: AutoSegmentConfig,
  ctx: CustomerContext,
  inferenceCache: { result: InferenceResult | null },
): boolean {
  if (cfg.type === "gender") {
    if (!inferenceCache.result) {
      inferenceCache.result = inferGender(ctx.name, ctx.email);
    }
    const r = inferenceCache.result;
    if (r.gender !== cfg.gender) return false;
    return CONFIDENCE_RANK[r.confidence] >= CONFIDENCE_RANK[cfg.min_confidence];
  }
  if (cfg.type === "state") {
    return normalizeState(ctx.state) === normalizeState(cfg.state);
  }
  return false;
}

/**
 * Itera todas as listas auto_segment do workspace e apenda o cliente
 * onde der match. Cada append é via RPC atômico append_contact_to_list
 * (migration-099) — race-safe + dedup por email/phone.
 *
 * Em paralelo, faz upsert em customer_gender_inference (se houver email)
 * pra manter o painel /api/crm/segments/gender sincronizado mesmo pra
 * workspaces sem lista de gender.
 */
export async function syncCustomerToAutoSegmentLists(
  admin: AdminClient,
  workspaceId: string,
  ctx: CustomerContext,
): Promise<AutoSegmentMatchResult[]> {
  // Carrega listas auto-segmentadas do workspace de uma vez só.
  const { data: lists, error } = await admin
    .from("crm_contact_lists")
    .select("id, auto_segment")
    .eq("workspace_id", workspaceId)
    .not("auto_segment", "is", null);

  if (error) throw new Error(`load auto lists: ${error.message}`);

  const rows = (lists ?? []) as AutoSegmentListRow[];
  const inferenceCache: { result: InferenceResult | null } = { result: null };

  // Em paralelo: upsert do inference (idempotente; barato com email key).
  const email = (ctx.email || "").trim().toLowerCase();
  if (email) {
    if (!inferenceCache.result) {
      inferenceCache.result = inferGender(ctx.name, ctx.email);
    }
    const r = inferenceCache.result;
    void admin
      .from("customer_gender_inference")
      .upsert({
        workspace_id: workspaceId,
        email,
        inferred_gender: r.gender,
        confidence: r.confidence,
        source: r.source,
        matched_name: r.matchedName,
        female_ratio: r.femaleRatio,
      }, { onConflict: "workspace_id,email" });
  }

  const results: AutoSegmentMatchResult[] = [];
  for (const row of rows) {
    try {
      if (!evaluateMatch(row.auto_segment, ctx, inferenceCache)) {
        results.push({ listId: row.id, appended: false, reason: "no_match" });
        continue;
      }
      const { data: appended, error: rpcErr } = await admin.rpc("append_contact_to_list", {
        p_list_id: row.id,
        p_email: email || null,
        p_phone: ctx.phone || null,
        p_name: ctx.name || null,
      });
      if (rpcErr) {
        results.push({ listId: row.id, appended: false, reason: "rpc_error", error: rpcErr.message });
        continue;
      }
      results.push(appended
        ? { listId: row.id, appended: true }
        : { listId: row.id, appended: false, reason: "duplicate" });
    } catch (e) {
      results.push({
        listId: row.id,
        appended: false,
        reason: "rpc_error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}

// ---------- Helpers de ensureList ----------

const STATE_NAMES_PT: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia",
  CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás",
  MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais",
  PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí",
  RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul",
  RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo",
  SE: "Sergipe", TO: "Tocantins",
};

export const VALID_BR_STATES = Object.keys(STATE_NAMES_PT);

export function isValidBrState(uf: string): boolean {
  return STATE_NAMES_PT[normalizeState(uf)] !== undefined;
}

export function stateLabel(uf: string): string {
  const u = normalizeState(uf);
  return STATE_NAMES_PT[u] ? `${STATE_NAMES_PT[u]} (${u})` : u;
}

type EnsureStateListResult = { id: string; name: string; created: boolean };

/**
 * Acha ou cria a contact_list auto-segmentada por UF.
 * Idempotente — match pelo auto_segment.state.
 */
export async function ensureStateList(
  admin: AdminClient,
  workspaceId: string,
  uf: string,
): Promise<EnsureStateListResult> {
  const state = normalizeState(uf);
  if (!isValidBrState(state)) {
    throw new Error(`UF inválida: ${uf}`);
  }
  const { data: existing, error: findErr } = await admin
    .from("crm_contact_lists")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .eq("auto_segment->>type", "state")
    .eq("auto_segment->>state", state)
    .maybeSingle();

  if (findErr) throw new Error(`ensureStateList find: ${findErr.message}`);
  if (existing) {
    return { id: existing.id as string, name: existing.name as string, created: false };
  }

  const name = `Clientes ${STATE_NAMES_PT[state]} (auto)`;
  const description = `Lista alimentada automaticamente toda vez que um pedido confirmado chega de uma cliente com endereço em ${STATE_NAMES_PT[state]} (${state}). Inclui pedidos novos sem reseed.`;

  const { data: created, error: createErr } = await admin
    .from("crm_contact_lists")
    .insert({
      workspace_id: workspaceId,
      name,
      description,
      contacts: [],
      total_count: 0,
      phone_count: 0,
      email_count: 0,
      auto_segment: { type: "state", state },
    })
    .select("id, name")
    .single();

  if (createErr || !created) {
    throw new Error(`ensureStateList create: ${createErr?.message ?? "no row"}`);
  }
  return { id: created.id as string, name: created.name as string, created: true };
}

// ---------- Seed inicial (do crm_vendas) ----------

const SEED_PAGE = 1000;

/**
 * Seeda a lista de um estado a partir de crm_vendas: pega todo email
 * único que comprou com state = UF, com phone+name mais recentes.
 * Usa o RPC atômico, então é idempotente (chamadas subsequentes só
 * pegam novidades).
 */
export async function seedStateListFromCrmVendas(
  admin: AdminClient,
  workspaceId: string,
  uf: string,
  listId: string,
): Promise<{ scanned: number; appended: number; duplicate: number; errors: number }> {
  const state = normalizeState(uf);
  // mapa email → {name, phone, ts}
  const latestByEmail = new Map<string, { name: string | null; phone: string | null; ts: number }>();

  let from = 0;
  let scanned = 0;
  while (true) {
    const { data, error } = await admin
      .from("crm_vendas")
      .select("email, cliente, telefone, data_compra, state")
      .eq("workspace_id", workspaceId)
      .eq("state", state)
      .range(from, from + SEED_PAGE - 1);
    if (error) throw new Error(`seed scan: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const r = row as { email: string | null; cliente: string | null; telefone: string | null; data_compra: string | null };
      const email = (r.email || "").trim().toLowerCase();
      if (!email) continue;
      const ts = r.data_compra ? new Date(r.data_compra).getTime() : 0;
      const cur = latestByEmail.get(email);
      if (!cur || ts > cur.ts) {
        latestByEmail.set(email, { name: r.cliente, phone: r.telefone, ts });
      }
    }
    scanned += data.length;
    if (data.length < SEED_PAGE) break;
    from += SEED_PAGE;
  }

  let appended = 0;
  let duplicate = 0;
  let errors = 0;
  for (const [email, info] of latestByEmail) {
    try {
      const { data: ok, error } = await admin.rpc("append_contact_to_list", {
        p_list_id: listId,
        p_email: email,
        p_phone: info.phone || null,
        p_name: info.name || null,
      });
      if (error) { errors++; continue; }
      if (ok) appended++;
      else duplicate++;
    } catch {
      errors++;
    }
  }
  return { scanned, appended, duplicate, errors };
}

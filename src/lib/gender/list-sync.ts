// Sincroniza inferência de gênero com crm_contact_lists.
//
// Duas operações:
//   - ensureGenderList: idempotente; acha (ou cria) a lista marcada
//     com auto_segment = { type: 'gender', gender, min_confidence }
//   - syncCustomerToGenderList: roda inferência + append atômico via
//     RPC, com upsert do customer_gender_inference em paralelo.
//
// Chamada do webhook: syncCustomerToGenderList é o ponto único.
// Tudo dentro de try/catch no caller — falha aqui NÃO pode derrubar
// o webhook de pedido.

import type { SupabaseClient } from "@supabase/supabase-js";
import { inferGender, type Confidence, type Gender } from "./inference";

export type GenderListConfig = {
  gender: Exclude<Gender, "unknown">;
  min_confidence: Exclude<Confidence, "low" | "unknown">;
};

export const DEFAULT_FEMALE_LIST: GenderListConfig = {
  gender: "female",
  min_confidence: "medium",
};

const LIST_NAMES: Record<GenderListConfig["gender"], string> = {
  female: "Clientes Mulheres (auto)",
  male: "Clientes Homens (auto)",
};

const LIST_DESCRIPTIONS: Record<GenderListConfig["gender"], string> = {
  female: "Lista alimentada automaticamente toda vez que um pedido confirmado chega de uma cliente inferida como mulher (nome ou email). Inclui só high+medium confidence — vide src/lib/gender/inference.ts.",
  male: "Lista alimentada automaticamente toda vez que um pedido confirmado chega de um cliente inferido como homem. Inclui só high+medium confidence.",
};

type AdminClient = SupabaseClient;

type ListRow = {
  id: string;
  name: string;
  total_count: number;
};

/**
 * Acha (ou cria) a lista auto-segmentada do workspace pra um config
 * (gender + min_confidence). Match exato pelo JSONB auto_segment.
 */
export async function ensureGenderList(
  admin: AdminClient,
  workspaceId: string,
  config: GenderListConfig = DEFAULT_FEMALE_LIST,
): Promise<ListRow> {
  // Busca por workspace + auto_segment matching
  const { data: existing, error: findErr } = await admin
    .from("crm_contact_lists")
    .select("id, name, total_count")
    .eq("workspace_id", workspaceId)
    .eq("auto_segment->>type", "gender")
    .eq("auto_segment->>gender", config.gender)
    .eq("auto_segment->>min_confidence", config.min_confidence)
    .maybeSingle();

  if (findErr) {
    throw new Error(`ensureGenderList find: ${findErr.message}`);
  }
  if (existing) return existing as ListRow;

  const { data: created, error: createErr } = await admin
    .from("crm_contact_lists")
    .insert({
      workspace_id: workspaceId,
      name: LIST_NAMES[config.gender],
      description: LIST_DESCRIPTIONS[config.gender],
      contacts: [],
      total_count: 0,
      phone_count: 0,
      email_count: 0,
      auto_segment: {
        type: "gender",
        gender: config.gender,
        min_confidence: config.min_confidence,
      },
    })
    .select("id, name, total_count")
    .single();

  if (createErr || !created) {
    throw new Error(`ensureGenderList create: ${createErr?.message ?? "no row"}`);
  }
  return created as ListRow;
}

/**
 * Decide se a confiança da inferência satisfaz o min_confidence da
 * lista. min_confidence='medium' aceita medium+high; 'high' só high.
 */
function meetsMinConfidence(c: Confidence, min: GenderListConfig["min_confidence"]): boolean {
  if (min === "high") return c === "high";
  return c === "high" || c === "medium";
}

export type SyncCustomerInput = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type SyncResult = {
  status: "appended" | "duplicate" | "skipped_unknown" | "skipped_wrong_gender" | "skipped_low_confidence";
  inferredGender: Gender;
  confidence: Confidence;
  listId?: string;
};

/**
 * Faz inferência + upsert do customer_gender_inference + (se bater
 * no critério) append atômico na lista auto-segmentada.
 *
 * Usar no webhook de pedido confirmado. O upsert do inference é
 * cheap (single row) e mantém o painel /api/crm/segments/gender
 * sincronizado mesmo pra clientes que ainda não estão no snapshot
 * (clientes novos só aparecem no snapshot após o próximo recompute).
 */
export async function syncCustomerToGenderList(
  admin: AdminClient,
  workspaceId: string,
  customer: SyncCustomerInput,
  config: GenderListConfig = DEFAULT_FEMALE_LIST,
): Promise<SyncResult> {
  const result = inferGender(customer.name, customer.email);

  // Upsert inference sempre — útil pro painel, mesmo se for homem ou
  // unknown. Email é o key; sem email não dá pra rastrear.
  const email = (customer.email || "").trim().toLowerCase();
  if (email) {
    await admin
      .from("customer_gender_inference")
      .upsert({
        workspace_id: workspaceId,
        email,
        inferred_gender: result.gender,
        confidence: result.confidence,
        source: result.source,
        matched_name: result.matchedName,
        female_ratio: result.femaleRatio,
      }, { onConflict: "workspace_id,email" });
  }

  if (result.gender === "unknown") {
    return { status: "skipped_unknown", inferredGender: result.gender, confidence: result.confidence };
  }
  if (result.gender !== config.gender) {
    return { status: "skipped_wrong_gender", inferredGender: result.gender, confidence: result.confidence };
  }
  if (!meetsMinConfidence(result.confidence, config.min_confidence)) {
    return { status: "skipped_low_confidence", inferredGender: result.gender, confidence: result.confidence };
  }

  const list = await ensureGenderList(admin, workspaceId, config);

  // RPC atômica do migration-099
  const { data: appended, error: rpcErr } = await admin.rpc("append_contact_to_list", {
    p_list_id: list.id,
    p_email: email || null,
    p_phone: customer.phone || null,
    p_name: customer.name || null,
  });

  if (rpcErr) {
    throw new Error(`append_contact_to_list: ${rpcErr.message}`);
  }

  return {
    status: appended ? "appended" : "duplicate",
    inferredGender: result.gender,
    confidence: result.confidence,
    listId: list.id,
  };
}

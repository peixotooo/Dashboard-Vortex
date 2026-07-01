// Captura de snapshots de membros dos grupos de WhatsApp (via W-API).
//
// Reutilizado por:
//   - /api/cron/whatsapp-group-snapshot       (diário)
//   - /api/whatsapp-groups/member-snapshot     (on-demand, "Atualizar agora")
//
// Para cada grupo do workspace pega a contagem de membros via group-metadata e
// grava UM ponto por dia em whatsapp_group_member_snapshots.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getWapiConfig,
  getInstanceStatus,
  listGroups,
  getGroupMetadata,
  updateWapiConnected,
  normalizeWapiGroups,
  isWapiDisconnectedError,
  type WapiConfig,
} from "@/lib/wapi-api";
import { spDateString } from "@/lib/series-utils";

export type GroupSnapshotSource = "cron" | "manual";

export interface GroupSnapshotResult {
  configured: boolean;
  connected: boolean;
  groupsCaptured: number;
  totalMembers: number;
  errors: Array<{ groupJid: string; error: string }>;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** jids dos grupos do workspace: tenta W-API primeiro e usa cache como fallback. */
async function getGroupJids(
  db: SupabaseClient,
  workspaceId: string,
  config: WapiConfig
): Promise<Array<{ jid: string; name: string }>> {
  const { data: cached } = await db
    .from("wapi_groups")
    .select("group_jid, group_name")
    .eq("workspace_id", workspaceId);

  const cachedGroups =
    cached?.map((g) => ({
      jid: g.group_jid as string,
      name: (g.group_name as string) || "",
    })) || [];

  try {
    const raw = await listGroups(config);
    const list = normalizeWapiGroups(raw).map((g) => ({
      jid: g.id,
      name: g.name || "Sem nome",
    }));

    if (list.length > 0) {
      const now = new Date().toISOString();
      await db.from("wapi_groups").upsert(
        list.map((g) => ({
          workspace_id: workspaceId,
          group_jid: g.jid,
          group_name: g.name || "Sem nome",
          synced_at: now,
        })),
        { onConflict: "workspace_id,group_jid" }
      );

      return list;
    }
  } catch (err) {
    if (cachedGroups.length === 0) throw err;
  }

  return cachedGroups;
}

/**
 * Captura a contagem de membros de todos os grupos do workspace e grava o
 * ponto do dia. Sequencial com throttle pra respeitar o rate limit da W-API.
 */
export async function captureGroupSnapshots(
  db: SupabaseClient,
  workspaceId: string,
  opts: { source?: GroupSnapshotSource; throttleMs?: number } = {}
): Promise<GroupSnapshotResult> {
  const source = opts.source ?? "manual";
  const throttleMs = opts.throttleMs ?? 350;

  const config = await getWapiConfig(workspaceId);
  if (!config) {
    return {
      configured: false,
      connected: false,
      groupsCaptured: 0,
      totalMembers: 0,
      errors: [],
    };
  }

  try {
    const status = await getInstanceStatus(config);
    const connected = status.connected === true;
    if (connected !== config.connected) {
      await updateWapiConnected(workspaceId, connected);
    }
    if (!connected) {
      return {
        configured: true,
        connected: false,
        groupsCaptured: 0,
        totalMembers: 0,
        errors: [],
      };
    }
  } catch (err) {
    await updateWapiConnected(workspaceId, false);
    return {
      configured: true,
      connected: false,
      groupsCaptured: 0,
      totalMembers: 0,
      errors: [
        {
          groupJid: "*",
          error: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }

  let groups: Array<{ jid: string; name: string }> = [];
  try {
    groups = await getGroupJids(db, workspaceId, config);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (isWapiDisconnectedError(err)) {
      await updateWapiConnected(workspaceId, false);
      return {
        configured: true,
        connected: false,
        groupsCaptured: 0,
        totalMembers: 0,
        errors: [{ groupJid: "*", error }],
      };
    }
    return {
      configured: true,
      connected: true,
      groupsCaptured: 0,
      totalMembers: 0,
      errors: [{ groupJid: "*", error }],
    };
  }
  const capturedOn = spDateString();
  const now = new Date().toISOString();

  let groupsCaptured = 0;
  let totalMembers = 0;
  const errors: Array<{ groupJid: string; error: string }> = [];

  for (let i = 0; i < groups.length; i++) {
    const { jid } = groups[i];
    try {
      const meta = await getGroupMetadata(config, jid);
      totalMembers += meta.memberCount;
      groupsCaptured++;

      await db.from("whatsapp_group_member_snapshots").upsert(
        {
          workspace_id: workspaceId,
          group_jid: jid,
          group_name: meta.name || groups[i].name || null,
          captured_on: capturedOn,
          captured_at: now,
          member_count: meta.memberCount,
          admins_count: meta.adminsCount,
          source,
        },
        { onConflict: "workspace_id,group_jid,captured_on" }
      );

      // Mantém o nome do grupo no cache atualizado.
      if (meta.name && meta.name !== groups[i].name) {
        await db
          .from("wapi_groups")
          .update({ group_name: meta.name })
          .eq("workspace_id", workspaceId)
          .eq("group_jid", jid);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      errors.push({ groupJid: jid, error });
      if (isWapiDisconnectedError(err)) {
        await updateWapiConnected(workspaceId, false);
        return {
          configured: true,
          connected: false,
          groupsCaptured,
          totalMembers,
          errors,
        };
      }
    }

    if (i < groups.length - 1 && throttleMs > 0) await sleep(throttleMs);
  }

  return { configured: true, connected: true, groupsCaptured, totalMembers, errors };
}

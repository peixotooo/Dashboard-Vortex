import type { SupabaseClient } from "@supabase/supabase-js";
import { getWapiConfig, listGroups, revokeGroupInvite } from "@/lib/wapi-api";

export type PoolGroupStatus = "active" | "paused" | "full" | "archived";

export interface GroupPoolGroupView {
  id: string;
  poolId: string;
  groupJid: string;
  groupName: string;
  sequence: number | null;
  inviteUrl: string | null;
  status: PoolGroupStatus;
  redirectCount: number;
  memberCount: number | null;
  lastCapturedAt: string | null;
  capacity: number;
  fillPct: number | null;
  isNearFull: boolean;
  isFull: boolean;
}

export interface GroupPoolView {
  id: string;
  name: string;
  slug: string;
  publicUrl: string;
  matchPattern: string | null;
  capacity: number;
  nearFullThreshold: number;
  active: boolean;
  groups: GroupPoolGroupView[];
  stats: {
    totalGroups: number;
    activeGroups: number;
    routeableGroups: number;
    openRouteableGroups: number;
    nearFullGroups: number;
    fullGroups: number;
    missingInviteLinks: number;
    totalMembers: number;
    needsMoreGroups: boolean;
  };
}

export interface PoolRedirectSelection {
  pool: {
    id: string;
    workspaceId: string;
    slug: string;
    capacity: number;
    nearFullThreshold: number;
  };
  config: PoolConfig;
  group: GroupPoolGroupView | null;
}

export interface RefreshPoolInviteLinksResult {
  pools: GroupPoolView[];
  summary: {
    attempted: number;
    updated: number;
    skipped: number;
    failed: number;
    force: boolean;
    errors: Array<{
      groupJid: string;
      groupName: string;
      error: string;
    }>;
  };
}

export interface SyncPoolGroupsResult {
  groupsCount: number;
  syncedAt: string;
}

type PoolConfig = {
  name: string;
  slug: string;
  matchPattern: string | null;
  capacity: number;
  nearFullThreshold: number;
  active: boolean;
  groupOverrides?: Record<
    string,
    {
      status?: PoolGroupStatus;
      sequence?: number | null;
      inviteUrl?: string | null;
      redirectCount?: number;
    }
  >;
};

type PresetRow = {
  id: string;
  workspace_id: string;
  name: string;
  group_jids: string[] | null;
  created_at: string;
};

type WapiGroupRow = {
  group_jid: string;
  group_name: string;
};

type NormalizedWapiGroup = {
  id: string;
  name: string;
};

type SnapshotRow = {
  group_jid: string;
  member_count: number;
  captured_at: string;
};

const POOL_PREFIX = "__pool__:";

export function isTechnicalPoolPresetName(name: string): boolean {
  return name.startsWith(POOL_PREFIX);
}

export function slugifyGroupPool(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function extractGroupSequence(name: string): number | null {
  const match = name.match(/#\s*(\d+)/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePoolConfig(row: Pick<PresetRow, "name">): PoolConfig | null {
  if (!isTechnicalPoolPresetName(row.name)) return null;
  try {
    const parsed = JSON.parse(row.name.slice(POOL_PREFIX.length)) as Partial<PoolConfig>;
    if (!parsed.slug || !parsed.name) return null;
    return {
      name: parsed.name,
      slug: parsed.slug,
      matchPattern: parsed.matchPattern || null,
      capacity: parsed.capacity || 1024,
      nearFullThreshold: parsed.nearFullThreshold || 950,
      active: parsed.active !== false,
      groupOverrides: parsed.groupOverrides || {},
    };
  } catch {
    return null;
  }
}

function serializePoolConfig(config: PoolConfig): string {
  return `${POOL_PREFIX}${JSON.stringify({
    name: config.name,
    slug: config.slug,
    matchPattern: config.matchPattern,
    capacity: config.capacity,
    nearFullThreshold: config.nearFullThreshold,
    active: config.active,
    groupOverrides: config.groupOverrides || {},
  })}`;
}

function normalizeInviteUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = trimmed.match(
    /https?:\/\/(?:chat\.whatsapp\.com|wa\.me\/joinchat)\/([A-Za-z0-9_-]+)/i
  );
  if (!match) return null;

  const code = (match[1] || "").replace(/[),.;]+$/, "");
  const normalized = code.toLowerCase().replace(/\s+/g, "");
  if (
    !/^[A-Za-z0-9_-]{10,}$/.test(code) ||
    ["undefined", "null", "false", "true", "nan", "[objectobject]"].includes(normalized)
  ) {
    return null;
  }

  return match[0].replace(/[),.;]+$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWapiGroupList(raw: unknown): NormalizedWapiGroup[] {
  let source: Array<Record<string, unknown>> = [];

  if (Array.isArray(raw)) {
    source = raw as Array<Record<string, unknown>>;
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const candidate = obj.groups || obj.data || obj.result || [];
    if (Array.isArray(candidate)) source = candidate as Array<Record<string, unknown>>;
  }

  return source
    .map((group) => ({
      id: String(group.id || group.jid || group.groupId || ""),
      name: String(group.name || group.subject || group.groupName || "Sem nome"),
    }))
    .filter((group) => group.id && group.id.includes("@g.us"));
}

async function latestSnapshotsByGroup(
  db: SupabaseClient,
  workspaceId: string,
  groupJids: string[]
): Promise<Map<string, SnapshotRow>> {
  const map = new Map<string, SnapshotRow>();
  if (groupJids.length === 0) return map;

  const { data } = await db
    .from("whatsapp_group_member_snapshots")
    .select("group_jid, member_count, captured_at")
    .eq("workspace_id", workspaceId)
    .in("group_jid", groupJids)
    .order("captured_at", { ascending: false });

  for (const row of (data || []) as SnapshotRow[]) {
    if (!map.has(row.group_jid)) map.set(row.group_jid, row);
  }

  return map;
}

async function groupsForPool(
  db: SupabaseClient,
  workspaceId: string,
  config: PoolConfig
): Promise<WapiGroupRow[]> {
  let query = db
    .from("wapi_groups")
    .select("group_jid, group_name")
    .eq("workspace_id", workspaceId)
    .order("group_name");

  if (config.matchPattern) {
    query = query.ilike("group_name", `%${config.matchPattern}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as WapiGroupRow[];
}

function sortPoolGroups<T extends { sequence: number | null; groupName: string }>(groups: T[]): T[] {
  return groups.sort((a, b) => {
    if (a.sequence !== null && b.sequence !== null) return a.sequence - b.sequence;
    if (a.sequence !== null) return -1;
    if (b.sequence !== null) return 1;
    return a.groupName.localeCompare(b.groupName);
  });
}

function toPoolGroupView(
  group: WapiGroupRow,
  row: PresetRow,
  config: PoolConfig,
  snapshot: SnapshotRow | undefined
): GroupPoolGroupView {
  const override = config.groupOverrides?.[group.group_jid] || {};
  const memberCount = snapshot?.member_count ?? null;
  const fillPct =
    memberCount === null
      ? null
      : Math.min(100, Math.round((memberCount / config.capacity) * 1000) / 10);
  const sequence =
    override.sequence !== undefined ? override.sequence : extractGroupSequence(group.group_name);

  return {
    id: group.group_jid,
    poolId: row.id,
    groupJid: group.group_jid,
    groupName: group.group_name || "Sem nome",
    sequence,
    inviteUrl: override.inviteUrl || null,
    status: override.status || "active",
    redirectCount: override.redirectCount || 0,
    memberCount,
    lastCapturedAt: snapshot?.captured_at || null,
    capacity: config.capacity,
    fillPct,
    isNearFull: memberCount !== null && memberCount >= config.nearFullThreshold,
    isFull: memberCount !== null && memberCount >= config.capacity,
  };
}

function buildStats(groups: GroupPoolGroupView[]) {
  const active = groups.filter((g) => g.status === "active");
  const routeable = active.filter((g) => Boolean(g.inviteUrl));
  const openRouteable = routeable.filter((g) => !g.isNearFull);
  const nearFull = active.filter((g) => g.isNearFull);
  const full = active.filter((g) => g.isFull);
  const missingInviteLinks = active.filter((g) => !g.inviteUrl).length;

  return {
    totalGroups: groups.length,
    activeGroups: active.length,
    routeableGroups: routeable.length,
    openRouteableGroups: openRouteable.length,
    nearFullGroups: nearFull.length,
    fullGroups: full.length,
    missingInviteLinks,
    totalMembers: groups.reduce((sum, g) => sum + (g.memberCount || 0), 0),
    needsMoreGroups: routeable.length > 0 && routeable.every((g) => g.isNearFull),
  };
}

async function buildPoolView(
  db: SupabaseClient,
  row: PresetRow,
  config: PoolConfig,
  origin: string
): Promise<GroupPoolView> {
  const groups = await groupsForPool(db, row.workspace_id, config);
  const snapshots = await latestSnapshotsByGroup(
    db,
    row.workspace_id,
    groups.map((g) => g.group_jid)
  );
  const groupViews = sortPoolGroups(
    groups.map((group) => toPoolGroupView(group, row, config, snapshots.get(group.group_jid)))
  );

  return {
    id: row.id,
    name: config.name,
    slug: config.slug,
    publicUrl: `${origin.replace(/\/$/, "")}/g/${config.slug}`,
    matchPattern: config.matchPattern,
    capacity: config.capacity,
    nearFullThreshold: config.nearFullThreshold,
    active: config.active,
    groups: groupViews,
    stats: buildStats(groupViews),
  };
}

export async function listGroupPools(
  db: SupabaseClient,
  workspaceId: string,
  origin: string
): Promise<GroupPoolView[]> {
  const { data, error } = await db
    .from("wapi_group_presets")
    .select("id, workspace_id, name, group_jids, created_at")
    .eq("workspace_id", workspaceId)
    .like("name", `${POOL_PREFIX}%`)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  const pools: GroupPoolView[] = [];
  for (const row of (data || []) as PresetRow[]) {
    const config = parsePoolConfig(row);
    if (!config) continue;
    pools.push(await buildPoolView(db, row, config, origin));
  }

  return pools;
}

export async function createGroupPool(
  db: SupabaseClient,
  workspaceId: string,
  config: PoolConfig
): Promise<void> {
  const groups = await groupsForPool(db, workspaceId, config);
  const { error } = await db.from("wapi_group_presets").insert({
    workspace_id: workspaceId,
    name: serializePoolConfig(config),
    group_jids: groups.map((g) => g.group_jid),
  });

  if (error) throw new Error(error.message);
}

export async function updateGroupPool(
  db: SupabaseClient,
  workspaceId: string,
  poolId: string,
  config: PoolConfig,
  groups: Array<Record<string, unknown>> = []
): Promise<void> {
  const overrides: PoolConfig["groupOverrides"] = config.groupOverrides || {};

  for (const group of groups) {
    const groupJid = String(group.groupJid || group.group_jid || group.id || "");
    if (!groupJid) continue;
    overrides[groupJid] = {
      status: (group.status as PoolGroupStatus) || "active",
      sequence:
        group.sequence === null || group.sequence === ""
          ? null
          : Number.isFinite(Number(group.sequence))
            ? Number(group.sequence)
            : extractGroupSequence(String(group.groupName || "")),
      inviteUrl:
        "inviteUrl" in group ? normalizeInviteUrl(group.inviteUrl) : normalizeInviteUrl(group.invite_url),
      redirectCount: Number(group.redirectCount || 0),
    };
  }

  const nextConfig = { ...config, groupOverrides: overrides };
  const currentGroups = await groupsForPool(db, workspaceId, nextConfig);
  const { error } = await db
    .from("wapi_group_presets")
    .update({
      name: serializePoolConfig(nextConfig),
      group_jids: currentGroups.map((g) => g.group_jid),
      updated_at: new Date().toISOString(),
    })
    .eq("id", poolId)
    .eq("workspace_id", workspaceId);

  if (error) throw new Error(error.message);
}

export async function deleteGroupPool(
  db: SupabaseClient,
  workspaceId: string,
  poolId: string
): Promise<void> {
  const { error } = await db
    .from("wapi_group_presets")
    .delete()
    .eq("id", poolId)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}

export async function syncPoolGroupsFromWapi(
  db: SupabaseClient,
  workspaceId: string
): Promise<SyncPoolGroupsResult> {
  const wapiConfig = await getWapiConfig(workspaceId);
  if (!wapiConfig) throw new Error("W-API not configured");

  const raw = await listGroups(wapiConfig);
  const groupList = normalizeWapiGroupList(raw);
  const syncedAt = new Date().toISOString();

  if (groupList.length > 0) {
    const rows = groupList.map((group) => ({
      workspace_id: workspaceId,
      group_jid: group.id,
      group_name: group.name,
      synced_at: syncedAt,
    }));

    const { error } = await db
      .from("wapi_groups")
      .upsert(rows, { onConflict: "workspace_id,group_jid" });

    if (error) throw new Error(error.message);

    await db
      .from("wapi_groups")
      .delete()
      .eq("workspace_id", workspaceId)
      .lt("synced_at", syncedAt);
  }

  return {
    groupsCount: groupList.length,
    syncedAt,
  };
}

export async function refreshPoolInviteLinks(
  db: SupabaseClient,
  workspaceId: string,
  poolId: string,
  origin: string,
  options: { force?: boolean; throttleMs?: number } = {}
): Promise<RefreshPoolInviteLinksResult> {
  const { data, error } = await db
    .from("wapi_group_presets")
    .select("id, workspace_id, name, group_jids, created_at")
    .eq("id", poolId)
    .eq("workspace_id", workspaceId)
    .like("name", `${POOL_PREFIX}%`)
    .single();

  if (error || !data) throw new Error(error?.message || "Pool not found");

  const row = data as PresetRow;
  const config = parsePoolConfig(row);
  if (!config) throw new Error("Pool invalido");

  const wapiConfig = await getWapiConfig(workspaceId);
  if (!wapiConfig) throw new Error("W-API not configured");

  const view = await buildPoolView(db, row, config, origin);
  const force = options.force === true;
  const throttleMs = Math.max(0, options.throttleMs ?? 500);
  const activeGroups = view.groups.filter((group) => group.status === "active");
  const targets = activeGroups.filter((group) => force || !group.inviteUrl);
  const overrides: NonNullable<PoolConfig["groupOverrides"]> = {
    ...(config.groupOverrides || {}),
  };
  const errors: RefreshPoolInviteLinksResult["summary"]["errors"] = [];
  let updated = 0;

  for (let index = 0; index < targets.length; index += 1) {
    const group = targets[index];
    if (index > 0 && throttleMs > 0) await sleep(throttleMs);

    try {
      const invite = await revokeGroupInvite(wapiConfig, group.groupJid);
      if (!invite.inviteUrl) {
        errors.push({
          groupJid: group.groupJid,
          groupName: group.groupName,
          error: "W-API nao retornou link de convite",
        });
        continue;
      }

      const current = overrides[group.groupJid] || {};
      overrides[group.groupJid] = {
        ...current,
        status: group.status,
        sequence: group.sequence,
        inviteUrl: invite.inviteUrl,
        redirectCount: group.redirectCount,
      };
      updated += 1;
    } catch (err) {
      errors.push({
        groupJid: group.groupJid,
        groupName: group.groupName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (updated > 0) {
    const nextConfig = { ...config, groupOverrides: overrides };
    const currentGroups = await groupsForPool(db, workspaceId, nextConfig);
    const { error: updateError } = await db
      .from("wapi_group_presets")
      .update({
        name: serializePoolConfig(nextConfig),
        group_jids: currentGroups.map((group) => group.group_jid),
        updated_at: new Date().toISOString(),
      })
      .eq("id", poolId)
      .eq("workspace_id", workspaceId);

    if (updateError) throw new Error(updateError.message);
  }

  const pools = await listGroupPools(db, workspaceId, origin);

  return {
    pools,
    summary: {
      attempted: targets.length,
      updated,
      skipped: activeGroups.length - targets.length,
      failed: errors.length,
      force,
      errors,
    },
  };
}

export async function selectGroupForPoolRedirect(
  db: SupabaseClient,
  slug: string
): Promise<PoolRedirectSelection | null> {
  const { data, error } = await db
    .from("wapi_group_presets")
    .select("id, workspace_id, name, group_jids, created_at")
    .like("name", `${POOL_PREFIX}%`);

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = ((data || []) as PresetRow[]).find((candidate) => {
    const config = parsePoolConfig(candidate);
    return config?.slug === slug;
  });
  if (!row) return null;

  const config = parsePoolConfig(row);
  if (!config || config.active === false) return null;

  const view = await buildPoolView(db, row, config, "https://dash.bulking.com.br");
  const routeable = view.groups.filter((g) => g.status === "active" && g.inviteUrl);
  const belowWarning = routeable.find((g) => !g.isNearFull);
  const belowCapacity = [...routeable]
    .filter((g) => !g.isFull)
    .sort((a, b) => (a.memberCount ?? 0) - (b.memberCount ?? 0))[0];

  return {
    pool: {
      id: row.id,
      workspaceId: row.workspace_id,
      slug: config.slug,
      capacity: config.capacity,
      nearFullThreshold: config.nearFullThreshold,
    },
    config,
    group: belowWarning || belowCapacity || null,
  };
}

export async function recordPoolRedirect(
  db: SupabaseClient,
  selection: PoolRedirectSelection
): Promise<void> {
  if (!selection.group) return;

  const overrides = selection.config.groupOverrides || {};
  const current = overrides[selection.group.groupJid] || {};
  overrides[selection.group.groupJid] = {
    ...current,
    redirectCount: (current.redirectCount || 0) + 1,
  };

  const nextConfig = { ...selection.config, groupOverrides: overrides };
  const { error } = await db
    .from("wapi_group_presets")
    .update({ name: serializePoolConfig(nextConfig), updated_at: new Date().toISOString() })
    .eq("id", selection.pool.id)
    .eq("workspace_id", selection.pool.workspaceId);

  if (error) throw new Error(error.message);
}

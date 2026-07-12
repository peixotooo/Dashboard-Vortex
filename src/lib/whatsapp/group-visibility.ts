// Esses dois grupos antigos continuam sendo devolvidos pela W-API mesmo após
// a saída da instância. Mantê-los numa exclusão central evita que um refresh
// do cache, um snapshot ou um preset volte a expô-los ou selecioná-los.
export const HIDDEN_WAPI_GROUP_JIDS = [
  "120363431605323214@g.us",
  "120363426207111837@g.us",
] as const;

const hiddenGroupJids = new Set<string>(HIDDEN_WAPI_GROUP_JIDS);

export function isVisibleWapiGroupJid(jid: string): boolean {
  return !hiddenGroupJids.has(jid);
}

export function filterVisibleWapiGroups<T extends { id: string }>(
  groups: T[],
): T[] {
  return groups.filter((group) => isVisibleWapiGroupJid(group.id));
}

export function filterVisibleCachedGroups<T extends { group_jid: string }>(
  groups: T[],
): T[] {
  return groups.filter((group) => isVisibleWapiGroupJid(group.group_jid));
}

export function filterVisibleGroupJids(groupJids: string[]): string[] {
  return groupJids.filter(isVisibleWapiGroupJid);
}

import { createAdminClient } from "@/lib/supabase-admin";

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

const PAGE_SIZE = 5000;

/**
 * Fetch phones in the permanent exclusion list (paginated for large tables).
 */
export async function getExcludedPhones(workspaceId: string): Promise<Set<string>> {
  const admin = createAdminClient();
  const phones = new Set<string>();
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data } = await admin
      .from("wa_exclusions")
      .select("phone")
      .eq("workspace_id", workspaceId)
      .range(from, from + PAGE_SIZE - 1);

    if (data && data.length > 0) {
      for (const r of data) {
        phones.add(normalizePhone((r as { phone: string }).phone));
      }
      from += PAGE_SIZE;
      hasMore = data.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }

  return phones;
}

/**
 * Fetch phones that were successfully contacted within the cooldown window (paginated).
 */
export async function getCooldownPhones(
  workspaceId: string,
  cooldownDays: number
): Promise<Set<string>> {
  if (cooldownDays <= 0) return new Set();

  const admin = createAdminClient();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - cooldownDays);

  const phones = new Set<string>();
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data } = await admin
      .from("wa_messages")
      .select("phone")
      .eq("workspace_id", workspaceId)
      .in("status", ["sent", "delivered", "read"])
      .gte("sent_at", cutoff.toISOString())
      .range(from, from + PAGE_SIZE - 1);

    if (data && data.length > 0) {
      for (const r of data) {
        phones.add(normalizePhone((r as { phone: string }).phone));
      }
      from += PAGE_SIZE;
      hasMore = data.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }

  return phones;
}

/**
 * Filter contacts, removing excluded and cooldown phones.
 */
export async function filterContacts<T extends { phone: string }>(
  workspaceId: string,
  contacts: T[],
  cooldownDays: number
): Promise<{
  allowed: T[];
  excludedCount: number;
  cooldownCount: number;
  blockedCount: number;
}> {
  const [excludedPhones, cooldownPhones] = await Promise.all([
    getExcludedPhones(workspaceId),
    getCooldownPhones(workspaceId, cooldownDays),
  ]);

  let cooldownCount = 0;
  let blockedCount = 0;

  const allowed = contacts.filter((c) => {
    const phone = normalizePhone(c.phone);
    if (excludedPhones.has(phone)) {
      blockedCount++;
      return false;
    }
    if (cooldownPhones.has(phone)) {
      cooldownCount++;
      return false;
    }
    return true;
  });

  return {
    allowed,
    excludedCount: cooldownCount + blockedCount,
    cooldownCount,
    blockedCount,
  };
}

/**
 * Check if a single phone is in the exclusion list (for cron safety net).
 */
export async function isPhoneBlocked(
  workspaceId: string,
  phone: string
): Promise<boolean> {
  const admin = createAdminClient();
  const normalized = normalizePhone(phone);
  const { data } = await admin
    .from("wa_exclusions")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("phone", normalized)
    .limit(1);

  return (data?.length ?? 0) > 0;
}

import { createAdminClient } from "@/lib/supabase-admin";

export interface TopbarCampaign {
  id: string;
  workspace_id: string;
  name: string;
  enabled: boolean;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  recurrence: "none" | "daily" | "weekly" | "monthly";
  recurrence_days: number[] | null;
  recurrence_window_start: string | null;
  recurrence_window_end: string | null;
  title: string | null;
  message: string;
  link_url: string | null;
  link_label: string | null;
  countdown_enabled: boolean;
  countdown_target: string | null;
  countdown_label: string;
  countdown_recurrence: "fixed" | "rolling_daily" | "rolling_weekly";
  bg_color: string | null;
  text_color: string | null;
  accent_color: string | null;
  show_on_pages: string[] | null;
  context_type: string | null;
  context_brief: string | null;
}

function withinWindow(now: Date, startTime?: string | null, endTime?: string | null): boolean {
  if (!startTime || !endTime) return true;
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (startMin <= endMin) return minutesNow >= startMin && minutesNow <= endMin;
  // Janela atravessa meia-noite
  return minutesNow >= startMin || minutesNow <= endMin;
}

function matchesRecurrence(c: TopbarCampaign, now: Date): boolean {
  if (c.recurrence === "none") return true;

  if (c.recurrence === "daily") {
    return withinWindow(now, c.recurrence_window_start, c.recurrence_window_end);
  }

  if (c.recurrence === "weekly") {
    if (!c.recurrence_days || c.recurrence_days.length === 0) return false;
    if (!c.recurrence_days.includes(now.getDay())) return false;
    return withinWindow(now, c.recurrence_window_start, c.recurrence_window_end);
  }

  if (c.recurrence === "monthly") {
    if (!c.recurrence_days || c.recurrence_days.length === 0) return false;
    if (!c.recurrence_days.includes(now.getDate())) return false;
    return withinWindow(now, c.recurrence_window_start, c.recurrence_window_end);
  }

  return false;
}

function isAbsoluteScheduleActive(c: TopbarCampaign, now: Date): boolean {
  if (c.starts_at && new Date(c.starts_at).getTime() > now.getTime()) return false;
  if (c.ends_at && new Date(c.ends_at).getTime() < now.getTime()) return false;
  return true;
}

/**
 * Computes the "effective" countdown target for the campaign given now,
 * applying recurrence rolling logic when configured.
 */
export function effectiveCountdownTarget(c: TopbarCampaign, now: Date): string | null {
  if (!c.countdown_enabled) return null;
  if (c.countdown_recurrence === "fixed") return c.countdown_target;

  // Rolling: o target é o fim da janela atual
  if (c.recurrence_window_end) {
    const [eh, em] = c.recurrence_window_end.split(":").map(Number);
    const target = new Date(now);
    target.setHours(eh, em, 0, 0);
    if (target.getTime() <= now.getTime()) {
      // Janela já passou — empurra pra ocorrência seguinte
      target.setDate(target.getDate() + (c.countdown_recurrence === "rolling_weekly" ? 7 : 1));
    }
    return target.toISOString();
  }

  // Fallback: 24h a partir de agora
  const target = new Date(now);
  target.setDate(target.getDate() + 1);
  return target.toISOString();
}

/**
 * Encontra a campanha ativa de maior prioridade para uma workspace
 * em um dado momento e tipo de página.
 */
export async function resolveActiveCampaign(
  workspaceId: string,
  pageType: string,
  now: Date = new Date()
): Promise<{ campaign: TopbarCampaign; countdownTarget: string | null } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("topbar_campaigns")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("enabled", true)
    .order("priority", { ascending: false })
    .order("updated_at", { ascending: false });

  if (error || !data) return null;

  for (const row of data as TopbarCampaign[]) {
    if (!isAbsoluteScheduleActive(row, now)) continue;
    if (!matchesRecurrence(row, now)) continue;

    const pages = row.show_on_pages;
    if (pages && pages.length > 0 && !pages.includes("all") && !pages.includes(pageType)) {
      continue;
    }

    return { campaign: row, countdownTarget: effectiveCountdownTarget(row, now) };
  }

  return null;
}

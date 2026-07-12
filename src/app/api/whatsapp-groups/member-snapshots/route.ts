import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  shiftDays,
  daysBetween,
  spDateString,
  toLabel,
  makeDelta,
  refByDaysAgo,
} from "@/lib/series-utils";
import { isVisibleWapiGroupJid } from "@/lib/whatsapp/group-visibility";

interface Row {
  group_jid: string;
  group_name: string | null;
  captured_on: string;
  member_count: number;
  admins_count: number | null;
}

interface GroupPoint {
  date: string;
  label: string;
  members: number;
  dailyDelta: number | null;
}

interface TotalPoint {
  date: string;
  label: string;
  members: number;
}

// GET /api/whatsapp-groups/member-snapshots?days=90
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const admin = createAdminClient();

    const { data: cfg } = await admin
      .from("wapi_config")
      .select("workspace_id, connected")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const configured = !!cfg;

    const days = Math.min(
      730,
      Math.max(
        7,
        parseInt(request.nextUrl.searchParams.get("days") || "90", 10) || 90,
      ),
    );
    const today = spDateString();
    const since = shiftDays(today, -days);

    const { data: snapRows } = await admin
      .from("whatsapp_group_member_snapshots")
      .select("group_jid, group_name, captured_on, member_count, admins_count")
      .eq("workspace_id", workspaceId)
      .gte("captured_on", since)
      .order("captured_on", { ascending: true });

    const rows = ((snapRows || []) as Row[]).filter((row) =>
      isVisibleWapiGroupJid(row.group_jid),
    );

    if (rows.length === 0) {
      return NextResponse.json({
        configured,
        connected: cfg?.connected ?? false,
        hasData: false,
        asOf: null,
        lastSnapshotAgeDays: null,
        stale: false,
        totals: null,
        groups: [],
      });
    }

    // --- por grupo ---
    const byGroup = new Map<string, Row[]>();
    for (const r of rows) {
      if (!byGroup.has(r.group_jid)) byGroup.set(r.group_jid, []);
      byGroup.get(r.group_jid)!.push(r);
    }

    const groups = Array.from(byGroup.entries()).map(([jid, grows]) => {
      const series: GroupPoint[] = grows.map((r, i) => ({
        date: r.captured_on,
        label: toLabel(r.captured_on),
        members: r.member_count,
        dailyDelta: i > 0 ? r.member_count - grows[i - 1].member_count : null,
      }));
      const current = series[series.length - 1];
      const first = series[0];
      const d7 = makeDelta(current.members, refByDaysAgo(series, 7)?.members);
      const d30 = makeDelta(current.members, refByDaysAgo(series, 30)?.members);
      const periodNet = current.members - first.members;
      const latest = grows[grows.length - 1];
      const trendBasis = d7?.value ?? periodNet;
      return {
        jid,
        name: latest.group_name || jid,
        memberCount: current.members,
        adminsCount: latest.admins_count,
        capturedOn: current.date,
        series,
        d7,
        d30,
        periodNet,
        trend: trendBasis > 0 ? "up" : trendBasis < 0 ? "down" : "flat",
      };
    });

    groups.sort((a, b) => b.memberCount - a.memberCount);

    // --- totais (soma por dia entre todos os grupos) ---
    const sumByDate = new Map<string, number>();
    for (const r of rows) {
      sumByDate.set(
        r.captured_on,
        (sumByDate.get(r.captured_on) || 0) + r.member_count,
      );
    }
    const totalSeries: TotalPoint[] = Array.from(sumByDate.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, members]) => ({ date, label: toLabel(date), members }));

    const tCurrent = totalSeries[totalSeries.length - 1];
    const tFirst = totalSeries[0];
    const tSpan = Math.max(1, daysBetween(tFirst.date, tCurrent.date));
    const tPeriodNet = tCurrent.members - tFirst.members;
    const lastSnapshotAgeDays = Math.max(0, daysBetween(tCurrent.date, today));

    const totals = {
      memberCount: tCurrent.members,
      groupCount: groups.length,
      asOf: tCurrent.date,
      series: totalSeries.map((p, i) => ({
        ...p,
        dailyDelta: i > 0 ? p.members - totalSeries[i - 1].members : null,
      })),
      d1: makeDelta(tCurrent.members, refByDaysAgo(totalSeries, 1)?.members),
      d7: makeDelta(tCurrent.members, refByDaysAgo(totalSeries, 7)?.members),
      d30: makeDelta(tCurrent.members, refByDaysAgo(totalSeries, 30)?.members),
      periodNet: tPeriodNet,
      periodPct:
        tFirst.members > 0
          ? Math.round((tPeriodNet / tFirst.members) * 10000) / 100
          : null,
      periodDays: tSpan,
    };

    return NextResponse.json({
      configured,
      connected: cfg?.connected ?? false,
      hasData: true,
      asOf: tCurrent.date,
      lastSnapshotAgeDays,
      stale: lastSnapshotAgeDays > 1,
      totals,
      groups,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}

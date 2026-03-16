import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getCampaignsWithMetrics, setContextToken } from "@/lib/meta-api";
import { datePresetToTimeRange } from "@/lib/utils";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const results: { workspaceId: string; detected: number; error?: string }[] = [];

  try {
    // Find all workspaces with linked meta accounts
    const { data: metaAccounts } = await admin
      .from("meta_accounts")
      .select("workspace_id, account_id")
      .eq("is_default", true);

    if (!metaAccounts || metaAccounts.length === 0) {
      return NextResponse.json({ message: "No workspaces with Meta accounts", results: [] });
    }

    const metaToken = process.env.META_ACCESS_TOKEN;
    if (!metaToken) {
      return NextResponse.json({ error: "META_ACCESS_TOKEN not configured" }, { status: 500 });
    }
    setContextToken(metaToken);

    const timeRange = datePresetToTimeRange("today");

    for (const { workspace_id: workspaceId, account_id: accountId } of metaAccounts) {
      try {
        // 1. Fetch current campaigns from Meta
        const { campaigns } = await getCampaignsWithMetrics({
          account_id: accountId,
          time_range: timeRange,
          statuses: ["ACTIVE"],
        });

        if (campaigns.length === 0) {
          results.push({ workspaceId, detected: 0 });
          continue;
        }

        // 2. Get latest budget log per campaign for this workspace
        const campaignIds = campaigns.map((c) => c.id);
        const { data: recentLogs } = await admin
          .from("budget_logs")
          .select("campaign_id, new_budget, created_at, source")
          .eq("workspace_id", workspaceId)
          .in("campaign_id", campaignIds)
          .order("created_at", { ascending: false });

        // Build map of latest known budget per campaign
        const lastKnown = new Map<string, { budget: number; at: string; source: string }>();
        for (const log of recentLogs || []) {
          if (!lastKnown.has(log.campaign_id)) {
            lastKnown.set(log.campaign_id, {
              budget: log.new_budget,
              at: log.created_at,
              source: log.source || "dashboard",
            });
          }
        }

        // 3. Detect external changes
        const externalChanges: Array<{
          campaign_id: string;
          campaign_name: string;
          old_budget: number;
          new_budget: number;
          change_pct: number;
          tier: string | null;
        }> = [];

        for (const campaign of campaigns) {
          const currentBudget = parseInt(campaign.daily_budget || "0", 10);
          if (currentBudget === 0) continue;

          const known = lastKnown.get(campaign.id);
          if (!known) continue; // No previous record — skip

          // If the last log was from dashboard within last 4h, it's expected
          const lastLogAge = Date.now() - new Date(known.at).getTime();
          if (known.source === "dashboard" && lastLogAge < 4 * 60 * 60 * 1000) continue;

          // Compare current budget to last known
          if (currentBudget !== known.budget) {
            const changePct = known.budget > 0
              ? ((currentBudget - known.budget) / known.budget) * 100
              : 0;

            externalChanges.push({
              campaign_id: campaign.id,
              campaign_name: campaign.name,
              old_budget: known.budget,
              new_budget: currentBudget,
              change_pct: Math.round(changePct * 100) / 100,
              tier: campaign.tier || null,
            });
          }
        }

        // 4. Insert external change logs
        if (externalChanges.length > 0) {
          const rows = externalChanges.map((c) => ({
            workspace_id: workspaceId,
            campaign_id: c.campaign_id,
            campaign_name: c.campaign_name,
            old_budget: c.old_budget,
            new_budget: c.new_budget,
            change_pct: c.change_pct,
            tier: c.tier,
            source: "external",
            snapshot_budget: c.old_budget,
            was_smart: null,
            risk_level: Math.abs(c.change_pct) > 20 ? "high" : Math.abs(c.change_pct) > 10 ? "medium" : "low",
          }));

          await admin.from("budget_logs").insert(rows);
        }

        // 5. Recompute optimization scores
        const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data: allLogs } = await admin
          .from("budget_logs")
          .select("source, was_smart, tier, change_pct")
          .eq("workspace_id", workspaceId)
          .gte("created_at", since30d);

        const logs = allLogs || [];
        const totalChanges = logs.length;
        const smartChanges = logs.filter((l) => l.was_smart === true).length;
        const dashboardChanges = logs.filter((l) => l.source === "dashboard").length;
        const externalTotal = logs.filter((l) => l.source === "external").length;

        // Missed opportunities: champion/potential campaigns with no increases
        const championCampaigns = campaigns.filter(
          (c) => c.tier === "champion" || c.tier === "potential"
        );
        const campaignsWithIncrease = new Set(
          logs
            .filter((l) => l.change_pct > 0 && l.source === "dashboard")
            .map((l) => l.tier)
        );
        const missed = championCampaigns.filter(
          (c) => !logs.some((l) => l.tier === c.tier && l.change_pct > 0)
        ).length;

        // Wasted spend: critical campaigns with no decreases
        const criticalCampaigns = campaigns.filter(
          (c) => c.tier === "critical" || c.tier === "warning"
        );
        const wasted = criticalCampaigns.filter(
          (c) => !logs.some((l) => l.tier === c.tier && l.change_pct < 0)
        ).length;

        const score = totalChanges > 0
          ? Math.min(100, Math.round(
              (smartChanges / totalChanges) * 50 +
              (dashboardChanges / totalChanges) * 30 +
              Math.max(0, 20 - missed * 5 - wasted * 5)
            ))
          : 0;

        await admin.from("budget_optimization_scores").upsert({
          workspace_id: workspaceId,
          total_changes: totalChanges,
          smart_changes: smartChanges,
          dashboard_changes: dashboardChanges,
          external_changes: externalTotal,
          missed_opportunities: missed,
          wasted_spend: wasted,
          score,
          period_start: since30d,
          period_end: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        results.push({ workspaceId, detected: externalChanges.length });
        console.log(
          `[Budget Snapshot] Workspace ${workspaceId}: ${externalChanges.length} external changes detected`
        );
      } catch (err) {
        console.error(`[Budget Snapshot] Error for workspace ${workspaceId}:`, err);
        results.push({ workspaceId, detected: 0, error: String(err) });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error("[Budget Snapshot] Fatal error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

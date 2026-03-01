import {
  listCampaigns,
  createCampaign,
  updateCampaign,
  pauseCampaign,
  resumeCampaign,
  createAdSet,
  getInsights,
  listAudiences,
} from "@/lib/meta-api";
import {
  saveMemoryRecord,
  loadCoreMemories,
  searchMemories,
  upsertDocument,
} from "@/lib/agent/memory";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function executeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  accountId: string,
  workspaceId?: string,
  supabase?: SupabaseClient
): Promise<unknown> {
  switch (toolName) {
    case "get_account_overview": {
      const datePreset = (toolInput.date_range as string) || "this_month";
      const [insights, campaigns] = await Promise.all([
        getInsights({
          object_id: accountId,
          date_preset: datePreset,
          fields: [
            "spend",
            "impressions",
            "clicks",
            "cpc",
            "cpm",
            "ctr",
            "reach",
            "frequency",
          ],
        }),
        listCampaigns({ account_id: accountId, limit: 100 }),
      ]);

      const campaignList = (campaigns as { campaigns: Array<{ status: string }> }).campaigns;
      const activeCampaigns = campaignList.filter(
        (c) => c.status === "ACTIVE"
      ).length;
      const pausedCampaigns = campaignList.filter(
        (c) => c.status === "PAUSED"
      ).length;

      return {
        insights,
        summary: {
          total_campaigns: campaignList.length,
          active_campaigns: activeCampaigns,
          paused_campaigns: pausedCampaigns,
        },
      };
    }

    case "list_campaigns": {
      return listCampaigns({
        account_id: accountId,
        status_filter: toolInput.status_filter as string | undefined,
        limit: (toolInput.limit as number) || 25,
      });
    }

    case "get_campaign_metrics": {
      const params: Parameters<typeof getInsights>[0] = {
        object_id: toolInput.campaign_id as string,
        date_preset: toolInput.date_range as string,
        fields: [
          "spend",
          "impressions",
          "clicks",
          "cpc",
          "cpm",
          "ctr",
          "reach",
          "frequency",
          "actions",
          "cost_per_action_type",
        ],
      };
      if (toolInput.breakdown) {
        params.breakdowns = [toolInput.breakdown as string];
      }
      return getInsights(params);
    }

    case "create_campaign": {
      return createCampaign({
        account_id: accountId,
        name: toolInput.name,
        objective: toolInput.objective,
        status: toolInput.status || "PAUSED",
        special_ad_categories: [],
      });
    }

    case "update_campaign": {
      const updates: Record<string, unknown> = {
        campaign_id: toolInput.campaign_id,
      };
      if (toolInput.name) updates.name = toolInput.name;
      if (toolInput.status) updates.status = toolInput.status;
      if (toolInput.daily_budget) updates.daily_budget = toolInput.daily_budget;
      return updateCampaign(updates);
    }

    case "pause_campaign": {
      return pauseCampaign({
        campaign_id: toolInput.campaign_id as string,
      });
    }

    case "resume_campaign": {
      return resumeCampaign({
        campaign_id: toolInput.campaign_id as string,
      });
    }

    case "create_adset": {
      return createAdSet({
        campaign_id: toolInput.campaign_id,
        name: toolInput.name,
        daily_budget: toolInput.daily_budget,
        optimization_goal: toolInput.optimization_goal,
        targeting: toolInput.targeting,
        status: toolInput.status || "PAUSED",
      });
    }

    case "analyze_performance": {
      const datePreset = (toolInput.date_range as string) || "last_7d";
      const [overview, byAge, byPlacement] = await Promise.all([
        getInsights({
          object_id: toolInput.campaign_id as string,
          date_preset: datePreset,
          fields: [
            "spend",
            "impressions",
            "clicks",
            "cpc",
            "cpm",
            "ctr",
            "reach",
            "frequency",
            "actions",
            "cost_per_action_type",
          ],
        }),
        getInsights({
          object_id: toolInput.campaign_id as string,
          date_preset: datePreset,
          fields: ["spend", "impressions", "clicks", "cpc", "ctr"],
          breakdowns: ["age"],
        }),
        getInsights({
          object_id: toolInput.campaign_id as string,
          date_preset: datePreset,
          fields: ["spend", "impressions", "clicks", "cpc", "ctr"],
          breakdowns: ["placement"],
        }),
      ]);

      return {
        overview,
        breakdown_by_age: byAge,
        breakdown_by_placement: byPlacement,
        analysis_note:
          "Use estes dados para gerar uma análise detalhada com sugestões de otimização.",
      };
    }

    case "list_custom_audiences": {
      return listAudiences({ account_id: accountId });
    }

    case "save_memory": {
      if (!workspaceId || !supabase) {
        return { error: "Memória não disponível (workspace não configurado)" };
      }
      await saveMemoryRecord(
        supabase,
        workspaceId,
        accountId,
        toolInput.category as string,
        toolInput.key as string,
        toolInput.value as string
      );
      return {
        success: true,
        message: `Memória salva: [${toolInput.category}] ${toolInput.key} = ${toolInput.value}`,
      };
    }

    case "recall_memory": {
      if (!workspaceId || !supabase) {
        return { error: "Memória não disponível (workspace não configurado)" };
      }
      const query = (toolInput.query as string) || "";
      const memories = query
        ? await searchMemories(supabase, workspaceId, accountId, query)
        : await loadCoreMemories(supabase, workspaceId, accountId);
      return {
        memories: memories.map((m) => ({
          category: m.category,
          key: m.key,
          value: m.value,
          updated_at: m.updated_at,
        })),
        count: memories.length,
      };
    }

    case "update_personality": {
      if (!workspaceId || !supabase) {
        return {
          error: "Personalidade não disponível (workspace não configurado)",
        };
      }

      const content = toolInput.updated_content as string;
      const summary = toolInput.change_summary as string;

      // Safety: minimum content length
      if (!content || content.length < 100) {
        return {
          error:
            "O conteúdo da personalidade é muito curto. Deve ter pelo menos 100 caracteres e manter a estrutura completa.",
        };
      }

      // Safety: must contain identity markers
      if (!content.includes("Vortex") && !content.includes("Identidade")) {
        return {
          error:
            "O conteúdo deve manter a referência à identidade do Vortex.",
        };
      }

      await upsertDocument(
        supabase,
        workspaceId,
        accountId,
        "soul",
        content
      );

      return {
        success: true,
        message: `Personalidade atualizada: ${summary}. A mudança será refletida na próxima mensagem.`,
      };
    }

    default:
      return { error: `Tool '${toolName}' não reconhecida.` };
  }
}

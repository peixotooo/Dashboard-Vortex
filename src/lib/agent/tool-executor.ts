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
  createTask,
  updateTask,
  createDeliverable,
  getAgentBySlug,
} from "@/lib/agent/memory";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function executeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  accountId: string,
  workspaceId?: string,
  supabase?: SupabaseClient,
  agentId?: string
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

    case "create_task": {
      if (!workspaceId || !supabase) {
        return { error: "Tasks não disponíveis (workspace não configurado)" };
      }
      const taskType = (toolInput.task_type as string) || "general";
      let assignAgentId: string | undefined;
      let assignedSlug: string | undefined;

      if (toolInput.assign_to_slug) {
        // Explicit slug provided
        assignedSlug = toolInput.assign_to_slug as string;
        const agent = await getAgentBySlug(supabase, workspaceId, assignedSlug);
        if (agent) assignAgentId = agent.id;
      } else {
        // Auto-assign based on task_type
        const defaultSlugMap: Record<string, string> = {
          copy: "copywriting",
          seo: "seo-audit",
          social_calendar: "social-content",
          campaign: "paid-ads",
          cro: "page-cro",
          strategy: "launch-strategy",
          revenue: "churn-prevention",
          general: "coordenador",
        };
        assignedSlug = defaultSlugMap[taskType] || "coordenador";
        const agent = await getAgentBySlug(supabase, workspaceId, assignedSlug);
        if (agent) assignAgentId = agent.id;
      }

      const task = await createTask(supabase, workspaceId, {
        title: toolInput.title as string,
        description: (toolInput.description as string) || "",
        agent_id: assignAgentId,
        created_by_agent_id: agentId,
        priority: (toolInput.priority as string) || "medium",
        task_type: taskType,
        due_date: toolInput.due_date as string | undefined,
      });
      return {
        success: true,
        task_id: task.id,
        message: `Tarefa criada: "${task.title}" (${task.priority}, ${task.task_type}) — atribuída a ${assignedSlug || "nenhum agente"}`,
      };
    }

    case "update_task": {
      if (!workspaceId || !supabase) {
        return { error: "Tasks não disponíveis (workspace não configurado)" };
      }
      const updates: Record<string, unknown> = {};
      if (toolInput.status) updates.status = toolInput.status;
      if (toolInput.priority) updates.priority = toolInput.priority;
      const updated = await updateTask(
        supabase,
        toolInput.task_id as string,
        updates
      );
      return {
        success: true,
        message: `Tarefa "${updated.title}" atualizada para status: ${updated.status}`,
      };
    }

    case "save_deliverable": {
      if (!workspaceId || !supabase) {
        return {
          error: "Deliverables não disponíveis (workspace não configurado)",
        };
      }
      const deliverable = await createDeliverable(supabase, workspaceId, {
        title: toolInput.title as string,
        content: toolInput.content as string,
        deliverable_type:
          (toolInput.deliverable_type as string) || "general",
        format: (toolInput.format as string) || "markdown",
        metadata: (toolInput.metadata as Record<string, unknown>) || {},
        task_id: toolInput.task_id as string | undefined,
        agent_id: agentId,
      });
      return {
        success: true,
        deliverable_id: deliverable.id,
        message: `Entrega salva: "${deliverable.title}" (${deliverable.deliverable_type})`,
      };
    }

    default:
      return { error: `Tool '${toolName}' não reconhecida.` };
  }
}

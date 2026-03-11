import { generateRfmReport, generateMonthlyCohort } from "@/lib/crm-rfm";
import type { CrmVendaRow } from "@/lib/crm-rfm";
import {
  listCampaigns,
  createCampaign,
  updateCampaign,
  pauseCampaign,
  resumeCampaign,
  createAdSet,
  createAdCreative,
  createAd,
  getInsights,
  listAudiences,
  uploadAdImage,
} from "@/lib/meta-api";
import { getGoogleAdsCampaigns } from "@/lib/google-ads-api";
import { getApifyConfig, scrapeInstagramProfile, scrapeInstagramPosts } from "@/lib/apify-api";
import {
  saveMemoryRecord,
  loadCoreMemories,
  searchMemories,
  upsertDocument,
  createProject,
  createTask,
  updateTask,
  createDeliverable,
  getAgentBySlug,
  listSavedCreatives,
  updateCreativeNote,
  listSavedCampaigns,
  createMarketingAction,
} from "@/lib/agent/memory";
import { createAdminClient } from "@/lib/supabase-admin";
import { syncMarketingToProjectContext } from "@/lib/agent/marketing-sync";
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

    case "create_ad_creative": {
      return createAdCreative({
        account_id: accountId,
        name: toolInput.name as string,
        image_hash: toolInput.image_hash as string,
        link: toolInput.link as string,
        title: (toolInput.title as string) || "",
        body: (toolInput.body as string) || "",
        call_to_action: (toolInput.call_to_action as string) || "LEARN_MORE",
        page_id: toolInput.page_id as string | undefined,
        instagram_actor_id: toolInput.instagram_actor_id as string | undefined,
      });
    }

    case "create_ad": {
      return createAd({
        adset_id: toolInput.adset_id as string,
        name: toolInput.name as string,
        creative: { creative_id: toolInput.creative_id as string },
        status: (toolInput.status as string) || "PAUSED",
        url_tags: toolInput.url_tags as string | undefined,
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

    case "create_project": {
      if (!workspaceId || !supabase) {
        return {
          error: "Projetos não disponíveis (workspace não configurado)",
        };
      }
      const project = await createProject(supabase, workspaceId, {
        title: toolInput.title as string,
        description: (toolInput.description as string) || "",
        created_by_agent_id: agentId,
      });
      return {
        success: true,
        project_id: project.id,
        message: `Projeto criado: "${project.title}". Use project_id: "${project.id}" ao criar tarefas para este projeto.`,
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
        project_id: toolInput.project_id as string | undefined,
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

      // Validate content is not empty/too short
      const deliverableContent = ((toolInput.content as string) || "").trim();
      if (deliverableContent.length < 50) {
        return {
          error:
            "Conteudo muito curto. A entrega deve ter no minimo 50 caracteres de conteudo real. Gere o conteudo COMPLETO e tente novamente.",
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
        project_id: toolInput.project_id as string | undefined,
      });
      return {
        success: true,
        deliverable_id: deliverable.id,
        message: `Entrega salva: "${deliverable.title}" (${deliverable.deliverable_type})`,
      };
    }

    // --- Saved Creatives Tools ---

    case "list_saved_creatives": {
      if (!workspaceId || !supabase) {
        return {
          error: "Criativos salvos nao disponiveis (workspace nao configurado)",
        };
      }
      const creatives = await listSavedCreatives(supabase, workspaceId, {
        tier: (toolInput.tier as string) || undefined,
        tags: (toolInput.tags as string[]) || undefined,
        format: (toolInput.format as string) || undefined,
        min_roas: (toolInput.min_roas as number) || undefined,
        account_id: (toolInput.account_id as string) || undefined,
        limit: (toolInput.limit as number) || 20,
      });

      return {
        creatives: creatives.map((c) => ({
          id: c.id,
          ad_name: c.ad_name,
          account_name: c.account_name,
          format: c.format,
          tier: c.tier,
          campaign_name: c.campaign_name,
          spend: c.spend,
          revenue: c.revenue,
          roas: c.roas,
          ctr: c.ctr,
          cpc: c.cpc,
          impressions: c.impressions,
          clicks: c.clicks,
          title: c.title,
          body: c.body ? c.body.slice(0, 200) : null,
          cta: c.cta,
          destination_url: c.destination_url,
          image_url: c.image_url,
          tags: c.tags,
          notes: c.notes,
          date_range: c.date_range,
        })),
        count: creatives.length,
        message:
          creatives.length === 0
            ? "Nenhum criativo campeao encontrado. Os criativos sao classificados automaticamente na pagina de Criativos."
            : `Encontrados ${creatives.length} criativos classificados.`,
      };
    }

    case "add_creative_note": {
      if (!workspaceId || !supabase) {
        return {
          error: "Criativos salvos nao disponiveis (workspace nao configurado)",
        };
      }
      const updated = await updateCreativeNote(
        supabase,
        toolInput.creative_id as string,
        toolInput.notes as string,
        toolInput.tags as string[] | undefined
      );
      return {
        success: true,
        message: `Anotacao atualizada para "${updated.ad_name}"`,
        creative_id: updated.id,
      };
    }

    case "list_saved_campaigns": {
      if (!workspaceId || !supabase) {
        return {
          error: "Campanhas salvas nao disponiveis (workspace nao configurado)",
        };
      }
      const savedCampaigns = await listSavedCampaigns(supabase, workspaceId, {
        tier: (toolInput.tier as string) || undefined,
        min_roas: (toolInput.min_roas as number) || undefined,
        account_id: (toolInput.account_id as string) || undefined,
        platform: (toolInput.platform as string) || undefined,
        limit: (toolInput.limit as number) || 20,
      });

      return {
        campaigns: savedCampaigns.map((c) => ({
          id: c.id,
          campaign_name: c.campaign_name,
          account_name: c.account_name,
          status: c.status,
          objective: c.objective,
          tier: c.tier,
          spend: c.spend,
          revenue: c.revenue,
          roas: c.roas,
          ctr: c.ctr,
          cpc: c.cpc,
          impressions: c.impressions,
          clicks: c.clicks,
          daily_budget: c.daily_budget,
          tags: c.tags,
          notes: c.notes,
          date_range: c.date_range,
        })),
        count: savedCampaigns.length,
        message:
          savedCampaigns.length === 0
            ? "Nenhuma campanha classificada encontrada. As campanhas sao classificadas automaticamente na pagina de Campanhas."
            : `Encontradas ${savedCampaigns.length} campanhas classificadas.`,
      };
    }

    case "upload_image_from_url": {
      const imageUrl = toolInput.image_url as string;
      if (!imageUrl) {
        return { error: "image_url é obrigatório" };
      }

      try {
        // Download image from URL
        const imgRes = await fetch(imageUrl);
        if (!imgRes.ok) {
          return { error: `Falha ao baixar imagem: HTTP ${imgRes.status}` };
        }
        const blob = await imgRes.blob();

        // Detect filename from URL
        const urlPath = new URL(imageUrl).pathname;
        const filename = urlPath.split("/").pop() || "image.jpg";

        // Create FormData for Meta upload
        const formData = new FormData();
        formData.append("filename", blob, filename);
        formData.append("account_id", accountId);

        const result = await uploadAdImage(formData);
        const images = (result as Record<string, unknown>).images as Record<string, { hash: string }> | undefined;
        if (!images) {
          return { error: "Upload concluído mas nenhum hash retornado" };
        }
        const firstKey = Object.keys(images)[0];
        const hash = firstKey ? images[firstKey].hash : null;
        if (!hash) {
          return { error: "Upload concluído mas image_hash não encontrado" };
        }
        return {
          success: true,
          image_hash: hash,
          message: `Imagem enviada com sucesso. image_hash: "${hash}" — use este hash em create_ad_creative.`,
        };
      } catch (err) {
        return {
          error: `Erro ao fazer upload da imagem: ${err instanceof Error ? err.message : "erro desconhecido"}`,
        };
      }
    }

    case "list_google_ads_campaigns": {
      const dateRange = (toolInput.date_range as string) || "last_30d";
      try {
        const result = await getGoogleAdsCampaigns({
          datePreset: dateRange as import("@/lib/types").DatePreset,
          statuses: ["ACTIVE", "PAUSED"],
        });
        const campaigns = result.campaigns;
        return {
          campaigns: campaigns.map((c) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            objective: c.objective,
            spend: c.spend,
            revenue: c.revenue,
            roas: c.roas,
            impressions: c.impressions,
            clicks: c.clicks,
            ctr: c.ctr,
            cpc: c.cpc,
            purchases: c.purchases,
          })),
          count: campaigns.length,
          total_spend: campaigns.reduce((s, c) => s + c.spend, 0).toFixed(2),
          total_revenue: campaigns.reduce((s, c) => s + c.revenue, 0).toFixed(2),
          message:
            campaigns.length === 0
              ? "Nenhuma campanha Google Ads encontrada. Verifique se as credenciais estao configuradas."
              : `Encontradas ${campaigns.length} campanhas Google Ads.`,
        };
      } catch (err) {
        return {
          error: `Erro ao buscar campanhas Google Ads: ${err instanceof Error ? err.message : "erro desconhecido"}`,
        };
      }
    }

    case "create_marketing_action": {
      if (!workspaceId || !supabase) {
        return { error: "Workspace nao configurado" };
      }
      try {
        const action = await createMarketingAction(supabase, workspaceId, {
          title: toolInput.title as string,
          description: (toolInput.description as string) || "",
          category: (toolInput.category as string) || "geral",
          start_date: toolInput.start_date as string,
          end_date: toolInput.end_date as string,
          status: "planned",
        });
        syncMarketingToProjectContext(supabase, workspaceId).catch(() => {});
        return {
          success: true,
          action_id: action.id,
          message: `Acao "${action.title}" adicionada ao calendario de planejamento (${action.start_date} a ${action.end_date})`,
        };
      } catch (err) {
        return {
          error: `Erro ao criar acao de marketing: ${err instanceof Error ? err.message : "erro desconhecido"}`,
        };
      }
    }

    // --- Media Gallery Tools ---

    case "list_media_gallery": {
      if (!workspaceId) {
        return { error: "Galeria não disponível (workspace não configurado)" };
      }
      try {
        const adminSb = createAdminClient();
        let query = adminSb
          .from("workspace_media")
          .select("id, filename, image_url, image_hash, created_at")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(50);

        const search = toolInput.search as string | undefined;
        if (search) {
          query = query.ilike("filename", `%${search}%`);
        }

        const { data, error } = await query;
        if (error) {
          return { error: `Erro ao buscar galeria: ${error.message}` };
        }

        return {
          media: (data || []).map((m) => ({
            filename: m.filename,
            image_hash: m.image_hash,
            image_url: m.image_url,
            created_at: m.created_at,
          })),
          count: (data || []).length,
          message:
            (data || []).length === 0
              ? "Nenhuma imagem na galeria. O usuário precisa anexar imagens no chat primeiro."
              : `${(data || []).length} imagens disponíveis na galeria.`,
        };
      } catch (err) {
        return {
          error: `Erro ao buscar galeria: ${err instanceof Error ? err.message : "erro desconhecido"}`,
        };
      }
    }

    // --- Instagram Tools ---

    case "get_instagram_profile": {
      const username = toolInput.username as string;
      if (!username) return { error: "username e obrigatorio" };
      try {
        const config = await getApifyConfig(workspaceId || undefined);
        if (!config) return { error: "Apify nao configurado. Defina APIFY_API_TOKEN no .env." };
        const profile = await scrapeInstagramProfile(config, username);
        return { profile };
      } catch (err) {
        return { error: `Erro ao buscar perfil: ${err instanceof Error ? err.message : "erro desconhecido"}` };
      }
    }

    case "get_instagram_posts": {
      const username = toolInput.username as string;
      if (!username) return { error: "username e obrigatorio" };
      const limit = Math.min((toolInput.limit as number) || 12, 50);
      try {
        const config = await getApifyConfig(workspaceId || undefined);
        if (!config) return { error: "Apify nao configurado. Defina APIFY_API_TOKEN no .env." };
        const posts = await scrapeInstagramPosts(config, username, limit);
        return {
          posts: posts.map(p => ({
            type: p.type,
            caption: p.caption?.slice(0, 200),
            hashtags: p.hashtags,
            likesCount: p.likesCount,
            commentsCount: p.commentsCount,
            timestamp: p.timestamp,
            url: p.url,
          })),
          total: posts.length,
        };
      } catch (err) {
        return { error: `Erro ao buscar posts: ${err instanceof Error ? err.message : "erro desconhecido"}` };
      }
    }

    // --- CRM Tools ---

    case "get_crm_overview": {
      if (!workspaceId || !supabase) {
        return { error: "CRM nao disponivel (workspace nao configurado)" };
      }
      const crmRows: CrmVendaRow[] = [];
      const CRM_PAGE = 1000;
      let crmFrom = 0;
      let crmMore = true;
      while (crmMore) {
        const { data, error } = await supabase
          .from("crm_vendas")
          .select("cliente, email, telefone, valor, data_compra, cupom, numero_pedido, compras_anteriores")
          .eq("workspace_id", workspaceId)
          .range(crmFrom, crmFrom + CRM_PAGE - 1);
        if (error) return { error: `Erro ao buscar dados: ${error.message}` };
        if (data && data.length > 0) {
          crmRows.push(...(data as CrmVendaRow[]));
          crmFrom += CRM_PAGE;
          crmMore = data.length === CRM_PAGE;
        } else {
          crmMore = false;
        }
      }
      if (crmRows.length === 0) {
        return { summary: { totalCustomers: 0 }, segments: [], distributions: {}, behavioral: {} };
      }
      const report = generateRfmReport(crmRows);
      return {
        summary: report.summary,
        segments: report.segments,
        distributions: report.distributions,
        behavioral: report.behavioralDistributions,
      };
    }

    case "get_export_history": {
      if (!workspaceId || !supabase) {
        return { error: "CRM nao disponivel (workspace nao configurado)" };
      }
      const { data: logs, error: logsErr } = await supabase
        .from("crm_export_logs")
        .select("id, export_type, filters, record_count, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (logsErr) return { error: `Erro ao buscar logs: ${logsErr.message}` };
      return { logs: logs || [], count: (logs || []).length };
    }

    case "get_cohort_trends": {
      if (!workspaceId || !supabase) {
        return { error: "CRM nao disponivel (workspace nao configurado)" };
      }
      const cohortMonths = (toolInput.months as number) || 12;
      const cohortRows: CrmVendaRow[] = [];
      const COHORT_PAGE = 1000;
      let cohortFrom = 0;
      let cohortMore = true;
      while (cohortMore) {
        const { data, error } = await supabase
          .from("crm_vendas")
          .select("cliente, email, telefone, valor, data_compra, cupom, numero_pedido, compras_anteriores")
          .eq("workspace_id", workspaceId)
          .range(cohortFrom, cohortFrom + COHORT_PAGE - 1);
        if (error) return { error: `Erro ao buscar dados: ${error.message}` };
        if (data && data.length > 0) {
          cohortRows.push(...(data as CrmVendaRow[]));
          cohortFrom += COHORT_PAGE;
          cohortMore = data.length === COHORT_PAGE;
        } else {
          cohortMore = false;
        }
      }
      if (cohortRows.length === 0) {
        return { error: "Sem dados no CRM para gerar coortes" };
      }
      const cohort = generateMonthlyCohort(cohortRows, cohortMonths > 0 ? cohortMonths : undefined);
      return {
        metrics: {
          arpu: cohort.arpu,
          avgOrdersPerClient: cohort.avgOrdersPerClient,
          repurchaseRate: cohort.repurchaseRate,
          newClients: cohort.newClients,
          totalClients: cohort.totalClients,
          totalRevenue: cohort.totalRevenue,
        },
        monthlyData: cohort.monthlyData,
      };
    }

    case "get_financial_context": {
      if (!workspaceId || !supabase) {
        return { error: "Financeiro nao disponivel (workspace nao configurado)" };
      }
      const { data: fin, error: finErr } = await supabase
        .from("financial_settings")
        .select("*")
        .eq("workspace_id", workspaceId)
        .single();
      if (finErr || !fin) {
        return {
          product_cost_pct: 25, tax_pct: 6, frete_pct: 6,
          desconto_pct: 3, other_expenses_pct: 5, invest_pct: 12,
          note: "Usando valores default — configuracoes financeiras nao encontradas",
        };
      }
      return fin;
    }

    default:
      return { error: `Tool '${toolName}' não reconhecida.` };
  }
}

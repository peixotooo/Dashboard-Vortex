import type Anthropic from "@anthropic-ai/sdk";

type Tool = Anthropic.Messages.Tool;

// --- Meta Ads Tools (Vortex only) ---

const META_TOOLS: Tool[] = [
  {
    name: "get_account_overview",
    description:
      "Obtém resumo geral da conta de anúncios do Meta. Inclui gasto total, campanhas ativas, impressões, cliques. Use quando o usuário perguntar sobre o estado da conta ou pedir um resumo.",
    input_schema: {
      type: "object" as const,
      properties: {
        date_range: {
          type: "string",
          enum: ["today", "yesterday", "last_7d", "last_30d", "this_month"],
          description: "Período para os dados agregados",
        },
      },
      required: [],
    },
  },
  {
    name: "list_campaigns",
    description:
      "Lista campanhas da conta de anúncios. Pode filtrar por status. Use quando o usuário perguntar 'quais campanhas estão rodando', 'me mostra as campanhas', etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        status_filter: {
          type: "string",
          enum: ["ACTIVE", "PAUSED"],
          description: "Filtrar por status da campanha (omitir para todas)",
        },
        limit: {
          type: "number",
          description: "Número máximo de campanhas retornadas",
        },
      },
      required: [],
    },
  },
  {
    name: "get_campaign_metrics",
    description:
      "Obtém métricas de performance de uma campanha específica. Inclui gastos, impressões, cliques, CPC, CPM, CTR, reach, frequency. Use quando o usuário perguntar 'como está a campanha X'.",
    input_schema: {
      type: "object" as const,
      properties: {
        campaign_id: {
          type: "string",
          description: "ID da campanha no Meta Ads",
        },
        date_range: {
          type: "string",
          enum: [
            "today",
            "yesterday",
            "last_7d",
            "last_14d",
            "last_30d",
            "this_month",
            "last_month",
          ],
          description: "Período das métricas",
        },
        breakdown: {
          type: "string",
          enum: ["age", "gender", "placement", "device_platform", "country"],
          description: "Segmentação dos dados (opcional)",
        },
      },
      required: ["campaign_id", "date_range"],
    },
  },
  {
    name: "create_campaign",
    description:
      "Cria uma nova campanha no Meta Ads. IMPORTANTE: Sempre mostre um resumo detalhado ao usuário e peça confirmação ANTES de executar esta tool. Nunca crie campanhas sem confirmação explícita.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Nome da campanha" },
        objective: {
          type: "string",
          enum: [
            "OUTCOME_AWARENESS",
            "OUTCOME_ENGAGEMENT",
            "OUTCOME_TRAFFIC",
            "OUTCOME_LEADS",
            "OUTCOME_APP_PROMOTION",
            "OUTCOME_SALES",
          ],
          description: "Objetivo da campanha",
        },
        status: {
          type: "string",
          enum: ["ACTIVE", "PAUSED"],
          description: "Status inicial da campanha",
        },
      },
      required: ["name", "objective"],
    },
  },
  {
    name: "update_campaign",
    description:
      "Atualiza configurações de uma campanha existente. Pode alterar nome, budget, status. Mostre alterações propostas e peça confirmação.",
    input_schema: {
      type: "object" as const,
      properties: {
        campaign_id: {
          type: "string",
          description: "ID da campanha a ser atualizada",
        },
        name: { type: "string", description: "Novo nome (opcional)" },
        status: {
          type: "string",
          enum: ["ACTIVE", "PAUSED"],
          description: "Novo status (opcional)",
        },
        daily_budget: {
          type: "number",
          description: "Novo orçamento diário em centavos (opcional)",
        },
      },
      required: ["campaign_id"],
    },
  },
  {
    name: "pause_campaign",
    description:
      "Pausa uma campanha ativa. Peça confirmação antes de executar.",
    input_schema: {
      type: "object" as const,
      properties: {
        campaign_id: { type: "string", description: "ID da campanha" },
      },
      required: ["campaign_id"],
    },
  },
  {
    name: "resume_campaign",
    description:
      "Reativa uma campanha pausada. Peça confirmação antes de executar.",
    input_schema: {
      type: "object" as const,
      properties: {
        campaign_id: { type: "string", description: "ID da campanha" },
      },
      required: ["campaign_id"],
    },
  },
  {
    name: "create_adset",
    description:
      "Cria um novo conjunto de anúncios (Ad Set) dentro de uma campanha. Define segmentação, orçamento e otimização. Peça confirmação antes de executar.",
    input_schema: {
      type: "object" as const,
      properties: {
        campaign_id: {
          type: "string",
          description: "ID da campanha pai",
        },
        name: { type: "string", description: "Nome do conjunto de anúncios" },
        daily_budget: {
          type: "number",
          description: "Orçamento diário em centavos de Real (ex: 10000 = R$100)",
        },
        optimization_goal: {
          type: "string",
          enum: [
            "LINK_CLICKS",
            "LANDING_PAGE_VIEWS",
            "IMPRESSIONS",
            "REACH",
            "OFFSITE_CONVERSIONS",
            "LEAD_GENERATION",
          ],
          description: "Meta de otimização",
        },
        targeting: {
          type: "object",
          description: "Configurações de segmentação",
          properties: {
            age_min: { type: "number" },
            age_max: { type: "number" },
            genders: {
              type: "array",
              items: { type: "number" },
              description: "0=todos, 1=masculino, 2=feminino",
            },
            geo_locations: {
              type: "object",
              properties: {
                countries: {
                  type: "array",
                  items: { type: "string" },
                },
              },
            },
          },
        },
        status: {
          type: "string",
          enum: ["ACTIVE", "PAUSED"],
          description: "Status inicial",
        },
      },
      required: ["campaign_id", "name", "optimization_goal"],
    },
  },
  {
    name: "analyze_performance",
    description:
      "Analisa a performance de uma campanha e gera sugestões de otimização. Use quando o usuário pedir análise, sugestões de melhoria, ou perguntar 'o que posso melhorar'.",
    input_schema: {
      type: "object" as const,
      properties: {
        campaign_id: {
          type: "string",
          description: "ID da campanha a analisar",
        },
        date_range: {
          type: "string",
          enum: ["last_7d", "last_14d", "last_30d"],
        },
      },
      required: ["campaign_id"],
    },
  },
  {
    name: "list_custom_audiences",
    description:
      "Lista públicos personalizados e lookalike disponíveis na conta. Use quando o usuário quiser usar audiências existentes.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

// --- Memory Tools (Vortex only) ---

const MEMORY_TOOLS: Tool[] = [
  {
    name: "save_memory",
    description:
      "Salva um fato ou preferência na memória permanente do agente. Use PROATIVAMENTE quando aprender algo sobre o usuário: preferências, padrões de uso, targeting favorito, budgets típicos, convenções de nomenclatura. A memória persiste entre conversas e sessões.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          enum: ["targeting", "budget", "naming", "preference", "general"],
          description:
            "Categoria da memória: targeting (público-alvo), budget (orçamentos), naming (nomes), preference (preferências), general (outros)",
        },
        key: {
          type: "string",
          description:
            "Chave descritiva do fato (ex: 'budget_diario_padrao', 'objetivo_preferido', 'targeting_padrao')",
        },
        value: {
          type: "string",
          description: "O fato ou preferência a ser lembrado",
        },
      },
      required: ["category", "key", "value"],
    },
  },
  {
    name: "recall_memory",
    description:
      "Busca informações na memória permanente do agente. Use quando precisar lembrar preferências, padrões ou fatos sobre o usuário salvos em conversas anteriores. Sem query retorna todas as memórias.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "Termo de busca (busca no nome e valor das memórias). Omita para retornar todas.",
        },
      },
      required: [],
    },
  },
  {
    name: "update_personality",
    description:
      "Atualiza a personalidade/estilo do Vortex. Use APENAS quando o usuário pedir EXPLICITAMENTE que você mude seu comportamento, tom, ou estilo de comunicação. Exemplos: 'fale mais direto', 'seja mais informal', 'use menos emojis'. NUNCA use sem pedido explícito do usuário.",
    input_schema: {
      type: "object" as const,
      properties: {
        updated_content: {
          type: "string",
          description:
            "O conteúdo COMPLETO atualizado do documento de personalidade em markdown. DEVE manter a estrutura de seções (Identidade, Capacidades) e apenas ajustar o estilo/tom conforme solicitado pelo usuário.",
        },
        change_summary: {
          type: "string",
          description:
            "Breve descrição da mudança feita (ex: 'Tornado mais direto e objetivo', 'Removidos emojis')",
        },
      },
      required: ["updated_content", "change_summary"],
    },
  },
];

// --- Team Tools (Team agents only) ---

const TEAM_TOOLS: Tool[] = [
  {
    name: "create_project",
    description:
      "Cria um novo projeto para agrupar tarefas relacionadas. Use quando o usuario pedir um plano de marketing, conjunto de entregas, ou qualquer trabalho que envolva multiplas tarefas. Depois de criar o projeto, crie as tarefas usando o project_id retornado.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Titulo do projeto",
        },
        description: {
          type: "string",
          description:
            "Descricao do projeto com escopo e objetivos",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "delegate_to_agent",
    description:
      "Delega uma tarefa para um especialista do time e recebe a resposta dentro desta conversa. O especialista trabalha com todo seu conhecimento especializado e retorna o resultado. Use quando o usuário quer resultado AGORA (para tarefas assíncronas futuras, use create_task).",
    input_schema: {
      type: "object" as const,
      properties: {
        agent_slug: {
          type: "string",
          description:
            "Slug do especialista (copywriting, copy-editing, email-sequence, cold-email, seo-audit, ai-seo, programmatic-seo, schema-markup, site-architecture, content-strategy, social-content, page-cro, form-cro, signup-flow-cro, onboarding-cro, popup-cro, paywall-upgrade-cro, ab-test-setup, paid-ads, ad-creative, analytics-tracking, launch-strategy, pricing-strategy, marketing-psychology, marketing-ideas, free-tool-strategy, churn-prevention, referral-program, revops, sales-enablement, competitor-alternatives)",
        },
        task: {
          type: "string",
          description:
            "Descrição detalhada do que o especialista deve fazer. Seja específico sobre o que entregar.",
        },
        context: {
          type: "string",
          description:
            "Contexto adicional relevante (informações do usuário, restrições, preferências, dados da conversa)",
        },
        complexity: {
          type: "string",
          enum: ["deep", "normal", "basic"],
          description:
            "Nível de complexidade: deep = análise profunda/estratégia (Opus), normal = trabalho padrão (Sonnet), basic = tarefa simples/revisão (Haiku). Default: normal",
        },
      },
      required: ["agent_slug", "task"],
    },
  },
  {
    name: "create_task",
    description:
      "Cria uma tarefa no kanban do time e atribui a um especialista. Se assign_to_slug for omitido, o agente e atribuido automaticamente pelo task_type (copy→copywriting, seo→seo-audit, social_calendar→social-content, campaign→paid-ads, cro→page-cro, strategy→launch-strategy, revenue→churn-prevention, general→coordenador). A tarefa sera executada automaticamente pelo sistema.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Título da tarefa",
        },
        description: {
          type: "string",
          description: "Descrição detalhada da tarefa",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "urgent"],
          description: "Prioridade da tarefa",
        },
        task_type: {
          type: "string",
          enum: [
            "copy",
            "seo",
            "social_calendar",
            "campaign",
            "cro",
            "strategy",
            "revenue",
            "general",
          ],
          description: "Tipo da tarefa",
        },
        assign_to_slug: {
          type: "string",
          description:
            "Slug do agente para atribuir. OPCIONAL — se omitido, atribui automaticamente pelo task_type. Use para escolher um especialista especifico diferente do default (ex: task_type=copy mas quer email-sequence ao inves de copywriting). Slugs: copywriting, copy-editing, email-sequence, cold-email, seo-audit, ai-seo, programmatic-seo, schema-markup, site-architecture, content-strategy, social-content, page-cro, form-cro, signup-flow-cro, onboarding-cro, popup-cro, paywall-upgrade-cro, ab-test-setup, paid-ads, ad-creative, analytics-tracking, launch-strategy, pricing-strategy, marketing-psychology, marketing-ideas, free-tool-strategy, churn-prevention, referral-program, revops, sales-enablement, competitor-alternatives",
        },
        due_date: {
          type: "string",
          description: "Data de entrega (ISO 8601)",
        },
        project_id: {
          type: "string",
          description:
            "ID do projeto ao qual esta tarefa pertence (retornado por create_project)",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "update_task",
    description:
      "Atualiza o status ou prioridade de uma tarefa existente no kanban.",
    input_schema: {
      type: "object" as const,
      properties: {
        task_id: {
          type: "string",
          description: "ID da tarefa",
        },
        status: {
          type: "string",
          enum: ["backlog", "todo", "in_progress", "review", "done"],
          description: "Novo status da tarefa",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "urgent"],
          description: "Nova prioridade",
        },
      },
      required: ["task_id"],
    },
  },
  {
    name: "save_deliverable",
    description:
      "Salva uma entrega formatada (copy, calendário, auditoria, estratégia, etc). Use para registrar o resultado do trabalho de forma estruturada. O conteúdo pode ser markdown ou JSON dependendo do tipo.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Título da entrega",
        },
        content: {
          type: "string",
          description:
            "Conteúdo da entrega em markdown ou JSON (para calendários use JSON com entries)",
        },
        deliverable_type: {
          type: "string",
          enum: [
            "calendar",
            "copy",
            "audit",
            "strategy",
            "report",
            "email_sequence",
            "general",
          ],
          description: "Tipo da entrega",
        },
        format: {
          type: "string",
          enum: ["markdown", "json"],
          description: "Formato do conteúdo",
        },
        task_id: {
          type: "string",
          description: "ID da tarefa relacionada (opcional)",
        },
        metadata: {
          type: "object",
          description:
            "Dados extras estruturados (ex: entries de calendário)",
        },
        project_id: {
          type: "string",
          description:
            "ID do projeto ao qual esta entrega pertence (opcional)",
        },
      },
      required: ["title", "content", "deliverable_type"],
    },
  },
];

// --- Backward compat: all tools in one array (used by existing /agent page) ---

export const AGENT_TOOLS: Tool[] = [...META_TOOLS, ...MEMORY_TOOLS, ...TEAM_TOOLS];

// --- Per-agent tool selection ---

export function getToolsForAgent(agentSlug?: string): Tool[] {
  // Vortex (default) gets Meta + Memory tools
  if (!agentSlug || agentSlug === "vortex") {
    return [...META_TOOLS, ...MEMORY_TOOLS];
  }
  // Marcos (CMO) and paid-ads specialist get Team + Meta tools
  if (agentSlug === "coordenador" || agentSlug === "paid-ads") {
    return [...TEAM_TOOLS, ...META_TOOLS];
  }
  // Other team agents get only Team tools
  return TEAM_TOOLS;
}

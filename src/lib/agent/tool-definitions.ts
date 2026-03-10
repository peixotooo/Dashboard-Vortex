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
      "Cria um novo conjunto de anúncios (Ad Set) dentro de uma campanha. Define segmentação, orçamento e otimização. Em fluxo automatico (campanha completa), crie com status PAUSED sem pedir confirmação.",
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
  {
    name: "create_ad_creative",
    description:
      "Cria um criativo de anúncio com imagem, copy e CTA. Retorna o creative_id necessário para criar o anúncio. IMPORTANTE: precisa de um image_hash — vindo de upload ou de imagem anexada no chat.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Nome do criativo" },
        image_hash: {
          type: "string",
          description:
            "Hash da imagem (do upload ou anexo do chat)",
        },
        link: {
          type: "string",
          description: "URL de destino (landing page)",
        },
        title: {
          type: "string",
          description: "Título / headline (abaixo da imagem)",
        },
        body: {
          type: "string",
          description: "Texto principal / copy (acima da imagem)",
        },
        call_to_action: {
          type: "string",
          description: "Tipo do botão CTA",
          enum: [
            "LEARN_MORE",
            "SHOP_NOW",
            "SIGN_UP",
            "SUBSCRIBE",
            "CONTACT_US",
            "DOWNLOAD",
            "GET_OFFER",
            "BOOK_TRAVEL",
            "WHATSAPP_MESSAGE",
          ],
        },
        page_id: {
          type: "string",
          description:
            "Facebook Page ID (opcional — detectado automaticamente se não fornecido)",
        },
        instagram_actor_id: {
          type: "string",
          description:
            "Instagram account ID para cross-posting (opcional)",
        },
      },
      required: ["name", "image_hash", "link"],
    },
  },
  {
    name: "create_ad",
    description:
      "Cria um anúncio dentro de um ad set, vinculando a um criativo. Esta é a etapa final: campanha → ad set → criativo → anúncio. Em fluxo automatico, crie com status PAUSED e pergunte ao final se quer ativar.",
    input_schema: {
      type: "object" as const,
      properties: {
        adset_id: {
          type: "string",
          description: "ID do ad set onde o anúncio será criado",
        },
        name: { type: "string", description: "Nome do anúncio" },
        creative_id: {
          type: "string",
          description: "ID do criativo (de create_ad_creative)",
        },
        status: {
          type: "string",
          enum: ["ACTIVE", "PAUSED"],
          description: "Status do anúncio (padrão: PAUSED)",
        },
        url_tags: {
          type: "string",
          description: "Parâmetros UTM para tracking (opcional)",
        },
      },
      required: ["adset_id", "name", "creative_id"],
    },
  },
  {
    name: "upload_image_from_url",
    description:
      "Faz upload de uma imagem a partir de uma URL para a conta de anúncios Meta. Retorna o image_hash que pode ser usado em create_ad_creative. Use quando precisar subir uma imagem de URL externa (ex: de um gerador de criativos ou asset externo).",
    input_schema: {
      type: "object" as const,
      properties: {
        image_url: {
          type: "string",
          description: "URL pública da imagem a ser enviada",
        },
      },
      required: ["image_url"],
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
      "Delega uma tarefa para um especialista do time. Por padrao, executa de forma sincrona e retorna o resultado na conversa. Com async=true, cria uma tarefa no kanban que sera processada em background (ideal para analises complexas com muitas chamadas de API que podem demorar). O resultado ficara disponivel na pagina de entregas.",
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
        async: {
          type: "boolean",
          description:
            "Se true, cria uma tarefa no kanban e processa em background. Ideal para: geracao de copy, auditorias SEO, calendarios, estrategias — tarefas que geram DOCUMENTOS/TEXTOS. NUNCA use async=true para acoes que executam na Meta Ads API (criar campanhas, adsets, anuncios) — essas DEVEM ser sync (async=false) para executar imediatamente. Default: false",
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
  {
    name: "create_marketing_action",
    description:
      "Cria uma acao no calendario de planejamento de marketing. Use apos concluir entregas para registrar as acoes planejadas no calendario do time. O usuario ve essas acoes na pagina Planejamento.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Titulo da acao de marketing",
        },
        description: {
          type: "string",
          description: "Descricao da acao",
        },
        category: {
          type: "string",
          enum: [
            "campanha",
            "conteudo",
            "social",
            "email",
            "seo",
            "lancamento",
            "evento",
            "geral",
          ],
          description: "Categoria da acao",
        },
        start_date: {
          type: "string",
          description: "Data de inicio (YYYY-MM-DD)",
        },
        end_date: {
          type: "string",
          description: "Data de fim (YYYY-MM-DD)",
        },
      },
      required: ["title", "category", "start_date", "end_date"],
    },
  },
];

// --- Media Gallery Tools ---

const MEDIA_GALLERY_TOOLS: Tool[] = [
  {
    name: "list_media_gallery",
    description:
      "Lista imagens disponíveis na galeria de mídia do workspace. Retorna filename, image_hash e image_url de imagens já enviadas pelo usuário. Use quando precisar de image_hash para criar criativos, ou quando o usuário perguntar quais imagens tem disponíveis.",
    input_schema: {
      type: "object" as const,
      properties: {
        search: {
          type: "string",
          description:
            "Termo de busca para filtrar por nome do arquivo (opcional)",
        },
      },
      required: [],
    },
  },
];

// --- Saved Creatives Tools ---

const SAVED_CREATIVES_TOOLS: Tool[] = [
  {
    name: "list_saved_creatives",
    description:
      "Lista criativos classificados automaticamente como campeoes, potencial ou escala. Use para buscar referencia de criativos que performaram bem. Inclui metricas de performance (impressoes, cliques, CTR, CPC, spend, receita, ROAS), copy, formato, URL de destino e anotacoes.",
    input_schema: {
      type: "object" as const,
      properties: {
        tier: {
          type: "string",
          enum: ["champion", "potential", "scale"],
          description:
            "Filtrar por classificacao: champion (ROAS alto + volume), potential (ROAS alto, pouco gasto), scale (volume alto, ROAS positivo)",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "Filtrar por tags (ex: ['winner', 'hero']). Retorna criativos que tem QUALQUER uma das tags.",
        },
        format: {
          type: "string",
          enum: ["image", "video", "carousel"],
          description: "Filtrar por formato do criativo",
        },
        min_roas: {
          type: "number",
          description:
            "ROAS minimo (ex: 2.0 para criativos com pelo menos 2x de retorno)",
        },
        account_id: {
          type: "string",
          description: "Filtrar por conta de anuncios especifica",
        },
        limit: {
          type: "number",
          description: "Numero maximo de resultados (default: 20)",
        },
      },
      required: [],
    },
  },
  {
    name: "add_creative_note",
    description:
      "Adiciona ou atualiza anotacoes e tags em um criativo salvo. Use para registrar insights, razoes de performance, padroes identificados ou sugestoes de iteracao.",
    input_schema: {
      type: "object" as const,
      properties: {
        creative_id: {
          type: "string",
          description: "ID do criativo salvo (UUID retornado por list_saved_creatives)",
        },
        notes: {
          type: "string",
          description:
            "Anotacao sobre o criativo. Pode incluir analise de performance, padroes, sugestoes.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "Tags para categorizar (substitui as anteriores). Ex: ['winner', 'hero', 'escala']",
        },
      },
      required: ["creative_id", "notes"],
    },
  },
];

// --- Saved Campaigns Tools ---

const SAVED_CAMPAIGNS_TOOLS: Tool[] = [
  {
    name: "list_saved_campaigns",
    description:
      "Lista campanhas classificadas automaticamente como campeoes, potencial ou escala. Inclui metricas agregadas de performance (spend, revenue, ROAS, CTR, CPC) e metadados (objetivo, orcamento, status). Suporta filtro por plataforma (meta ou google).",
    input_schema: {
      type: "object" as const,
      properties: {
        tier: {
          type: "string",
          enum: ["champion", "potential", "scale"],
          description:
            "Filtrar por classificacao: champion (ROAS alto + volume), potential (ROAS alto, pouco gasto), scale (volume alto, ROAS positivo)",
        },
        min_roas: {
          type: "number",
          description: "ROAS minimo (ex: 2.0)",
        },
        account_id: {
          type: "string",
          description: "Filtrar por conta de anuncios",
        },
        platform: {
          type: "string",
          enum: ["meta", "google"],
          description: "Filtrar por plataforma (meta ou google). Omita para todas.",
        },
        limit: {
          type: "number",
          description: "Numero maximo de resultados (default: 20)",
        },
      },
      required: [],
    },
  },
];

// --- Google Ads Tools ---

const GOOGLE_ADS_TOOLS: Tool[] = [
  {
    name: "list_google_ads_campaigns",
    description:
      "Lista campanhas do Google Ads com metricas de performance (spend, impressoes, cliques, CTR, CPC, conversoes, receita, ROAS). Use quando o usuario perguntar sobre campanhas do Google Ads, performance no Google, ou quiser comparar com Meta Ads.",
    input_schema: {
      type: "object" as const,
      properties: {
        date_range: {
          type: "string",
          enum: ["today", "yesterday", "last_7d", "last_14d", "last_30d", "this_month", "last_month"],
          description: "Periodo para os dados agregados (default: last_30d)",
        },
      },
      required: [],
    },
  },
];

// --- Instagram Tools (scraping via Apify) ---

const INSTAGRAM_TOOLS: Tool[] = [
  {
    name: "get_instagram_profile",
    description:
      "Obtem dados do perfil publico de um usuario do Instagram via scraping. Retorna seguidores, posts, bio, categoria. Usa cache de 6h. Use quando precisar analisar metricas de um perfil IG ou para contexto de criacao de conteudo.",
    input_schema: {
      type: "object" as const,
      properties: {
        username: {
          type: "string",
          description: "Username do Instagram (sem @). Ex: nike, starbucks",
        },
      },
      required: ["username"],
    },
  },
  {
    name: "get_instagram_posts",
    description:
      "Obtem posts recentes de um perfil publico do Instagram via scraping. Retorna curtidas, comentarios, caption, hashtags, tipo (imagem/video/carrossel). Usa cache de 6h. Use para analisar conteudo, identificar padroes de engagement, ou buscar inspiracao.",
    input_schema: {
      type: "object" as const,
      properties: {
        username: {
          type: "string",
          description: "Username do Instagram (sem @)",
        },
        limit: {
          type: "number",
          description: "Numero maximo de posts (padrao: 12, max: 50)",
        },
      },
      required: ["username"],
    },
  },
];

// --- Backward compat: all tools in one array (used by existing /agent page) ---

export const AGENT_TOOLS: Tool[] = [
  ...META_TOOLS,
  ...GOOGLE_ADS_TOOLS,
  ...MEMORY_TOOLS,
  ...TEAM_TOOLS,
  ...INSTAGRAM_TOOLS,
  ...SAVED_CREATIVES_TOOLS,
  ...SAVED_CAMPAIGNS_TOOLS,
  ...MEDIA_GALLERY_TOOLS,
];

// --- Per-agent tool selection ---

export function getToolsForAgent(agentSlug?: string): Tool[] {
  const SAVED_TOOLS = [...SAVED_CREATIVES_TOOLS, ...SAVED_CAMPAIGNS_TOOLS];
  // Vortex (default) gets Meta + Google Ads + Memory + Saved + Media Gallery
  if (!agentSlug || agentSlug === "vortex") {
    return [...META_TOOLS, ...GOOGLE_ADS_TOOLS, ...MEMORY_TOOLS, ...SAVED_TOOLS, ...MEDIA_GALLERY_TOOLS];
  }
  // Marcos (CMO) and paid-ads specialist get Team + Meta + Google Ads + Instagram + Saved + Media Gallery
  if (agentSlug === "coordenador" || agentSlug === "paid-ads") {
    return [...TEAM_TOOLS, ...META_TOOLS, ...GOOGLE_ADS_TOOLS, ...INSTAGRAM_TOOLS, ...SAVED_TOOLS, ...MEDIA_GALLERY_TOOLS];
  }
  // Social content gets Team + Instagram + Saved
  if (agentSlug === "social-content") {
    return [...TEAM_TOOLS, ...INSTAGRAM_TOOLS, ...SAVED_TOOLS];
  }
  // Ad creative and copywriting agents get Team + Saved + Media Gallery
  if (agentSlug === "ad-creative" || agentSlug === "copywriting") {
    return [...TEAM_TOOLS, ...SAVED_TOOLS, ...MEDIA_GALLERY_TOOLS];
  }
  // Other team agents get only Team tools
  return TEAM_TOOLS;
}

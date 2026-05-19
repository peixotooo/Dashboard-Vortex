-- Migration 086: Topbar (régua superior flutuante com ofertas, countdown e geração de copies por LLM)

-- ============================================================================
-- 1) topbar_configs — settings globais por workspace (1 row / workspace)
-- ============================================================================

CREATE TABLE IF NOT EXISTS topbar_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT false,

  -- Defaults visuais (campanha pode sobrescrever)
  bg_color TEXT DEFAULT '#0f172a',
  text_color TEXT DEFAULT '#ffffff',
  accent_color TEXT DEFAULT '#22c55e',
  font_size TEXT DEFAULT '14px',
  height TEXT DEFAULT '40px',

  -- Comportamento
  sticky BOOLEAN DEFAULT true,                  -- flutua ao rolar
  position TEXT DEFAULT 'top' CHECK (position IN ('top', 'bottom')),
  show_close_button BOOLEAN DEFAULT true,
  close_persistence_hours INT DEFAULT 24,       -- quanto tempo um close fica salvo
  show_on_pages TEXT[] DEFAULT ARRAY['all']::TEXT[],
  -- Páginas em que a topbar NUNCA aparece (guard reforçado também no JS)
  hide_on_pages TEXT[] DEFAULT ARRAY['cart', 'checkout']::TEXT[],

  -- IA (OpenRouter)
  ai_enabled BOOLEAN DEFAULT false,
  ai_context TEXT,                              -- contexto geral do negócio
  ai_brand_voice TEXT,                          -- tom de voz
  ai_model TEXT DEFAULT 'openrouter/auto',
  ai_variations_per_run INT DEFAULT 3,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_topbar_configs_workspace
  ON topbar_configs(workspace_id) WHERE enabled = true;

-- ============================================================================
-- 2) topbar_campaigns — campanhas com agendamento, recorrência e countdown
-- ============================================================================

CREATE TABLE IF NOT EXISTS topbar_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  name TEXT NOT NULL,                           -- nome interno
  enabled BOOLEAN DEFAULT true,
  priority INT DEFAULT 0,                       -- maior ganha quando há sobreposição

  -- Agendamento absoluto
  starts_at TIMESTAMPTZ,                        -- null = sem início definido
  ends_at TIMESTAMPTZ,                          -- null = sem fim definido

  -- Recorrência
  recurrence TEXT DEFAULT 'none'
    CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly')),
  recurrence_days INT[],                        -- weekly: 0=dom .. 6=sáb / monthly: 1..31
  recurrence_window_start TIME,                 -- janela ativa por dia
  recurrence_window_end TIME,

  -- Conteúdo da variação ativa (espelha a topbar_variations.selected)
  message TEXT NOT NULL,
  link_url TEXT,
  link_label TEXT,

  -- Countdown
  countdown_enabled BOOLEAN DEFAULT false,
  countdown_target TIMESTAMPTZ,
  countdown_label TEXT DEFAULT 'Termina em',
  countdown_recurrence TEXT DEFAULT 'fixed'
    CHECK (countdown_recurrence IN ('fixed', 'rolling_daily', 'rolling_weekly')),

  -- Overrides visuais (null = herda do topbar_configs)
  bg_color TEXT,
  text_color TEXT,
  accent_color TEXT,

  -- Páginas (null = herda do topbar_configs)
  show_on_pages TEXT[],

  -- Contexto da campanha (alimenta a LLM)
  context_type TEXT,                            -- 'launch' | 'sale' | 'restock' | 'seasonal' | 'custom'
  context_brief TEXT,                           -- brief específico

  -- Auto-regeneração via LLM
  auto_regenerate BOOLEAN DEFAULT false,
  regenerate_every_hours INT DEFAULT 24,
  last_regenerated_at TIMESTAMPTZ,
  next_regenerate_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_topbar_campaigns_workspace_enabled
  ON topbar_campaigns(workspace_id, enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_topbar_campaigns_schedule
  ON topbar_campaigns(workspace_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_topbar_campaigns_regen
  ON topbar_campaigns(next_regenerate_at)
  WHERE auto_regenerate = true AND enabled = true;

-- ============================================================================
-- 3) topbar_variations — variações de copy (humanas ou geradas via LLM)
-- ============================================================================

CREATE TABLE IF NOT EXISTS topbar_variations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES topbar_campaigns(id) ON DELETE CASCADE,

  message TEXT NOT NULL,
  link_label TEXT,

  selected BOOLEAN DEFAULT false,               -- variação atualmente em uso
  generated_by TEXT DEFAULT 'human'
    CHECK (generated_by IN ('human', 'llm')),
  llm_model TEXT,
  llm_prompt_used TEXT,

  impressions INT DEFAULT 0,
  clicks INT DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_topbar_variations_campaign
  ON topbar_variations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_topbar_variations_selected
  ON topbar_variations(campaign_id) WHERE selected = true;

-- ============================================================================
-- 4) topbar_events — analytics (impressões / cliques / fechamentos)
-- ============================================================================

CREATE TABLE IF NOT EXISTS topbar_events (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES topbar_campaigns(id) ON DELETE SET NULL,
  variation_id UUID REFERENCES topbar_variations(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('impression', 'click', 'close')),
  page_type TEXT,
  session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_topbar_events_workspace_day
  ON topbar_events(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_topbar_events_campaign
  ON topbar_events(campaign_id, event_type);

-- ============================================================================
-- RLS
-- ============================================================================

ALTER TABLE topbar_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE topbar_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE topbar_variations ENABLE ROW LEVEL SECURITY;
ALTER TABLE topbar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view topbar_configs"
  ON topbar_configs FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));
CREATE POLICY "Admins manage topbar_configs"
  ON topbar_configs FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

CREATE POLICY "Members view topbar_campaigns"
  ON topbar_campaigns FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));
CREATE POLICY "Admins manage topbar_campaigns"
  ON topbar_campaigns FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

CREATE POLICY "Members view topbar_variations"
  ON topbar_variations FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));
CREATE POLICY "Admins manage topbar_variations"
  ON topbar_variations FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

CREATE POLICY "Members view topbar_events"
  ON topbar_events FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

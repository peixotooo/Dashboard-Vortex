-- Migration 052: Mission Control
-- Operational brain for Atlas/COO. Registers demands, follow-ups, experiments,
-- decisions, learnings, executive reports, and activity log across the org.
-- All times stored in UTC (timestamptz). Display layer converts to America/Sao_Paulo.

-- =========================================================================
-- DEMANDS (core unit of operational work)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.mc_demands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- identity
  title text NOT NULL,
  description text DEFAULT '',
  area text NOT NULL DEFAULT 'ops' CHECK (area IN (
    'acquisition','conversion','retention','crm','creative','site','finance','ops','reporting','analytics'
  )),
  channel text CHECK (channel IN (
    'meta_ads','google_ads','email','whatsapp','influencer','organic','site','crm','marketplace','mixed'
  )),
  company text DEFAULT 'bulking',
  source text,
  requester text,
  owner text,
  secondary_owner text,
  assigned_by text,
  response_required_from text,

  -- state
  status text NOT NULL DEFAULT 'new' CHECK (status IN (
    'new','triaged','assigned','waiting_person','in_progress','waiting_external','blocked','ready_for_review','done','canceled'
  )),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical','high','medium','low')),
  health text NOT NULL DEFAULT 'on_track' CHECK (health IN ('on_track','attention','delayed','blocked','at_risk')),
  urgency text,

  -- timing (all UTC)
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  created_at_local text,
  first_seen_at_utc timestamptz,
  assigned_at_utc timestamptz,
  started_at_utc timestamptz,
  last_updated_at_utc timestamptz NOT NULL DEFAULT now(),
  next_follow_up_at_utc timestamptz,
  due_at_utc timestamptz,
  blocked_at_utc timestamptz,
  resolved_at_utc timestamptz,
  closed_at_utc timestamptz,

  -- substance
  objective text,
  expected_outcome text,
  current_situation text,
  next_action text,
  next_action_owner text,
  next_action_due_at_utc timestamptz,

  -- blocker
  blocker text,
  blocker_owner text,
  unblock_action text,

  -- follow-up policy
  requires_reply boolean DEFAULT false,
  reply_sla_hours integer DEFAULT 3,
  follow_up_rule text,
  escalation_rule text,

  -- Waiting-for-person state (generic — any person on the team)
  waiting_for_person text,
  waiting_since_at_utc timestamptz,
  waiting_last_reply_at_utc timestamptz,
  no_reply_since_hours numeric,

  -- impact signals
  acquisition_impact text,
  conversion_impact text,
  retention_impact text,
  revenue_impact text,
  risk_level text,

  -- relationships
  related_campaigns jsonb DEFAULT '[]'::jsonb,
  related_channels jsonb DEFAULT '[]'::jsonb,
  related_tasks jsonb DEFAULT '[]'::jsonb,
  related_decision_ids jsonb DEFAULT '[]'::jsonb,
  related_learning_ids jsonb DEFAULT '[]'::jsonb,
  related_report_ids jsonb DEFAULT '[]'::jsonb,
  evidence_links jsonb DEFAULT '[]'::jsonb,

  -- audit
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mc_demands_workspace ON public.mc_demands(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_mc_demands_owner ON public.mc_demands(workspace_id, owner);
CREATE INDEX IF NOT EXISTS idx_mc_demands_waiting_person ON public.mc_demands(workspace_id, waiting_for_person) WHERE waiting_for_person IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mc_demands_next_follow_up ON public.mc_demands(workspace_id, next_follow_up_at_utc) WHERE next_follow_up_at_utc IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mc_demands_due ON public.mc_demands(workspace_id, due_at_utc) WHERE due_at_utc IS NOT NULL;

ALTER TABLE public.mc_demands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mc_demands_select" ON public.mc_demands FOR SELECT USING (workspace_id IN (SELECT public.get_user_workspace_ids()));
CREATE POLICY "mc_demands_insert" ON public.mc_demands FOR INSERT WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()));
CREATE POLICY "mc_demands_update" ON public.mc_demands FOR UPDATE USING (workspace_id IN (SELECT public.get_user_workspace_ids()));
CREATE POLICY "mc_demands_delete" ON public.mc_demands FOR DELETE USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

-- =========================================================================
-- FOLLOW-UPS (asks, charges, reminders sent to a target person)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.mc_follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  demand_id uuid REFERENCES public.mc_demands(id) ON DELETE CASCADE,

  target_person text NOT NULL,
  target_role text,
  message_type text NOT NULL DEFAULT 'ask' CHECK (message_type IN (
    'ask','charge','reminder','unblock','escalation','confirmation'
  )),
  message_text text NOT NULL DEFAULT '',

  sent_at_utc timestamptz NOT NULL DEFAULT now(),
  due_reply_at_utc timestamptz,
  replied_at_utc timestamptz,

  reply_status text NOT NULL DEFAULT 'pending' CHECK (reply_status IN (
    'pending','replied','late_reply','no_reply','clarified','blocked'
  )),
  reply_quality text CHECK (reply_quality IN ('complete','incomplete','vague','inconsistent')),

  follow_up_number integer NOT NULL DEFAULT 1,
  escalate_if_no_reply boolean DEFAULT false,
  escalation_target text,
  outcome text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mc_follow_ups_workspace ON public.mc_follow_ups(workspace_id, reply_status);
CREATE INDEX IF NOT EXISTS idx_mc_follow_ups_demand ON public.mc_follow_ups(demand_id);
CREATE INDEX IF NOT EXISTS idx_mc_follow_ups_due ON public.mc_follow_ups(workspace_id, due_reply_at_utc) WHERE reply_status = 'pending';

ALTER TABLE public.mc_follow_ups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mc_follow_ups_select" ON public.mc_follow_ups FOR SELECT USING (workspace_id IN (SELECT public.get_user_workspace_ids()));
CREATE POLICY "mc_follow_ups_insert" ON public.mc_follow_ups FOR INSERT WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()));
CREATE POLICY "mc_follow_ups_update" ON public.mc_follow_ups FOR UPDATE USING (workspace_id IN (SELECT public.get_user_workspace_ids()));
CREATE POLICY "mc_follow_ups_delete" ON public.mc_follow_ups FOR DELETE USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

-- =========================================================================
-- EXPERIMENTS (growth hypotheses under test)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.mc_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  title text NOT NULL,
  hypothesis text DEFAULT '',
  area text NOT NULL DEFAULT 'ops' CHECK (area IN (
    'acquisition','conversion','retention','crm','creative','site','finance','ops','reporting','analytics'
  )),
  channel text,
  owner text,

  status text NOT NULL DEFAULT 'backlog' CHECK (status IN (
    'backlog','approved','running','analyzing','won','lost','inconclusive','paused'
  )),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical','high','medium','low')),

  start_date_utc timestamptz,
  end_date_utc timestamptz,

  baseline_metric text,
  target_metric text,
  current_metric text,
  expected_impact text,
  actual_impact text,
  confidence text,

  decision text,
  next_step text,

  linked_demand_ids jsonb DEFAULT '[]'::jsonb,
  linked_campaigns jsonb DEFAULT '[]'::jsonb,
  learning_summary text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mc_experiments_workspace ON public.mc_experiments(workspace_id, status);

ALTER TABLE public.mc_experiments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mc_experiments_select" ON public.mc_experiments FOR SELECT USING (workspace_id IN (SELECT public.get_user_workspace_ids()));
CREATE POLICY "mc_experiments_insert" ON public.mc_experiments FOR INSERT WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()));
CREATE POLICY "mc_experiments_update" ON public.mc_experiments FOR UPDATE USING (workspace_id IN (SELECT public.get_user_workspace_ids()));
CREATE POLICY "mc_experiments_delete" ON public.mc_experiments FOR DELETE USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

-- =========================================================================
-- DECISIONS (ledger of meaningful decisions)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.mc_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  title text NOT NULL,
  decision text NOT NULL DEFAULT '',
  why text DEFAULT '',
  decision_date_utc timestamptz NOT NULL DEFAULT now(),
  decided_by text,
  area text,
  impact_level text CHECK (impact_level IN ('high','medium','low')),
  related_demand_ids jsonb DEFAULT '[]'::jsonb,
  related_experiment_ids jsonb DEFAULT '[]'::jsonb,
  expiry_review_date_utc timestamptz,
  still_valid boolean DEFAULT true,
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mc_decisions_workspace ON public.mc_decisions(workspace_id, decision_date_utc DESC);

ALTER TABLE public.mc_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mc_decisions_select" ON public.mc_decisions FOR SELECT USING (workspace_id IN (SELECT public.get_user_workspace_ids()));
CREATE POLICY "mc_decisions_insert" ON public.mc_decisions FOR INSERT WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()));
CREATE POLICY "mc_decisions_update" ON public.mc_decisions FOR UPDATE USING (workspace_id IN (SELECT public.get_user_workspace_ids()));
CREATE POLICY "mc_decisions_delete" ON public.mc_decisions FOR DELETE USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

-- =========================================================================
-- LEARNINGS (reusable knowledge captured from work)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.mc_learnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  title text NOT NULL,
  learning text NOT NULL DEFAULT '',
  type text,
  source text,
  date_utc timestamptz NOT NULL DEFAULT now(),
  area text,
  channel text,
  confidence text,
  reusable boolean DEFAULT true,
  related_campaigns jsonb DEFAULT '[]'::jsonb,
  related_experiments jsonb DEFAULT '[]'::jsonb,
  related_decision_ids jsonb DEFAULT '[]'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mc_learnings_workspace ON public.mc_learnings(workspace_id, date_utc DESC);

ALTER TABLE public.mc_learnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mc_learnings_select" ON public.mc_learnings FOR SELECT USING (workspace_id IN (SELECT public.get_user_workspace_ids()));
CREATE POLICY "mc_learnings_insert" ON public.mc_learnings FOR INSERT WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()));
CREATE POLICY "mc_learnings_update" ON public.mc_learnings FOR UPDATE USING (workspace_id IN (SELECT public.get_user_workspace_ids()));
CREATE POLICY "mc_learnings_delete" ON public.mc_learnings FOR DELETE USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

-- =========================================================================
-- EXECUTIVE REPORTS (rolled-up summaries for leadership)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.mc_executive_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  period_type text,
  period_label text,
  generated_at_utc timestamptz NOT NULL DEFAULT now(),
  audience text,
  summary text DEFAULT '',
  what_improved text,
  what_worsened text,
  blockers text,
  next_actions text,
  decisions_needed text,
  linked_demand_ids jsonb DEFAULT '[]'::jsonb,
  linked_metrics jsonb DEFAULT '{}'::jsonb,
  sent boolean DEFAULT false,
  sent_at_utc timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mc_reports_workspace ON public.mc_executive_reports(workspace_id, generated_at_utc DESC);

ALTER TABLE public.mc_executive_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mc_reports_select" ON public.mc_executive_reports FOR SELECT USING (workspace_id IN (SELECT public.get_user_workspace_ids()));
CREATE POLICY "mc_reports_insert" ON public.mc_executive_reports FOR INSERT WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()));
CREATE POLICY "mc_reports_update" ON public.mc_executive_reports FOR UPDATE USING (workspace_id IN (SELECT public.get_user_workspace_ids()));
CREATE POLICY "mc_reports_delete" ON public.mc_executive_reports FOR DELETE USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

-- =========================================================================
-- ACTIVITY LOG (immutable ledger of every change)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.mc_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  demand_id uuid REFERENCES public.mc_demands(id) ON DELETE CASCADE,
  entity_type text NOT NULL DEFAULT 'demand',
  entity_id uuid,
  actor text,
  actor_type text CHECK (actor_type IN ('human','agent','system')),
  event_type text NOT NULL,
  timestamp_utc timestamptz NOT NULL DEFAULT now(),
  summary text,
  before_value jsonb,
  after_value jsonb,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_mc_activity_workspace ON public.mc_activity_log(workspace_id, timestamp_utc DESC);
CREATE INDEX IF NOT EXISTS idx_mc_activity_demand ON public.mc_activity_log(demand_id, timestamp_utc DESC);
CREATE INDEX IF NOT EXISTS idx_mc_activity_entity ON public.mc_activity_log(entity_type, entity_id);

ALTER TABLE public.mc_activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mc_activity_select" ON public.mc_activity_log FOR SELECT USING (workspace_id IN (SELECT public.get_user_workspace_ids()));
CREATE POLICY "mc_activity_insert" ON public.mc_activity_log FOR INSERT WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()));

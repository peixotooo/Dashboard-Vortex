-- Migration 053: Mission Control v2
-- COO feedback: people registry, notification queue, per-priority SLA,
-- metric snapshots, deliverable types, experiment rigor, closing guard.
-- Idempotent — safe to re-run.

-- =========================================================================
-- PEOPLE (canonical registry — avoids "Pricila" vs "Pri" vs "Pricila Bulking")
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.mc_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  role text,
  team text,
  channel text CHECK (channel IN ('whatsapp','telegram','internal','email','slack','sms')),
  phone_or_chat_id text,
  email text,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_mc_people_workspace ON public.mc_people(workspace_id, is_active);

ALTER TABLE public.mc_people ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "mc_people_select" ON public.mc_people FOR SELECT USING (workspace_id IN (SELECT public.get_user_workspace_ids()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "mc_people_insert" ON public.mc_people FOR INSERT WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "mc_people_update" ON public.mc_people FOR UPDATE USING (workspace_id IN (SELECT public.get_user_workspace_ids()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "mc_people_delete" ON public.mc_people FOR DELETE USING (workspace_id IN (SELECT public.get_user_workspace_ids()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================================
-- NOTIFICATIONS QUEUE (so MC can _cobrar_ not only _registrar_)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.mc_notifications_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type text NOT NULL,          -- demand | follow_up | experiment | report
  entity_id uuid,
  event text NOT NULL,                -- sla_breach | charge | escalation | reminder | report_sent
  target_person_id uuid REFERENCES public.mc_people(id) ON DELETE SET NULL,
  target_person_name text,            -- snapshot if not linked
  channel text,                       -- whatsapp | telegram | internal | email | slack | sms
  payload jsonb DEFAULT '{}'::jsonb,
  scheduled_at_utc timestamptz NOT NULL DEFAULT now(),
  sent_at_utc timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped','canceled')),
  error text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mc_queue_due ON public.mc_notifications_queue(workspace_id, status, scheduled_at_utc);
CREATE INDEX IF NOT EXISTS idx_mc_queue_entity ON public.mc_notifications_queue(entity_type, entity_id);

ALTER TABLE public.mc_notifications_queue ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "mc_queue_select" ON public.mc_notifications_queue FOR SELECT USING (workspace_id IN (SELECT public.get_user_workspace_ids()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "mc_queue_insert" ON public.mc_notifications_queue FOR INSERT WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "mc_queue_update" ON public.mc_notifications_queue FOR UPDATE USING (workspace_id IN (SELECT public.get_user_workspace_ids()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================================
-- DEMANDS — new statuses + new columns
-- =========================================================================

-- Expand status enum (drop + recreate check constraint)
ALTER TABLE public.mc_demands DROP CONSTRAINT IF EXISTS mc_demands_status_check;
ALTER TABLE public.mc_demands ADD CONSTRAINT mc_demands_status_check CHECK (status IN (
  'new','triaged','assigned',
  'waiting_person','waiting_founder','waiting_data','waiting_content','waiting_external',
  'in_progress','blocked','ready_for_review','done','canceled','archived'
));

-- Structural relationships
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS parent_demand_id uuid REFERENCES public.mc_demands(id) ON DELETE SET NULL;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS depends_on_ids jsonb DEFAULT '[]'::jsonb;

-- Deliverable shape
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS deliverable_type text
  CHECK (deliverable_type IN ('report','action','analysis','test','bug','follow_up','decision','content','other'));

-- Closing artifacts
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS completion_notes text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS success_metric text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS failure_reason text;

-- Provenance
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS requested_by_role text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS team text
  CHECK (team IN ('marketing','ecommerce','crm','ops','finance','product','data','content','other'));

-- People references (live alongside free-text fields for backwards compat)
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS owner_person_id uuid REFERENCES public.mc_people(id) ON DELETE SET NULL;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS waiting_for_person_id uuid REFERENCES public.mc_people(id) ON DELETE SET NULL;

-- Metric snapshot at decision-time (freeze the numbers so the narrative can't drift)
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS metric_snapshot_json jsonb;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS metric_snapshot_captured_at_utc timestamptz;

CREATE INDEX IF NOT EXISTS idx_mc_demands_parent ON public.mc_demands(parent_demand_id) WHERE parent_demand_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mc_demands_team ON public.mc_demands(workspace_id, team);
CREATE INDEX IF NOT EXISTS idx_mc_demands_owner_person ON public.mc_demands(owner_person_id) WHERE owner_person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mc_demands_waiting_person_id ON public.mc_demands(waiting_for_person_id) WHERE waiting_for_person_id IS NOT NULL;

-- =========================================================================
-- FOLLOW-UPS — channel + audit + persisted SLA breach
-- =========================================================================
ALTER TABLE public.mc_follow_ups ADD COLUMN IF NOT EXISTS channel text
  CHECK (channel IN ('whatsapp','telegram','internal','email','slack','sms'));
ALTER TABLE public.mc_follow_ups ADD COLUMN IF NOT EXISTS sent_by text;          -- atlas | pricila | system | <user>
ALTER TABLE public.mc_follow_ups ADD COLUMN IF NOT EXISTS response_text text;    -- full response captured
ALTER TABLE public.mc_follow_ups ADD COLUMN IF NOT EXISTS response_summary text; -- short auditable version
ALTER TABLE public.mc_follow_ups ADD COLUMN IF NOT EXISTS is_sla_breached boolean NOT NULL DEFAULT false;
ALTER TABLE public.mc_follow_ups ADD COLUMN IF NOT EXISTS breach_hours numeric;

ALTER TABLE public.mc_follow_ups ADD COLUMN IF NOT EXISTS target_person_id uuid REFERENCES public.mc_people(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mc_followups_breach ON public.mc_follow_ups(workspace_id, is_sla_breached) WHERE is_sla_breached = true;

-- =========================================================================
-- EXPERIMENTS — rigor fields for real learning motor
-- =========================================================================
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS test_type text
  CHECK (test_type IN ('ab','multivariate','before_after','holdout','cohort','lift','qualitative','other'));
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS sample_size integer;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS stop_rule text;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS win_rule text;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS loss_rule text;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS final_decision_reason text;

-- Metric snapshot for experiments too
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS metric_snapshot_json jsonb;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS metric_snapshot_captured_at_utc timestamptz;

-- =========================================================================
-- Seed data would go here in project setup (skipped — workspace-specific)
-- =========================================================================

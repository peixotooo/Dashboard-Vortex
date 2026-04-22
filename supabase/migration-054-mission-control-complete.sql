-- Migration 054: Mission Control — consolidated, idempotent.
-- Re-running is safe. Supersedes 052/053 if they were half-applied.
-- Ends with NOTIFY pgrst so PostgREST picks up new columns immediately
-- (otherwise writes fail with "Could not find the 'X' column ... in the schema cache").

-- =========================================================================
-- 1) TABLES (create if missing — no destructive changes)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.mc_demands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  last_updated_at_utc timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'new',
  priority text NOT NULL DEFAULT 'medium',
  health text NOT NULL DEFAULT 'on_track',
  area text NOT NULL DEFAULT 'ops'
);

CREATE TABLE IF NOT EXISTS public.mc_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS public.mc_follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  demand_id uuid REFERENCES public.mc_demands(id) ON DELETE CASCADE,
  target_person text NOT NULL,
  sent_at_utc timestamptz NOT NULL DEFAULT now(),
  reply_status text NOT NULL DEFAULT 'pending',
  message_type text NOT NULL DEFAULT 'ask',
  message_text text NOT NULL DEFAULT '',
  follow_up_number integer NOT NULL DEFAULT 1,
  is_sla_breached boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mc_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  hypothesis text DEFAULT '',
  area text NOT NULL DEFAULT 'ops',
  status text NOT NULL DEFAULT 'backlog',
  priority text NOT NULL DEFAULT 'medium',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mc_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  decision text NOT NULL DEFAULT '',
  why text DEFAULT '',
  decision_date_utc timestamptz NOT NULL DEFAULT now(),
  still_valid boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mc_learnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  learning text NOT NULL DEFAULT '',
  date_utc timestamptz NOT NULL DEFAULT now(),
  reusable boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mc_executive_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  summary text DEFAULT '',
  generated_at_utc timestamptz NOT NULL DEFAULT now(),
  sent boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mc_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  demand_id uuid REFERENCES public.mc_demands(id) ON DELETE CASCADE,
  entity_type text NOT NULL DEFAULT 'demand',
  event_type text NOT NULL,
  timestamp_utc timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mc_notifications_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  event text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  scheduled_at_utc timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =========================================================================
-- 2) COLUMN BACKFILL (ADD COLUMN IF NOT EXISTS — safe to re-run)
-- =========================================================================

-- mc_demands
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS description text DEFAULT '';
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS company text DEFAULT 'bulking';
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS requester text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS requested_by_role text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS owner text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS owner_person_id uuid;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS secondary_owner text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS assigned_by text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS response_required_from text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS team text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS deliverable_type text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS parent_demand_id uuid;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS depends_on_ids jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS urgency text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS created_at_local text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS first_seen_at_utc timestamptz;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS assigned_at_utc timestamptz;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS started_at_utc timestamptz;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS next_follow_up_at_utc timestamptz;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS due_at_utc timestamptz;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS blocked_at_utc timestamptz;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS resolved_at_utc timestamptz;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS closed_at_utc timestamptz;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS objective text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS expected_outcome text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS current_situation text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS success_metric text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS next_action text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS next_action_owner text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS next_action_due_at_utc timestamptz;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS blocker text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS blocker_owner text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS unblock_action text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS requires_reply boolean DEFAULT false;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS reply_sla_hours integer DEFAULT 3;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS follow_up_rule text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS escalation_rule text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS waiting_for_person text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS waiting_for_person_id uuid;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS waiting_since_at_utc timestamptz;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS waiting_last_reply_at_utc timestamptz;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS no_reply_since_hours numeric;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS acquisition_impact text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS conversion_impact text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS retention_impact text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS revenue_impact text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS risk_level text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS completion_notes text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS failure_reason text;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS metric_snapshot_json jsonb;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS metric_snapshot_captured_at_utc timestamptz;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS related_campaigns jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS related_channels jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS related_tasks jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS related_decision_ids jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS related_learning_ids jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS related_report_ids jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS evidence_links jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.mc_demands ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- mc_people
ALTER TABLE public.mc_people ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE public.mc_people ADD COLUMN IF NOT EXISTS team text;
ALTER TABLE public.mc_people ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE public.mc_people ADD COLUMN IF NOT EXISTS phone_or_chat_id text;
ALTER TABLE public.mc_people ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.mc_people ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.mc_people ADD COLUMN IF NOT EXISTS notes text;

-- mc_follow_ups
ALTER TABLE public.mc_follow_ups ADD COLUMN IF NOT EXISTS target_role text;
ALTER TABLE public.mc_follow_ups ADD COLUMN IF NOT EXISTS target_person_id uuid;
ALTER TABLE public.mc_follow_ups ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE public.mc_follow_ups ADD COLUMN IF NOT EXISTS sent_by text;
ALTER TABLE public.mc_follow_ups ADD COLUMN IF NOT EXISTS due_reply_at_utc timestamptz;
ALTER TABLE public.mc_follow_ups ADD COLUMN IF NOT EXISTS replied_at_utc timestamptz;
ALTER TABLE public.mc_follow_ups ADD COLUMN IF NOT EXISTS reply_quality text;
ALTER TABLE public.mc_follow_ups ADD COLUMN IF NOT EXISTS response_text text;
ALTER TABLE public.mc_follow_ups ADD COLUMN IF NOT EXISTS response_summary text;
ALTER TABLE public.mc_follow_ups ADD COLUMN IF NOT EXISTS breach_hours numeric;
ALTER TABLE public.mc_follow_ups ADD COLUMN IF NOT EXISTS escalate_if_no_reply boolean DEFAULT false;
ALTER TABLE public.mc_follow_ups ADD COLUMN IF NOT EXISTS escalation_target text;
ALTER TABLE public.mc_follow_ups ADD COLUMN IF NOT EXISTS outcome text;

-- mc_experiments
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS owner text;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS start_date_utc timestamptz;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS end_date_utc timestamptz;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS baseline_metric text;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS target_metric text;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS current_metric text;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS expected_impact text;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS actual_impact text;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS confidence text;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS test_type text;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS sample_size integer;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS stop_rule text;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS win_rule text;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS loss_rule text;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS final_decision_reason text;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS decision text;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS next_step text;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS linked_demand_ids jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS linked_campaigns jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS learning_summary text;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS metric_snapshot_json jsonb;
ALTER TABLE public.mc_experiments ADD COLUMN IF NOT EXISTS metric_snapshot_captured_at_utc timestamptz;

-- mc_decisions
ALTER TABLE public.mc_decisions ADD COLUMN IF NOT EXISTS decided_by text;
ALTER TABLE public.mc_decisions ADD COLUMN IF NOT EXISTS area text;
ALTER TABLE public.mc_decisions ADD COLUMN IF NOT EXISTS impact_level text;
ALTER TABLE public.mc_decisions ADD COLUMN IF NOT EXISTS related_demand_ids jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.mc_decisions ADD COLUMN IF NOT EXISTS related_experiment_ids jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.mc_decisions ADD COLUMN IF NOT EXISTS expiry_review_date_utc timestamptz;
ALTER TABLE public.mc_decisions ADD COLUMN IF NOT EXISTS notes text;

-- mc_learnings
ALTER TABLE public.mc_learnings ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE public.mc_learnings ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.mc_learnings ADD COLUMN IF NOT EXISTS area text;
ALTER TABLE public.mc_learnings ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE public.mc_learnings ADD COLUMN IF NOT EXISTS confidence text;
ALTER TABLE public.mc_learnings ADD COLUMN IF NOT EXISTS related_campaigns jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.mc_learnings ADD COLUMN IF NOT EXISTS related_experiments jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.mc_learnings ADD COLUMN IF NOT EXISTS related_decision_ids jsonb DEFAULT '[]'::jsonb;

-- mc_executive_reports
ALTER TABLE public.mc_executive_reports ADD COLUMN IF NOT EXISTS period_type text;
ALTER TABLE public.mc_executive_reports ADD COLUMN IF NOT EXISTS period_label text;
ALTER TABLE public.mc_executive_reports ADD COLUMN IF NOT EXISTS audience text;
ALTER TABLE public.mc_executive_reports ADD COLUMN IF NOT EXISTS what_improved text;
ALTER TABLE public.mc_executive_reports ADD COLUMN IF NOT EXISTS what_worsened text;
ALTER TABLE public.mc_executive_reports ADD COLUMN IF NOT EXISTS blockers text;
ALTER TABLE public.mc_executive_reports ADD COLUMN IF NOT EXISTS next_actions text;
ALTER TABLE public.mc_executive_reports ADD COLUMN IF NOT EXISTS decisions_needed text;
ALTER TABLE public.mc_executive_reports ADD COLUMN IF NOT EXISTS linked_demand_ids jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.mc_executive_reports ADD COLUMN IF NOT EXISTS linked_metrics jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.mc_executive_reports ADD COLUMN IF NOT EXISTS sent_at_utc timestamptz;

-- mc_activity_log
ALTER TABLE public.mc_activity_log ADD COLUMN IF NOT EXISTS entity_id uuid;
ALTER TABLE public.mc_activity_log ADD COLUMN IF NOT EXISTS actor text;
ALTER TABLE public.mc_activity_log ADD COLUMN IF NOT EXISTS actor_type text;
ALTER TABLE public.mc_activity_log ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE public.mc_activity_log ADD COLUMN IF NOT EXISTS before_value jsonb;
ALTER TABLE public.mc_activity_log ADD COLUMN IF NOT EXISTS after_value jsonb;
ALTER TABLE public.mc_activity_log ADD COLUMN IF NOT EXISTS notes text;

-- mc_notifications_queue
ALTER TABLE public.mc_notifications_queue ADD COLUMN IF NOT EXISTS entity_id uuid;
ALTER TABLE public.mc_notifications_queue ADD COLUMN IF NOT EXISTS target_person_id uuid;
ALTER TABLE public.mc_notifications_queue ADD COLUMN IF NOT EXISTS target_person_name text;
ALTER TABLE public.mc_notifications_queue ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE public.mc_notifications_queue ADD COLUMN IF NOT EXISTS payload jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.mc_notifications_queue ADD COLUMN IF NOT EXISTS sent_at_utc timestamptz;
ALTER TABLE public.mc_notifications_queue ADD COLUMN IF NOT EXISTS error text;

-- =========================================================================
-- 3) CHECK CONSTRAINTS (recreate to match current enum values)
-- =========================================================================
ALTER TABLE public.mc_demands DROP CONSTRAINT IF EXISTS mc_demands_status_check;
ALTER TABLE public.mc_demands ADD CONSTRAINT mc_demands_status_check CHECK (status IN (
  'new','triaged','assigned',
  'waiting_person','waiting_founder','waiting_data','waiting_content','waiting_external',
  'in_progress','blocked','ready_for_review','done','canceled','archived'
));

ALTER TABLE public.mc_demands DROP CONSTRAINT IF EXISTS mc_demands_priority_check;
ALTER TABLE public.mc_demands ADD CONSTRAINT mc_demands_priority_check CHECK (priority IN ('critical','high','medium','low'));

ALTER TABLE public.mc_demands DROP CONSTRAINT IF EXISTS mc_demands_health_check;
ALTER TABLE public.mc_demands ADD CONSTRAINT mc_demands_health_check CHECK (health IN ('on_track','attention','delayed','blocked','at_risk'));

ALTER TABLE public.mc_demands DROP CONSTRAINT IF EXISTS mc_demands_area_check;
ALTER TABLE public.mc_demands ADD CONSTRAINT mc_demands_area_check CHECK (area IN (
  'acquisition','conversion','retention','crm','creative','site','finance','ops','reporting','analytics'
));

ALTER TABLE public.mc_demands DROP CONSTRAINT IF EXISTS mc_demands_team_check;
ALTER TABLE public.mc_demands ADD CONSTRAINT mc_demands_team_check CHECK (team IS NULL OR team IN (
  'marketing','ecommerce','crm','ops','finance','product','data','content','other'
));

ALTER TABLE public.mc_demands DROP CONSTRAINT IF EXISTS mc_demands_deliverable_type_check;
ALTER TABLE public.mc_demands ADD CONSTRAINT mc_demands_deliverable_type_check CHECK (deliverable_type IS NULL OR deliverable_type IN (
  'report','action','analysis','test','bug','follow_up','decision','content','other'
));

ALTER TABLE public.mc_follow_ups DROP CONSTRAINT IF EXISTS mc_follow_ups_reply_status_check;
ALTER TABLE public.mc_follow_ups ADD CONSTRAINT mc_follow_ups_reply_status_check CHECK (reply_status IN (
  'pending','replied','late_reply','no_reply','clarified','blocked'
));

ALTER TABLE public.mc_follow_ups DROP CONSTRAINT IF EXISTS mc_follow_ups_message_type_check;
ALTER TABLE public.mc_follow_ups ADD CONSTRAINT mc_follow_ups_message_type_check CHECK (message_type IN (
  'ask','charge','reminder','unblock','escalation','confirmation'
));

ALTER TABLE public.mc_experiments DROP CONSTRAINT IF EXISTS mc_experiments_status_check;
ALTER TABLE public.mc_experiments ADD CONSTRAINT mc_experiments_status_check CHECK (status IN (
  'backlog','approved','running','analyzing','won','lost','inconclusive','paused'
));

-- =========================================================================
-- 4) FKs for new ID columns (only if pointing at tables created above)
-- =========================================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'mc_demands_owner_person_id_fkey'
  ) THEN
    ALTER TABLE public.mc_demands
      ADD CONSTRAINT mc_demands_owner_person_id_fkey
      FOREIGN KEY (owner_person_id) REFERENCES public.mc_people(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'mc_demands_waiting_for_person_id_fkey'
  ) THEN
    ALTER TABLE public.mc_demands
      ADD CONSTRAINT mc_demands_waiting_for_person_id_fkey
      FOREIGN KEY (waiting_for_person_id) REFERENCES public.mc_people(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'mc_demands_parent_demand_id_fkey'
  ) THEN
    ALTER TABLE public.mc_demands
      ADD CONSTRAINT mc_demands_parent_demand_id_fkey
      FOREIGN KEY (parent_demand_id) REFERENCES public.mc_demands(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'mc_follow_ups_target_person_id_fkey'
  ) THEN
    ALTER TABLE public.mc_follow_ups
      ADD CONSTRAINT mc_follow_ups_target_person_id_fkey
      FOREIGN KEY (target_person_id) REFERENCES public.mc_people(id) ON DELETE SET NULL;
  END IF;
END $$;

-- =========================================================================
-- 5) RLS + POLICIES (drop-then-create so re-running is safe)
-- =========================================================================
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'mc_demands','mc_follow_ups','mc_experiments','mc_decisions',
    'mc_learnings','mc_executive_reports','mc_activity_log',
    'mc_people','mc_notifications_queue'
  ])
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "%I_select" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%I_insert" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%I_update" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%I_delete" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "%I_select" ON public.%I FOR SELECT USING (workspace_id IN (SELECT public.get_user_workspace_ids()))', t, t);
    EXECUTE format('CREATE POLICY "%I_insert" ON public.%I FOR INSERT WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()))', t, t);
    EXECUTE format('CREATE POLICY "%I_update" ON public.%I FOR UPDATE USING (workspace_id IN (SELECT public.get_user_workspace_ids()))', t, t);
    EXECUTE format('CREATE POLICY "%I_delete" ON public.%I FOR DELETE USING (workspace_id IN (SELECT public.get_user_workspace_ids()))', t, t);
  END LOOP;
END $$;

-- =========================================================================
-- 6) INDEXES (safe, idempotent)
-- =========================================================================
CREATE INDEX IF NOT EXISTS idx_mc_demands_workspace ON public.mc_demands(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_mc_demands_waiting_person ON public.mc_demands(workspace_id, waiting_for_person) WHERE waiting_for_person IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mc_demands_waiting_person_id ON public.mc_demands(waiting_for_person_id) WHERE waiting_for_person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mc_demands_next_follow_up ON public.mc_demands(workspace_id, next_follow_up_at_utc) WHERE next_follow_up_at_utc IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mc_follow_ups_workspace ON public.mc_follow_ups(workspace_id, reply_status);
CREATE INDEX IF NOT EXISTS idx_mc_follow_ups_breach ON public.mc_follow_ups(workspace_id, is_sla_breached) WHERE is_sla_breached = true;
CREATE INDEX IF NOT EXISTS idx_mc_activity_workspace ON public.mc_activity_log(workspace_id, timestamp_utc DESC);
CREATE INDEX IF NOT EXISTS idx_mc_queue_due ON public.mc_notifications_queue(workspace_id, status, scheduled_at_utc);
CREATE INDEX IF NOT EXISTS idx_mc_people_workspace ON public.mc_people(workspace_id, is_active);

-- =========================================================================
-- 7) RELOAD POSTGREST SCHEMA CACHE
-- This is the fix for "Could not find the 'X' column ... in the schema cache"
-- =========================================================================
NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- 8) VERIFICATION — returns one row per required column. Missing => problem.
-- Run the SELECT to eyeball.
-- =========================================================================
-- SELECT table_name, column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema='public' AND table_name LIKE 'mc\_%' ESCAPE '\'
-- ORDER BY table_name, ordinal_position;

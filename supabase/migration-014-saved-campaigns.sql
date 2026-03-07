-- Migration 014: Saved Classified Campaigns
-- Auto-classified campaigns saved for agent reference and analysis

CREATE TABLE IF NOT EXISTS public.saved_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  account_name text,
  campaign_id text NOT NULL,
  campaign_name text NOT NULL,
  status text,
  objective text,
  daily_budget text,
  lifetime_budget text,
  -- Performance metrics (snapshot at classification time)
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  spend numeric(12,2) DEFAULT 0,
  reach integer DEFAULT 0,
  ctr numeric(8,4) DEFAULT 0,
  cpc numeric(12,4) DEFAULT 0,
  cpm numeric(12,4) DEFAULT 0,
  revenue numeric(12,2) DEFAULT 0,
  purchases integer DEFAULT 0,
  roas numeric(8,4) DEFAULT 0,
  -- Classification and annotations
  tier text CHECK (tier IN ('champion', 'potential', 'scale')),
  notes text,
  tags text[] DEFAULT '{}',
  saved_at timestamptz DEFAULT now(),
  date_range text,
  UNIQUE(workspace_id, campaign_id)
);

CREATE INDEX idx_saved_campaigns_workspace ON public.saved_campaigns(workspace_id);
CREATE INDEX idx_saved_campaigns_tier ON public.saved_campaigns(workspace_id, tier);

ALTER TABLE public.saved_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_access" ON public.saved_campaigns FOR ALL
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

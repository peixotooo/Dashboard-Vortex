-- Migration 013: Saved Champion Creatives
-- Auto-classified creatives saved for agent reference and analysis

CREATE TABLE IF NOT EXISTS public.saved_creatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  account_name text,
  ad_id text NOT NULL,
  ad_name text NOT NULL,
  campaign_name text,
  campaign_id text,
  adset_name text,
  adset_id text,
  creative_id text,
  title text,
  body text,
  image_url text,
  thumbnail_url text,
  video_id text,
  cta text,
  format text,
  destination_url text,
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
  saved_by uuid REFERENCES auth.users(id),
  saved_at timestamptz DEFAULT now(),
  date_range text,
  UNIQUE(workspace_id, ad_id)
);

CREATE INDEX idx_saved_creatives_workspace ON public.saved_creatives(workspace_id);
CREATE INDEX idx_saved_creatives_tier ON public.saved_creatives(workspace_id, tier);
CREATE INDEX idx_saved_creatives_tags ON public.saved_creatives USING gin(tags);
CREATE INDEX idx_saved_creatives_roas ON public.saved_creatives(workspace_id, roas DESC);

ALTER TABLE public.saved_creatives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_access" ON public.saved_creatives FOR ALL
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

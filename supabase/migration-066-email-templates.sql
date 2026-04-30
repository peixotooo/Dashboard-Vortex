-- supabase/migration-066-email-templates.sql

-- 1. Settings per workspace ---------------------------------------------------
create table if not exists email_template_settings (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  enabled boolean not null default false,
  bestseller_lookback_days int not null default 7,
  slowmoving_lookback_days int not null default 30,
  newarrival_lookback_days int not null default 14,
  min_stock_bestseller int not null default 5,
  slowmoving_max_sales int not null default 3,
  slowmoving_discount_percent numeric not null default 10,
  slowmoving_coupon_validity_hours int not null default 48,
  copy_provider text not null default 'template'
    check (copy_provider in ('template','llm')),
  llm_agent_slug text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Suggestions (3 per workspace per day) -----------------------------------
create table if not exists email_template_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  generated_for_date date not null,
  slot smallint not null check (slot in (1,2,3)),

  vnda_product_id text not null,
  product_snapshot jsonb not null,

  target_segment_type text not null
    check (target_segment_type in ('rfm','attribute')),
  target_segment_payload jsonb not null,

  copy jsonb not null,
  copy_provider text not null,
  rendered_html text not null,

  recommended_hours int[] not null,
  hours_score jsonb,

  coupon_code text,
  coupon_vnda_promotion_id bigint,
  coupon_vnda_coupon_id bigint,
  coupon_expires_at timestamptz,
  coupon_discount_percent numeric,

  status text not null default 'pending'
    check (status in ('pending','selected','sent')),
  selected_at timestamptz,
  selected_count int not null default 0,
  sent_at timestamptz,
  sent_hour_chosen int check (sent_hour_chosen between 0 and 23),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(workspace_id, generated_for_date, slot)
);

create index if not exists email_template_suggestions_ws_date_idx
  on email_template_suggestions(workspace_id, generated_for_date desc);
create index if not exists email_template_suggestions_ws_status_idx
  on email_template_suggestions(workspace_id, status, generated_for_date desc);

-- 3. Audit log ---------------------------------------------------------------
create table if not exists email_template_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  suggestion_id uuid references email_template_suggestions(id) on delete cascade,
  event text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists email_template_audit_ws_idx
  on email_template_audit(workspace_id, created_at desc);
create index if not exists email_template_audit_suggestion_idx
  on email_template_audit(suggestion_id);

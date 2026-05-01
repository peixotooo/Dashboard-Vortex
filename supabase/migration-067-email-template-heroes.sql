-- supabase/migration-067-email-template-heroes.sql
--
-- Persistent cache of generated hero images. The kie.ai GPT Image 2 endpoint
-- returns short-lived URLs (24h), so we re-upload to B2 and store the
-- permanent URL keyed by (workspace_id, vnda_product_id, layout_id, slot).
-- Re-running the cron with the same triple skips regeneration.

create table if not exists email_template_heroes (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  vnda_product_id text not null,
  layout_id text not null,
  slot smallint not null check (slot in (1,2,3)),

  hero_url text not null,
  reference_image text,
  prompt text not null,

  kie_task_id text,
  source_image_urls text[] not null default '{}',

  created_at timestamptz not null default now(),

  primary key (workspace_id, vnda_product_id, layout_id, slot)
);

create index if not exists email_template_heroes_ws_idx
  on email_template_heroes(workspace_id, created_at desc);

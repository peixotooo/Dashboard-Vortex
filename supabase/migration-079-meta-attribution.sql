-- Meta CAPI attribution snapshot per email.
--
-- Browser-only signals (fbc, fbp, client IP, user agent) can't be captured
-- by the VNDA confirmed-order webhook. We instead snapshot them in the
-- storefront at checkout-email-entry time, keyed by the email the customer
-- types in. When the order webhook arrives, we read the latest snapshot for
-- that email and merge it into the server-side Purchase event so Meta gets
-- a single Purchase event with hashed PII (server) PLUS fbc/fbp/IP/UA
-- (browser), maxing out Event Match Quality without double-counting.

create table if not exists public.meta_attribution (
  id bigserial primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  consumer_id text,
  fbc text,
  fbp text,
  client_ip text,
  user_agent text,
  captured_at timestamptz not null default now(),
  unique (workspace_id, email)
);

-- Recent lookups by (workspace_id, email)
create index if not exists meta_attribution_ws_email_idx
  on public.meta_attribution (workspace_id, email);

-- TTL hint: rows older than 7 days are useless to Meta (CAPI dedup window).
create index if not exists meta_attribution_captured_at_idx
  on public.meta_attribution (captured_at);

alter table public.meta_attribution enable row level security;

drop policy if exists "Members can view their workspace's attribution"
  on public.meta_attribution;
create policy "Members can view their workspace's attribution"
  on public.meta_attribution for select
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid()
    )
  );

-- Writes go through service-role (the public /api/meta-attribution endpoint
-- and the webhook handler), so no insert/update policy is needed for
-- regular users.

-- Migration 116: close public-schema RLS gaps flagged by Supabase.
--
-- Supabase Security Advisor reported rls_disabled_in_public. These tables are
-- workspace-scoped and should never be readable by anon users. We intentionally
-- do not FORCE RLS here: service-role jobs and SECURITY DEFINER queue helpers
-- must keep working while browser/session access is constrained by workspace.

do $$
declare
  table_name text;
  workspace_tables text[] := array[
    'crm_abc_snapshots',
    'email_template_audiences',
    'email_template_audit',
    'email_template_dispatches',
    'email_template_drafts',
    'email_template_heroes',
    'email_template_iporto_envios',
    'email_template_settings',
    'email_template_suggestions',
    'product_costs',
    'vnda_webhook_logs',
    'wa_exclusions',
    'workspace_email_marketing'
  ];
begin
  foreach table_name in array workspace_tables loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable row level security', table_name);

      execute format('drop policy if exists %I on public.%I', 'Members view ' || table_name, table_name);
      execute format(
        'create policy %I on public.%I for select using (workspace_id in (select public.get_user_workspace_ids()))',
        'Members view ' || table_name,
        table_name
      );

      execute format('drop policy if exists %I on public.%I', 'Admins manage ' || table_name, table_name);
      execute format(
        'create policy %I on public.%I for all using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and role in (''owner'', ''admin''))) with check (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and role in (''owner'', ''admin'')))',
        'Admins manage ' || table_name,
        table_name
      );
    end if;
  end loop;
end $$;

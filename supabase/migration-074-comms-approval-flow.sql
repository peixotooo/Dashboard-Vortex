-- supabase/migration-074-comms-approval-flow.sql
--
-- "Rascunho agendado com aprovação" para CRM Email e WhatsApp.
--
-- Em vez de o usuário disparar direto, ele monta toda a comunicação
-- (conteúdo + listas/segmento + agendamento) e marca como "precisa
-- aprovação". O envio só acontece depois que outro usuário aprova.
--
-- Email: aproveitamos a tabela email_template_drafts. Quando
--   approval_state = 'pending_approval', o draft guarda também o
--   dispatch_payload (list_ids, sender, utm_term etc.) e o
--   scheduled_for. Só ao aprovar é que chamamos a Locaweb.
--
-- WhatsApp: aproveitamos wa_campaigns. status='pending_approval'
--   significa que as wa_messages já estão queued, mas o cron skipa
--   (o whatsapp-sender só lê queued/sending/scheduled-due, então
--   pending_approval é ignorado naturalmente). Ao aprovar a campanha
--   transiciona pra queued (envio imediato) ou scheduled (se houver
--   scheduled_at no futuro).
--
-- Idempotente.

-- ============================================================
-- email_template_drafts: approval columns
-- ============================================================

alter table if exists email_template_drafts
  add column if not exists approval_state text
    check (approval_state in ('pending_approval', 'approved', 'rejected')),
  add column if not exists scheduled_for timestamptz,
  add column if not exists dispatch_payload jsonb,
  add column if not exists submitted_by uuid references auth.users(id) on delete set null,
  add column if not exists submitted_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_by uuid references auth.users(id) on delete set null,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text;

create index if not exists email_template_drafts_pending_idx
  on email_template_drafts (workspace_id, submitted_at desc)
  where approval_state = 'pending_approval';

-- ============================================================
-- wa_campaigns: approval columns
-- ============================================================
--
-- status já é TEXT livre (sem CHECK constraint), então o valor
-- 'pending_approval' é aceito sem alteração.

alter table if exists wa_campaigns
  add column if not exists submitted_by uuid references auth.users(id) on delete set null,
  add column if not exists submitted_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_by uuid references auth.users(id) on delete set null,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text;

create index if not exists wa_campaigns_pending_idx
  on wa_campaigns (workspace_id, submitted_at desc)
  where status = 'pending_approval';

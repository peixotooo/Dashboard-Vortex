-- Migration 106: snapshots de membros de grupos de WhatsApp (série temporal).
--
-- A integração W-API já cacheia jid+nome dos grupos (wapi_groups), mas não
-- guarda histórico de quantos membros cada grupo tem. Esta tabela grava UM
-- ponto por dia por grupo (contagem de membros via /group/group-metadata),
-- pra medir crescimento e queda ao longo do tempo.
--
-- Captura: cron diário (/api/cron/whatsapp-group-snapshot) + on-demand
-- (POST /api/whatsapp-groups/member-snapshot, botão "Atualizar agora").
--
-- Acesso: RLS habilitado SEM policies de cliente — leitura/escrita só pelo
-- servidor via service_role (createAdminClient), igual ao instagram_snapshots.

CREATE TABLE IF NOT EXISTS whatsapp_group_member_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  group_jid TEXT NOT NULL,
  group_name TEXT,

  -- Bucket do dia (timezone America/Sao_Paulo). UNIQUE garante 1 ponto/dia:
  -- re-rodar o cron ou "Atualizar agora" no mesmo dia faz UPDATE.
  captured_on DATE NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  member_count INTEGER NOT NULL,
  admins_count INTEGER,

  -- Origem: 'cron' | 'manual'.
  source TEXT NOT NULL DEFAULT 'cron',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT wa_group_member_snapshots_unique_day
    UNIQUE (workspace_id, group_jid, captured_on)
);

-- Série por grupo (view por grupo + deltas).
CREATE INDEX IF NOT EXISTS idx_wa_group_member_snap_group
  ON whatsapp_group_member_snapshots (workspace_id, group_jid, captured_on DESC);

-- Totais por dia agregando todos os grupos do workspace.
CREATE INDEX IF NOT EXISTS idx_wa_group_member_snap_ws_date
  ON whatsapp_group_member_snapshots (workspace_id, captured_on);

ALTER TABLE whatsapp_group_member_snapshots ENABLE ROW LEVEL SECURITY;

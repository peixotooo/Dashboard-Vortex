-- Migration 035: WhatsApp compliance - exclusion list + cooldown index

-- 1. wa_exclusions — Permanent blocklist per workspace
CREATE TABLE IF NOT EXISTS wa_exclusions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  contact_name TEXT,
  reason TEXT NOT NULL DEFAULT 'manual',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (workspace_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_wa_exclusions_ws_phone
  ON wa_exclusions(workspace_id, phone);

-- 2. Partial index for fast cooldown queries on wa_messages
CREATE INDEX IF NOT EXISTS idx_wa_messages_cooldown
  ON wa_messages(workspace_id, phone, sent_at DESC)
  WHERE status IN ('sent', 'delivered', 'read');

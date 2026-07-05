-- Migration 132: Chat Commerce v2 — modo GLOBAL do assistente
--
-- v1 é PDP-scoped (gate por produto). v2 é uma página de chat global
-- (/chat) que vende a loja inteira. Uma flag por workspace liga o modo global
-- sem afetar o widget v1. Também texto de boas-vindas/sugestões próprios da
-- experiência global (o widget continua usando welcome_message/suggestions).

ALTER TABLE assistant_settings
  ADD COLUMN IF NOT EXISTS global_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE assistant_settings
  ADD COLUMN IF NOT EXISTS global_welcome TEXT NOT NULL DEFAULT '';

ALTER TABLE assistant_settings
  ADD COLUMN IF NOT EXISTS global_suggestions JSONB NOT NULL DEFAULT
    '["O que tem de mais vendido?","Quero uma camiseta oversized preta","Tem cupom hoje?","Me ajuda a escolher um look"]'::jsonb;

-- Marca a conversa como originada no chat global (pra separar métrica do widget PDP)
ALTER TABLE assistant_conversations
  ADD COLUMN IF NOT EXISTS surface TEXT NOT NULL DEFAULT 'pdp';

-- Mesma marca na mensagem: permite o cap de custo diário SEPARADO por superfície
-- (o chat global v2 não consome a cota do widget v1 e vice-versa).
ALTER TABLE assistant_messages
  ADD COLUMN IF NOT EXISTS surface TEXT NOT NULL DEFAULT 'pdp';

CREATE INDEX IF NOT EXISTS idx_assistant_messages_ws_surface_created
  ON assistant_messages (workspace_id, surface, created_at);

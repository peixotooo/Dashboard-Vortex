-- Migration 058: Multi-step gift bar with optional per-step modals
-- Each step: { id, label, icon, threshold, modal_title?, modal_body? }
-- When steps is non-empty, storefront renders multi-step UI; else falls back to legacy single-threshold

ALTER TABLE gift_bar_configs ADD COLUMN IF NOT EXISTS steps JSONB DEFAULT '[]'::jsonb;
ALTER TABLE gift_bar_configs ADD COLUMN IF NOT EXISTS message_next_step TEXT DEFAULT 'Faltam R$ {gap} para o proximo {next_label}!';
ALTER TABLE gift_bar_configs ADD COLUMN IF NOT EXISTS message_all_achieved TEXT DEFAULT 'Voce desbloqueou todos os mimos!';

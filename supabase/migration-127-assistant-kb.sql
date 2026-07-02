-- Migration 127: Base de conhecimento institucional do assistente
--
-- Texto curado das páginas institucionais da loja (trocas, frete, pagamento,
-- FAQ, privacidade, atendimento). Sincronizado por scripts/assistant-kb-sync.ts
-- a partir de www.bulking.com.br/p/*. Separado de store_info (que o admin edita
-- à mão) — a tool informacoes_da_loja concatena os dois.
--
-- Campanhas e benefícios NÃO ficam aqui: são lidos AO VIVO do banco
-- (topbar_campaigns, promo_active_coupons, gift_bar_configs, ...) pela tool
-- promocoes_e_beneficios, porque mudam toda hora.

ALTER TABLE assistant_settings
  ADD COLUMN IF NOT EXISTS institutional_kb TEXT NOT NULL DEFAULT '';

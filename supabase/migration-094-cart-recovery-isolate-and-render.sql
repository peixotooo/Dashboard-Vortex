-- Migration 094: isolar campanhas de cart-recovery + persistir conteúdo
--
-- Problema 1: cada dispatch do cart-recovery cria uma wa_campaigns que
-- aparece na lista de /crm/whatsapp ("Cart Recovery — cart Xyz — step 1"),
-- poluindo a UI. Adicionamos uma coluna `kind` e filtramos no endpoint.
--
-- Problema 2: a timeline do cart no /crm/cart-recovery mostra apenas
-- "WhatsApp enviado 14:30" sem o texto. Adicionamos rendered_payload
-- pra ver exatamente o que o cliente recebeu (texto interpolado).

-- wa_campaigns.kind — distingue campanha manual da automação cart-recovery.
ALTER TABLE wa_campaigns
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'campaign';

-- Retroativa: marca campanhas existentes de cart-recovery (nome começa
-- com "Cart Recovery —") como kind='cart_recovery' pra somem da lista.
UPDATE wa_campaigns
SET kind = 'cart_recovery'
WHERE name LIKE 'Cart Recovery%' AND kind = 'campaign';

CREATE INDEX IF NOT EXISTS idx_wa_campaigns_kind
  ON wa_campaigns (workspace_id, kind, created_at DESC);

-- cart_recovery_messages.rendered_payload — conteúdo real que foi enviado
-- ao cliente, pra exibir na timeline.
--   WhatsApp: { template_name, language, variables: {1: "...", ...}, body }
--   Email:    { subject, body_html, to }
ALTER TABLE cart_recovery_messages
  ADD COLUMN IF NOT EXISTS rendered_payload JSONB;

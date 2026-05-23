-- Migration 091: cupom auto por step na régua de cart recovery
--
-- Cada step pode opcionalmente gerar um cupom único por carrinho (válido
-- só pra aquele cliente) antes do dispatch. Útil pra "última tentativa"
-- com escassez de tempo (ex: 10% por 48h).
--
-- coupon_pct = 0 → step não gera cupom
-- coupon_pct > 0 → gera cupom (% off no carrinho inteiro) com validade
--                  coupon_validity_hours
--
-- O code gerado vai pra abandoned_carts.coupon_code e fica disponível
-- como variável {{coupon_code}} nos templates WhatsApp/Email.

ALTER TABLE cart_recovery_steps
  ADD COLUMN IF NOT EXISTS coupon_pct INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coupon_validity_hours INT NOT NULL DEFAULT 48;

-- Persistir info do cupom criado pra cada cart: code (já tem),
-- promotion_id pra eventual pausa/cleanup, e expires_at pra UI mostrar
-- tempo restante.
ALTER TABLE abandoned_carts
  ADD COLUMN IF NOT EXISTS recovery_coupon_promotion_id BIGINT,
  ADD COLUMN IF NOT EXISTS recovery_coupon_expires_at TIMESTAMPTZ;

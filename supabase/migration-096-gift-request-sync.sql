-- Migration 096: Sincroniza wa_messages.status -> gift_requests.status
--
-- Sem isso, gift_requests.status fica eternamente 'queued' mesmo depois
-- que a Meta confirma envio/entrega/leitura no webhook, porque o webhook
-- só atualiza wa_messages.

-- ============================================================================
-- 1) Aceita 'sending' no enum de status do gift_requests
-- ============================================================================

ALTER TABLE gift_requests
  DROP CONSTRAINT IF EXISTS gift_requests_status_check;

ALTER TABLE gift_requests
  ADD CONSTRAINT gift_requests_status_check
  CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'converted'));

-- ============================================================================
-- 2) Trigger: quando wa_messages atualiza, propaga pra gift_requests
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_gift_request_from_wa_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE gift_requests
  SET
    status = CASE
      WHEN NEW.status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed')
        THEN NEW.status
      ELSE gift_requests.status
    END,
    sent_at = COALESCE(NEW.sent_at, gift_requests.sent_at),
    delivered_at = COALESCE(NEW.delivered_at, gift_requests.delivered_at),
    read_at = COALESCE(NEW.read_at, gift_requests.read_at),
    error_message = COALESCE(NEW.error_message, gift_requests.error_message)
  WHERE wa_message_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_gift_request_from_wa_message ON wa_messages;

CREATE TRIGGER trg_sync_gift_request_from_wa_message
AFTER UPDATE OF status, sent_at, delivered_at, read_at, error_message
ON wa_messages
FOR EACH ROW
WHEN (
  NEW.status IS DISTINCT FROM OLD.status
  OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
  OR NEW.delivered_at IS DISTINCT FROM OLD.delivered_at
  OR NEW.read_at IS DISTINCT FROM OLD.read_at
  OR NEW.error_message IS DISTINCT FROM OLD.error_message
)
EXECUTE FUNCTION sync_gift_request_from_wa_message();

-- ============================================================================
-- 3) Backfill: sincroniza pedidos existentes que já têm wa_message_id linkado
-- ============================================================================

UPDATE gift_requests gr
SET
  status = CASE
    WHEN wm.status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed')
      THEN wm.status
    ELSE gr.status
  END,
  sent_at = COALESCE(wm.sent_at, gr.sent_at),
  delivered_at = COALESCE(wm.delivered_at, gr.delivered_at),
  read_at = COALESCE(wm.read_at, gr.read_at),
  error_message = COALESCE(wm.error_message, gr.error_message)
FROM wa_messages wm
WHERE gr.wa_message_id = wm.id;

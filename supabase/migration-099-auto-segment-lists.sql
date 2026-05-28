-- Migration 099: listas auto-alimentadas (auto_segment) + append atômico.
--
-- Caso de uso disparador: lista "Clientes Mulheres" alimentada
-- automaticamente toda vez que chega um webhook de pedido confirmado
-- e o cliente é inferido como mulher (high+medium confidence).
--
-- Modelagem:
--   * auto_segment JSONB em crm_contact_lists marca a lista como
--     dinâmica. Shape canônico:
--       { type: 'gender', gender: 'female', min_confidence: 'medium' }
--     Listas manuais continuam com auto_segment NULL.
--   * Função append_contact_to_list faz check-and-append protegido
--     por SELECT...FOR UPDATE — webhooks paralelos não conseguem
--     duplicar nem perder contato no contacts JSONB.
--
-- Counters total_count/phone_count/email_count são mantidos pela
-- própria função (incrementais), evitando recálculo do array a cada
-- pedido.

ALTER TABLE crm_contact_lists
  ADD COLUMN IF NOT EXISTS auto_segment JSONB;

-- Índice GIN: usado pra achar a lista de um workspace por tipo de
-- segmentação (find-or-create do gender_list).
CREATE INDEX IF NOT EXISTS idx_ccl_auto_segment
  ON crm_contact_lists USING gin (auto_segment)
  WHERE auto_segment IS NOT NULL;

-- Append atômico com dedup por email/phone.
-- Retorna TRUE se adicionou, FALSE se já existia (ou nada válido).
-- O FOR UPDATE garante que webhooks concorrentes serializem na
-- mesma lista — sem race condition.
CREATE OR REPLACE FUNCTION append_contact_to_list(
  p_list_id UUID,
  p_email TEXT,
  p_phone TEXT,
  p_name TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_contacts JSONB;
  v_exists BOOLEAN;
  v_norm_email TEXT;
  v_norm_phone TEXT;
  v_new_contact JSONB;
BEGIN
  v_norm_email := CASE
    WHEN p_email IS NOT NULL AND length(trim(p_email)) > 0
    THEN lower(trim(p_email))
    ELSE NULL
  END;
  v_norm_phone := CASE
    WHEN p_phone IS NOT NULL AND length(trim(p_phone)) > 0
    THEN regexp_replace(p_phone, '\D', '', 'g')
    ELSE NULL
  END;

  IF v_norm_email IS NULL AND v_norm_phone IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Lock the row
  SELECT contacts INTO v_contacts
  FROM crm_contact_lists
  WHERE id = p_list_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Already in the list?
  SELECT EXISTS(
    SELECT 1 FROM jsonb_array_elements(v_contacts) AS c
    WHERE
      (v_norm_email IS NOT NULL AND lower(c->>'email') = v_norm_email)
      OR (v_norm_phone IS NOT NULL AND c->>'phone' = v_norm_phone)
  ) INTO v_exists;

  IF v_exists THEN
    RETURN FALSE;
  END IF;

  v_new_contact := jsonb_strip_nulls(jsonb_build_object(
    'email', v_norm_email,
    'phone', v_norm_phone,
    'name', NULLIF(trim(coalesce(p_name, '')), '')
  ));

  UPDATE crm_contact_lists SET
    contacts    = contacts || jsonb_build_array(v_new_contact),
    total_count = total_count + 1,
    phone_count = phone_count + (CASE WHEN v_norm_phone IS NOT NULL THEN 1 ELSE 0 END),
    email_count = email_count + (CASE WHEN v_norm_email IS NOT NULL THEN 1 ELSE 0 END),
    updated_at  = now()
  WHERE id = p_list_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Migration 101: lookup email → estado mais recente.
--
-- O snapshot RFM hoje não carrega state nos customers — adicionar
-- exige rebuild do snapshot (operação cara). Pra desbloquear o filtro
-- de UF no /crm sem aguardar o próximo recompute, expomos um lookup
-- via função que devolve o último estado conhecido por email.
--
-- DISTINCT ON com ORDER BY data_compra DESC garante o mais recente.

CREATE OR REPLACE FUNCTION crm_customer_state_latest(p_workspace_id UUID)
RETURNS TABLE(
  email TEXT,
  state TEXT
)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT ON (lower(trim(email)))
    lower(trim(email)) AS email,
    state
  FROM crm_vendas
  WHERE workspace_id = p_workspace_id
    AND email IS NOT NULL
    AND email <> ''
    AND state IS NOT NULL
    AND state <> ''
  ORDER BY lower(trim(email)), data_compra DESC NULLS LAST;
$$;

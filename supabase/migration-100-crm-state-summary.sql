-- Migration 100: agregação de clientes/receita por UF.
--
-- A página /crm/estados precisa de contagem de clientes únicos +
-- receita total por estado. Snapshot RFM não carrega state nos
-- customers (decisão antiga de não inflar o JSONB), então a única
-- fonte é crm_vendas. PostgreSQL faz a agregação nativa muito mais
-- rápido do que paginar 84k linhas pelo PostgREST.
--
-- A função roda como STABLE — segura pra cachear via PostgREST se
-- precisar.

CREATE OR REPLACE FUNCTION crm_state_summary(p_workspace_id UUID)
RETURNS TABLE(
  state TEXT,
  customer_count BIGINT,
  total_revenue NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(state, '(sem estado)') AS state,
    COUNT(DISTINCT lower(trim(email))) AS customer_count,
    COALESCE(SUM(valor), 0) AS total_revenue
  FROM crm_vendas
  WHERE workspace_id = p_workspace_id
    AND email IS NOT NULL
    AND email <> ''
  GROUP BY COALESCE(state, '(sem estado)')
  ORDER BY customer_count DESC;
$$;

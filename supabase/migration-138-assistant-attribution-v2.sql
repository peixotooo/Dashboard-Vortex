-- Migration 138: atribuição determinística do assistente + separação de QA
--
-- A página /pedido/<token> expõe o TOKEN público da VNDA, enquanto o webhook
-- entrega também o CODE canônico do pedido. Os dois identificadores precisam
-- coexistir para a confirmação client-side e o webhook se encontrarem em
-- qualquer ordem. Também marcamos tráfego de QA para ele não contaminar os
-- indicadores de clientes.

ALTER TABLE public.assistant_conversations
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.assistant_messages
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quality_flags TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.assistant_events
  ADD COLUMN IF NOT EXISTS order_token TEXT,
  ADD COLUMN IF NOT EXISTS order_id TEXT,
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.assistant_attributions
  ALTER COLUMN order_code DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS order_token TEXT,
  ADD COLUMN IF NOT EXISTS order_id TEXT,
  ADD COLUMN IF NOT EXISTS order_status TEXT,
  ADD COLUMN IF NOT EXISTS order_shipping NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS surface TEXT,
  ADD COLUMN IF NOT EXISTS placed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.assistant_attributions
  DROP CONSTRAINT IF EXISTS assistant_attributions_source_check;

ALTER TABLE public.assistant_attributions
  ADD CONSTRAINT assistant_attributions_source_check
  CHECK (source IN ('client_confirmation', 'webhook', 'probabilistic'));

ALTER TABLE public.assistant_attributions
  DROP CONSTRAINT IF EXISTS assistant_attributions_surface_check;

ALTER TABLE public.assistant_attributions
  ADD CONSTRAINT assistant_attributions_surface_check
  CHECK (surface IS NULL OR surface IN ('global', 'pdp', 'unknown'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'assistant_attributions_workspace_order_token_key'
      AND conrelid = 'public.assistant_attributions'::regclass
  ) THEN
    ALTER TABLE public.assistant_attributions
      ADD CONSTRAINT assistant_attributions_workspace_order_token_key
      UNIQUE (workspace_id, order_token);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'assistant_attributions_workspace_order_id_key'
      AND conrelid = 'public.assistant_attributions'::regclass
  ) THEN
    ALTER TABLE public.assistant_attributions
      ADD CONSTRAINT assistant_attributions_workspace_order_id_key
      UNIQUE (workspace_id, order_id);
  END IF;
END $$;

-- Sessões automatizadas históricas. Browser real nunca usa esses UAs.
UPDATE public.assistant_conversations
SET is_test = true
WHERE lower(coalesce(user_agent, '')) ~ '^(curl|node|postman|insomnia)(/|\s|$)';

-- Corrige falsos nomes capturados pelo fluxo antigo.
UPDATE public.assistant_conversations
SET customer_name = NULL
WHERE lower(trim(coalesce(customer_name, ''))) IN (
  'oi', 'olá', 'ola', 'qual', 'quero', 'tem', 'tamanho', 'produto', 'pedido',
  'frete', 'desconto', 'promoção', 'promocao', 'compra', 'comprar', 'ver', 'teste'
);

UPDATE public.assistant_messages AS m
SET is_test = c.is_test
FROM public.assistant_conversations AS c
WHERE c.id = m.conversation_id
  AND m.is_test IS DISTINCT FROM c.is_test;

UPDATE public.assistant_events AS e
SET is_test = c.is_test
FROM public.assistant_conversations AS c
WHERE c.workspace_id = e.workspace_id
  AND c.session_key = e.atk
  AND e.is_test IS DISTINCT FROM c.is_test;

-- Probes históricos do endpoint foram criados sem conversation correspondente.
UPDATE public.assistant_events
SET is_test = true
WHERE lower(atk) ~ '^testsession_'
   OR upper(coalesce(order_code, '')) LIKE 'TESTE-QA-%';

UPDATE public.assistant_attributions AS a
SET
  is_test = c.is_test,
  surface = coalesce(a.surface, c.surface)
FROM public.assistant_conversations AS c
WHERE c.workspace_id = a.workspace_id
  AND c.session_key = a.atk;

UPDATE public.assistant_attributions
SET is_test = true
WHERE lower(coalesce(atk, '')) ~ '^testsession_'
   OR upper(coalesce(order_code, '')) LIKE 'TESTE-QA-%';

-- Registros antigos guardaram o token da URL na coluna order_code.
UPDATE public.assistant_events
SET
  order_token = order_code,
  order_code = NULL
WHERE event_type = 'order_placed'
  AND order_token IS NULL
  AND order_code ~ '^[A-Za-z0-9_-]{24,64}$';

UPDATE public.assistant_attributions
SET
  order_token = order_code,
  order_code = NULL
WHERE atk IS NOT NULL
  AND order_token IS NULL
  AND order_code ~ '^[A-Za-z0-9_-]{24,64}$';

CREATE INDEX IF NOT EXISTS assistant_conversations_customer_time
  ON public.assistant_conversations (workspace_id, created_at DESC)
  WHERE is_test = false;

CREATE INDEX IF NOT EXISTS assistant_messages_customer_time
  ON public.assistant_messages (workspace_id, created_at DESC)
  WHERE is_test = false;

CREATE INDEX IF NOT EXISTS assistant_events_customer_time
  ON public.assistant_events (workspace_id, occurred_at DESC)
  WHERE is_test = false;

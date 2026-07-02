-- Migration 126: Assistente de vendas na loja (widget de chat na PDP)
--
-- Vendedor virtual que conversa com clientes na loja usando LLM (OpenRouter)
-- com ferramentas SOMENTE-LEITURA de catálogo. Nunca acessa pedidos, clientes
-- ou tokens. Histórico da conversa fica no servidor (o cliente só envia a
-- própria mensagem — não consegue forjar mensagens do assistente/system prompt).

-- ============================================
-- 1. Configuração por workspace (gate por produto)
-- ============================================
CREATE TABLE IF NOT EXISTS assistant_settings (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  -- IDs de produto VNDA onde o widget aparece. Vazio = nenhum. ['*'] = todas as PDPs.
  product_ids TEXT[] NOT NULL DEFAULT '{}',
  -- Modelo OpenRouter (override do default do servidor)
  model TEXT,
  title TEXT NOT NULL DEFAULT 'Assistente Bulking',
  welcome_message TEXT NOT NULL DEFAULT 'Fala! Sou o assistente da loja. Posso te ajudar com tamanho, tecido, disponibilidade e recomendações. O que você precisa?',
  -- Chips de sugestão exibidos no início da conversa
  suggestions JSONB NOT NULL DEFAULT '["Qual tamanho ideal pra mim?", "Esse tecido é dry ou algodão?", "Me recomenda produtos parecidos"]'::jsonb,
  -- Texto livre sobre a loja (trocas, frete, pagamento) usado pela tool informacoes_da_loja.
  -- Editável no dashboard — o modelo NUNCA inventa política que não esteja aqui.
  store_info TEXT NOT NULL DEFAULT '',
  -- Limites de custo/abuso
  max_messages_per_session INT NOT NULL DEFAULT 30,
  daily_message_cap INT NOT NULL DEFAULT 1500,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE assistant_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view assistant_settings" ON assistant_settings
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admins manage assistant_settings" ON assistant_settings
  FOR ALL USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- ============================================
-- 2. Conversas (sessão do widget)
-- ============================================
CREATE TABLE IF NOT EXISTS assistant_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Token de sessão gerado no servidor (não adivinhável); o widget guarda em sessionStorage
  session_key TEXT NOT NULL,
  product_id TEXT,
  page_url TEXT,
  -- IP nunca armazenado em claro (hash com salt) — só para rate limit/abuso
  ip_hash TEXT,
  user_agent TEXT,
  message_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, session_key)
);

CREATE INDEX IF NOT EXISTS idx_assistant_conversations_ws_last
  ON assistant_conversations (workspace_id, last_message_at DESC);

ALTER TABLE assistant_conversations ENABLE ROW LEVEL SECURITY;

-- Leitura pelo dashboard (QA das conversas antes de expandir p/ mais produtos).
-- Escrita apenas via service role (rotas do servidor).
CREATE POLICY "Members view assistant_conversations" ON assistant_conversations
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- ============================================
-- 3. Mensagens (transcrição + telemetria de tools)
-- ============================================
CREATE TABLE IF NOT EXISTS assistant_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- 'user' | 'assistant' são o histórico replayado ao LLM.
  -- 'tool' é só telemetria (JSON {name, input, ok}) — nunca replayado.
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assistant_messages_conv
  ON assistant_messages (conversation_id, id);
CREATE INDEX IF NOT EXISTS idx_assistant_messages_ws_created
  ON assistant_messages (workspace_id, created_at DESC);

ALTER TABLE assistant_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view assistant_messages" ON assistant_messages
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- Migration 135: Financeiro próprio (migração SenseBoard) — núcleo de dados
--
-- SDD: docs/senseboard-migracao-sdd.md. Substitui o SaaS SenseBoard.
-- Tudo gira em torno de fin_entries (lançamentos); DRE/DFC são agregações.
-- Semântica comprovada na origem: DRE usa data de COMPETÊNCIA; DFC usa caixa
-- (pagamento/vencimento); transferências entre contas são neutras nos
-- relatórios; depreciação (gerada do imobilizado) entra na DRE e NUNCA no DFC.
--
-- Decisão vs. SDD §3: categoria/subcategoria ficam como TEXT na classificação
-- (a árvore é fixa — 13 categorias-raiz — e o mapeamento categoria→linha de
-- DRE/seção de DFC mora no motor de relatórios em código, não no banco).
--
-- Aplicar manualmente no Supabase (padrão do projeto).

-- ============================================================
-- 1. Parceiros (clientes/fornecedores) — ~2.1k na origem
-- ============================================================
CREATE TABLE IF NOT EXISTS public.fin_partners (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (char_length(name) <= 200),
  cpf_cnpj      TEXT CHECK (char_length(cpf_cnpj) <= 20),
  contact       TEXT CHECK (char_length(contact) <= 200),
  address       TEXT CHECK (char_length(address) <= 300),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

-- ============================================================
-- 2. Contas bancárias (11 na origem; sem saldo inicial — saldo
--    deriva 100% dos lançamentos, comprovado na origem)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.fin_bank_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code          TEXT NOT NULL CHECK (char_length(code) <= 30),   -- sigla (BK, MP BK…)
  bank_name     TEXT CHECK (char_length(bank_name) <= 100),
  agency        TEXT CHECK (char_length(agency) <= 20),
  account_number TEXT CHECK (char_length(account_number) <= 40),
  archived_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, code)
);

-- ============================================================
-- 3. Classificações — nó-folha da árvore Categoria>Subcategoria>Classificação
--    `path` = caminho completo exatamente como vem no export da origem
--    (chave natural; nomes de categoria/sub também contêm " - ").
-- ============================================================
CREATE TABLE IF NOT EXISTS public.fin_classifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  path           TEXT NOT NULL CHECK (char_length(path) <= 300),
  name           TEXT NOT NULL CHECK (char_length(name) <= 150),  -- folha
  category       TEXT NOT NULL CHECK (char_length(category) <= 100),
  subcategory    TEXT CHECK (char_length(subcategory) <= 150),
  flow           SMALLINT NOT NULL CHECK (flow IN (1, -1)),       -- +1 entrada / -1 saída
  is_transfer    BOOLEAN NOT NULL DEFAULT false,  -- transferência entre contas (neutra)
  is_depreciation BOOLEAN NOT NULL DEFAULT false, -- não-caixa (fora do DFC)
  is_active      BOOLEAN NOT NULL DEFAULT true,   -- existe no cadastro atual da origem
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, path)
);

-- De>Para: texto-livre de import → classificação oficial (69 na origem)
CREATE TABLE IF NOT EXISTS public.fin_classification_aliases (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  alias_text        TEXT NOT NULL CHECK (char_length(alias_text) <= 200),
  classification_id UUID NOT NULL REFERENCES fin_classifications(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, alias_text)
);

-- ============================================================
-- 4. Lotes de importação (auditoria/rollback)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.fin_import_batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source        TEXT NOT NULL DEFAULT 'senseboard',
  filename      TEXT,
  row_count     INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','done','failed','rolled_back')),
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 5. Lançamentos — 72.535 na carga inicial (competências 2020→2032)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.fin_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  doc_number        TEXT CHECK (char_length(doc_number) <= 100),
  description       TEXT CHECK (char_length(description) <= 500),
  observation       TEXT CHECK (char_length(observation) <= 1000),
  partner_id        UUID REFERENCES fin_partners(id),
  classification_id UUID NOT NULL REFERENCES fin_classifications(id),
  bank_account_id   UUID REFERENCES fin_bank_accounts(id),
  competence_date   DATE,                     -- DRE
  due_date          DATE,                     -- vencimento (DFC projetado)
  paid_at           DATE,                     -- pagamento efetivo (DFC realizado)
  amount            NUMERIC(14,2) NOT NULL CHECK (amount >= 0),  -- sempre positivo
  flow              SMALLINT NOT NULL CHECK (flow IN (1, -1)),   -- denormalizado p/ agregação
  -- accrual = provisão contábil (ex.: CMV mensal — pendente, sem conta):
  -- entra na DRE pela competência e NUNCA no DFC (paridade comprovada).
  kind              TEXT NOT NULL DEFAULT 'normal'
                    CHECK (kind IN ('normal','depreciation','transfer','accrual')),
  needs_review      BOOLEAN NOT NULL DEFAULT false,  -- "Não Classificado" da origem
  source            TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('senseboard','manual','import','vnda')),
  source_created_at TIMESTAMPTZ,              -- trilha de auditoria da origem
  source_created_by TEXT CHECK (char_length(source_created_by) <= 120),
  source_updated_at TIMESTAMPTZ,
  source_updated_by TEXT CHECK (char_length(source_updated_by) <= 120),
  import_batch_id   UUID REFERENCES fin_import_batches(id),
  deleted_at        TIMESTAMPTZ,              -- lixeira (recuperar lançamentos)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fin_entries_ws_competence
  ON public.fin_entries (workspace_id, competence_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS fin_entries_ws_due
  ON public.fin_entries (workspace_id, due_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS fin_entries_ws_paid
  ON public.fin_entries (workspace_id, paid_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS fin_entries_ws_classification
  ON public.fin_entries (workspace_id, classification_id);
CREATE INDEX IF NOT EXISTS fin_entries_ws_account
  ON public.fin_entries (workspace_id, bank_account_id);
CREATE INDEX IF NOT EXISTS fin_entries_batch
  ON public.fin_entries (import_batch_id);

-- ============================================================
-- 6. Parâmetros/metas da empresa (1 linha por workspace)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.fin_settings (
  workspace_id      UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  goals             JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {meta_receita_mensal, meta_mc_pct, meta_lucro_pct, meta_ebitda_pct}
  cash_planning     JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {pmr_dias, pmp_dias, distribuicao_pct}
  balance_reference JSONB NOT NULL DEFAULT '{}'::jsonb,  -- balanço de referência (v2)
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 7. RLS (padrão do projeto: membros leem; escrita via service role)
-- ============================================================
ALTER TABLE public.fin_partners               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fin_bank_accounts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fin_classifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fin_classification_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fin_import_batches         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fin_entries                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fin_settings               ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['fin_partners','fin_bank_accounts','fin_classifications',
                           'fin_classification_aliases','fin_import_batches',
                           'fin_entries','fin_settings']
  LOOP
    EXECUTE format(
      'CREATE POLICY "Members view %I" ON public.%I FOR SELECT USING (
         workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
       )', t, t);
  END LOOP;
END $$;

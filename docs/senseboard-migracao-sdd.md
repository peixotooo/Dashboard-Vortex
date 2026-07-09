# Migração SenseBoard → Dashboard Vortex — Software Design Document

Objetivo: replicar dentro do Dashboard Vortex as funcionalidades do SenseBoard (app.senseboard.com.br, SaaS de controladoria financeira da Sense Controladoria) que a Bulking usa, importar todo o histórico de dados e **cancelar a assinatura**.

Fonte deste documento: investigação guiada por navegador na conta real (sessão de Guilherme) em 08/07/2026, tela a tela, incluindo endpoints AJAX e fluxos de import/export.

---

## 1. Escopo pedido

Features obrigatórias (paridade completa, sem deixar funcionalidade de fora):

1. **Dashboard** (visão do período)
2. **DRE** expandido e simplificado (mensal e anual)
3. **DFC** (demonstrativo de fluxo de caixa, 4 visões)
4. **Lançamentos** (CRUD + import/export em massa)
5. **Configurações**: cadastros (parceiros/fornecedores, classificações, contas bancárias, parâmetros/metas etc.)
6. **Importação de todos os dados históricos**

---

## 2. Inventário completo do SenseBoard (o que existe hoje)

### 2.1 Arquitetura observada

- App server-rendered (PHP-style) com jQuery; cada módulo tem endpoint auxiliar `GET /{modulo}/ajax?data_inicio=&data_fim=&status_pgto=&filiais=` que retorna JSON.
- Exemplo real: `GET /dashboard/ajax?data_inicio=2026-07-01&data_fim=2026-07-31` → array de `{categoria_id, categoria_nome, subcategoria_id, subcategoria_nome, subcategoria_pai, subcategoria_soma}` (alimenta o gráfico de distribuição de gastos). Note o `subcategoria_pai`: a árvore de classificação tem 3 níveis.
- Export client-side: `gerar_xlsx.min.js` / `gerar_pdf.min.js` presentes em todas as páginas ("Gerar XLSX Completo" / "Gerar PDF Completo" no menu do usuário — exportam a tela atual).

### 2.2 Dashboard (`/dashboard`)

Filtros globais: **período** (data início/fim), **status de lançamento** ("Todos os lançamentos" — pagos e/ou pendentes), botão Filtrar.

Blocos:
- **DRE Resumido** do período (tabela $ e %): Receita de Vendas → (−) Deduções → (=) Receita líquida → (−) CPV → (=) Margem bruta → (−) Despesas Variáveis → (=) Margem de contribuição → (−) Gastos fixos → (=) Ebitda → (±) Receitas/Despesas financeiras → (=) Resultado operacional bruto → (−) Impostos s/ Lucro → (=) Resultado operacional líquido.
- Botão **"DRE Expandido"** → modal com a mesma DRE aberta em TODAS as classificações (subtotais por subcategoria + linhas ↳ por classificação).
- **4 medidores (gauge) meta × apurado**: Receitas de Vendas (meta R$ 164.098,90), Margem de Contribuição (meta 60%), Ebitda (meta 5%), Lucro Líquido (meta 4%).
- **Distribuição de gastos**: barras por classificação (dados do `/dashboard/ajax`).
- Cards: **Ponto de Equilíbrio Financeiro**, **Ponto de Equilíbrio Ideal**, **Total de saídas**.
- **DFC por dia** do período (linhas saldo/entrada/saída) com filtro por contas bancárias.
- **Saldo inicial / Saldo final do período vigente**.
- **Metas de crescimento**: MC 60%, Ebitda ideal 5%, Margem de lucro ideal 4%, Liquidez mínima do período.

### 2.3 Dashboard Dinâmico (`/dashboard_dinamico`)

Dashboard de widgets configuráveis pelo usuário ("Adicionar novo gráfico", busca por nome, exibir todos/somente, drag & drop). Widgets existentes na conta: Margem de Contribuição, Frete de Vendas, Faturamento Mensal, % Frete, Meta faturamento – Julho, Ebitda, Taxas Intermediadores, Lucratividade.

### 2.4 Lançamentos (`/lancamento`) — 72.535 registros

Tabela: Nº/Descrição · Parceiro · Vencimento · **Competência** · Movimentação (valor + badge da conta: BK, BKNG, MP BK, MBKNG…) · Tipo (**Entrada / Saída / Transferência entre contas (Entrada|Saída)** — transferências têm badge distinto e são **ignoradas nos relatórios**) · Classificação · **Pago** (toggle + data de pagamento) · Data de cadastro.

- **Cadastro** (`/lancamento/cadastrar/`): nº documento, data vencimento, data **competência**, conta bancária, parceiro (autocomplete, obrigatório), valor (obrigatório), data de pagamento, classificação (obrigatória — define o tipo entrada/saída), descrição, observação, toggle **"Gerar repetições (parcelas, recorrência)"**. Botões "Cadastrar e voltar" / "Cadastrar e novo".
- **Import em lote** (`/lancamento/cadastrar_lote`): planilha modelo `.xls/.xlsx`, máx. **40.000 linhas por importação**, validação tudo-ou-nada, **parceiros inexistentes são cadastrados automaticamente** (matching por nome exato, sensível a acento).
- **Export**: "Exportar lançamentos" → Excel, **respeita os filtros atuais**.
- **Ações em lote**: editar selecionados / excluir selecionados.
- Lixeira: **Recuperar Lançamentos** (`/recuperar_lancamentos`) e **Excluir registros** (`/excluir_registros`, exclusão em massa por critérios).

### 2.5 DFC (`/dfc*`) — "Ignorando transferências entre contas"

Filtros em todas as visões: contas bancárias (com **Seleções de Contas salvas**), ano, status de lançamento.

1. **DFC Dashboard** (`/dfc`): consolidado mês a mês (Recebíveis, Saídas, Liquidez mensal, Saldo acumulado + totais anuais); gráfico Fluxo de Caixa & Índice de Liquidez (entradas pagas/pendentes, saídas pagas/pendentes, liquidez, saldo acumulado pago/pendente); **Prazo médio de recebimento (17 dias) / pagamento (25 dias)**; DFC diário do ano; saldo inicial/final.
2. **DFC Resumido** (`/dfc/resumido`): DFC método direto por mês — Saldo Inicial → **Atividades Operacionais** ((+) Recebimento de Clientes, (−) Pagamento a fornecedores, (−) Despesas administrativas e comerciais, (=) Caixa Obtido) → **Atividades de Investimento** ((−) Compra de Ativo, (+) Dividendos e Venda de Ativos, (=) Caixa) → **Atividades de Financiamento** ((−) Pagamento Financiamento, (+) Integralização de Capital, (=) Caixa) → Saldo Final. Colunas: 12 meses (cada uma com toggle exibir/ocultar) + ACUM. + MÉDIA + %.
3. **DFC Expandido** (`/dfc/expandido`): mesma estrutura com cada linha aberta na árvore de classificações (ex.: Pagamento a fornecedores → Matéria prima → CMV-Embalagens/CMV-TECIDOS/CMV-Produtos Terceirizados; folha Adm × Prod/Oper com 13º, férias, FGTS, INSS, multa rescisória, salário; TI → internet/softwares/telefonia; propaganda → por canal; pró-labore por sócio; etc.). Tem botão "ocultar linhas zeradas".
4. **DFC Comparativo** (`/dfc/comparativo`): cada mês com colunas **Realizado × Previsto** + ACUM/MÉDIA/%. O previsto vem do "Planejamento de Caixa" nos Parâmetros da Empresa.
5. **Caixa Planejado** (`/planejamento_fluxo_caixa`): Planejado × Realizado com abas **Mensal / Diário / Relatórios**; checkboxes "Mostrar realizado/planejado/ocultar zeradas"; gráfico com séries previstas × realizadas; KPIs do mês: **Geração de caixa** (vs. previsto), **Entrada** (com contas a receber), **Saída** (pagas × não pagas).

### 2.6 DRE Anual (`/dre_anual*`)

Filtros: ano, status de lançamento.

1. **Resumido**: linhas da DRE gerencial (mesma régua do dashboard + Gasto com Pessoal Adm, Gasto com pessoal Prod/Oper, Despesas Operacionais discriminados, e no fim (−) Distribuição de Lucro → (=) Resultado pós distribuição de lucros). Colunas: 12 meses (toggle por mês) + ACUM. + MÉDIA + %.
2. **Expandido**: DRE aberta na árvore completa — Deduções → Comissões, Taxas Intermediador, Devolução/Cancelamento NF, Impostos (COFINS, ICMS, ICMS Difal, PIS, Simples Nacional); CPV → CMV/CPV, Custos Variáveis de Operação, Frete Compra; etc.
3. **Comparativo**: Realizado × Previsto por mês (previsto vem do "Planejamento financeiro (DRE Anual)" importado por planilha nos Parâmetros).

### 2.7 Indicadores Contábeis (`/indicadores`)

Balanço financeiro (Ativos: circulante/não circulante; Passivos: circulante/não circulante; PL com capital social, lucros acumulados) calculado do **Balanço de Referência** (ano-base 2022, cadastrado em Parâmetros) + lançamentos posteriores. Indicadores: Liquidez Corrente/Seca/Imediata/Geral, Capital de Giro Líquido, PMRE, PMRV, PMPC, Ciclo Financeiro, ROE, GAF, Evolução do PL anual.

### 2.8 Precificação (`/precificacao*`)

Simulações de preço por produto (custo hora, preço venda, markup, margem bruta, lucro líquido % e R$) + Centros de Custos/Departamentos produtivos (área %, folha, pessoas, hora/pessoa, outros, depreciação → **custo hora** por departamento). **Uso na conta: 2 simulações, última em mar/2024 — praticamente abandonado.**

### 2.9 Configurações

| Tela | Conteúdo | Volume |
|---|---|---|
| **Parceiros de negócios** (`/parceiro`) | nome, CPF/CNPJ, contato, endereço (quase tudo vazio — a maioria foi auto-criada por importação, há muitos nomes-hash de extrato) | **2.103** |
| **Classificações** (`/classificacao`) | nome + **Categoria** (fixa do sistema: Receita de Vendas, Deduções, CPV, Despesas Variáveis, Despesas Operacionais, Gasto com pessoal Adm/ProdOper, Despesas Financeiras, Receitas Financeiras, Investimentos, Impostos…) + **Subcategoria** (árvore fixa) + **Tipo** (Entrada/Saída/Transferência). Import/export nativos ("Exportar classificações"). | **65** |
| **De > Para de Classificações** (`/classificacao_personalizada`) | mapping texto-livre → classificação oficial, usado na importação; tem **"Agente de Sugestões"** (IA) e ações em lote | ~30+ |
| **Contas Bancárias** (`/conta_bancaria`) | sigla, banco, nº agência, nº conta (SÓ ISSO — **não há saldo inicial**: os saldos derivam 100% dos lançamentos). Suporta **"Seleções de Contas"** (grupos salvos p/ filtro). Contas: BK/BKNG (Itaú), C6, ITAU, MBKNG/MP BK/MP (Mercado Pago), NU, PAGME, PAYP, SANT | **11** |
| **Filiais e Unidades** | bloqueado no plano atual (não usado) | 0 |
| **Centro de Custos** | bloqueado no plano atual (não usado) | 0 |
| **Ativos Imobilizados** (`/imobilizado`) | descrição, identif. patrimônio, parceiro, data compra, valor aquisição, vida útil, valor residual, modelo | ~10 (equip. de silk) |
| **Parâmetros da empresa** (`/empresa_parametros`) | 7 abas: **Metas Primárias** (meta receita mensal R$; MC 60%; lucro ideal 4%; EBITDA ideal 5%) · **Ponto de Equilíbrio Ideal** · **Metas de Patrimônio Líquido** · **Balanço Patrimonial de Referência** (ano 2022 + todos os campos de balanço) · **Planejamento financeiro (DRE Anual)** (import de planilha de metas por classificação × mês; existe 1 de 2024, meta lucro R$ 1.217.473,34) · **Planejamento de Caixa (DFC)** (prazo médio recebimento 30d + distribuição % em 13 faixas "no mês…12 meses depois" — hoje 100% no mês seguinte; prazo médio pagamento 30d; cenários planejados; parâmetros por indicador) · **Projeções Automáticas** | — |
| **Usuários** (`/usuario`) | gestão de usuários da conta | — |

### 2.10 Fora de escopo de produto (não migrar)

- **Conteúdos** (tutoriais, Sense Academy, valuation) — material do fornecedor.
- **Filiais/Centro de Custos** — bloqueados/não usados.
- **Precificação** — abandonado desde mar/2024 (o Vortex já tem simulador/pricing próprio: `src/lib/financeiro/`, migration-080-pricing).
- **Dashboard Dinâmico** — nice-to-have; a v1 pode ficar sem (os 8 widgets da conta são todos deriváveis da DRE).

---

## 3. Modelo de dados proposto (Supabase)

Convenção: prefixo `fin_`, todas com `workspace_id` + RLS via `getWorkspaceContext` (REGRA do projeto — PR #199).

```sql
-- migration-135-financeiro-core.sql (proposta)

fin_categories        -- árvore FIXA de 3 níveis que define DRE e DFC (seed do sistema, espelha o SenseBoard)
  id, parent_id, name, kind,          -- kind: receita_venda|deducao|cpv|despesa_variavel|gasto_pessoal_adm|gasto_pessoal_oper|
                                      --       despesa_operacional|receita_financeira|despesa_financeira|imposto_lucro|
                                      --       investimento|financiamento|distribuicao_lucro|transferencia
  dre_section, dfc_section, sort      -- em qual linha da DRE / seção do DFC a categoria agrega

fin_classifications   -- as "classificações" do usuário (65 hoje)
  id, workspace_id, name, category_id, flow int2,  -- flow: +1 entrada, -1 saída, 0 transferência
  created_at, archived_at

fin_classification_aliases  -- De>Para (auto-classificação em imports)
  id, workspace_id, alias_text, classification_id

fin_bank_accounts
  id, workspace_id, code, bank_name, agency, account_number, archived_at

fin_bank_account_groups          -- "Seleções de Contas"
  id, workspace_id, name; + fin_bank_account_group_items(group_id, account_id)

fin_partners          -- parceiros/fornecedores/clientes (2.103)
  id, workspace_id, name (unique por workspace), cpf_cnpj, contact, address, created_at

fin_entries           -- lançamentos (72.535)
  id, workspace_id, doc_number, description, observation,
  partner_id, classification_id, bank_account_id,
  due_date date, competence_date date, paid_at date,     -- vencimento / competência / pagamento
  amount numeric(14,2),                                   -- sempre positivo; sinal vem da classificação
  is_paid bool, recurrence_group uuid,                    -- parcelas/recorrência agrupadas
  import_batch_id, created_at, deleted_at                 -- deleted_at = lixeira (recuperar lançamentos)

fin_import_batches    -- auditoria de importações (arquivo, contagem, status, erros)

fin_settings          -- parâmetros da empresa (1 linha por workspace, JSONB por bloco)
  goals jsonb          -- {meta_receita_mensal, meta_mc_pct, meta_lucro_pct, meta_ebitda_pct, liquidez_minima}
  balance_reference jsonb  -- {ano, ativos..., passivos..., pl...}
  cash_planning jsonb      -- {pmr_dias, pmp_dias, distribuicao_pct[13], cenarios}

fin_budget_lines      -- Planejamento financeiro (DRE previsto) por classificação × mês
  id, workspace_id, year, month, classification_id, amount

fin_fixed_assets      -- imobilizado (10 itens)
```

**Motor de relatórios — SEMÂNTICA COMPROVADA POR PARIDADE (37/37 números exatos vs. telas de 08/07/2026; ver `scripts/senseboard-parity.ts`):**

- **DRE**: agrega por **data de competência**; exclui transferências e lançamentos "Não Classificado" (`needs_review`); **inclui** depreciação e provisões (accrual).
- **DFC**: agrega por **caixa** — pago entra na data de pagamento, pendente entra no vencimento; só `kind='normal'` (exclui transferências, depreciação e provisões/accrual).
- **`kind='accrual'`** (descoberta da paridade): as provisões mensais de CMV que o Raphael lança ("CMV - JANEIRO 26" etc., pendente + sem conta + folha "Custo Mercadoria Vendida") entram na DRE pela competência e NUNCA no DFC. 42 linhas na carga.
- Saldo bancário = soma acumulada dos lançamentos pagos da conta (não existe saldo inicial cadastral — comprovado).

Implementar como funções SQL/views leves + endpoint `/api/financeiro/report?tipo=dre|dfc&nivel=resumido|expandido&...`.

---

## 4. Estratégia de extração dos dados (SenseBoard → Vortex)

Rotas de saída confirmadas na investigação:

| Dado | Rota | Observação |
|---|---|---|
| **Lançamentos (72.535)** | Botão "Exportar lançamentos" → Excel | Respeita filtros → exportar **por ano** (2023, 2024, 2025, 2026) para arquivos menores e conferíveis |
| **Classificações (65)** | "Exportar classificações" (menu Cadastrar/Importar da tela) | — |
| **Parceiros (2.103)** | Sem export dedicado → usar "Gerar XLSX Completo" na tela `/parceiro`, OU reconstruir dos próprios lançamentos (o nome vem em cada linha; CPF/CNPJ/contato estão vazios na quase totalidade) | — |
| **Contas bancárias (11)** | Manual (tabela pequena, já transcrita neste doc §2.9) | — |
| **De>Para (~30)** | "Gerar XLSX Completo" na tela `/classificacao_personalizada` | — |
| **Parâmetros/metas** | Manual (valores já transcritos: MC 60%, lucro 4%, EBITDA 5%, PMR 30d/100% mês seguinte, PMP 30d, balanço ref. 2022) | — |
| **Planejamento DRE 2024** | Tela permite baixar/ver o importado; baixo valor (ano encerrado) — decidir se importa | — |
| **Imobilizado (~10)** | Manual ou XLSX Completo da tela | — |
| **Relatórios de conferência** | "Gerar XLSX Completo" em DRE Anual (resumido+expandido) e DFC (resumido+expandido) de cada ano | Vira o **gabarito de paridade** (ver §6) |

Alternativa programática: os endpoints `/{modulo}/ajax` respondem JSON com cookie de sessão — dá para raspar com um script se o Excel se mostrar lossy. Primeira escolha é o export nativo (oficial e completo).

### 4.1 Resultado da Fase 0 — export executado em 2026-07-08 ✅

Arquivos em `output/senseboard-export/` (**gitignored** — dado financeiro não vai pro GitHub):

| Arquivo | Conteúdo |
|---|---|
| `lancamentos-completo-2026-07-08.xls.html` + `.csv` | **72.535/72.535 lançamentos** (export único, sem filtro — o endpoint `GET /lancamento/exportar` aceita os mesmos query params do filtro da listagem) |
| `classificacoes-2026-07-08.xls.html` + `.csv` | 65 classificações (colunas: Classificação, Categoria, Subcategoria, Tipo, **Bloqueado**, Data de Cadastro) |
| `de-para-classificacoes-2026-07-08.json` | 69 mapeamentos (capturado do DOM — não há endpoint de export) |
| `contas-bancarias-2026-07-08.json` | 11 contas |
| `convert_to_csv.py` | conversor/validador (os ".xls" são tabela HTML) |

O export de lançamentos tem **16 colunas**, incluindo trilha de auditoria: Número do Doc., Competência, Vencimento, Parceiro, Descrição, Movimentação, Data de pagamento, Conta bancária, Classificação, Observação, Centro de custo, Tipo, Cadastro, Usuário cadastro, Última edição, Usuário última edição. Risco §8 (export lossy) eliminado.

**Descobertas que mudam o importador:**

1. **A coluna Classificação traz o caminho completo** `Categoria - Subcategoria - Classificação` (2 ou 3 níveis). A árvore inteira vem embutida em cada linha — o join com o cadastro de classificações é por caminho, não por nome.
2. **Existe um 5º tipo: `Depreciação` (9.048 linhas)** — lançamentos não-caixa gerados automaticamente do imobilizado (ex.: "(21/60) Pistola de pressão"), classificação "Despesas Financeiras - Depreciação", sem conta bancária, agendados até 2032. Entram na DRE, ficam FORA do DFC. O motor precisa desse tratamento (e o cadastro de imobilizado do Vortex deve gerar essas parcelas).
3. **Tipos `Entrada/Saída - Não Classificado` (5.179 linhas)** = lançamentos importados aguardando revisão (badge ⓘ na UI). Têm classificação atribuída; é um status de confirmação — modelar como flag `needs_review`.
4. **Horizonte real dos dados**: competência de **2020 a 2032** (recorrências e depreciação lançadas no futuro). Vencimento: 224 linhas sem data.
5. Volumes de conferência: por vencimento — 2022: 100 · 2023: 39.736 · 2024: 14.344 · 2025: 8.381 · 2026: 5.194 · 2027–2032: 4.556 · sem data: 224. Pendentes (sem data pagamento): 2.843. Sem conta bancária: 10.829 (inclui depreciação). Parceiros distintos nos dados: 1.934.
6. **Export completo funciona** apesar de um 503 aparente no primeiro clique — o download de 68 MB veio. Não é preciso fatiar por ano.

Pendências da Fase 0 (fazer com o motor pronto, assinatura segue ativa no dual-run): gabaritos "Gerar XLSX Completo" de DRE Anual e DFC (resumido+expandido) por ano para o teste de paridade; parceiros serão derivados do arquivo mestre (CPF/CNPJ/contato vazios no SenseBoard).

**Operação atual**: Raphael (financeiro) opera o SenseBoard **diariamente** — o importador incremental e o cutover precisam do buy-in e treinamento dele.

**Importador**: `scripts/import-senseboard.ts` lendo os XLSX → upsert em `fin_partners` (por nome), `fin_classifications` (por nome), `fin_entries`. Guardar `import_batch_id` para rollback. Validar: contagem por ano, soma de valores por classificação × mês × status **batendo com o gabarito** antes de ativar telas.

---

## 5. Design do módulo no Vortex

Novo item de navegação **"Financeiro"** (workspace Bulking) com sub-rotas:

```
/financeiro                      → Dashboard (período): DRE resumida + modal expandida, gauges meta×apurado,
                                    distribuição de gastos, PE financeiro/ideal, DFC diário, saldos, metas
/financeiro/lancamentos          → tabela (filtros: período, conta(s), status, classificação, parceiro, busca),
                                    toggle pago inline, ações em lote, lixeira
/financeiro/lancamentos/novo     → form + recorrência/parcelas
/financeiro/lancamentos/importar → upload XLSX (modelo próprio compatível com o do SenseBoard), preview, validação
/financeiro/dfc                  → visão anual: consolidado mensal, resumido, expandido, comparativo, diário
/financeiro/dre                  → visão anual: resumido, expandido, comparativo (colunas-mês com toggle, ACUM/MÉDIA/%)
/financeiro/config               → classificações (+de>para), contas (+seleções), parceiros, metas/parâmetros, imobilizado
```

Decisões de paridade:

- **Tem paridade 1:1**: dashboard, DRE (2 níveis + anual 3 visões), DFC (4 visões + diário), lançamentos (CRUD, import 40k+, export, lote, lixeira, recorrência), classificações + de>para, contas + seleções, parceiros, metas, planejamento de caixa (previsto simples por prazos/percentuais), balanço de referência + indicadores contábeis.
- **Ganhos sobre o SenseBoard** (baratos no nosso stack): lançamento automático de vendas VNDA (webhook de pedidos que já temos) e conciliação com relatórios Mercado Pago/extratos OFX — hoje tudo entra no SenseBoard por planilha/manual; MER e visão de marketing integradas (já temos `_finance-cross.ts`).
- **v2 (não bloquear cutover)**: Dashboard Dinâmico de widgets, Projeções Automáticas, Indicadores Contábeis completos (exigem balanço de referência — portar os valores de 2022), Caixa Planejado diário.
- **Não migrar**: Precificação (temos pricing próprio), Filiais, Centro de Custos, Conteúdos.

UI: respeitar [[feedback_contrast_color_combos]] (nada de fundo claro + texto claro) e [[feedback_ui_foolproof_visible]] (tudo visível, nada escondido).

---

## 6. Plano de migração / cutover

**Fase 0 — Congelar gabarito (1 dia)**
Exportar do SenseBoard: lançamentos por ano, classificações, de>para, XLSX Completo de DRE/DFC resumido+expandido por ano (2023–2026), parceiros. Guardar em `output/senseboard-export/` (fora do git se sensível).

**Fase 1 — Fundação (migrations + import)** — ✅ código pronto em 2026-07-08
- `supabase/migration-135-financeiro-core.sql` — fin_partners, fin_bank_accounts, fin_classifications (+aliases), fin_import_batches, fin_entries, fin_settings, RLS padrão. **Aplicar manualmente no Supabase.**
- `scripts/senseboard-lib.ts` — parsing compartilhado (caminho por longest-prefix das 13 categorias; derivação de flow/kind/needs_review).
- `scripts/import-senseboard.ts` — dry-run validado: 72.535 lançamentos (61.316 normal / 9.048 depreciation / 2.129 transfer / 42 accrual), 111 classificações (59 ativas), 1.934 parceiros, 11 contas, 69 aliases. `--apply` faz full-refresh da fonte 'senseboard' (idempotente p/ re-import semanal).
- `scripts/senseboard-parity.ts` — `--csv` 🎯 **PARIDADE TOTAL 37/37** (DRE receita jan–jul + deduções jan–jun; DFC entradas/saídas 12 meses + totais anuais). `--db` valida a importação após aplicar a migration.

Sequência de ativação: aplicar migration-135 → `npx tsx scripts/import-senseboard.ts --apply` → `npx tsx scripts/senseboard-parity.ts --db` (precisa dar 🎯).

**Fase 2 — Telas core** — ✅ NO AR em 2026-07-08 (commit 5238cff3), módulo **`/controladoria`** (grupo Financeiro da sidebar; `/financeiro` já era da Curva ABC):
- `src/lib/controladoria/engine.ts` — motor DRE/DFC/dashboard (smoke `scripts/_controladoria-smoke.ts` 10/10 contra o banco, incl. seções do DFC resumido e saldo inicial de julho idênticos às telas SenseBoard).
- APIs `/api/controladoria/{report,lancamentos,lancamentos/[id],meta}` (getWorkspaceContext + admin client).
- Telas: `/controladoria` (dashboard do período: metas×apurado, DRE, distribuição de gastos, saldos), `/controladoria/lancamentos` (filtros, CRUD, toggle pago, lixeira, export CSV), `/controladoria/dre` e `/dfc` (anuais, resumido/expandido, filtro pagos/pendentes), `/controladoria/config` (metas semeadas: MC 60% / Ebitda 5% / Lucro 4%; classificações; contas).
- Mapeamento DFC-resumido derivado dos dados e validado: fornecedores = CPV + Desp. Operacionais; adm/comerciais = Variáveis + Deduções + Pessoal + Impostos s/ Lucro; investimento = Imobilizado + Investimentos; financiamento = Despesas/Receitas Financeiras.

Fora da v1 (documentado, não bloqueia dual-run): import de planilha in-app (usar `scripts/import-senseboard.ts`), recorrência/parcelas no form, comparativo Realizado×Previsto, Caixa Planejado diário, filtro por conta bancária nas visões anuais (o motor já aceita `accounts=`).

**Fase 3 — Dual-run (1 ciclo mensal completo)**
Time financeiro continua operando o SenseBoard; a cada semana re-importamos o delta (export filtrado por data de cadastro) e comparamos os relatórios do mês corrente. Critério de saída: 1 fechamento mensal inteiro com paridade e o time usando o Vortex para consulta.

**Fase 4 — Cutover**
Operação passa a lançar SÓ no Vortex (import de planilha + lançamento manual + automações VNDA/MP). Export final completo do SenseBoard como snapshot de arquivo morto. **Cancelar assinatura.**

---

## 7. Perguntas abertas

1. **Processo operacional hoje**: quem lança no SenseBoard e como (a Caroline aparece como autora do planejamento)? Entram extratos por planilha com que frequência? Isso define o formato do importador recorrente e as automações da Fase 4.
2. Os anos anteriores a 2023 existem no SenseBoard? O filtro de ano mostrava 2026; conferir o range completo do dropdown na hora do export (o total de 72,5k lançamentos sugere histórico desde ~2023).
3. Vale portar o **Planejamento financeiro (DRE previsto)** de 2024, ou começamos planejamento novo no Vortex? (Recomendação: não portar; criar previsto 2026+.)
4. Indicadores Contábeis: portar o balanço de referência 2022 na v1 ou deixar para v2? (Recomendação: v2 — ninguém opera por eles no dia a dia; dashboard/DRE/DFC são o uso real.)
5. Multiusuário: quantos usuários ativos existem em `/usuario` e quais permissões precisam ser replicadas (o Vortex já tem membership por workspace)?

---

## 8. Riscos

- **Qualidade dos parceiros**: 2.103 nomes com muitos hashes de extrato → importar como estão (paridade primeiro), higienizar depois com o próprio de>para/IA.
- **Semântica de datas**: competência × vencimento × pagamento precisam ser preservadas exatamente; qualquer confusão distorce DRE vs DFC (teste de paridade pega).
- **Transferências entre contas**: têm que ser neutras em DRE/DFC mas visíveis em extrato de conta — replicar o flag/tipo do SenseBoard.
- **Export nativo com colunas a menos**: validar na Fase 0 se o Excel de lançamentos traz TODAS as colunas (competência, conta, status, datas). Se faltar algo, fallback nos endpoints `/ajax`.

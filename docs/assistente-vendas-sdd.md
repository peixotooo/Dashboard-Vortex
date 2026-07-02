# Assistente de Vendas na Loja — SDD

Vendedor virtual com IA no site da Bulking (widget de chat na PDP). Ajuda o
cliente a escolher **tamanho**, entender **tecido/composição**, checar
**disponibilidade** e recebe **recomendações** por cor, modelagem (oversized)
e tecido (dry/algodão). Inspiração: agentic commerce (DigitalGenius).

**Piloto:** habilitado em UM produto. Validou → expande a lista (ou `*` = todas
as PDPs) pelo dashboard.

## Arquitetura

```
Loja (VNDA)                      Vercel (dash.bulking.com.br)              APIs
┌──────────────┐   POST /api/assistant/chat   ┌──────────────────┐
│ shelves.js   │ ───────────────────────────► │ harness (loop    │ ──► OpenRouter
│  └ assistant │   {key, session, message}    │ tool-calling)    │     (LLM)
│    .js       │ ◄─────────────────────────── │  ├ buscar_produtos ──► shelf_products
│ (widget UI)  │   {reply, products[]}        │  ├ detalhes_produto ─► VNDA (live)
└──────────────┘                              │  ├ guia_de_tamanhos   (estático)
                                              │  └ informacoes_da_loja (settings)
                                              └──────────────────┘
```

- **LLM:** OpenRouter via `callLLM` (`src/lib/agent/llm-provider.ts`), modelo
  padrão `anthropic/claude-haiku-4.5` (override: `assistant_settings.model` ou
  env `ASSISTANT_MODEL`). Sem streaming de propósito: a resposta inteira passa
  pelos guardrails antes de ir ao cliente.
- **Catálogo:** busca no espelho `shelf_products` (rápido, tem tags/ficha-técnica);
  disponibilidade por tamanho ao vivo na VNDA (`GET /products/{id}` → variants).
- **Histórico no servidor** (`assistant_conversations`/`assistant_messages`):
  o navegador só envia a mensagem nova + session token. Impossível forjar
  system prompt/mensagens do assistente pelo cliente.

## Segurança (decisões de projeto)

| Risco | Defesa |
|---|---|
| Vazamento de token/segredo | LLM nunca vê segredo algum; tools retornam só dados públicos de vitrine; sanitizador de saída redige padrões de chave (defesa em profundidade) |
| Acesso a pedidos/clientes | Não existe tool para isso — whitelist fechada de 4 tools somente-leitura (`src/lib/assistant/tools.ts`) |
| Quantidade de estoque | Descartada na camada de dados (`catalog.ts`): o modelo só recebe boolean disponível/esgotado |
| Prompt injection | Histórico server-side + prompt endurecido + tool results tratados como dados + pior caso limitado pela arquitetura (não há capability perigosa) |
| Custo/DoS | Rate limit por IP (8/min), teto por conversa (30 msgs), **cap diário por workspace (1500 msgs)** — ataque distribuído para no cap |
| PII nos logs | CPF/cartão são scrubbed antes de persistir; IP só como hash com salt; aviso no widget "não compartilhe dados pessoais" |
| Alucinação de política/desconto | Modelo proibido de inventar; políticas só via `assistant_settings.store_info` (editável no dashboard); composição só da tag `ficha-tecnica` |
| Widget quebrar a loja | Tudo em try/catch, falha = widget não aparece; carregado async pelo shelves.js |

## Arquivos

- `supabase/migration-126-store-assistant.sql` — **aplicar manualmente** (3 tabelas)
- `src/lib/assistant/` — `harness.ts` (loop), `tools.ts` (whitelist), `catalog.ts`
  (dados sanitizados), `prompt.ts`, `guardrails.ts`, `rate-limit.ts`, `settings.ts`, `types.ts`
- `src/app/api/assistant/chat/route.ts` — POST público (key = `shelf_api_keys`, mesma do shelves.js)
- `src/app/api/assistant/config/route.ts` — GET público (widget decide se aparece)
- `src/app/api/assistant/admin/route.ts` — settings + conversas (autenticado)
- `src/app/(dashboard)/assistente/page.tsx` — página do dashboard
- `public/assistant.js` — widget (carregado pelo `public/shelves.js` em PDPs)
- `scripts/assistant-setup.ts` — habilitar piloto

## Rollout

1. Aplicar `migration-126-store-assistant.sql` no Supabase (SQL editor).
2. Conferir env `OPENROUTER_API_KEY` na Vercel (já existe local).
3. Deploy (shelves.js já carrega o assistant.js — dormente até habilitar).
4. `npx tsx scripts/assistant-setup.ts --product 1271` (BASIC PRETA, piloto).
5. Testar na PDP: tamanho, tecido, disponibilidade, recomendação, injection básica.
6. Acompanhar conversas em `/assistente` no dashboard; ajustar `store_info`.
7. Expandir: adicionar IDs em "Produtos liberados" (ou `*`) no dashboard.

**Rollback:** `npx tsx scripts/assistant-setup.ts --disable` (propaga em ~2min)
ou switch na página `/assistente`.

## Limites conhecidos / v2

- Rate limit por IP é in-memory por instância serverless (best-effort) — os
  tetos duros são por sessão e diário, no banco. Se precisar de rate limit
  distribuído, mover para o worker da DigitalOcean ou Upstash.
- Guia de medidas: tabela oversized padrão (P–XGG) hardcoded; medidas por
  produto viriam de um cadastro futuro.
- Sem busca semântica (embeddings) — ranking por token no nome + filtros.
  Catálogo ~600 itens não precisa ainda.
- Handoff para atendimento humano (WhatsApp) é só orientação por texto na v1.

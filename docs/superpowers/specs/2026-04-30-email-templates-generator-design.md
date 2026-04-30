# Email Templates Generator — Design Spec

> Status: Design approved · 2026-04-30
> Owner: Guilherme Peixoto · Bulking
> Workflow: brainstorming → **writing-plans (next)** → executing-plans

---

## 1. Visão & Escopo

Cron diário (06:00 BRT) que gera **3 sugestões de email marketing** por workspace por dia, cruzando dados de **VNDA × GA4 × CRM**, e entrega HTML pronto para copiar+colar em sistema externo de email marketing (o dashboard NÃO dispara emails — apenas gera).

A feature vive dentro do módulo CRM em `/(dashboard)/crm/email-templates` e segue o padrão arquitetural já validado em `src/lib/coupons/*`.

### Os 3 slots fixos

| Slot | Tipo | Segmento RFM alvo | Cupom? | Countdown? |
|------|------|-------------------|--------|------------|
| **1** | Best-seller (top GA4 7d, estoque ≥ 5) | Champions + Loyal | Não | Não |
| **2** | Sem-giro (estoque alto, vendas baixas 30d) | Loyal + Potential | **Sim** (10–15% off, 48h, default 10%) | **Sim** (48h) |
| **3** | Novidade (criado ≤ 14d) | New + Champions | Não | Não |

### Fluxo do usuário

1. Abre `/crm/email-templates` → vê 3 sugestões do dia + tab de histórico (30 dias).
2. Cada card mostra: produto, segmento alvo + estimativa de tamanho, **3 horários ótimos de disparo** (de GA4 hourly), cupom (slot 2), preview do email.
3. Botão **"Copiar HTML"** copia o HTML pro clipboard, marca `selected_at` e incrementa `selected_count` (não destrutivo, copiável N vezes).
4. Botão **"Marcar como disparado"** abre modal pedindo `sent_at` (default = now) e opcionalmente qual dos 3 horários sugeridos foi usado (`sent_hour_chosen`).
5. Sugestões coexistem — usuário pode disparar as 3.
6. Após 24h viram histórico (não somem ao serem usadas).

### Estados de uma sugestão

| Estado | Quando | Ação que dispara |
|--------|--------|-------------------|
| `pending` | Recém-criada pelo cron | (default) |
| `selected` | Usuário clicou "Copiar HTML" pela primeira vez | Marca `selected_at`, incrementa `selected_count` |
| `sent` | Usuário marcou disparo manual | Registra `sent_at` + `sent_hour_chosen` |

### Out of MVP (explícito)

- **Segmentação por atributo de produto comprado** ("camiseta preta") — schema já preparado, vira **v2**
- Bandit / aprendizado por slot — depende de feedback que o sistema não tem (disparo é externo) — **v3**
- Tipos extras (win-back, carrinho-quente, cross-sell) — **v2/v3**
- Disparo direto via Resend / integração com email-mkt — **fora de escopo permanente**
- Firecrawl scraping de imagens — **descartado** (VNDA API basta)
- Push notification do "3 sugestões prontas" — **v2** (trivial com Resend)

---

## 2. Arquitetura

Espelha o padrão de `src/lib/coupons/*` — cada arquivo focado, ~150–300 linhas, responsabilidades isoladas e bem testáveis.

```
src/lib/email-templates/
  orchestrator.ts       # entrypoint cron — gera 3 sugestões/workspace
  picker.ts             # decide produto por slot (cruza VNDA × GA4)
  segments.ts           # resolve segmento RFM por slot (extensível)
  copy.ts               # generateCopy(slot, product, segment) → {subject,headline,lead,cta}
                        #   impl: templateBased (default) | llmBased (hook futuro)
  hours.ts              # top-3 horários ótimos via GA4 hourly (14d)
  coupon.ts             # cria cupom no VNDA via createFullCoupon() — SLOT 2 only
  countdown.ts          # gera URL pública /api/email-countdown.png?expires=...
  audit.ts              # log de geração + transições de estado
  settings.ts           # config por workspace
  types.ts              # EmailSuggestion, Slot, Segment, etc

src/lib/email-templates/templates/
  shared.ts             # header/footer/tokens inline (Bulking: preto/verde/Kanit)
  bestseller.ts         # render(slot=1, ctx) → HTML email-safe
  slowmoving.ts         # render(slot=2, ctx) → HTML com countdown + cupom
  newarrival.ts         # render(slot=3, ctx) → HTML

src/app/api/cron/email-templates-refresh/route.ts   # 06:00 BRT diário
src/app/api/email-countdown.png/route.ts            # PNG dinâmico (Next OG/satori)
src/app/api/crm/email-templates/
  active/route.ts       # GET sugestões do dia
  history/route.ts      # GET 30d com filtros de estado
  [id]/select/route.ts  # POST → marca selected_at (idempotente)
  [id]/sent/route.ts    # POST → registra sent_at + horário escolhido
  [id]/route.ts         # GET 1 sugestão completa
  settings/route.ts     # GET/PUT config workspace

src/app/(dashboard)/crm/email-templates/
  page.tsx              # lista do dia + histórico (tabs)
  [id]/preview/page.tsx # preview iframe + ações
  components/
    suggestion-card.tsx
    sent-modal.tsx
    history-table.tsx
    settings-drawer.tsx

supabase/migrations/
  XXX_email_templates.sql
```

### Princípios de responsabilidade

- **`orchestrator.ts` é o único lugar com sequência:** para cada slot → `picker` → `segments` → (slot 2) `coupon` → `copy` → `hours` → `template.render()` → grava no DB.
- Demais libs são puras (input → output). Nada de side-effects fora do que o nome diz.
- **`templates/*` retornam `string` HTML email-safe** (tabelas inline, max 600px, todos estilos inline em cada elemento, dark-safe).
- **`coupon.ts`** envolve `createFullCoupon` de `src/lib/coupons/vnda-coupons.ts` — não duplica lógica.
- **`countdown.ts`** retorna URL pública assinada (HMAC) com `expires` no query string — a rota `/api/email-countdown.png` valida assinatura, calcula tempo restante, renderiza PNG via `@vercel/og`.

---

## 3. Schema do Banco (Supabase)

### `email_template_settings` (1 linha por workspace)

```sql
create table email_template_settings (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  enabled boolean not null default false,
  -- janelas
  bestseller_lookback_days int not null default 7,
  slowmoving_lookback_days int not null default 30,
  newarrival_lookback_days int not null default 14,
  -- thresholds
  min_stock_bestseller int not null default 5,
  slowmoving_max_sales int not null default 3,
  -- cupom slot 2
  slowmoving_discount_percent numeric not null default 10,  -- 5..20 enforced em settings.ts
  slowmoving_coupon_validity_hours int not null default 48,
  -- copy
  copy_provider text not null default 'template'
    check (copy_provider in ('template','llm')),
  llm_agent_slug text,                      -- 'copywriting' | 'email-sequence' (quando llm)
  -- bookkeeping
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### `email_template_suggestions` (3 linhas/workspace/dia)

```sql
create table email_template_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  generated_for_date date not null,            -- 2026-04-30
  slot smallint not null check (slot in (1,2,3)),

  -- produto escolhido
  vnda_product_id text not null,
  product_snapshot jsonb not null,             -- name, price, image_url, url, description (frozen)

  -- segmento alvo
  target_segment_type text not null            -- 'rfm' (mvp) | 'attribute' (v2)
    check (target_segment_type in ('rfm','attribute')),
  target_segment_payload jsonb not null,       -- {rfm_classes:['champions','loyal']} | {tags:[...],...}

  -- copy
  copy jsonb not null,                         -- {subject, headline, lead, cta_text, cta_url}
  copy_provider text not null,                 -- snapshot do que foi usado
  rendered_html text not null,                 -- HTML final email-safe (frozen no momento da geração)

  -- horários sugeridos (top-3 GA4)
  recommended_hours int[] not null,            -- ex: [9, 14, 20]
  hours_score jsonb,                           -- ex: {9:0.034, 14:0.041, 20:0.045} pra debug

  -- cupom (slot 2 only)
  coupon_code text,                            -- ex: 'EMAIL-SLOWMOV-A7K2X'
  coupon_vnda_promotion_id bigint,
  coupon_vnda_coupon_id bigint,
  coupon_expires_at timestamptz,
  coupon_discount_percent numeric,

  -- estados
  status text not null default 'pending'
    check (status in ('pending','selected','sent')),
  selected_at timestamptz,                     -- quando user copiou HTML pela primeira vez
  selected_count int not null default 0,
  sent_at timestamptz,                         -- datetime real do disparo (manual)
  sent_hour_chosen int,                        -- qual dos recommended_hours foi usado (0..23)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(workspace_id, generated_for_date, slot)  -- 1 sugestão por slot por dia
);

create index on email_template_suggestions(workspace_id, generated_for_date desc);
create index on email_template_suggestions(workspace_id, status, generated_for_date desc);
```

### `email_template_audit` (event log)

```sql
create table email_template_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  suggestion_id uuid references email_template_suggestions(id) on delete cascade,
  event text not null,                          -- 'generated','skipped_no_product','copy_failed',
                                                -- 'coupon_created','coupon_failed','selected','sent'
  payload jsonb,                                -- contexto livre por evento
  created_at timestamptz not null default now()
);

create index on email_template_audit(workspace_id, created_at desc);
create index on email_template_audit(suggestion_id);
```

### Notas de design

- `product_snapshot` + `rendered_html` **frozen** no momento da geração — se VNDA mudar preço ao longo do dia, o HTML que o user copiou continua coerente.
- `target_segment_payload jsonb` é a porta para v2 "comprou camiseta preta" sem migration nova.
- `coupon_*` são nullable — só slot 2 usa.
- `unique(workspace_id, generated_for_date, slot)` torna o cron **idempotente** — re-rodar não duplica.
- Sem RLS aqui — endpoints vão por `api-auth.ts` (mesmo padrão de `/api/coupons/*`).

---

## 4. Algoritmos de Seleção

### `picker.ts` — escolhe 1 produto por slot

**Slot 1 — Best-seller**
```
input: workspace, lookback_days=7, min_stock=5
1. GA4 → top produtos por purchase_revenue (add_to_cart como tiebreaker) últimos 7d
2. VNDA → para cada candidato (top 30), verifica produto.disponivel + estoque ≥ 5
3. Filtra: produtos não usados como slot 1 nos últimos 7 dias (anti-repetição)
4. Retorna top 1
fallback: se nenhum candidato passa filtros → null (audit: 'skipped_no_product')
```

**Slot 2 — Sem-giro**
```
input: workspace, lookback_days=30, max_sales=3
1. VNDA → todos produtos com estoque > 10 e criados há ≥ 30d
2. GA4 → para cada candidato, soma purchases últimos 30d
3. Score = stock / (sales + 1)  → maior = mais "encalhado"
4. Filtra: não usados como slot 2 nos últimos 14 dias
5. Retorna top 1
fallback: → null
```

**Slot 3 — Novidade**
```
input: workspace, lookback_days=14
1. VNDA → produtos com created_at ≥ today - 14d AND disponivel AND estoque > 0
2. Ordena por mais recente
3. Filtra: não usado como slot 3 nos últimos 14 dias
4. Retorna top 1
fallback: → null (workspace nova/sem novidade não recebe slot 3)
```

**Critério "não usado":** consulta em `email_template_suggestions` por `workspace_id + slot + vnda_product_id` na janela. Anti-repetição barata, sem estado externo.

---

### `segments.ts` — segmento RFM por slot

| Slot | RFM target |
|------|-----------|
| 1 | `champions`, `loyal` |
| 2 | `loyal`, `potential` |
| 3 | `new`, `champions` |

```ts
interface ResolvedSegment {
  type: 'rfm' | 'attribute';
  payload: { rfm_classes?: string[]; ... };
  estimated_size: number;            // pra exibir "≈ 1.247 contatos" na UI
  display_label: string;             // "Champions + Loyal (top compradores)"
}
```

`estimated_size` vem de `count(*) where rfm_class = ANY(...)` no schema CRM existente. **Não exporta lista de emails** — disparo é externo, esse é só hint.

---

### `hours.ts` — top-3 horários ótimos (GA4 hourly)

```
input: workspace, lookback_days=14
1. GA4 hourly → 14d × 24h = 336 pontos: sessions, conversions
2. Agrega por hora-do-dia (0..23): sum(conversions) / sum(sessions) = conv_rate
3. Score = conv_rate, com pequeno boost para horas com volume estatísticamente significativo (≥30 sessões/hora-do-dia)
4. Pick top 3 com REGRA DE DISPERSÃO:
   - 1º: melhor hora geral
   - 2º: melhor hora distante ≥3h da 1ª
   - 3º: melhor hora distante ≥3h das duas anteriores
   - Garante manhã/tarde/noite (não 3 horas seguidas)
fallback: se GA4 indisponível → [9, 14, 20] (defaults brand-fit)
```

Output: `{ recommended_hours: [9,14,20], hours_score: {9:0.034, 14:0.041, 20:0.045} }`

---

### `copy.ts` — interface dual (provider pattern)

```ts
type CopyInput = {
  slot: 1 | 2 | 3;
  product: { name: string; price: number; old_price?: number; ... };
  segment: ResolvedSegment;
  coupon?: { code: string; discount_percent: number; expires_at: Date };
};

type CopyOutput = {
  subject: string;       // ex: "O mais vestido da semana."
  headline: string;
  lead: string;          // 2-3 frases, brand voice Bulking
  cta_text: string;      // "Vista o trabalho." | "Ver oferta." | "Conferir lançamento."
  cta_url: string;       // VNDA product URL
};

interface CopyProvider {
  generate(input: CopyInput): Promise<CopyOutput>;
}
```

**MVP — `templateBased`:** strings montadas por slot, com vocabulário do brandbook (usar: hustle, shape, vestir; evitar: barato, mega promo, guerreiro). Variação por dia-da-semana evita repetição literal.

**Hook — `llmBased`:** chama `team-agents` (`copywriting` ou `email-sequence`) via `llm-provider.ts` (OpenRouter), passando contexto + brandbook resumido. `email_template_settings.copy_provider` decide qual rola. **Fallback automático:** se LLM falha → cai pra `templateBased`.

---

## 5. HTML Email-Safe, Countdown e Cupom

### Regras transversais aos 3 templates

- Largura máxima **600px**, layout `<table role="presentation">` (não flex/grid).
- Estilos **inline** em cada elemento (`<style>` no head é ignorado por Outlook/Gmail desktop).
- Cores dos design tokens do brandbook: bg `#000`, accent `#49E472`, text `#FFFFFF`.
- Tipografia: `font-family: 'Kanit', Arial, Helvetica, sans-serif` (Kanit via Google Fonts `<link>` — fallback Arial pro Outlook).
- Imagens: URL VNDA direta com `width`/`height` explícitos + `alt` obrigatório (alt-text descritivo, sem hype).
- Dark-mode safe: `meta name="color-scheme" content="light dark"`.
- Mobile responsivo: `@media (max-width: 599px)` com fonts +2-4px e padding ajustado.
- Pre-header: `<div style="display:none;...">{preview}</div>` — primeira frase do lead.

### Estrutura comum (`shared.ts`)

```
[HEADER]   Logo BULKING centralizado (branco sobre preto), 60px altura
[HERO]     Imagem do produto (600×800 aspect, object-fit cover)
[BLOCO 1]  Headline (Kanit ExtraBold 32px, branco)
[BLOCO 2]  Lead (Inter 16px, #D9D9D9, line-height 1.5)
[BLOCO 3]  (slot 2 only) Cupom box + Countdown
[BLOCO 4]  CTA Primary (verde #49E472, texto preto, uppercase, 16px, padding 16x32)
[BLOCO 5]  Detalhes do produto (nome, preço, preço antigo riscado se houver)
[FOOTER]   "Respect the Hustle." | links institucionais | unsubscribe placeholder
```

### Especificidades por slot

**Slot 1 — Best-seller** (`bestseller.ts`)
- Badge no canto superior esquerdo da hero: "TOP 1 DA SEMANA" (verde sobre preto)
- Headline ex: "O mais vestido da semana."
- Sem cupom, sem countdown
- CTA: "Ver na loja"

**Slot 2 — Sem-giro** (`slowmoving.ts`)
- Badge: "ÚLTIMAS PEÇAS"
- **Bloco cupom:** caixa com border verde 2px, fundo `#0a0a0a`
  ```
  CUPOM EXCLUSIVO
  [    EMAIL-SLOWMOV-A7K2X    ]   ← código copiável, monospace
  10% off em [Nome do Produto]
  ```
- **Countdown** logo abaixo (PNG dinâmico)
- CTA: "Aproveitar agora"
- Headline brand-aware ex: "Última chance pra vestir essa." (NUNCA "MEGA PROMO!!!")

**Slot 3 — Novidade** (`newarrival.ts`)
- Badge: "ACABOU DE CHEGAR"
- Headline ex: "Nova fase, nova peça."
- Sem cupom, sem countdown
- CTA: "Conferir lançamento"

### Countdown timer (slot 2)

Abordagem: **PNG dinâmico self-hosted** via `@vercel/og` (Next 16 nativo).

**Rota:** `GET /api/email-countdown.png?expires=2026-05-02T15:00:00Z&sig=<hmac>`

Funcionamento:
1. `countdown.ts` gera URL com HMAC-SHA256 (`process.env.EMAIL_COUNTDOWN_SECRET`) sobre `expires`.
2. Cliente abre o email → GET nessa URL.
3. Rota valida assinatura → calcula `expires - now()` → renderiza PNG via `ImageResponse`.
4. PNG mostra: `48:00:00` (HH:MM:SS) em Kanit, verde `#49E472` sobre preto, **600×120**.
5. Se já expirou: PNG mostra "ENCERRADO" em cinza.
6. Headers: `Cache-Control: no-store, no-cache, must-revalidate`.
7. Rota **não autenticada** — precisa ser pública pra Gmail/Outlook puxarem.

### Cupom (slot 2)

```ts
import { createFullCoupon } from '@/lib/coupons/vnda-coupons';

// 1. Código gerado: EMAIL-SLOWMOV-{base32(5)}  ex: EMAIL-SLOWMOV-A7K2X
const code = `EMAIL-SLOWMOV-${randomBase32(5)}`;
const expires_at = addHours(new Date(), settings.slowmoving_coupon_validity_hours); // default 48h

// 2. Cria no VNDA (promotion + rule + coupon + bucket via createFullCoupon)
const result = await createFullCoupon(vndaConfig, {
  code,
  discount_percent: settings.slowmoving_discount_percent,
  expires_at,
  product_id: pickedProduct.vnda_id,
  // demais campos seguindo padrão coupons existente
});

// 3. Persiste IDs em email_template_suggestions:
//    coupon_code, coupon_vnda_promotion_id, coupon_vnda_coupon_id,
//    coupon_expires_at, coupon_discount_percent
```

**Idempotência:** o `unique(workspace_id, generated_for_date, slot)` impede duplicação. Se uma sugestão antiga já tem `coupon_vnda_*`, o re-run pula a criação.

**Falha do VNDA:** orchestrator faz log `coupon_failed` em `email_template_audit` e **não cria a sugestão slot 2 nesse dia** (melhor pular do que enviar email com cupom inválido).

---

## 6. UI, API, Cron, Observabilidade

### UI — `/(dashboard)/crm/email-templates/page.tsx`

**Layout:**

```
┌──────────────────────────────────────────────────────────────┐
│  Email Templates                              [⚙ Configurações]│
│  3 sugestões prontas pra hoje · 30/04/2026                    │
├──────────────────────────────────────────────────────────────┤
│  [ Hoje ]  [ Histórico ]                                      │
├──────────────────────────────────────────────────────────────┤
│  ┌─ Slot 1 · Best-seller ──────────────────────────────────┐  │
│  │ [img]  Camiseta Hustle Preta                  R$ 89,90  │  │
│  │        Champions + Loyal · ≈ 1.247 contatos             │  │
│  │        Horários sugeridos: 09:00 · 14:00 · 20:00        │  │
│  │        Status: pending · Copiado 0× · Não disparado     │  │
│  │        [Preview] [📋 Copiar HTML]  [✓ Marcar disparado] │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌─ Slot 2 · Sem-giro ─────────────────────────────────────┐  │
│  │ [img]  Jogger Bulking Cinza                   R$ 149,90 │  │
│  │        Loyal + Potential · ≈ 893 contatos               │  │
│  │        Horários sugeridos: 10:00 · 15:00 · 21:00        │  │
│  │        🎟 Cupom: EMAIL-SLOWMOV-A7K2X · 10% off · 48h     │  │
│  │        Status: selected · Copiado 2× · Não disparado    │  │
│  │        [Preview] [📋 Copiar HTML]  [✓ Marcar disparado] │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌─ Slot 3 · Novidade ─────────────────────────────────────┐  │
│  │  ... (idem)                                             │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**Componentes (shadcn já no projeto):**
- `<SuggestionCard>` — 1 por slot. Botões: "Preview" (abre `<Sheet>` com iframe `srcdoc=rendered_html`), "Copiar HTML" (Clipboard API → POST `/select`), "Marcar disparado" (abre `<SentModal>`).
- `<SentModal>` — datetime picker (default = now), select com 3 horários sugeridos pré-marcados ("usei o de 14:00"), texto livre opcional → POST `/sent`.
- `<HistoryTable>` — tabela 30d, filtros: estado (`pending|selected|sent`), slot, busca por produto. Cada linha tem ações "Ver HTML" (read-only) e "Marcar disparado" se ainda `pending|selected`.
- `<SettingsDrawer>` — gera/atualiza `email_template_settings`: enabled, lookbacks, thresholds, discount %, validity hours, copy provider (template/llm) + slug do agent.

**Empty states:**
- Sem GA4 → CTA "Conecte GA4 nas Configurações pra ativar"
- Sem VNDA → "Conecte VNDA"
- `enabled=false` → toggle "Ativar geração diária"
- Slot sem candidatos → placeholder "Sem produto qualificado pro slot X hoje" + razão do audit

### API contracts

```
GET    /api/crm/email-templates/active
       → { date: '2026-04-30', suggestions: EmailSuggestion[] }   (max 3)

GET    /api/crm/email-templates/history?days=30&status=&slot=
       → { suggestions: EmailSuggestion[], total: number }

GET    /api/crm/email-templates/[id]
       → EmailSuggestion (com rendered_html)

POST   /api/crm/email-templates/[id]/select
       → { ok: true, selected_at, selected_count }
       (idempotente — incrementa selected_count)

POST   /api/crm/email-templates/[id]/sent
       body: { sent_at?: ISO, hour_chosen?: 0..23 }
       → { ok: true, sent_at, sent_hour_chosen }

GET    /api/crm/email-templates/settings
PUT    /api/crm/email-templates/settings
       body: EmailTemplateSettings

GET    /api/email-countdown.png?expires=ISO&sig=HMAC
       → image/png 600×120 (no-cache)
       (rota pública, valida HMAC)

POST   /api/cron/email-templates-refresh
       (header: X-Cron-Secret)
       → { ok: true, generated: { workspace_id, slots_filled }[], skipped: [...] }
```

Auth segue `api-auth.ts` do projeto (mesmo padrão de `/api/coupons/*`).

### Cron schedule

`vercel.json` ganha entry:

```json
{
  "crons": [
    { "path": "/api/cron/email-templates-refresh", "schedule": "0 9 * * *" }
  ]
}
```

`0 9 * * *` UTC = **06:00 BRT**. Itera workspaces com `email_template_settings.enabled=true`. Para cada workspace: gera os 3 slots em paralelo (`Promise.allSettled` — falha em 1 não derruba os outros). Idempotente via `unique(workspace_id, generated_for_date, slot)`.

**Manual trigger:** botão "Regenerar agora" em `<SettingsDrawer>` (admin only) chama o mesmo endpoint cron com `X-Cron-Secret` injetado server-side.

### Observabilidade

- Toda transição grava em `email_template_audit` (`generated`, `coupon_created`, `coupon_failed`, `selected`, `sent`, `skipped_*`).
- Logs estruturados em `console.log` (Vercel Runtime Logs) com `{ workspace_id, slot, action, ms }`.
- UI exibe lista do audit das últimas 24h em collapsible "Diagnóstico" dentro do `<SettingsDrawer>` (visível sob feature flag `showAdminDiagnostics`).

### Variáveis de ambiente novas

```
EMAIL_COUNTDOWN_SECRET=<random 32 bytes>   # HMAC do PNG countdown
CRON_SECRET=<existente>                    # já usado por outros crons
# OPENROUTER_API_KEY já existe — usado quando copy_provider=llm
```

---

## 7. Decisões arquiteturais (ADR-style)

| # | Decisão | Razão |
|---|---------|-------|
| 1 | Espelhar padrão de `src/lib/coupons/*` | Time conhece, testes/separação validados, arquivos focados. Alternativas (módulo unificado, lib monolítica) atrasam ou criam débito |
| 2 | `target_segment_payload jsonb` | Permite v2 "camiseta preta" sem migration. Schema MVP já escala |
| 3 | `rendered_html` frozen no DB | Garante que copiar HTML horas depois sempre retorna o mesmo conteúdo, mesmo se VNDA mudar preço |
| 4 | PNG countdown via `@vercel/og` self-hosted | Controle visual (brandbook), zero custo extra, sem dep externa, Next 16 nativo |
| 5 | Cupom slot 2 reutiliza `createFullCoupon` | Não duplica lógica VNDA (promotion + rule + coupon + bucket). `coupon.ts` é só wrapper |
| 6 | Estado `selected` separado de `sent` | "Copiar HTML" não significa que o user disparou — métricas precisam dessa distinção |
| 7 | Sugestões coexistem (não somem ao escolher) | User pode disparar as 3 |
| 8 | Hook `llmBased` mas default `templateBased` | Custo-controlado no MVP; settings habilita LLM via OpenRouter (já no stack) usando agents `copywriting`/`email-sequence` existentes |
| 9 | Anti-repetição via consulta no próprio DB | Sem estado externo, barato, suficiente |
| 10 | Idempotência via `unique(workspace_id, date, slot)` | Re-rodar cron seguro; tentativas de retry no Vercel Cron não duplicam |

---

## 8. Plano de extensão (não-MVP, registrado para coerência)

- **v2 — segmentação por atributo:** novo `segments.ts` resolve `target_segment_type='attribute'` usando ordens VNDA × catálogo VNDA × tags/cor (ex: "comprou camiseta preta nos últimos 90d"). Schema já suporta. UI ganha builder de segmento.
- **v2 — push notification "3 sugestões prontas":** Resend (já no projeto) dispara email às 09:00 BRT com link.
- **v3 — bandit/aprendizado:** depende de feedback. Pode usar `sent_count` por slot+segmento + manual rating. Bandit fica em `bandit.ts` espelhando `coupons/bandit.ts`.
- **v3 — outros tipos:** win-back, carrinho-quente (top GA4 sem compra), cross-sell por categoria comprada, esgotando-estoque. Cada um vira novo `picker` strategy + novo template.

---

## 9. Próximo passo

Próxima skill: **`writing-plans`** — quebra esse design em tarefas atômicas (2-5 min cada) com paths exatos, código, RED-GREEN-REFACTOR e verificação por etapa.

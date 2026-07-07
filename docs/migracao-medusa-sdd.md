# SDD — Migração de plataforma: VNDA → Medusa JS

**Data:** 2026-07-07 · **Status:** proposta para aprovação · **Owner:** Guilherme
**Fontes:** levantamento multi-agente (6 agentes de código sobre este repo + 4 de pesquisa web verificada em 07/07/2026 + auditoria de lacunas). Referências de arquivo citadas como `arquivo:linha`.

---

## 0. TL;DR executivo

Migrar a loja Bulking da VNDA (SaaS) para Medusa v2 (open source, self-hosted em Droplet DigitalOcean), em **dual-run** até o cutover. O levantamento mostra que o projeto é viável e que o dashboard já está ~70% desacoplado da VNDA (o grosso bebe de tabelas internalizadas no Supabase). Os três blocos que definem o projeto:

1. **Checkout/pagamentos é o item crítico** — não existe NENHUM plugin Medusa v2 maduro com PIX no Brasil (verificado em 07/07/2026). Teremos que escrever um payment provider próprio (candidato: Pagar.me API v5) ou completar o plugin community de Mercado Pago. É a maior fatia de esforço e de risco.
2. **O elo VNDA↔Eccosys é nativo da VNDA e some no cutover** — pedido Medusa→Eccosys e estoque Eccosys→Medusa precisam ser construídos, mas o Hub ML já contém ~80% dos blocos (`pushOrderToEccosys`, cron `sync-stock`, cliente Eccosys agnóstico).
3. **O ponto único de integração do dashboard é o webhook de pedidos** — replicar o evento `order.placed` do Medusa no shape que o pipeline atual espera resolve CRM, cashback, CAPI, recuperação de carrinho, reviews e atribuição do chat de uma vez.

Regras de ouro do cutover: **URLs idênticas** (não reseta learning da Meta), **mesmo catálogo/feed Meta e Google** (mesmos `id`s), **Eccosys como fonte única de estoque** no dual-run, **nunca migrar às vésperas de pico** (Black Friday).

Custo de infra estimado: **~US$200–225/mês** baseline (backend DO + storefront Vercel + Cloudflare + Sentry) — contra o custo VNDA atual (% GMV + mensalidade). Esforço estimado: **4–6 meses** com dual-run (detalhe em §17).

---

## 1. Escopo e princípios

**Escopo pedido:**
- Clonar catálogo completo (produtos + imagens; imagens no Backblaze B2).
- Sync de estoque com Eccosys para **todos** os produtos ativos (hoje o Hub ML cobre só ML).
- Tudo do menu "Loja" do dashboard funcionando no Medusa: Prateleiras, Etiquetas Promo, Topbar, Régua de Brinde, Benefícios PDP, Cupons Auto, Avaliações, Assistente IA, Produtos ([features.ts:154-224](../src/lib/features.ts)).
- Cashback e Recuperação de Carrinho funcionando.
- **Dual-run**: VNDA continua operando; Medusa sobe em paralelo; cutover quando decidirmos.
- Hospedagem em Droplet DigitalOcean que aguente pico; repositório novo no GitHub para a loja.
- Segurança em primeiro lugar.

**Princípios de design:**
1. **Eccosys é a fonte de verdade de estoque e do cadastro-mestre** (já é hoje). Medusa e VNDA são canais de venda lendo o mesmo pool.
2. **O Supabase do dashboard continua sendo o cérebro** (CRM, réguas, config de features). O Medusa não substitui o dashboard — ele substitui a VNDA como "canal loja".
3. **Paridade de URL byte a byte** (`/camisetas`, `/hustle-iii`, `/produto/...`, `/pedido/<code>`): preserva SEO, os ~26 anúncios ativos apontando pra coleções e o learning da Meta.
4. **Chave canônica de identidade = SKU Eccosys** (`codigo`). `content_ids` do CAPI já é SKU, o Hub já mapeia por SKU, o feed Meta/GMC deve manter o mesmo `id`.
5. **Abstração de plataforma no dashboard, não fork**: uma camada `store_connections` + adaptadores, para o mesmo dashboard operar VNDA e Medusa simultaneamente no dual-run.
6. **Toda rota nova do dashboard usa `getWorkspaceContext`** (lição do PR #199 — nunca header cru + admin client).

---

## 2. Estado atual — onde a VNDA realmente está acoplada

Classificação do inventário (`[A]` = API VNDA ao vivo, `[B]` = dado já copiado pro Supabase, `[C]` = acoplado a tema/URLs/DOM da loja VNDA):

| Feature | Fonte | Classe | O que muda no Medusa |
|---|---|---|---|
| CRM (RFM, ABC, segmentos, e-mail/WA) | `crm_vendas` | [B] | Só re-alimentação (webhook novo) |
| Simulador financeiro | `crm_vendas` | [B] | Nada |
| Prateleiras (config+algoritmos) | Supabase + espelho `shelf_products` | [B]+[A] | Trocar `catalog-sync` de fonte |
| Topbar, Gift-bar, Promo tags, Benefícios PDP | Supabase (migrations 039-121) | [B]+[C] | Só o render (hoje `shelves.js` injetado no tema VNDA) |
| Reviews (coleta, moderação, landing /avaliar) | Supabase próprio | [B] | Widget + gate de despacho |
| Assistente IA (busca) | espelho `shelf_products` | [B] | Detalhe/variantes ao vivo + handoff de checkout |
| Cashback (motor, régua, templates) | Supabase | [B] | Carteira: VNDA `/credits` → Store Credit Medusa |
| Recuperação de carrinho (régua, fila WA) | Supabase | [B] | Detecção de abandono + `recovery_url` + cupom |
| Cupons/promoções (criação/rotação) | VNDA `/discounts` | **[A] escrita** | Promotions module do Medusa |
| Pricing engine (sale price) | VNDA `PATCH /variants` | **[A] escrita** | Price lists do Medusa |
| Ingestão de pedidos | webhook VNDA | [A]→[B] | Subscriber `order.placed` |
| Meta CAPI Purchase | webhook VNDA + shelves.js | [A]+[C] | Mapper novo + eventos no storefront |
| Checkout micro-funil, buybar, bridge do chat | DOM/URLs do tema VNDA | **[C]** | Reescrever nativo no storefront |
| Overview/faturamento, cockpit caixa | `getVndaDailyReport` ao vivo | [A] | Adapter de leitura de pedidos |
| ~89 scripts ops + skills (bulking-sale, pdp-images) | API VNDA direta | [A] | Reescrever os vitais, aposentar o resto |

**O ponto único de falha** ([webhooks/vnda/orders/route.ts](../src/app/api/webhooks/vnda/orders/route.ts)): o webhook de pedidos alimenta, em cascata: upsert `crm_vendas` → auto-segmentos → fechamento de `abandoned_carts` → **CAPI Purchase** → **cashback** (criar/usar/cancelar) → `assistant_attributions`. Replicar esse evento com shape compatível é o coração da migração do dashboard (§8).

**Dependências VNDA que NÃO estão no repo** (levantar antes de fechar o plano — §16): gateway de pagamento atual (MDR, métodos, taxa de aprovação), configuração de frete (tabelas, frete grátis R$149?, quem emite etiqueta), regra exata do cupom PRIMEIRAVEZ, mecânica do elo nativo VNDA↔Eccosys, e-mails transacionais que a VNDA envia, export contratual (clientes, pedidos, saldos de crédito).

---

## 3. Arquitetura alvo

```
                        ┌─────────────────────────────────────────┐
                        │                Cloudflare                │
                        │   (WAF, rate-limit, CDN, DNS, cache)     │
                        └───────┬──────────────┬──────────────────┘
                                │              │
              www.bulking.com.br│              │ api.bulking.com.br
                     (storefront)              │ (Store/Admin API)
                                ▼              ▼
                  ┌──────────────────┐   ┌──────────────────────────────┐
                  │  Vercel           │   │  Droplet DO (NYC1, 4c/8GB)   │
                  │  Next.js store    │   │  docker compose:             │
                  │  (dtc-starter     │   │   medusa-server (:9000 local)│
                  │   customizado)    │   │   medusa-worker (jobs/subs)  │
                  └────────┬─────────┘   │   nginx/caddy (TLS)          │
                           │             └───────┬──────────┬───────────┘
                           │                     │          │
                           │      DO Managed PG (4GB, PITR) │ DO Managed Valkey
                           │                                │
                  ┌────────▼────────────────────────────────▼───────────┐
                  │  Backblaze B2 (imagens, S3-compatible, egress $0     │
                  │  via Cloudflare Bandwidth Alliance)                  │
                  └──────────────────────────────────────────────────────┘

  Dashboard Vortex (Vercel, este repo) ◄── webhooks/subscribers do Medusa
        │  └── Supabase (crm_vendas, réguas, config de features…)
        └──► Eccosys (ERP): estoque → Medusa · pedido Medusa → Eccosys → NF-e
  whatsapp-worker.mjs (scheduler das réguas — hoje já externo, continua)
```

**Repositórios:** criar repo novo `bulking-store` (monorepo: `apps/medusa` + `apps/storefront`). O Dashboard Vortex continua neste repo; a integração entre os dois é por API/webhook, nunca por import de código.

**Decisão recomendada — storefront na Vercel, backend no Droplet:** o time já domina Vercel, ela absorve pico de BF sem capacity planning, e imagens saem por B2+Cloudflare (nunca pela Vercel, para não estourar o 1TB incluso). O Droplet roda só o Medusa (server+worker). Se preferir tudo no Droplet: Next.js self-hosted exige `cacheHandler` Redis para ISR multi-instância e capacity planning de pico — dá, mas é ops a mais no dia mais crítico do ano.

**Atenção assumida:** DO não tem região Brasil. Backend em NYC1 = ~110–140ms de RTT por chamada de API de carrinho/checkout. Mitigação: Cloudflare (POPs BR) para tudo cacheável + storefront com Server Components fazendo fetch server-side (Vercel `gru1`→NYC backbone é melhor que browser→NYC). Alternativa se a latência incomodar nos testes: droplet-equivalente com região SP (fora da DO). Decidir explicitamente em vez de descobrir na CVR (§16.7).

---

## 4. Workstream 1 — Catálogo e imagens (clone VNDA → Medusa)

**Modelo:** produto VNDA (pai + variantes de tamanho) → Medusa Product + Options ("Tamanho") + Variants (1 SKU por variante). Usar **global product options** (v2.17+) para P/M/G/GG/XG. Categorias/coleções (`/camisetas`, `/hustle-iii`, `/brasil`…) → Categories + Collections do Medusa com **os mesmos slugs**. Tags VNDA (`ficha-tecnica`, tags de campanha) → tags/metadata.

**Extração:** já temos os blocos — `listVndaProducts`/`searchVndaProducts` ([vnda-api.ts](../src/lib/vnda-api.ts)), `GET /products/{id}/images`, e o espelho `shelf_products` como cache. Gotchas conhecidos se aplicam (tags só via search, nunca `tags` como query param).

**Carga:** script de import chamando os workflows do Medusa (`createProductsWorkflow`) em batch — para 1–2k SKUs é tranquilo; CSV do admin como plano B. Pré-criar categorias/coleções/sales channel/shipping profile antes (o import exige IDs existentes).

**Imagens → Backblaze B2:**
- File Module oficial `@medusajs/medusa/file-s3` com endpoint B2 (`https://s3.<region>.backblazeb2.com`). B2 não aparece na doc, mas a API S3-compatible atende (só signature v4, que o SDK usa).
- Gotchas B2: ACL só no nível do bucket (bucket público de leitura; neutralizar ACL por objeto via `additional_client_config` se o provider tentar enviar); bucket versionado por default.
- Servir via domínio próprio (`img.bulking.com.br`) proxied pela Cloudflare → **egress $0** (Bandwidth Alliance ativa em 2026).
- Pipeline de clone: baixar da CDN VNDA → re-upload no B2 → registrar no Medusa. Mesmo padrão do `uploadPicture` do Hub ML.
- **Preservar nome/ordem**: capa primeiro (a ordem foi curada manualmente — capas /brasil, imagens-benefício das ~36 PDPs oversized).

**Sync contínuo durante o dual-run:** enquanto as duas lojas operam, produto novo entra pelo fluxo atual (Eccosys/pré-cadastro → VNDA) e um job espelha para o Medusa (delta por `updated_at`). Content freeze alguns dias antes do cutover + delta final.

---

## 5. Workstream 2 — Eccosys (estoque, pedidos, NF-e)

Hoje: **loja VNDA↔Eccosys é integração nativa da plataforma** (zero código nosso — confirmado por grep). O Hub ML é nosso e vira o template.

### 5.1 Estoque Eccosys → Medusa (todos os produtos ativos)
- Clonar o padrão do cron [sync-stock](../src/app/api/cron/sync-stock/route.ts): bulk-fetch `GET /estoques` (paginado, 1 req/s) → mapa `codigo→estoqueDisponivel` → escrever no Inventory Module do Medusa (`location-levels` por inventory item).
- Granularidade: **SKU filho** (variante). Tabela-ponte nova `medusa_products` (espelho de `hub_products`: `sku` ↔ `ecc_id` ↔ `medusa_variant_id`), `UNIQUE(workspace_id, sku)`.
- Frequência: horária como o ML no início; avaliar webhook/delta depois. Durante picos de campanha, considerar 15min.
- Cliente Eccosys ([src/lib/eccosys/client.ts](../src/lib/eccosys/client.ts)) é 100% agnóstico — reusar como está. Atenção ao throttle 1 req/s module-level (não distribui entre lambdas — o job de sync deve rodar em processo único; candidato natural: scheduled job no worker do Medusa ou no whatsapp-worker).

### 5.2 Pedido Medusa → Eccosys
- Subscriber `order.placed` (worker Medusa) → POST para endpoint nosso → `pushOrderToEccosys()` generalizado ([src/lib/hub/push-order.ts](../src/lib/hub/push-order.ts) já monta `_Contato`, `_Itens` com resolução `codigo→idProduto`, `_Parcelas`, `_EnderecoDeEntrega`).
- Generalizar o que hoje é hardcoded ML: transportadora (Mercado Envios → transportadora real do pedido) e canal de venda (**criar canal "Loja Medusa" no Eccosys** — verificar com o suporte Eccosys como criar canal genérico, pergunta §16.2).
- **NF-e continua 100% no Eccosys** (nada muda na emissão). O fluxo de volta (faturado → tracking) segue o padrão do `check-faturados`: cron lê `GET /pedidos/{id}` → grava fulfillment/tracking no Medusa (`POST /admin/fulfillments`) → cliente recebe e-mail de enviado. Isso também alimenta o gate de despacho de cashback/reviews (§9/§10) — no Medusa o sinal vira evento `fulfillment.shipped`, muito mais confiável que o polling de `tracking_code` atual.

### 5.3 Oversell no dual-run (risco nº 1 de operação)
- Regra: **um único pool no Eccosys; todos os canais leem e decrementam o mesmo pool.** VNDA continua com o elo nativo; Medusa entra como canal novo lendo `/estoques` e empurrando pedidos.
- A janela de risco é a latência entre venda num canal e débito visível no outro. Mitigações: sync de estoque frequente em SKUs curva-A, buffer de segurança (ex.: expor estoque−1 quando estoque ≤2 no canal secundário durante o dual-run), alerta de mismatch diário (job que compara estoque Medusa × Eccosys × VNDA e loga divergência).
- **Pré-requisito de descoberta:** documentar como o elo nativo VNDA↔Eccosys funciona (push? polling? latência?) — pergunta §16.2. Sem isso o risco é incalculável.

---

## 6. Workstream 3 — Checkout, pagamentos e frete (o item crítico)

### 6.1 Realidade do ecossistema (verificada 07/07/2026)
- **Não existe plugin Medusa v2 pronto com PIX.** Pagar.me, PagBank, Appmax, Asaas: zero plugins. Mercado Pago: plugin community ativo (`@nicogorga/medusa-payment-mercadopago` v0.3.0, jun/2026) mas **só cartão testado, sem PIX no código**. Nova.Pay (wrapper de Pagar.me): completo (cartão/PIX/boleto) porém **checkout redirect hospedado fora do domínio** + taxa do integrador + repo privado — não recomendado como solução definitiva.
- Stripe BR: sem Elo/Hipercard, PIX invite-only com cap R$3k/transação, sem parcelamento BR — descartado como principal.
- **Caminho recomendado: payment provider custom sobre a API do Pagar.me v5** (cartão parcelado com/sem juros nativo, PIX, boleto, antifraude embutido, todas as bandeiras). A interface do Medusa é bem documentada: 9 métodos + webhook (`AbstractPaymentProvider`); o plugin do NicolasGorga serve de gabarito estrutural. Alternativa: completar o plugin de Mercado Pago com PIX (Payment Brick já renderiza parcelamento) e contribuir upstream.
- Pré-requisito do PIX/boleto: **pagamento assíncrono via webhook (Medusa v2.16+)** — já suportado no core. O trabalho real de UX é nosso: QR + copia-e-cola, polling de confirmação, expiração do PIX com liberação de reserva de estoque, e-mail de "pagamento pendente".
- **Antes de escolher: levantar o baseline atual** (qual gateway a VNDA usa, MDR, métodos ativos, parcelamento máximo, taxa de aprovação). Cutover de gateway costuma custar 3–10 p.p. de aprovação se mal calibrado — sem baseline, a regressão é invisível (§16.1).

### 6.2 Checkout brasileiro no storefront
O starter não tem nada BR: **CPF/CNPJ** via `additional_data` + validador Zod (approach documentado do core), **CEP lookup** (ViaCEP/BrasilAPI) no frontend, **seletor de parcelas** (renderizado pelo SDK do gateway), máscaras. O checkout é a página que mais merece investimento — é onde a VNDA hoje entrega conversão testada. Replicar o micro-funil de medição que já temos (`checkout_events`, migration-124) desde o dia 1 para comparar CVR etapa a etapa contra o baseline VNDA.

### 6.3 Frete
- Inventariar ANTES a configuração atual na VNDA (transportadoras, tabelas, regra do frete grátis — a gift-bar/`/frete-149` sugere threshold R$149; quem emite etiqueta hoje — provavelmente o Eccosys) — pergunta §16.3.
- Cotação ao vivo por CEP: fulfillment provider custom (`calculatePrice` recebe CEP + itens) sobre Melhor Envio (`POST /shipment/calculate`) ou Frenet. Existe plugin v2 novíssimo de Melhor Envio (jun/2026, v0.1.0, 0 stars, só cotação — sem compra de etiqueta): usável como base auditada/fork, não como dependência cega.
- Se a etiqueta já sai do ERP (provável), cotação resolve o checkout e o pós-venda continua no Eccosys.
- Kangu foi extinta (01/2025) — descartar.

### 6.4 Kits/combos
Mecânica central de campanha (THE SALE, `/carrinho/adicionar/kit`). Inventory Kits do Medusa ≠ combo promocional com preço fechado — mapear como a VNDA modela o kit hoje e desenhar o equivalente (produto-bundle com inventory kit + promotion, ou promotion `buyget`). Afeta baixa de estoque no Eccosys, CAPI `contents` e a skill bulking-sale. Item de design pendente (§16.4).

---

## 7. Workstream 4 — Storefront e as features do menu "Loja"

### 7.1 Base
Fork do **`medusajs/dtc-starter`** (o `nextjs-starter-medusa` foi ARQUIVADO em 02/07/2026). Next.js App Router, RSC, checkout multi-step, conta de cliente. Tema Bulking por cima (dark, Respect The Hustle — aplicar `docs/bulking-manifesto.md` no tom de toda copy da loja).

### 7.2 Decisão estrutural: componentes nativos, não script injetado
O `shelves.js` (7.110 linhas) existe porque na VNDA não controlamos o tema. **No storefront próprio, injetar script no próprio site é anti-padrão.** Recomendação: portar como componentes React nativos consumindo **as mesmas APIs públicas do dashboard** (que já são agnósticas):

| Módulo shelves.js | No storefront Medusa | API (inalterada) |
|---|---|---|
| Prateleiras (render + tracking) | `<VortexShelf position="..."/>` nas PLP/PDP/home/carrinho | `/api/shelves/{recommend,config,track}` |
| Topbar (+ THE SALE) | `<Topbar/>` no layout | `/api/topbar/public-config` |
| Gift-bar (régua de brinde) | `<GiftBar/>` lendo o cart do Medusa via JS SDK (fim do parse de HTML do carrinho) | `/api/gift-bar/public-config` |
| Etiquetas promo | badge no card de produto (server-side!) | `/api/promo-tags/products` |
| Reviews widget + carrossel | componentes na PDP/home + JSON-LD `AggregateRating` | `/api/reviews/*` |
| Benefícios PDP | bloco nativo na PDP | config existente |
| Buybar mobile | componente próprio (fim do hack de esconder `.form-floating`) | — |
| Pedir de presente | componente | `/api/gift-request/*` |
| Checkout micro-funil | eventos nas etapas do checkout novo | `/api/checkout-events` |
| CAPI browser + captura EMQ | SDK leve (`vortex-tracking.ts`) — §11 | `/api/meta-capi`, `/api/meta-attribution` |
| Bridge `#vtx_cart` do chat | rota nativa: `/chat` monta o carrinho via Store API e redireciona pro checkout (fim do hash+bridge) | — |

O que muda no dashboard: **nada nas APIs**; o "snippet de instalação" vira documentação do SDK. Config continua toda no Supabase — o time de marketing continua operando topbar/etiquetas/prateleiras do dashboard sem deploy.

### 7.3 SEO e paridade
- **URLs idênticas** (produto, coleção, institucionais). Onde for impossível, 301 server-side 1:1 (nunca em massa pra home). Manter redirects ≥1 ano.
- Canonical auto-referente, meta/titles/H1 byte a byte, JSON-LD Product/Offer/AggregateRating validado ANTES do cutover.
- Sitemap duplo na virada (novo + antigo com URLs redirecionadas), Search Console sem Change of Address (mesmo domínio).
- **Checklist anti-clássico:** remover `noindex` de staging no go-live; crawl completo (Screaming Frog) pré e pós; baseline de posições orgânicas congelado antes.
- Páginas institucionais/políticas (troca, privacidade, frete, medidas): Medusa não tem CMS — decidir entre hardcoded no storefront ou CMS headless leve; política de troca linkada no checkout é exigência CDC/GMC (§16.10).
- Expectativa realista mesmo fazendo tudo certo: flutuação de 10–20% no orgânico no 1º mês, recuperação em 3–6 meses.

### 7.4 Contas de cliente
Senhas da VNDA não são exportáveis (SaaS). **Estratégia recomendada: login passwordless (OTP/magic link por e-mail) como método primário** — o Auth Module suporta provider custom; o cashback já é keyed por e-mail, então o cliente loga e vê o saldo sem fricção de reset. Senha vira opcional. Convite de reativação em massa 24–48h após o cutover (não no dia). Migrar clientes (nome, e-mail, telefone, endereços, tags/grupos, opt-ins de marketing — LGPD: migrar flags de consentimento, não re-inscrever).

### 7.5 Pedidos históricos
**Não migrar para o Medusa.** O histórico já vive em `crm_vendas` (e no Eccosys). Para "meus pedidos" do cliente: consolidação em runtime (pedidos legados servidos do nosso banco read-only + pedidos novos do Medusa). Isso também atende Troquecommerce e CS por 90+ dias pós-cutover para trocas de pedidos VNDA (§16.11).

---

## 8. Workstream 5 — Adapter do dashboard (dual-run de verdade)

### 8.1 `store_connections` (generalização de `vnda_connections`)
Nova tabela com `platform: 'vnda' | 'medusa'`, credenciais cifradas (AES-256-GCM já existente), `webhook_token`, flags (`enable_cashback`…). As features passam a resolver a conexão por plataforma. `vnda_connections` continua até o desligamento.

### 8.2 O webhook de pedidos unificado
Endpoint novo `POST /api/webhooks/medusa/orders` (ou subscriber Medusa → chamada autenticada) que normaliza o payload Medusa para o shape interno que o pipeline espera (o mapeamento atual vive em [src/lib/vnda-webhook.ts](../src/lib/vnda-webhook.ts)) e roda o MESMO pipeline: `crm_vendas` (com `source='medusa_webhook'`) → segmentos → fechar carrinho → CAPI → cashback → atribuição do chat.
- Campos mínimos do evento: email, telefone+DDD, nome, itens `[{sku, name, qty, price}]`, total/subtotal/frete, cupom, desconto, uso de store credit (estruturado — fim da heurística de 15 chaves!), endereço (UF), status, `code`.
- **Dedupe cross-plataforma:** `crm_vendas` já tem chave `(workspace_id, source, source_order_id)` — pedidos dos dois canais convivem. Mas TODA regra "primeira compra / nunca comprou" (PRIMEIRAVEZ, RFM novo-cliente, cooldowns) precisa olhar as **duas fontes por e-mail/CPF**, não por source.

### 8.3 Escritas que mudam de alvo
| Hoje (VNDA) | No Medusa |
|---|---|
| Cupons: `POST /discounts` + rules + coupons ([vnda-coupons.ts](../src/lib/coupons/vnda-coupons.ts)) | Promotions module (código único, % cart-wide, `limit` 1 uso, expiração — cobre o cupom de recuperação `BKNG10_XXXXXX`) |
| Pricing engine: `PATCH /variants` sale_price | Price list (sale) via Admin API |
| Carteira: `/credits` deposit/withdrawal/refund | Store Credit (§9) |
| Espelho de catálogo: `catalog-sync` → `shelf_products` | Store API do Medusa → mesmas colunas (manter `shelf_products` como está; só a fonte muda + de-para de IDs) |

### 8.4 Mapa de identidade (lacuna transversal apontada pelo crítico)
Dezenas de tabelas são keyed por IDs VNDA (`shelf_products.product_id`, `review_requests.product_id`, `cashback_transactions.source_order_id`, `abandoned_carts.vnda_cart_token`, `assistant_attributions.order_code`, `content_ids` Meta, `id` GMC, `ecommerce_number` Troquecommerce). Criar **documento + tabela de-para** `sku ↔ vnda_product_id ↔ medusa_product_id/variant_id` populada no clone do catálogo (§4). Regra: tudo que é novo referencia SKU; o de-para traduz o legado. Auditar consumidor por consumidor antes do cutover.

---

## 9. Workstream 6 — Cashback

O motor (FSM, cálculo banker's, régua LEMBRETE_1/2/3, templates, idempotência, Troquecommerce) é **agnóstico e sobrevive intacto**. O que muda é a carteira:

- **Carteira → `@medusajs/loyalty-plugin`** (open source desde 28/04/2026; requer Medusa ≥2.14): Store Credit Module com contas por cliente, transações credit/debit, **aplicação do saldo no checkout** e refund para store credit. A regra de acúmulo continua nossa (o tick chama a API do plugin em vez de `/credits`).
- **Verificar na POC:** expiração por data (a VNDA tem `valid_from/valid_until` nativo; o plugin não documenta — se não tiver, o tick já emite débito na expiração hoje via refund, o padrão sobrevive) e referência idempotente (preservar semântica `BULKING-CASHBACK-{id}` / contrato "refund casa com a reference do depósito").
- **Resgate estruturado:** o Medusa expõe uso de store credit no pedido — morre a heurística `extractCreditUsed` de 15 chaves.
- **Gate de despacho:** `fulfillment.shipped` substitui o polling de `tracking_code`.
- **Bulking Club:** tag `bulking-club` → customer group; a exclusão por cupom de membro (`CASHBACK_MEMBER_PROMOTION_ID`) vira query no Promotions module.
- **Reviews rewards** ([rewards.ts](../src/lib/reviews/rewards.ts)) trocam de carteira junto.

### 9.1 Cutover do dinheiro (plano obrigatório)
No dia D haverá créditos ATIVOS na carteira VNDA:
1. **T-7d:** congelar reativações; depositar normalmente (pedidos ainda são VNDA).
2. **Dia D:** freeze de depósitos/refunds na VNDA; export do passivo — fonte primária `cashback_transactions` (status ATIVO/REATIVADO), reconciliada com `GET /credits/balance` por e-mail (iterar a base; medir antes o volume — pergunta §16.6).
3. Re-crédito no Store Credit Medusa **preservando `expira_em`** original, reference `BULKING-MIGRATION-{id}`.
4. Divergências (transação local × saldo VNDA) → fila de reconciliação manual.
5. Dual-run: o tick precisa saber em qual carteira cada transação vive → coluna `platform` em `cashback_transactions` (default 'vnda', novas via Medusa = 'medusa').

---

## 10. Workstream 7 — Recuperação de carrinho e réguas

A régua inteira (rules/steps/messages, fila `wa_campaigns` via Meta Cloud API, template UTILITY barato, Locaweb SMTP, compliance `wa_exclusions`, KPIs) é **agnóstica**. Acoplamento VNDA concentrado em 5 arquivos (`payload.ts`, `enrich.ts`, `vnda-import.ts`, `coupons.ts`, webhooks). No Medusa:

- **Detecção de abandono:** não existe evento nativo `cart.abandoned`. Padrão oficial: **scheduled job no worker** consultando carts com `updated_at` antigo + e-mail + sem pedido → POST pro nosso webhook (mesmo shape do `normalizeCart`). Vantagem sobre a VNDA: incluir nome/telefone no payload mata o enrichment de 1 tentativa.
- **`recovery_url`:** construir rota de cart-resume no storefront (`/carrinho/recuperar/{token}` → seta o cart_id no cookie e abre o carrinho). É o link do WhatsApp/e-mail — testar exaustivamente (é o clique de maior intenção da régua).
- **Cupom por step:** Promotions module (código único, 1 uso, expiração) — a VNDA nem tinha DELETE de promotion; o Medusa é mais limpo.
- **Fechamento (recovered):** já resolvido pelo webhook unificado (§8.2), match por e-mail/telefone — cross-plataforma no dual-run (carrinho abandonado na VNDA + compra no Medusa deve contar como recuperado).
- **Réguas irmãs** (reviews pós-compra, gift-request conversions, coupon-attribution) bebem de `crm_vendas` — resolvidas pelo webhook unificado + evento de despacho (§5.2).
- **SPOF a documentar:** `whatsapp-worker.mjs` é o scheduler real de TODAS as réguas (cart-recovery 5min, import 15min, cashback-tick diário 12:00 UTC). Documentar onde roda, monitorar com healthcheck, e decidir se os jobs de manutenção migram para scheduled jobs do worker Medusa (§16.9).

---

## 11. Workstream 8 — Tracking, CAPI e feeds (não cegar o ML da Meta)

Hoje são DOIS trilhos: pixel nativo VNDA (browser fbq + CAPI da VNDA → pixel BK BACKUP `1369443261478323`) e o NOSSO CAPI (server-side → pixel B7984 `530030010455239`). **O trilho da VNDA desaparece no cutover** — a loja Medusa precisa emitir tudo:

**Browser (SDK `vortex-tracking` no storefront):**
1. GA4 completo via GTM: `page_view`, `view_item`, `view_item_list`, `select_item`, `add_to_cart`, `begin_checkout`, `purchase{transaction_id, value, items[]}` — sem isso o funil do overview e metade do dashboard cegam. Manter `dataLayer` e os eventos suplementares (`vortex-<algoritmo>` das prateleiras).
2. **fbq browser explícito** (hoje quem instala é a VNDA) + CAPI: com os dois trilhos no mesmo pixel, **TODO evento passa a exigir `event_id` compartilhado browser↔server** (hoje só Purchase deduplica).
3. Eventos CAPI reimplementados sem DOM-scraping: AddToCart no handler real do carrinho (fim do monkey-patch de `/carrinho/adicionar`), Purchase na página de confirmação com `event_id = vtx_purchase_<code>` **idêntico ao servidor**, InitiateCheckout nas rotas novas.
4. Captura EMQ: cookies `_vtx_em`/`_vtx_ph`/`_vtx_cid`, `_fbp` (ler/gerar), `_fbc` fresco, beacon para `/api/meta-attribution` no e-mail do checkout. Com checkout próprio, capturamos PII de formulário de primeira mão → EMQ tende a SUBIR pós-migração.

**Servidor:** mapper Medusa→`CapiEventInput` no webhook unificado (o dispatcher [meta-capi.ts](../src/lib/meta-capi.ts) é agnóstico e fica como está). `content_ids` = **SKU, idêntico ao feed**.

**Feeds de catálogo (Meta + Google Shopping) — dependência dura sem dono hoje:** ambos são gerados pela VNDA. Construir gerador próprio (job no dashboard ou no Medusa: XML/TSV com `id`=SKU **idêntico ao atual**, `link` para a URL nova, preço/estoque atualizados). **Nunca criar catálogo/feed novo** — atualizar a URL de fetch do feed EXISTENTE no mesmo catálogo Meta (learning do Advantage+ preservado) e no GMC (re-review de 24–72h por URL alterada; `id` novo = produto novo = histórico zerado).

**Regra Meta no cutover:** URLs idênticas ⇒ anúncios ativos não são tocados ⇒ learning intacto (editar link de anúncio = novo creative = reset). Critério de rollback: pixel/GA4 zerados >30min.

**Dual-run GA4:** mesmo property, dimensão `hostname` para separar lojas; anotar a data do cutover; UTMs inalteradas.

---

## 12. Segurança (primeiro lugar, como pedido)

**Infra (Droplet):**
- Ordem canônica: usuário sudo não-root → SSH só com chave ed25519 (`PermitRootLogin no`, `PasswordAuthentication no`) → UFW `default deny` (só 22/80/443) → Fail2Ban → `unattended-upgrades`.
- **Gotcha crítico Docker+UFW:** `-p 9000:9000` fura o UFW (iptables do Docker vence). Bind interno em `127.0.0.1` (só o proxy alcança) ou `ufw-docker`. Postgres/Redis: NUNCA publicados — Managed DB na VPC privada da DO com trusted sources = só o droplet.
- Cloudflare na frente de tudo (proxied): WAF managed rules, rate-limit em `/store/carts*`+checkout e `/auth*`, TLS Full (strict). Origem só aceita tráfego Cloudflare (allowlist de IPs no UFW/proxy).
- Secrets: `.env` com permissão 600 fora do git; `JWT_SECRET`/`COOKIE_SECRET` fortes (v2.16+ exige explícitos); deploy injeta via GitHub Actions secrets.

**Admin Medusa:**
- `admin.bulking-store.com` (ou path protegido) atrás de **Cloudflare Access/Zero Trust** (grátis ≤50 users) — admin de loja exposto na internet é o vetor nº 1.
- **RBAC não existe no Medusa OSS** (todo usuário é admin pleno; RBAC é Enterprise/Cloud). Mitigação: mínimo de contas, MFA (v2.15.5+, `AUTH_MFA_ENCRYPTION_KEY`), Access na frente, audit via logs. Se a equipe crescer: plugin pago RSC-Labs ou custom.

**Aplicação:**
- `STORE_CORS`/`ADMIN_CORS`/`AUTH_CORS` restritos aos domínios reais.
- Publishable key por sales channel no storefront (padrão Medusa).
- Webhooks dashboard↔Medusa autenticados (token dedicado + HMAC; mesmo padrão `?token=` atual serve, com secret por conexão).
- Lição do PR #199 vale dobrado: toda rota nova do dashboard = `getWorkspaceContext`. (Pendência conhecida: `route-helpers.ts` do cashback usa helper próprio — alinhar antes de multiplicar superfícies.)

**PCI:** checkout transparente com cartão via SDK/Brick do gateway (tokenização no iframe do gateway) ⇒ escopo **SAQ A-EP**. Nunca tocar PAN. Formalizar o questionário com o gateway escolhido.

**LGPD:** dados de clientes/pedidos (com CPF) passam a viver em infra própria fora do BR (DO NYC + B2) ⇒ transferência internacional (arts. 33–36): DPA com DigitalOcean e Backblaze, atualizar política de privacidade, fluxos de titular (acesso/correção/eliminação) funcionando no dia 1, migrar opt-ins de marketing como flags (não re-inscrever ninguém). Minimização: não migrar o que não será usado.

**Backups/DR:** Managed PG com PITR 7d incluso + `pg_dump` diário → B2 (retenção 30d, protege contra comprometimento da conta DO); snapshots do droplet; infra reproduzível (compose + provisionamento no repo); **restore drill trimestral** (fork do PG + subir num droplet limpo, medir RTO).

---

## 13. Infra DigitalOcean — sizing, custo, deploy, observabilidade

**Sizing (tráfego atual ~100–300k sessões/mês, pico 5–10x na BF):** benchmark oficial Medusa ≈140 RPS/instância (p95 <500ms) — ordens de magnitude acima da nossa média (4–12 req/s). Com Cloudflare cacheando a vitrine, o backend só vê carrinho/checkout/API.

| Item | Spec | US$/mês |
|---|---|---|
| Droplet Premium (server+worker+proxy via compose) | 4 vCPU / 8 GB | ~56 |
| Managed PostgreSQL (piso prático: conexões = 25/GiB−3) | 2 vCPU / 4 GB, PITR 7d incluso | 61 |
| Managed Valkey (event bus/workflow/cache/locking) | 1 GB | 15 |
| Backblaze B2 (~100GB imagens, egress $0 via CF) | — | ~1 |
| Backups diários do droplet (30%) | — | ~17 |
| Cloudflare Pro | WAF + rate-limit | 20–25 |
| Sentry Team | backend+storefront | 26 |
| **Backend total** | | **~200** |
| Vercel Pro (storefront) | | +20 |
| BF (1 mês): 2º droplet + LB | | +68 |

- **Server/worker split é requisito oficial** (não opcional): `MEDUSA_WORKER_MODE=server` + `worker` (com `DISABLE_MEDUSA_ADMIN=true`), mesmo build, mesmos PG/Redis. Módulos Redis explícitos (event-bus, workflow-engine, cache, locking) — os defaults em memória quebram multi-processo.
- **Nunca deployar versão `.0`** (v2.17.0 quebrou worker; fix na .1). Política de upgrade: congelar minor, janela mensal de manutenção, `db:migrate` no predeploy, ler changelog (minor releases INCLUEM breaking changes por política do projeto).
- **Deploy:** GitHub Actions → build da imagem → GHCR → SSH no droplet → `docker compose pull` + `docker rollout` (zero-downtime); migrations 1x antes do swap. Alternativa com painel: Dokploy (leve) se preferir UI.
- **Pico BF:** resize vertical do droplet (1–2min de downtime, reversível) OU 2º droplet + DO LB ($12/mês) — sem tocar em PG/Valkey gerenciados. Load test (k6) no checkout com alvo = pico BF estimado ANTES de precisar.
- **Observabilidade mínima séria:** Sentry (backend + storefront), uptime (Better Stack free: `/health` do Medusa, home, coleção, checkout), DO Monitoring com alertas (CPU/RAM/disco/conexões PG >80%), logs com rotação → Better Stack Logs.
- **Latência:** sem região BR na DO (§3). Decisão explícita pendente (§16.7).

---

## 14. Dual-run e cutover

### Fase A — Construção (staging fechado)
Medusa em `loja-dev.bulking.com.br` (Cloudflare Access + `noindex`), gateway em sandbox, catálogo clonado, checkout completo testável ponta a ponta (PIX sandbox, cartão, boleto, frete, PRIMEIRAVEZ, combo, cashback em shadow).

### Fase B — Dual-run controlado
- Loja Medusa em subdomínio (`nova.bulking.com.br`), `noindex`, **gateway REAL**, pedidos reais do time + amostra controlada (ex.: tráfego de um canal frio específico, ou clientes convidados). VNDA intocada.
- Cookies `_vtx_*` com `domain=.bulking.com.br` (funcionam cross-subdomínio); GA4 mesmo property com dimensão hostname; cupons single-use NÃO valem cross-plataforma (comunicar régua).
- Eccosys: canal "Loja Medusa" ativo; sync de estoque bidirecionalmente visível; **alerta diário de mismatch de estoque** rodando.
- Réguas: cart-recovery e cashback operando nas DUAS plataformas (coluna `platform`).
- Critérios para avançar: N pedidos reais sem incidente, CVR do checkout ≥ baseline VNDA − margem definida, taxa de aprovação de pagamento ≥ baseline − 2 p.p., EMQ ≥ atual, zero oversell em 30 dias.

### Fase C — Cutover
1. **Baseline congelado 60d antes:** CVR por dispositivo, funil `checkout_events`, aprovação de pagamento, Core Web Vitals, posições orgânicas, EMQ.
2. TTL do DNS → 300s com 48h de antecedência. Janela: madrugada de meio de semana, **nunca perto de pico/campanha** (se o alvo escorregar para outubro+, pular para janeiro).
3. Content freeze (produtos/preços) + delta final de catálogo/clientes + migração do passivo de cashback (§9.1).
4. `www.bulking.com.br` → storefront novo; VNDA viva em subdomínio interno ≥2 semanas (rollback sem rebuild).
5. Feed Meta/GMC: trocar URL de fetch nos feeds EXISTENTES (mesmos `id`s).
6. **2 ensaios completos de cutover em staging antes**, cronometrados, com rollback testado. Runbook com owner por passo.

**Go/no-go pós-DNS (janela de decisão 15min):** checkout falhando >2% das sessões, gateway rejeitando >5%, GA4/pixels zerados >30min, 404 em landing orgânica >1% do crawl ⇒ **rollback de DNS**. (Rollback após pedidos reais no Medusa exige re-sync de pedidos/estoque para o legado — por isso a janela curta.)

### Fase D — Pós-cutover
VNDA em modo leitura até o fim do contrato (trocas de pedidos antigos por 90+ dias via nosso read-only store, §7.5); régua de reativação de contas 24–48h depois; monitoramento diário de SEO/CVR/aprovação por 4 semanas; desligamento VNDA só depois do export completo confirmado (pedidos, clientes, XMLs).

---

## 15. Riscos principais (honestos)

| # | Risco | Severidade | Mitigação |
|---|---|---|---|
| 1 | Checkout próprio converte menos que o da VNDA (latência NYC, UX nova, parcelamento) | **Alta** | micro-funil desde o dia 1, dual-run com amostra real, baseline congelado, go/no-go numérico |
| 2 | Taxa de aprovação do gateway novo < atual | **Alta** | baseline do gateway atual ANTES; calibração de antifraude com o gateway; rampa gradual |
| 3 | Ecossistema BR do Medusa é deserto (zero case BR em produção, plugins de mantenedor único) | **Alta** | tudo BR-crítico é código NOSSO auditado; plugins só como gabarito |
| 4 | Oversell no dual-run (elo nativo VNDA↔Eccosys desconhecido) | Alta | inventariar o elo (§16.2), buffer de segurança, alerta de mismatch |
| 5 | Breaking changes mensais do Medusa | Média | congelar versão, janela de upgrade, nunca `.0`, staging antes de prod |
| 6 | Operação self-hosted (on-call, admin sem RBAC, R$700–1.100/h de GMV em jogo) | Média-alta | runbook de incidente, uptime+Sentry, Cloudflare Access, definir on-call ANTES do go-live |
| 7 | SEO: flutuação de 10–20% no 1º mês mesmo com paridade | Média | paridade de URL, JSON-LD, sitemap duplo, monitor diário |
| 8 | Feeds Meta/GMC quebrados = DPA/Shopping param | Alta | gerador de feed próprio pronto e validado ANTES do cutover |
| 9 | shelves.js reescrito ≠ comportamento testado de anos | Média | portar módulo a módulo com as MESMAS APIs; QA visual por feature |
| 10 | Custo oculto pós-launch (3+ meses de otimização, storefront vira codebase vivo) | Média | orçar manutenção contínua; 83% dos replatforms estouram prazo — faseado, não big-bang |

---

## 16. Perguntas abertas / decisões (bloqueiam a execução, não o início)

1. **Gateway:** qual gateway/adquirente a VNDA usa hoje (MDR, métodos, parcelamento máx, taxa de aprovação)? Decisão: Pagar.me provider custom (recomendado) vs completar plugin Mercado Pago vs Appmax/Asaas.
2. **Elo VNDA↔Eccosys:** mecanismo (push/poll), latência, como desligar por canal; como criar canal de venda "Medusa" no Eccosys (suporte Eccosys).
3. **Frete hoje:** transportadoras/tabelas/regra do frete grátis/quem emite etiqueta.
4. **PRIMEIRAVEZ:** regra exata configurada na VNDA (% / exclusões / enforcement de 1º pedido) + matriz de stacking permitido (cupom+cashback+combo+frete). Kits: como a VNDA modela.
5. **Export VNDA:** o que o contrato garante (clientes, pedidos com itens, cupons, saldos `/credits` em massa, XMLs) e prazo de aviso de saída.
6. **Passivo de cashback:** quantos clientes com saldo ATIVO e R$ total (dimensiona §9.1).
7. **Latência:** aceitar DO-NYC (~110–140ms RTT no checkout) ou considerar provider com região SP para o backend? (Storefront na Vercel `gru1` mitiga parcialmente.)
8. **Domínio do dual-run:** `nova.bulking.com.br` (proposta) e critério de rampa de tráfego.
9. **whatsapp-worker:** onde roda hoje, quem monitora; migrar os cron-jobs para o worker Medusa ou manter?
10. **Institucionais/blog:** o que existe na VNDA hoje (crawl completo) e o que os substitui (hardcoded vs CMS headless).
11. **Troquecommerce:** confirmar com eles o funcionamento keyed por pedido de outra plataforma (order code novo) + pedidos VNDA antigos pós-cutover.
12. **Data-alvo:** cutover antes de setembro ou pular para janeiro/2027 (nunca Q4).
13. **Operação:** quem cadastra produto/edita pedido/dá refund no admin hoje → treinamento no admin Medusa; quem fica de on-call.

---

## 17. Fases e esforço (estimativa honesta)

| Fase | Conteúdo | Duração |
|---|---|---|
| 0. Descoberta | Perguntas §16 (gateway, frete, elo Eccosys, exports), baseline congelado, POC: Medusa vazio no droplet + loyalty plugin + provider de pagamento em sandbox | 2–3 semanas |
| 1. Fundação | Repo `bulking-store`, infra DO completa (hardening §12), CI/CD, clone de catálogo + B2, storefront base com tema | 4–6 semanas |
| 2. Comércio | Payment provider (PIX/cartão/boleto) + checkout BR + frete + promotions (PRIMEIRAVEZ, combos) | 4–6 semanas |
| 3. Integrações | Eccosys (estoque full + pedidos + NF-e loop), webhook unificado no dashboard, `store_connections`, feeds Meta/GMC | 3–4 semanas |
| 4. Features | Componentes nativos (prateleiras, topbar, gift-bar, etiquetas, reviews, buybar, chat), tracking SDK (GA4+CAPI), cashback no store credit, cart-recovery | 4–5 semanas |
| 5. Dual-run | Fase B do §14: pedidos reais controlados, calibração, correções | 4+ semanas |
| 6. Cutover + estabilização | Fase C/D do §14 | 2 semanas + 4 de vigília |

**Total: ~4,5–6 meses.** Paralelizável parcialmente (fases 2/3/4). O caminho crítico é pagamento→checkout→dual-run.

---

## Apêndice — fatos de pesquisa que sustentam decisões

- Medusa v2.17.2 (01/07/2026), MIT, minor mensal COM breaking changes por política; starter antigo arquivado 02/07/2026 → `medusajs/dtc-starter`.
- Loyalty/Store Credit plugin open source desde 28/04/2026 (requer ≥2.14).
- RBAC/SSO/audit = só Enterprise/Cloud; MFA no OSS desde 2.15.5.
- Zero plugin de pagamento BR completo p/ v2; zero case BR público em produção; Kangu extinta 01/2025; plugin Melhor Envio v2 (jun/2026) só faz cotação.
- B2+Cloudflare Bandwidth Alliance ativa (egress $0); B2 $6/TB/mês; API calls grátis desde 05/2026.
- DO: sem região BR; Managed PG com PITR 7d incluso; conexões 25/GiB−3; Docker publica portas por cima do UFW.
- Meta: editar URL de anúncio = novo creative + learning reset; feed/catálogo existente com mesmos `id`s = learning preservado; GMC re-review 24–72h por URL alterada.
- Benchmarks de replatform: queda orgânica 10–20% no 1º mês é normal; 83% estouram prazo/orçamento; rollback window 15min pós-DNS; loja velha viva ≥2 semanas.

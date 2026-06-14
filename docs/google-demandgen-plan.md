# Plano — Demand Gen no Google com criativos vencedores do Meta + Lookalike

> **Status: PLANO PARA APROVAÇÃO. Nada construído/gasto ainda.**
> Conta: Bulking Oficial `746-695-9970` (sob MCC `591-933-9478`).
> Régua de marca aplicada: `docs/bulking-manifesto.md` (criativo evergreen, copy do manifesto).

---

## 1. Seleção de criativo (Meta → Google), filtrada 2x

Top criativos do Meta (90d) passados por **dois filtros**: (A) manifesto (evergreen, on-code, sem desconto) e (B) **policy de imagem do Demand Gen** (Google reprova imagem com **texto sobreposto, botão fake ou preço cravado**).

| Criativo Meta | ROAS | Manifesto | Policy Demand Gen | Veredito |
|---|---:|---|---|---|
| **Heavy (AD_IMG_02)** — academia raiz, 2 caras, preto Bulking, **sem texto** | **16.88x** | ✅ ouro | ✅ imagem limpa | **USAR** |
| Heavy (variante) — mesmo mundo + "Heavy Collection" + botão SHOP NOW | 0x | ✅ on-code | ❌ texto+botão cravados | usar só se **versão sem overlay** |
| Darkside — grid de camisetas + "DISPONÍVEL AGORA" | 1.46x | ⚠️ banner | ❌ texto+botão | não (é banner) |
| "R$86 / PREÇO FIXO" | 8.73x | ❌ desconto | ❌ preço cravado | não |
| Carnaval / Inverno / Cupom / Kits | vários | ❌ sazonal/promo | — | não |

**Conclusão:** usar o **mundo Heavy** (foto de academia raiz, limpa). É o melhor do Meta **e** o mais alinhado ao manifesto **e** o único que passa na policy do Demand Gen.

### O que precisamos de imagem (input seu)
O Demand Gen exige **3 proporções limpas** (sem texto) + logo:
- **Landscape 1.91:1** — rec. 1200×628 (obrigatória)
- **Quadrada 1:1** — rec. 1200×1200 (obrigatória)
- **Retrato 4:5** — rec. 960×1200 (recomendada)
- **Logo 1:1** — rec. 1200×1200 (obrigatória; renderiza com corte circular)

O `AD_IMG_02` original parece retrato. Precisamos das **fotos cruas do ensaio Heavy** (sem overlay) pra recortar nas 3 proporções, **ou** autorização pra eu recortar a partir das que temos (risco de cortar o enquadramento). E o **arquivo do logo** Bulking 1:1.

---

## 2. Copy (do manifesto — NÃO a copy promo do Meta)

Demand Gen é descoberta (topo/meio de funil). Headlines ≤40 / descrições ≤90 / business_name ≤25, tudo das Frases Matriz:

**Headlines (≤40):**
- A peça vem depois da atitude.
- Respeito vem antes da peça.
- Tem quem quer parecer. Tem quem faz.
- A Bulking não veste desculpa.
- Se precisa gritar, falta peso.
- O processo não precisa de plateia.

**Descrições (≤90):**
- Não é sobre camiseta. É sobre o que você aceita vestir todo dia.
- Roupa não constrói respeito. Respeito vem antes da peça.
- Pra quem leva o processo a sério. Se procura consolo, não é aqui.
- Caimento, padrão, peso. A peça acompanha quem já decidiu fazer.

**business_name:** `Bulking` · **CTA:** `SHOP_NOW` (ou `LEARN_MORE` p/ público frio) · **Final URL:** `https://www.bulking.com.br/heavy` (a confirmar)

---

## 3. Estrutura da campanha

- **1 campanha** `advertising_channel_type = DEMAND_GEN`, criada **PAUSADA** (assets passam por revisão).
- **Bidding:** `Maximize Conversions` no início (pouco histórico de compra atribuída → tCPA/tROAS só depois de acumular conversão). Meta = PURCHASE (já corrigimos as metas: WhatsApp saiu do biddable).
- **1 ad group**, ad tipo `demand_gen_multi_asset_ad` (responsivo de imagem).
- **Canais:** começar com Discover + Gmail + YouTube in-feed (desligar in-stream/shorts no início p/ controlar contexto).
- **Orçamento sugerido:** R$ 50–80/dia (teste controlado; comparável ao que rodava em Demand Gen). Escalar só com sinal de compra real.

---

## 4. Lookalike — ⚠️ caminho com travas reais

Você ouviu certo: **Demand Gen tem Lookalike** (Narrow/Balanced/Broad). Mas a semente é uma lista **Customer Match** (clientes com hash) e há 3 obstáculos:

1. 🔴 **Trava de abr/2026:** requisições de Customer Match falham se o **developer token não tiver histórico de Customer Match**. Nosso token é novo → provável `falha`. Saída: usar a **Data Manager API** (API separada, build à parte) ou validar antes com um teste pequeno.
2. **Elegibilidade de Targeting:** usar lookalike em modo Targeting exige **90 dias de conta + >US$50k de gasto histórico**. A conta é antiga (provável que cumpra), mas precisa confirmar.
3. **Tamanho da semente:** ~**1.000 clientes "matched"** ativos (subir ≥5.000 e-mails/telefones do Supabase/VNDA, com consentimento). Match leva até 48h.

**Recomendação (sequência inteligente):**
- **Fase A — subir a campanha JÁ** com criativo Heavy + **"optimized targeting"** nativo do Demand Gen (o Google expande sozinho). Não depende de Customer Match.
- **Fase B — adicionar o lookalike depois**, quando resolvermos Customer Match (testar token / Data Manager API / confirmar os US$50k). Lookalike hoje (mudança de mar/2026) já é mais "sinal de IA" que cerca rígida, então o ganho marginal de esperar por ele é menor do que parece.

---

## 5. Fases de build (o que eu construo via API — cada execução é escrita em produção, com sua confirmação)

| Fase | O que | Risco |
|---|---|---|
| **1. Upload de assets** | `AssetService` — subir as imagens Heavy (base64) + logo como Image Assets | baixo |
| **2. Criar Demand Gen** | 1 mutate atômico: budget → campanha (PAUSADA) → ad group → ad multi-asset com os assets+copy | médio (cria campanha) |
| **3. Revisar e ativar** | conferir no painel, assets aprovados → flipar p/ ENABLED | baixo |
| **4. (depois) Customer Match** | lista + OfflineUserDataJob **ou** Data Manager API (devido à trava) | alto (dados de cliente, trava de token) |
| **5. (depois) Lookalike** | `LookalikeUserListInfo` (seed + Balanced + BR) → targeting no ad group | médio |

Especificações técnicas completas (campos, proporções, limites, hashing) estão verificadas e guardadas — usadas na hora do build.

---

## 6. Checklist do manifesto (seção 10) aplicado a este plano

- **A) Copy:** toca ferida ✅ · afasta quem não pertence ✅ · adulta (não trend) ✅ · sai de qualquer marca fitness? ❌ (é Bulking) ✅ · sem cara de IA ✅ · sem fantasia/atalho ✅ · sem promo p/ público frio ✅
- **B) Criativo:** sazonal/expirado? ❌ (Heavy é evergreen) ✅ · conferi o CONTEÚDO da mídia (olhei a imagem) ✅ · evergreen/alinhado ao código ✅ · sem gritaria de desconto ✅
- **C) Régua final:** separa, incomoda e identifica → ✅ no caminho.

---

## 7. O que preciso de você pra construir

1. **Imagens Heavy limpas** (sem texto) — fotos cruas do ensaio, ou autorização pra eu recortar as que temos.
2. **Logo Bulking** 1:1 (arquivo, ≥128×128, idealmente 1200×1200).
3. **Final URL** (confirma `/heavy`?).
4. **Orçamento/dia** (sugiro R$ 50–80).
5. **Decisão lookalike:** Fase A agora (sem lookalike) + Fase B depois? (recomendado)
6. **Aprovar** este plano pra eu começar pela Fase 1.

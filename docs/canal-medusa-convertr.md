# Canal de vendas Medusa → Orders → Convertr (Club/Team)

Novo canal **aditivo** no droplet de produção que espelha o canal VNDA
existente. Ele puxa pedidos da **Medusa**, grava na **mesma tabela `Orders`**
(`postgresbulking` / db `vtexstore`) e monta o mesmo payload `IConvertrOrder`
que alimenta o motor de comissão Club/Team (Convertr).

- **Onde vive:** droplet de produção `164.90.156.139`, em
  `/home/tsAPIMEDUSAORDERS/` (espelho de `/home/tsAPIVNDAORDERS/`).
- **Container:** `tsapimedusaorders-api-1`, imagem
  `tsapimedusaorders-api-medusa`, porta **5000**, compose isolado
  (`/home/tsAPIMEDUSAORDERS/docker-compose.yml`), rede compartilhada
  `tsapivtexorders_default` (só para alcançar o Postgres no cutover).
- **Nasce DRY/OFF:** `MEDUSA_CHANNEL_LIVE=0`. Em DRY ele puxa + mapeia +
  **loga** a row e o payload Convertr, mas **não grava** em `Orders` e **não
  chama** o Convertr. A ativação é passo de cutover.
- **README operacional completo no droplet:** `/home/tsAPIMEDUSAORDERS/README-cutover.md`.

> Não toca nos canais VNDA/VTEX nem no compose deles. Compose, imagem, porta e
> rede próprios.

## Arquitetura da casa (o que foi extraído, read-only)

Cada canal = 1 container API (TS em camadas) que puxa pedidos da fonte e grava
em `Orders`:

- **VNDA** (`tsAPIVNDAORDERS`, porta 4000): `execute()/single()/canceled()`
  puxam de `api.vnda.com.br` e chamam `OrderData.create()` → grava em `Orders`.
- **VTEX/orquestrador** (`tsAPIVTEXORDERS`, porta 3000): além de puxar VTEX,
  recebe webhooks (`/orders/webhook`, `/convertr/webhook`) e repassa para a API
  VNDA (`/convertr/webhook/order`), que persiste via
  `OrderData.createConvertrOrder()`. A autenticação **outbound** ao Convertr
  (`ConvertrAuthModule`, `POST /api/auth/login`) mora só no projeto VTEX.
- **Motor de comissão (Convertr)** credita o membro a partir do **cupom** do
  pedido. A tabela `Orders` é a cópia que o relatório Club/Team consome.

Relatório de cupom (`ordersbycoupon`/`couponsreport`, projeto VTEX) filtra
`orderStatus IN ('paid','confirmed')`, agrupa por `orderMarketingCoupoun`
(armazenado **UPPERCASE**) e soma `orderValue` numa janela de
`orderAuthorizedDate`. O canal Medusa respeita exatamente isso.

## Mapeamento campo a campo — pedido Medusa → row `Orders`

O objeto mapeado é passado para o `OrderData.create(mapped, rawMedusaOrder)`
**inalterado** (mesmo código do VNDA), então a row é idêntica em forma.

| Coluna `Orders`          | Fonte Medusa | Observação |
|--------------------------|--------------|------------|
| `orderId`                | `MED-<display_id>` | Prefixo evita colisão com VNDA/VTEX. |
| `orderStatus`            | constante `confirmed` | Passa no filtro `IN('paid','confirmed')`. Status cru em `jsonCustomized.medusa_status`. |
| `orderStatusDescription` | `Medusa #<id> · pay:<payment_status> · ful:<fulfillment_status>` | Análogo do `delivery_message` VNDA. |
| `orderAuthorizedDate`    | `payment_collections[].completed_at` ?? `created_at` | Relatório usa esta data. |
| `orderCreationDate`      | `created_at` | |
| `orderCustomerFirstName` | `customer.first_name` ?? `shipping_address.first_name` | Nome do cliente costuma ser nulo na Medusa. |
| `orderCustomerLastName`  | `customer.last_name` ?? `shipping_address.last_name` | |
| `orderMarketingCoupoun`  | cupom club/team de `promotions[].code`, **UPPERCASE** | Ver "qual cupom conta". |
| `orderValue`             | `total` **do endpoint de LISTA** | O detalhe de 1 pedido retorna total parcial (artefato de versão do Medusa v2). |
| `jsonList`               | `{}` | Igual VNDA. |
| `jsonGet`                | pedido Medusa cru (completo) | Mesmo slot do "raw order" do VNDA. |
| `jsonCustomized`         | objeto mapeado (`code`, `client_*`, `coupon_code`, `total`, `medusa_*`) | Mesmo slot do `IOrder` mapeado do VNDA. |
| `payments[]`             | 1 linha: `paymentSystem='medusa'`, `paymentSystemName='Medusa'`, value=`total` | Espelha a forma de pagamento única do VNDA. |

**Quais pedidos processa:** não `canceled/draft/archived` E
`payment_status ∈ {authorized, captured, partially_captured, partially_refunded}`.

**Qual cupom conta:** dentre os `promotions[].code`, prefere o que casa
`MEDUSA_COUPON_REGEX` (default `(CLUB|TEAM)`), senão o primeiro; sempre
UPPERCASE; nenhum → `null`.

## Payload Convertr — pedido Medusa → `IConvertrOrder`

Mesma forma de `src/types/ConvertrTypes.ts`:
`id`/`increment_id`=`display_id`, `uuid`=id interno `order_...`,
`channel='medusa'`, `discounts[]` a partir das promotions
(`{ coupon: CODE_UPPER, discount, ... }` — o motor credita pelo **cupom**),
`items[]`, `address`, `customer`, `shipping`, `total`, `subtotal`, `discount`,
`created_at`; `status`: `captured→paid`, `authorized→confirmed`, senão `pending`.

## Prefixo do `orderId`

`MED-<display_id>`. Usa o número **display_id** (incremental, estável, o número
que aparece pro lojista/relatório), não o id interno `order_01K...`. O id interno
fica preservado em `jsonGet.id`, `jsonCustomized.id` e no `uuid` do Convertr.
`MED-` garante zero colisão com VNDA (`D44DBBB16A`) e VTEX (numérico).

## Variáveis de ambiente

| Var | DRY / staging | Cutover (produção) |
|-----|---------------|--------------------|
| `MEDUSA_CHANNEL_LIVE` | `0` (OFF) | **`1`** |
| `MEDUSA_URL` | staging (`vague-value-wander.medusajs.app`) | URL Medusa de produção |
| `MEDUSA_ADMIN_API_KEY` | secret `sk_...` de staging (Basic auth) | secret `sk_...` de produção |
| `MEDUSA_ADMIN_TOKEN` | (fallback Bearer JWT p/ teste rápido) | não usar |
| `ORDER_ID_PREFIX` | `MED-` | `MED-` |
| `MEDUSA_COUPON_REGEX` | `(CLUB\|TEAM)` | padrão real dos códigos club/team |
| `DATABASE_URL` | `postgresbulking:5432/vtexstore` | igual |
| `API_PORT` | `5000` | `5000` |

Auth no código: `MEDUSA_ADMIN_API_KEY` (Basic — chave como usuário, senha
vazia) tem precedência; senão `MEDUSA_ADMIN_TOKEN` (Bearer). Padrão Medusa v2.

## Kill-switch (defesa em profundidade)

`src/lib/killswitch.ts::isLive()` é checado em **dois** níveis: no `OrdersModule`
(em DRY loga `WOULD_UPSERT_ORDERS_ROW` + `WOULD_PROCESS_CONVERTR_PAYLOAD` e não
chama o banco) e no `OrdersData` (todo método de escrita curto-circuita com log
`SKIPPED` se não estiver LIVE). Nem um caminho acidental grava com a chave OFF.

## Prova DRY (staging)

Contra 2 pedidos sintéticos na Medusa **staging** (cupons FAKE):

- `MED-3` → `orderMarketingCoupoun=FAKECLUB001`, `orderValue=198.1`,
  `orderStatus=confirmed`; payload Convertr com `discounts[].coupon=FAKECLUB001`,
  `channel='medusa'`, `increment_id=3`.
- `MED-1` → `orderMarketingCoupoun=null`, `orderValue=78.9`.
- `SELECT count(*) FROM "Orders" WHERE "orderId" LIKE 'MED-%'` = **0** (nada
  gravado). Nenhuma chamada ao Convertr. Os 4 containers antigos intactos.

## Passo a passo do cutover

1. No compose: `MEDUSA_URL` = Medusa de produção, `MEDUSA_ADMIN_API_KEY` =
   secret de produção, `MEDUSA_COUPON_REGEX` = padrão real.
2. `MEDUSA_CHANNEL_LIVE=1`.
3. `docker compose up -d` (rebuild só se mudou código).
4. Agendar/backfill: acionar `GET /orders` (cron) para ingerir. A 1ª rodada grava
   as rows `MED-*`.
5. Conferir: `SELECT count(*) ... WHERE "orderId" LIKE 'MED-%'` cresce; relatório
   por cupom mostra os códigos club/team.
6. **Crédito no Convertr:** este canal persiste a row (cópia do dashboard). O
   crédito do membro é dirigido pelo cupom no motor Convertr — ligar o passo
   outbound aqui **deliberadamente** (fica ausente agora para nada creditar em
   dry). Validar dupla-contagem com o canal VNDA antes de habilitar.
7. Revogar a chave `sk_` de staging quando a de produção entrar.

## Gotchas

- **Totais:** usar `total` do endpoint de LISTA (detalhe de 1 pedido dá total
  parcial no Medusa v2).
- **Nome do cliente:** normalmente nulo no customer → cair no shipping address.
- **Dockerfile:** build com `npm install` completo (não `--production`) para ter
  `tsc`; a imagem VNDA só compilava porque o contexto dela carregava um
  `node_modules` do host — este canal exclui `node_modules` via `.dockerignore`.
- **Disco:** raiz do droplet em ~93–95%. Imagem ~458 MB.

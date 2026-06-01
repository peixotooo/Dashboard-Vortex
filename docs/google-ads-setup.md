# Google Ads — colocar a página `/google-ads` para funcionar 100%

A integração do Google Ads (código em [`src/lib/google-ads-api.ts`](../src/lib/google-ads-api.ts))
estava completa, mas **nunca teve credenciais configuradas** — por isso a página
`/google-ads` sempre caiu no estado de erro/vazio. Este guia leva você do zero até
dados reais aparecendo no dashboard.

> ⏱️ Tempo: ~30 min de setup + **~2 dias úteis** de espera pela aprovação do
> developer token (o gargalo é a Google, não o código).

---

## ⚠️ As duas armadilhas que fazem "nunca funcionar 100%"

Antes de tudo, conheça os dois erros silenciosos mais comuns:

1. **Developer token "Test Access" não consulta contas reais.** Um token recém-criado
   nasce no nível *Test Account Access* e **só funciona em contas de teste**. Apontar
   para uma conta real retorna `DEVELOPER_TOKEN_NOT_APPROVED`. É preciso pedir
   **Basic Access** (~2 dias úteis). Por isso o token tem que vir de uma conta
   **gerenciadora (MCC)** — conta avulsa nem consegue solicitar.

2. **Refresh token em modo "Testing" expira em 7 dias.** Se a tela de consentimento
   OAuth ficar com status *Testing*, o refresh token morre em 7 dias e a página volta
   a quebrar. **Publique o app** (status *In production*) antes de gerar o token.

O script [`scripts/google-ads-doctor.ts`](../scripts/google-ads-doctor.ts) detecta
ambos e diz o que fazer.

---

## Variáveis necessárias

| Variável | O que é | Onde obter |
|---|---|---|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Token de 22 caracteres | API Center da conta MCC |
| `GOOGLE_ADS_CLIENT_ID` | OAuth client ID | Google Cloud Console |
| `GOOGLE_ADS_CLIENT_SECRET` | OAuth client secret | Google Cloud Console |
| `GOOGLE_ADS_REFRESH_TOKEN` | Refresh token OAuth | `scripts/google-ads-auth.ts` |
| `GOOGLE_ADS_CUSTOMER_ID` | ID da conta a consultar (só dígitos) | `scripts/google-ads-auth.ts` |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | ID da MCC (só p/ contas gerenciadas) | opcional |
| `GOOGLE_ADS_API_VERSION` | Versão da API (default `v24`) | opcional |

---

## Passo 1 — Conta gerenciadora (MCC) e developer token

1. Tenha (ou crie) uma **conta gerenciadora** em <https://ads.google.com> →
   "Criar conta gerenciadora". Um token de produção **não** sai de conta avulsa nem
   de MCC de teste.
2. Logado na MCC, acesse <https://ads.google.com/aw/apicenter>
   (ou *Ferramentas e Configurações → Configuração → API Center*).
3. Preencha o formulário de acesso à API: site da empresa **no ar**, e-mail de contato
   **monitorado** (a Google pode pedir esclarecimentos por e-mail), aceite os termos.
4. Copie o **developer token** (22 caracteres). Anote o **nível de acesso** mostrado.
5. No dropdown de nível, clique em **"Apply for Basic Access"**, escolha o uso
   (gerenciamento / relatórios). Aprovação em **~2 dias úteis**.

> Enquanto o nível for *Test Account Access*, qualquer chamada a conta real falha com
> `DEVELOPER_TOKEN_NOT_APPROVED`. Isso é esperado até o Basic ser aprovado.

## Passo 2 — Projeto Google Cloud + OAuth client

1. Em <https://console.cloud.google.com> selecione/crie um projeto.
2. *APIs & Services → Library* → busque **"Google Ads API"** → **Enable**.
3. *APIs & Services → OAuth consent screen*:
   - User type: **External**.
   - Preencha nome do app, e-mail de suporte e contato.
   - Adicione o escopo `https://www.googleapis.com/auth/adwords`.
   - **Clique em "Publish app"** para mudar o status para **"In production"**.
     (Se deixar em *Testing*, o refresh token expira em 7 dias.)
4. *APIs & Services → Credentials → Create credentials → OAuth client ID*:
   - Application type: **Desktop app**.
   - Copie o **Client ID** e o **Client secret**.

## Passo 3 — Gerar o refresh token (e descobrir o customer ID)

1. No `.env.local`, preencha por enquanto:
   ```
   GOOGLE_ADS_CLIENT_ID=...
   GOOGLE_ADS_CLIENT_SECRET=...
   GOOGLE_ADS_DEVELOPER_TOKEN=...   # se já tiver
   ```
2. Rode:
   ```bash
   npx tsx scripts/google-ads-auth.ts
   ```
   Abre o navegador, você autoriza (clique em *Avançado → Continuar* se aparecer
   "app não verificado") e o script imprime:
   ```
   GOOGLE_ADS_REFRESH_TOKEN=1//0g...
   ```
   Se o developer token estiver presente, ele também **lista suas contas** com ID,
   nome, se é MANAGER/MCC e se é de teste.

3. Preencha o resto do `.env.local`:
   ```
   GOOGLE_ADS_REFRESH_TOKEN=1//0g...
   GOOGLE_ADS_CUSTOMER_ID=1234567890        # conta real, NÃO-manager, só dígitos
   GOOGLE_ADS_LOGIN_CUSTOMER_ID=0987654321  # só se a conta estiver sob uma MCC
   ```

## Passo 4 — Validar

```bash
npx tsx scripts/google-ads-doctor.ts
```
Ele checa as variáveis, renova o token, lista contas e roda uma query real de
campanhas. No fim, `✅ Tudo funcionando 100%`. Qualquer falha vem com o motivo e o
conserto exato.

## Passo 5 — Produção (Vercel)

As mesmas 5–6 variáveis precisam existir na Vercel:

```bash
# via CLI (uma a uma; cole o valor quando pedir)
vercel env add GOOGLE_ADS_DEVELOPER_TOKEN production
vercel env add GOOGLE_ADS_CLIENT_ID production
vercel env add GOOGLE_ADS_CLIENT_SECRET production
vercel env add GOOGLE_ADS_REFRESH_TOKEN production
vercel env add GOOGLE_ADS_CUSTOMER_ID production
# GOOGLE_ADS_LOGIN_CUSTOMER_ID production   # só se MCC
```
Ou em *Project → Settings → Environment Variables*. Depois, redeploy.

---

## Descoberta de contas pela API (alternativa ao script)

Com as credenciais no ar, o endpoint `GET /api/google-ads/accounts` retorna as contas
acessíveis (id, nome, manager, moeda, timezone) — útil para confirmar o
`GOOGLE_ADS_CUSTOMER_ID` direto do app.

## Versões da API (manutenção futura)

A Google descontinua versões ~trimestralmente; uma versão *sunset* faz **toda chamada
retornar 404**. O código usa `GOOGLE_ADS_API_VERSION` (default `v24`). Para atualizar,
basta trocar essa env — sem mexer no código. Acompanhe
<https://developers.google.com/google-ads/api/docs/sunset-dates>.

## Troubleshooting

| Sintoma | Causa | Conserto |
|---|---|---|
| `DEVELOPER_TOKEN_NOT_APPROVED` | Token em nível *Test* | Pedir Basic Access no API Center |
| `invalid_grant` ao renovar | Refresh token expirou/revogado | Publicar consent screen + rodar `google-ads-auth.ts` |
| 404 em toda chamada | Versão da API descontinuada | `GOOGLE_ADS_API_VERSION=v24` |
| `CUSTOMER_NOT_FOUND` | Customer ID errado/com hífen | Só dígitos; conferir conta |
| `USER_PERMISSION_DENIED` | Sem acesso / falta MCC | Definir `GOOGLE_ADS_LOGIN_CUSTOMER_ID` |
| Página vazia, sem erro | Sem campanhas no período | Trocar o período no seletor de datas |

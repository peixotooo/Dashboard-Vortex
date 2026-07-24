# Auditoria de Segurança - Dashboard Vortex

Data: 23/07/2026
Escopo: aplicação Next.js, rotas de API, scripts públicos da loja, autenticação e autorização, Supabase/RLS/RPC, integrações, webhooks, armazenamento, dependências e comportamento exposto em produção.

## Resumo executivo

A auditoria encontrou **2 falhas críticas, 7 altas, 6 médias e 2 baixas**. As duas falhas críticas foram reproduzidas de forma não destrutiva:

1. O middleware aceita uma sessão local sem validar a assinatura do JWT. Um JWT inválido atravessou a proteção de páginas e permitiu baixar um CSV real com dados comerciais que está em `public/`.
2. Funções `SECURITY DEFINER` da fila de e-mail iPORTO estão executáveis pelo papel anônimo. Elas podem revelar destinatários e alterar o estado da fila.

Também foram confirmados problemas de vinculação OAuth, autorização apenas visual, XSS armazenado na loja, exposição pública de analytics, uso público do Meta CAPI, mutação entre tenants, webhooks sem autenticação e rate limiting insuficiente.

Não foi encontrada injeção SQL clássica executável. Há, porém, interpolação insegura na gramática de filtros do PostgREST e vários usos de `service_role` que tornam a autorização da API especialmente importante.

## Metodologia

- Inventário de 1.671 arquivos versionados e 383 rotas de API.
- Busca estática dirigida para autenticação, autorização, XSS, SQL/filters, CSRF, CORS, SSRF, secrets, uploads, webhooks, funções SQL e uso de `service_role`.
- Revisão manual das cadeias de dados entre API, banco, dashboard e scripts da loja.
- Auditoria de dependências de produção com `npm audit --omit=dev`.
- Testes HTTP não destrutivos em produção, sem alterar dados reais.
- Testes anônimos das funções RPC usando apenas a chave pública destinada ao cliente.

O scanner Ghost externo atingiu o limite da ferramenta durante a execução. A cobertura foi substituída por varreduras locais, revisão manual e testes dinâmicos dirigidos. Esta auditoria não inclui pentest destrutivo, infraestrutura da Vercel/Supabase fora do repositório nem consoles dos provedores.

## Status das correções - 24/07/2026

A rodada de correção foi implementada no código com preservação explícita das superfícies públicas da loja. Os achados originais permanecem abaixo como registro da evidência; o estado atual é:

- **SEC-001:** corrigido no código. Middleware usa `getUser()`, exports comerciais foram removidos de `public/` e novos CSVs públicos são ignorados no Git/deploy.
- **SEC-002:** corrigido e verificado no Supabase. A migration 144 revoga `public`, `anon` e `authenticated`, concede acesso exclusivo ao `service_role` e limita internamente o lote.
- **SEC-003:** corrigido. OAuth ML/TikTok exige administrador, nonce forte em cookie, workspace válido e nova autorização no callback.
- **SEC-004/005:** corrigido nos fluxos confirmados. Há autorização funcional central por rota, HTML rico da loja é sanitizado, URLs/seletores são validados, previews foram isolados e rotas por ID agora filtram o workspace.
- **SEC-006/011:** corrigido. CAPI, telemetria, assistente, checkout, prateleiras, topbar e pedido de presente usam origem exata conhecida e, após resolver a chave, origem pertencente ao workspace. `Purchase` do navegador só é enviado após conferência com pedido real.
- **SEC-007/008:** corrigido. Analytics exigem contexto autorizado e a mutação de cashback está tenant-scoped.
- **SEC-009:** endurecido segundo o contrato publicado pelo Mercado Livre: allowlist oficial de rede, esquema/tamanho estritos, rate limit, recurso de pedido estrito e processamento garantido com `after()`.
- **SEC-010:** corrigido e verificado no Supabase. A migration 145 e o helper atômico estão ativos; rotas públicas e caras usam o rate limit compartilhado.
- **SEC-012:** corrigido e verificado no Supabase. A migration 146 deixou o bucket privado, limitado a 50 MB e restrito a CSV/texto; o helper usa URLs assinadas.
- **SEC-013:** corrigido. Next e dependências transitivas foram atualizados/pinados; o adaptador transitivo do MCP foi sobrescrito para a versão corrigida e teve seus imports reais validados. `npm audit --omit=dev` retorna zero vulnerabilidades.
- **SEC-014/015/016:** corrigido nos caminhos identificados: verificação central de origem nas mutações autenticadas, parser de webhook limitado, sanitização real de e-mail e escape de filtros PostgREST.
- **SEC-017:** `.env*` foi excluído do deploy. A assinatura expirada do handoff de carrinho permanece como melhoria separada.

Achados adicionais fechados nesta rodada:

- travessia de diretório e symlink na importação de CMV;
- escalada de função que permitia administrador remover proprietário ou promover administradores;
- duplicação concorrente de avaliações, agora protegida por claim atômico `submitting`;
- mensagens de iframe sem validação de `source`;
- proxy de mídia do Instagram seguindo redirect antes de validar o destino;
- extensões de upload controladas pelo nome do arquivo, agora derivadas do MIME permitido;
- logs contendo documento do comprador ou e-mail de destinatário;
- redirecionamento `next` do callback de autenticação sem validação de caminho local.
- SSRF em imagens, catálogos e integrações configuráveis: destinos agora exigem HTTPS público, bloqueiam DNS/IP privado, limitam redirects e removem credenciais em mudança de origem;
- credenciais de WhatsApp, avaliações, e-mail, CAPI, agente e cashback agora só podem ser alteradas por owner/admin, com corpo e formato limitados;
- bypass direto da hierarquia via Supabase: a migration 144 também revoga escrita direta em membros/workspaces e restringe atualização de perfil aos campos públicos;
- links de convite e webhooks exibidos no painel usam a origem configurada do dashboard, sem confiar no header `Host`;
- corpos JSON públicos e webhooks são lidos por streaming e interrompidos ao exceder o limite, inclusive sem `Content-Length`.

Validação executada sobre a árvore final:

- TypeScript sem erros (`npx tsc --noEmit`);
- 30/30 testes críticos de segurança;
- 47/47 testes funcionais de recuperação de carrinho, saldo Meta, estoque Eccosys, Instagram e PSP;
- sintaxe válida dos scripts públicos `shelves.js` e `assistant.js`;
- build de produção concluído, com 390 rotas;
- `git diff --check` sem erros e `npm audit --omit=dev` com zero vulnerabilidades.

Residuais deliberados:

- CSP completa por nonce/hash requer inventário e adaptação dos scripts externos da loja; os headers defensivos já foram aplicados, mas essa etapa não foi forçada nesta rodada para não quebrar widgets.
- Tokens de webhooks legados em query string continuam aceitos por compatibilidade com provedores; headers dedicados são preferidos e os segredos devem ser rotacionados.
- `Access-Control-Allow-Origin: *` permanece apenas em leituras públicas sem cookie/credencial e em uploads estritamente vinculados a token aleatório de avaliação.

## Achados

### SEC-001 - Crítico - Bypass de autenticação no middleware e arquivo comercial público

**Evidência**

- `src/middleware.ts:125-130` usa `supabase.auth.getSession()` para decidir se o usuário está autenticado.
- `getSession()` lê a sessão do cookie, mas não valida a assinatura do JWT no servidor.
- Em produção, um JWT com assinatura inválida recebeu `200` na página inicial, enquanto a mesma requisição sem cookie foi redirecionada para `/login`.
- O mesmo JWT inválido baixou `public/produtos_2026-04-09-17-16-24.csv`; o conteúdo remoto teve tamanho e SHA-256 idênticos ao arquivo local.
- O CSV contém preço de custo, estoque e dados fiscais/comerciais.
- Uma API protegida por `getUser()` respondeu `401` ao mesmo JWT, confirmando que o bypass está no middleware.
- Outros CSVs comerciais também estão sob `public/`, como `cadastro-gladiator-preta-exemplo - Worksheet.csv`.

**Impacto**

Um atacante pode acessar páginas cuja única barreira é o middleware e qualquer arquivo sensível em `public/` que pareça protegido pelo redirecionamento.

**Correção**

1. Substituir a decisão baseada em `getSession()` por `await supabase.auth.getUser()` e usar apenas o usuário validado.
2. Remover exports comerciais de `public/`.
3. Servir arquivos privados por endpoint autenticado ou bucket privado com URL assinada curta.
4. Criar teste de integração garantindo redirecionamento/`401` para JWT inválido.

### SEC-002 - Crítico - RPCs `SECURITY DEFINER` do iPORTO expostas ao anônimo

**Evidência**

- `supabase/migration-075-iporto-queue.sql:72` cria `claim_iporto_envios(integer)` como `SECURITY DEFINER`.
- `supabase/migration-075-iporto-queue.sql:93` cria `requeue_iporto_envio(bigint,text,integer)` como `SECURITY DEFINER`.
- A migration não revoga o `EXECUTE` concedido por padrão a `PUBLIC`.
- Em produção, chamadas anônimas não destrutivas às duas RPCs foram aceitas: `claim` com limite zero retornou `200` e `requeue` para ID inexistente retornou `204`.
- `claim_iporto_envios` retorna linhas da fila, incluindo e-mail, nome e variáveis, e muda o status para `processing` quando há linhas.

**Impacto**

Um usuário anônimo pode reivindicar a fila, obter PII e interromper ou reprocessar envios.

**Correção**

```sql
revoke all on function public.claim_iporto_envios(integer)
  from public, anon, authenticated;
revoke all on function public.requeue_iporto_envio(bigint, text, integer)
  from public, anon, authenticated;

grant execute on function public.claim_iporto_envios(integer) to service_role;
grant execute on function public.requeue_iporto_envio(bigint, text, integer)
  to service_role;
```

Também limitar `p_limit` dentro da função e auditar todas as funções `SECURITY DEFINER` futuras. As migrations 137 e 141 já mostram o padrão correto de `REVOKE` + `GRANT`.

### SEC-003 - Alto - Vinculação OAuth indevida no Mercado Livre e TikTok

**Evidência**

- `src/app/api/ml/auth/route.ts:4-28` aceita qualquer `workspace_id`, sem autenticar usuário nem verificar participação/administração no workspace.
- O fluxo do ML gera `state`, mas não persiste nem valida um nonce.
- `src/app/api/ml/callback/route.ts:13-87` confia no workspace recebido pelo `state` e grava tokens com `service_role`.
- `src/app/api/tiktok/auth/route.ts:14-69` e `callback/route.ts:15-118` validam um nonce em cookie, mas continuam sem autenticar o usuário e sem validar sua permissão no workspace informado.
- Em produção, ambos os endpoints iniciaram OAuth para um UUID arbitrário. O ML não definiu cookie de estado; o TikTok definiu o nonce, mas não o vinculou a uma identidade autorizada.

**Impacto**

Um atacante pode iniciar seu próprio OAuth usando o UUID de outro workspace e vincular a própria conta externa ao tenant da vítima, contaminando importações, pedidos e sincronizações.

**Correção**

- Exigir usuário autenticado e função de administrador antes de iniciar o OAuth.
- Vincular servidor-side `nonce + user_id + workspace_id + expiração`.
- No callback, validar o nonce e repetir a autorização do usuário antes da escrita com `service_role`.
- Nunca confiar em `workspace_id` fornecido isoladamente pelo navegador.

### SEC-004 - Alto - XSS armazenado e alteração da loja por membro sem permissão funcional

**Evidência**

- Rotas como `src/app/api/promo-tags/config/route.ts:69-114` e `src/app/api/reviews/route.ts:48-77` exigem apenas participação no workspace e escrevem com `service_role`.
- A rota de reviews permite a qualquer membro criar review já publicado, com `media` arbitrária.
- `public/shelves.js:3624-3637` e `3668-3760` inserem `badge_text` configurável com `innerHTML`.
- `public/shelves.js:257-261` valida o prefixo da URL, mas não escapa aspas antes de formar atributos HTML.
- `public/shelves.js:6701-6706` e `6730-6736` interpolam URLs de mídia em atributos HTML.
- `src/lib/reviews/settings.ts:100-166` aceita configurações sem validar estritamente cor e seletor.
- O `anchor_selector` pode apontar para um elemento amplo, como `body`, e o widget substitui seu conteúdo.
- O preview de recuperação de carrinho usa `dangerouslySetInnerHTML` sem sanitização em `src/app/(dashboard)/crm/cart-recovery/page.tsx:1882-1889` e `2239-2247`.

**Impacto**

Uma conta interna de baixo privilégio pode injetar HTML/JavaScript na loja, publicar conteúdo arbitrário ou alterar a página pública. HTML malicioso da recuperação também pode executar no dashboard de quem abrir o preview.

**Correção**

- Aplicar autorização funcional no servidor, não apenas ocultar menus.
- Usar `textContent`, criação de nós e `setAttribute`, sem concatenar HTML.
- Validar URLs com `URL`, protocolo permitido e host quando necessário.
- Limitar cores a formatos aceitos e seletores a uma lista controlada.
- Sanitizar HTML com biblioteca mantida e configuração restritiva.
- Limpar dados já persistidos antes de reativar o renderizador.
- Adicionar CSP efetiva como segunda camada, nunca como única correção.

O corpo do modal de etiqueta e o Markdown do assistente escapam o conteúdo antes da formatação; esses dois pontos específicos estão corretos.

### SEC-005 - Alto - Autorização funcional é majoritariamente aplicada apenas na interface

**Evidência**

- `src/components/layout/permission-gate.tsx` e a sidebar ocultam módulos conforme função/feature.
- `src/lib/api-auth.ts:197-240` (`getWorkspaceContext`) comprova apenas que o usuário pertence ao workspace.
- Muitas rotas de mutação usam esse helper e depois usam `service_role`, ignorando as permissões que a UI mostra.
- Foram encontradas aproximadamente 110 rotas de mutação com esse padrão, exigindo classificação de política rota a rota.
- Exemplos confirmados:
  - qualquer membro pode alterar promo tags, reviews e configurações públicas;
  - `src/app/api/gift-bar/config/route.ts:26-85` permite mudar a régua pública;
  - `src/app/api/crm/whatsapp/campaigns/route.ts:31-36` permite criar/encaminhar campanha em massa;
  - `src/app/api/crm/email-templates/drafts/[id]/dispatch/route.ts:35-155` permite envio direto de e-mail por qualquer membro;
  - o fluxo de aprovação pode ser aprovado pelo mesmo usuário e também usa apenas participação no workspace.

**Impacto**

Usuários sem acesso visual ao módulo ainda podem chamar a API diretamente e executar ações públicas, destrutivas ou com custo financeiro/reputacional.

**Correção**

Criar um helper central, por exemplo `getWorkspaceFeatureContext(feature, minRole)`, com matriz de capacidades. Exigir administrador ou capacidade explícita para:

- publicação/configuração da loja;
- campanhas e disparos;
- integrações e credenciais;
- exclusões e alterações financeiras;
- importações/exportações de PII;
- operações caras ou irreversíveis.

### SEC-006 - Alto - Meta CAPI público permite falsificar eventos e consumir credenciais privadas

**Evidência**

- `src/app/api/meta-capi/route.ts:85-199` aceita uma chave pública do script da loja e recebe evento, valor, pedido, e-mail, telefone e IP arbitrários.
- `src/lib/meta-capi.ts:16-35` inclui `purchase` no mapa de eventos aceitos.
- A API encaminha o evento usando as credenciais privadas do Meta.
- `src/lib/cors.ts:13-21` reflete qualquer `Origin` e envia `Access-Control-Allow-Credentials: true`.
- Em produção, um preflight de origem não confiável recebeu essa origem refletida.

**Impacto**

Terceiros podem forjar compras, contaminar a otimização/atribuição do Meta, consumir quota e enviar PII arbitrária em nome da empresa.

**Correção**

- Restringir origens aos domínios cadastrados do workspace.
- Não aceitar `Purchase` no endpoint público; gerar compra apenas do webhook autenticado do pedido.
- Ignorar IP enviado no corpo e derivar o IP confiável da requisição/proxy.
- Validar esquema, tamanho, eventos permitidos e idempotência.
- Aplicar rate limit distribuído por IP, chave, workspace e evento.

### SEC-007 - Alto - Analytics e contas de anúncios expostos sem autenticação

**Evidência**

- `src/app/api/ga4/insights/route.ts:6-78` não autentica e retorna receita, transações, sessões e custo de Google Ads para um `property_id`.
- `src/app/api/google-ads/accounts/route.ts:10-16` não autentica e lista as contas acessíveis pelas credenciais do servidor.
- Em produção, ambos retornaram `200` sem sessão; a lista continha metadados de quatro contas.

**Impacto**

Exposição de desempenho comercial e estrutura de contas de mídia a qualquer pessoa.

**Correção**

Exigir usuário e workspace autorizados, mapear propriedade/conta no servidor e não aceitar IDs soltos como autorização. Aplicar cache e rate limit.

### SEC-008 - Alto - Mutação entre tenants em lembrete de cashback

**Evidência**

- `src/app/api/cashback/transactions/[id]/force-reminder/route.ts:32-42` zera o lembrete pelo UUID recebido antes de filtrar pelo `workspace_id`.
- A leitura posterior é filtrada, mas a primeira escrita com `service_role` já aconteceu.

**Impacto**

Um administrador pode alterar uma transação de outro workspace se conhecer ou obtiver seu UUID.

**Correção**

Adicionar `.eq("workspace_id", auth.workspaceId)` a toda escrita e exclusão com `service_role`. Criar teste multi-tenant que confirme que UUID estrangeiro permanece inalterado.

### SEC-009 - Alto - Webhook do Mercado Livre sem autenticação

**Evidência**

- `src/app/api/ml/webhook/route.ts:8-64` não valida assinatura, segredo ou origem.
- Confia no `user_id` recebido, registra o corpo e aciona sincronização interna de pedidos com o `CRON_SECRET`.
- Em produção, um `POST` anônimo com corpo vazio foi aceito com `200`.

**Impacto**

Quem souber um `user_id` pode provocar sincronizações, chamadas externas e volume de logs, com possível impacto em pedidos/estoque e custo operacional.

**Correção**

Validar a autenticação oficial do provedor ou segredo dedicado, esquema/tamanho do corpo, idempotência, timestamp e rate limit. Não registrar payload bruto com PII.

### SEC-010 - Médio - Rate limiting insuficiente e local à instância

**Evidência**

- Das 383 rotas de API, apenas um pequeno grupo possui limitador explícito.
- Os limitadores encontrados usam `Map` em memória em vários pontos; em ambiente serverless, reiniciam e não compartilham contagem entre instâncias.
- CAPI, telemetria pública, webhooks, OAuth, analytics públicos e operações caras não têm controle distribuído consistente.
- `src/app/api/reviews/request/[token]/upload-url/route.ts:13-103` permite até 20 URLs pré-assinadas por minuto por instância, com vídeo de até 80 MB.

**Impacto**

Abuso de quota, custos, poluição de dados, spam e negação de serviço distribuída.

**Correção**

Adotar limitador compartilhado (Redis/Upstash ou tabela/RPC atômica no Postgres), com chaves por IP + identidade pública + workspace + rota. Somar limites de corpo, concorrência, orçamento diário e uploads pendentes.

O assistente possui camadas adicionais, inclusive limite diário persistente; é um dos fluxos mais bem protegidos, embora a origem pública ainda permita esgotamento de quota por terceiros.

### SEC-011 - Médio - Política CORS permissiva e headers incompletos

**Evidência**

- `src/lib/cors.ts:13-21` reflete qualquer origem e permite credenciais.
- `next.config.ts:10-44` define proteção de frame, mas não uma CSP completa, `nosniff`, `Referrer-Policy` ou `Permissions-Policy`.
- Em produção, `/login` respondeu com HSTS e `X-Frame-Options`, mas a CSP continha apenas `frame-ancestors`.
- `/login` também apresentou `Access-Control-Allow-Origin: *`, aparentemente vindo da camada de deploy, pois não é definido globalmente no repositório.

**Impacto**

Amplia o alcance de endpoints públicos abusáveis e reduz a defesa em profundidade contra XSS e vazamento de contexto.

**Correção**

- Remover `credentials: true` de respostas destinadas a qualquer origem.
- Aplicar allowlist exata por domínio de loja.
- Criar CSP baseada em nonce/hash, `X-Content-Type-Options: nosniff`, política de referrer e permissões.
- Revisar configuração da Vercel/edge responsável pelo CORS global.

`Access-Control-Allow-Origin: *` é aceitável para o arquivo estático `shelves.js`, mas não para APIs com sessão ou credenciais.

### SEC-012 - Médio - CSV de contatos armazenado em bucket público

**Evidência**

- `src/app/api/crm/email-templates/locaweb/lists/[id]/bulk-import/route.ts:47-84` cria `email-list-imports` como bucket público.
- O arquivo contém e-mail e nome dos destinatários.
- `src/lib/email-templates/bulk-import.ts` repete o mesmo padrão.
- A rota exige apenas participação no workspace e não impõe um limite explícito de contatos.

**Impacto**

Qualquer pessoa com a URL pode baixar PII enquanto o objeto existir. URLs podem aparecer em logs do provedor e histórico.

**Correção**

Usar bucket privado, URL assinada curta e exclusão automática após importação/erro. Impor limite de linhas/tamanho e exigir a capacidade de gestão de listas.

### SEC-013 - Médio - Dependências de produção vulneráveis

**Evidência**

`npm audit --omit=dev` encontrou 10 advisories em dependências de produção: 5 altos, 4 médios e 1 baixo.

Principais cadeias:

- Next.js 16.2.9, com atualização disponível;
- `postcss` e `sharp` transitivos do Next;
- `@modelcontextprotocol/sdk` e transitivos `hono`, `@hono/node-server`, `fast-uri` e `body-parser`;
- `protobufjs`;
- `brace-expansion`.

**Correção**

Atualizar de forma controlada, começando por Next.js e MCP SDK, revisar os transitivos e usar `overrides` apenas após teste de compatibilidade. Executar build, testes de autenticação, webhooks e scripts da loja antes do deploy. Não usar `npm audit fix --force` diretamente em produção.

### SEC-014 - Médio - CSRF e autenticação de webhooks não são centralizados

**Evidência**

- Cookies Supabase usam `SameSite=Lax`, e APIs JSON comuns não expõem CORS; isso reduz bastante o CSRF clássico por formulário.
- Não existe verificação central de `Origin`/`Sec-Fetch-Site` ou token CSRF em mutações com sessão.
- O OAuth do ML é um caso concreto de state/CSRF quebrado.
- Webhooks VNDA, Troque e iPORTO aceitam token estático em query string em alguns fluxos.
- Tokens na URL vazam mais facilmente para logs, traces e ferramentas de observabilidade.

**Impacto**

O risco principal hoje está em OAuth e vazamento/replay de segredo de webhook, não em um formulário HTML tradicional.

**Correção**

- Validar `Origin` e `Sec-Fetch-Site` nas mutações autenticadas ou adotar token sincronizador.
- Nunca fazer mutação em `GET`.
- Preferir HMAC sobre o corpo bruto com timestamp e replay protection.
- Se o provedor não suportar HMAC, usar header dedicado, rotação, rate limit e redação de URL nos logs.

O webhook do WhatsApp já valida `x-hub-signature-256` e é uma boa referência.

### SEC-015 - Médio - HTML de e-mail não é sanitizado como conteúdo não confiável

**Evidência**

- `src/lib/email-templates/tracking.ts:225-235` chama `sanitizeEmailHtml`, mas a função só corrige URLs, layout e responsividade; ela não remove scripts, handlers ou URLs perigosas.
- `src/lib/email-templates/tree/render.tsx:99-109` apenas normaliza tags e depois usa `dangerouslySetInnerHTML` em `129`, `154` e `178`.
- Qualquer membro pode alterar os blocos JSON de um draft via `src/app/api/crm/email-templates/drafts/[id]/route.ts:35-62`.
- Os previews principais usam iframe com sandbox, o que reduz o impacto no dashboard, mas o HTML ainda segue para provedores/clientes e o pipeline é apresentado como sanitização defensiva.

**Impacto**

Conteúdo malicioso pode chegar ao HTML da campanha. Clientes de e-mail modernos bloqueiam scripts, mas não se deve delegar a proteção ao cliente.

**Correção**

Adicionar sanitização real no servidor com allowlist específica para e-mail e validar o schema dos blocos. Manter previews em iframe sem `allow-same-origin` e sem scripts quando scripts não forem necessários.

### SEC-016 - Baixo - Interpolação na gramática de filtro PostgREST

**Evidência**

- `src/lib/controladoria/entry-filters.ts:15-20` interpola o texto de busca diretamente em `.or(...)`.
- Não foi confirmada execução de SQL nem escape do filtro externo de workspace.
- Alguns outros módulos removem caracteres da gramática PostgREST, mas o tratamento não é central.

**Impacto**

Um usuário pode alterar a lógica da busca dentro do próprio workspace, causar erros ou ampliar a consulta além do esperado pelo filtro textual.

**Correção**

Centralizar escape/validação para a gramática PostgREST, limitar comprimento e preferir RPC parametrizada para buscas complexas. Adicionar testes com vírgula, ponto, parênteses, aspas e operadores.

### SEC-017 - Baixo - Higiene de artefatos e handoff de carrinho

**Evidência**

- `.env.local` e `.env.cron` estão ignorados pelo Git, e nenhum segredo privado conhecido foi encontrado em arquivo versionado.
- Os arquivos locais estão com permissão `0644`; `.env.cron` não está explicitamente em `.vercelignore`.
- `public/shelves.js:14-75` aceita `#vtx_cart` como JSON Base64 não assinado e adiciona SKUs ao carrinho.

**Impacto**

O ambiente local permite leitura por outros usuários da máquina, e uma URL criada por terceiro pode alterar a sacola do visitante. Não há compra automática.

**Correção**

- Usar permissão `0600`, evitar arquivo duplicado de secrets e adicionar `.env*` ao `.vercelignore`.
- Assinar o handoff da sacola com token curto e expirável ou exibir confirmação antes de alterar um carrinho existente.

## Controles positivos observados

- APIs que usam `supabase.auth.getUser()` rejeitaram o JWT inválido.
- O RLS está habilitado nas tabelas por migrations explícitas ou pela migration dinâmica 116.
- Migrations mais recentes revogam corretamente funções `SECURITY DEFINER`.
- O webhook do WhatsApp usa HMAC.
- `src/lib/encryption.ts` usa AES-256-GCM.
- Existe validação dedicada para URLs externas e allowlist no fluxo de mídia do Instagram.
- O Markdown do assistente e o corpo do modal de promo tag escapam HTML antes de formatar.
- Não foram encontrados segredos privados conhecidos em arquivos versionados.
- Não foi confirmada injeção SQL clássica, command injection ou SSRF pública de alta confiança.

## JWT, CORS e modelo correto por superfície

“JWT em tudo” não é a arquitetura correta:

- Dashboard e APIs privadas: validar o JWT Supabase no servidor com `getUser()`, depois validar workspace, função e capacidade.
- Script público da loja: a chave identifica o workspace, mas não pode ser tratada como segredo. Usar escopo mínimo, origem cadastrada, assinatura curta quando necessário, rate limit e validação de evento.
- Webhooks: HMAC/assinatura do provedor, timestamp, idempotência e replay protection.
- Crons: segredo forte em header, falha fechada quando a variável não existir e rotação.
- OAuth: sessão autenticada, nonce e associação servidor-side entre usuário, workspace e callback.

## Plano de correção

### P0 - Hoje, antes de novo deploy funcional

1. Corrigir o middleware para usar `getUser()` e retirar os CSVs comerciais de `public/`.
2. Aplicar a migration de `REVOKE` das RPCs iPORTO e conferir todas as permissões no catálogo do banco.
3. Fechar GA4 e Google Ads com autenticação e workspace.
4. Bloquear os fluxos OAuth ML/TikTok até vincularem nonce, usuário e workspace.
5. Remover `Purchase` do CAPI público e restringir CORS.
6. Bloquear escrita pública da loja e disparos para membros sem capacidade; interromper os sinks de XSS.

### P1 - Próximas 48 horas

1. Implantar matriz central de autorização funcional nas APIs.
2. Corrigir a escrita cross-tenant do cashback e auditar toda mutação com `service_role`.
3. Autenticar o webhook ML e endurecer os webhooks estáticos.
4. Implantar rate limit distribuído, limites de corpo e orçamento de upload.
5. Tornar privado o bucket de importação e aplicar lifecycle.
6. Atualizar dependências vulneráveis com testes de regressão.
7. Aplicar headers de segurança e revisar CORS no deploy.

### P2 - Uma a duas semanas

1. CSP por nonce/hash e inventário dos scripts externos necessários.
2. Validação central de `Origin`/CSRF para mutações.
3. Testes automatizados de BOLA/BFLA com dois workspaces e papéis distintos.
4. Testes de JWT inválido, OAuth state, RPC anônima, XSS e webhooks no CI.
5. SAST, secret scanning, dependency audit e migration lint obrigatórios no pull request.
6. Rotação dos segredos que já circularam em URLs, arquivos locais duplicados ou conversas operacionais.

## Critérios mínimos de aceite

- JWT com assinatura inválida sempre resulta em redirect/`401`, inclusive para arquivos privados.
- `anon` e `authenticated` recebem `permission denied` nas RPCs operacionais iPORTO.
- Um membro sem feature/função recebe `403` em disparos, configurações públicas e integrações.
- Um usuário de workspace A nunca lê ou altera recursos de B, mesmo conhecendo o UUID.
- Scripts/handlers/URLs perigosas persistidos não executam na loja nem no dashboard.
- Origem não cadastrada não consegue chamar CAPI nem endpoints com credenciais.
- Analytics e contas externas nunca respondem sem sessão autorizada.
- Webhooks inválidos são rejeitados antes de qualquer consulta externa ou side effect.
- Limites continuam válidos entre múltiplas instâncias.
- `npm audit --omit=dev` não contém vulnerabilidade alta conhecida sem exceção documentada.

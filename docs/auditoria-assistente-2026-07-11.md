# Auditoria do Assistente de Vendas

Data da análise: 11/07/2026
Período disponível: 02/07/2026 a 11/07/2026

## Escopo e método

Foram processadas todas as 231 conversas e 1.124 mensagens existentes no banco. A leitura separou sessões de navegador de roteiros internos identificados por user-agent (`curl`, `node`, Postman e Insomnia). Os roteiros continuam úteis para QA técnico, mas não representam comportamento de público e não devem entrar nos KPIs comerciais.

Não houve feedback negativo registrado nas mensagens. Isso não comprova satisfação: a amostra de avaliações é insuficiente, então a auditoria usou as transcrições, as ações reais e contradições verificáveis como sinais de qualidade.

## Base analisada

- 231 conversas totais
- 143 sessões de QA automatizado
- 88 sessões de navegador
- 70 sessões no widget da PDP e 18 no chat global
- 49 sessões em navegador interno de Instagram/Facebook
- 28 sessões em outros navegadores móveis
- 11 sessões em desktop

## O que o público procura

Uma conversa pode aparecer em mais de um tema.

| Tema | Conversas | Participação nas 88 sessões |
|---|---:|---:|
| Tamanho, medidas e caimento | 65 | 74% |
| Busca e recomendação de produto | 28 | 32% |
| Intenção explícita de compra/sacola | 11 | 13% |
| Promoção, cupom, combo ou cashback | 9 | 10% |
| Tecido e composição | 8 | 9% |
| Pedido, troca ou pós-compra | 6 | 7% |
| Envio, entrega e prazo | 5 | 6% |

O assistente é, antes de tudo, um provador de tamanho conversacional. A recomendação de produto é a segunda função. Otimizações que não melhoram esses dois trabalhos têm prioridade baixa.

## Comportamento do funil observado

- 21 eventos de adição à sacola em sessões de navegador
- 2 idas ao checkout pelo chat global
- 1 sessão chegou à página de pedido
- esse único pedido foi cancelado e não teve pagamento confirmado
- o pedido cancelado também não continha o SKU originalmente adicionado pelo assistente

Logo, a receita confirmada direta no período é realmente zero. O rastreamento anterior, porém, não era confiável para pedidos futuros porque confundia o token da URL com o código do webhook e deslocava pedidos da PDP para o funil global.

## Problemas encontrados

### 1. Tamanho com confiança indevida

O agente tratava altura e peso como prova suficiente e usava expressões como “tamanho ideal”, inclusive em biotipos acima da referência da grade. A tabela informa largura da peça deitada, mas algumas respostas chamavam a medida de “tórax”, induzindo uma comparação errada com o corpo.

### 2. Conhecimento de tecido presumido

Quando uma peça não tinha ficha técnica e não continha “DRY” no nome, o catálogo classificava automaticamente como algodão. Isso permitia inventar composição de calças e outras peças sem informação cadastrada.

### 3. Base institucional contraditória

A base raspada misturava navegação, rodapé e políticas antigas. Ela dizia envio geral em até 3 dias úteis, enquanto a operação atual usa:

- pronta entrega: postagem em até 24 horas úteis após aprovação do pagamento;
- sob demanda: postagem em até 10 dias úteis;
- entrega: prazo calculado por CEP e transportadora no checkout.

### 4. QA contaminando indicadores

Mais da metade das conversas eram roteiros automatizados. Elas inflavam sessões, mensagens, intenções e uso de ferramentas no dashboard.

### 5. Atribuição quebrada em dois identificadores

A confirmação client-side enviava o token de `/pedido/<token>`, mas o webhook gravava o `code` do pedido. As linhas nunca se encontravam. Além disso, o evento final era marcado sempre como `global`, inclusive quando vinha da PDP.

### 6. Atribuição comercial ampla demais

O cookie durava sete dias e poderia creditar ao assistente qualquer pedido posterior, mesmo sem o produto indicado. Para decisão comercial, isso superestima o agente.

## Definição de métrica implantada

Uma compra direta do assistente agora exige simultaneamente:

1. sessão real de cliente, não QA;
2. adição à sacola registrada pelo assistente;
3. token da página de pedido reconciliado com o token/code do webhook VNDA;
4. pagamento confirmado e pedido não cancelado;
5. pelo menos um SKU do pedido igual ao SKU adicionado pelo assistente.

A receita direta soma apenas os itens correspondentes, líquida do desconto proporcional e sem frete. Pedido confirmado dentro da janela, mas sem SKU correspondente, fica separado como “posterior sem item assistido”. Pedido cancelado e vínculo aguardando webhook também ficam separados.

## Melhorias implantadas no agente

- composição desconhecida permanece desconhecida; não vira algodão por padrão;
- recomendações de tamanho deixam de prometer certeza;
- acima de 105 kg, sem medida comparável, o agente pede a largura de axila a axila de uma peça que já veste bem;
- “cm de tórax” é corrigido para largura da peça de axila a axila;
- confirmação de sacola sem ação real é bloqueada;
- urgência e escassez inventadas são removidas deterministicamente;
- palavras como “Oi”, “Qual” e “Tamanho” deixam de ser aceitas como nome;
- erro em vale-troca/cupom de devolução vai para atendimento humano, sem diagnóstico inventado;
- previsão de reposição nunca é prometida; o agente orienta o “Avise-me”;
- respostas sobre transparência, suor, encolhimento e durabilidade só usam ficha ou avaliação real.

## Conhecimento operacional recomendado

A base institucional deve permanecer curta e curada. Campanhas, cupons, combo, cashback, brindes e frete promocional continuam vindo das tabelas dinâmicas, nunca de texto fixo. A política fixa deve cobrir somente envio, troca, pagamento, reposição, loja online e escalonamento para atendimento.

## Próximas leituras

Com a atribuição corrigida, os indicadores prioritários são:

- taxa de recomendação de tamanho que vira adição à sacola;
- compra direta confirmada por superfície;
- receita líquida dos itens assistidos;
- pedidos posteriores sem item correspondente;
- respostas corrigidas automaticamente pelo guard de qualidade;
- dúvidas sem resposta que terminam em WhatsApp.

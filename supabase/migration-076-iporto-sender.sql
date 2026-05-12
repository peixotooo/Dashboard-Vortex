-- supabase/migration-076-iporto-sender.sql
--
-- Remetente do iPORTO precisa ser independente do Locaweb. O bug
-- observado: workspace tinha default_sender_email =
-- "contato@emkt.bulking.com.br" (do tempo da Locaweb), e quando o
-- usuário ativou o iPORTO o test send usou esse mesmo from. Resultado:
-- Gmail aplicou a reputação ruim do subdomínio emkt.bulking.com.br ao
-- envio e mandou pra spam, mesmo a iPORTO autenticada em
-- no-reply@bulking.com.br.
--
-- Colunas dedicadas pra iPORTO. Se vazias, dispatch-core cai pra
-- default_sender_email (mantém compat).
alter table workspace_email_marketing
  add column if not exists iporto_default_sender_email text,
  add column if not exists iporto_default_sender_name text;

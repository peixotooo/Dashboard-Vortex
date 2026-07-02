-- Migration 128: Captura de nome do cliente no início do chat
--
-- O assistente pede o primeiro nome antes de conversar (estilo atendente),
-- pra personalizar o atendimento. Nome é PII leve — guardamos só o primeiro
-- nome; nada de sobrenome/documento.

ALTER TABLE assistant_settings
  ADD COLUMN IF NOT EXISTS ask_name BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE assistant_conversations
  ADD COLUMN IF NOT EXISTS customer_name TEXT;

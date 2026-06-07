-- Migration 112: mensagens por etapa da régua de avaliação.
-- A régua tem até 3 contatos (pedido + 2 lembretes). Antes só havia 1 texto
-- (request_message_template) reutilizado. Agora cada lembrete tem a sua copy.
-- As mensagens são "substância" (sem saudação) — a saudação "Olá {nome}" é
-- adicionada automaticamente (template Meta) ou prefixada (W-API). Placeholders:
-- {produto} e {link}.

ALTER TABLE review_settings ADD COLUMN IF NOT EXISTS request_reminder_message TEXT;
ALTER TABLE review_settings ADD COLUMN IF NOT EXISTS request_reminder_2_message TEXT;

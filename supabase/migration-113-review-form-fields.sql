-- Migration 113: campos estruturados do formulário de avaliação.
-- O cliente seleciona infos (tamanho, caimento, tipo de corpo, altura, etc.)
-- que viram custom_fields na avaliação (ajuda outros clientes a decidir).
-- form_fields = array [{ key, label, type:'select'|'text', options:[...] }].
-- null = usa o conjunto padrão (definido no código, DEFAULT_REVIEW_SETTINGS).

ALTER TABLE review_settings ADD COLUMN IF NOT EXISTS form_fields JSONB;

-- Marca avaliações geradas por IA (source='ai') — usado pela geração com IA.
-- (reviews.source já existe; nada a alterar aqui, só documentar.)

-- Migration 017: Add provider_config doc_type
-- Allows storing LLM provider configuration (anthropic vs openrouter) per workspace

ALTER TABLE public.agent_documents
  DROP CONSTRAINT agent_documents_doc_type_check;

ALTER TABLE public.agent_documents
  ADD CONSTRAINT agent_documents_doc_type_check
  CHECK (doc_type IN ('soul', 'agent_rules', 'user_profile', 'daily_summary', 'project_context', 'provider_config'));

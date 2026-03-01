-- Migration 008: Add project_context doc_type
-- Allows storing a shared project/company context document visible to ALL agents

ALTER TABLE public.agent_documents
  DROP CONSTRAINT agent_documents_doc_type_check;

ALTER TABLE public.agent_documents
  ADD CONSTRAINT agent_documents_doc_type_check
  CHECK (doc_type IN ('soul', 'agent_rules', 'user_profile', 'daily_summary', 'project_context'));

-- Migration 010: Add retry control to agent_tasks
-- Prevents infinite reprocessing of failed tasks

ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS retry_count int DEFAULT 0;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS last_processed_at timestamptz;

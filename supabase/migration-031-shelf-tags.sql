-- Migration 031: Add tags column to shelf_configs for custom tag-based shelves
-- Allows creating shelves that filter products by VNDA tags

ALTER TABLE shelf_configs ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;

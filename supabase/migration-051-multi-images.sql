-- Migration 051: Support multiple images per collection item
-- Adds images array column, keeps original single image fields for backward compat

ALTER TABLE collection_items ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]';
-- Format: [{"storage_key": "...", "public_url": "...", "is_primary": true}, ...]

-- Migration 026: workspace_media table for persistent image gallery
CREATE TABLE IF NOT EXISTS workspace_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  filename text NOT NULL,
  image_url text NOT NULL,
  image_hash text,
  storage_path text,
  file_size integer,
  mime_type text,
  tags text[] DEFAULT '{}',
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_workspace_media_workspace ON workspace_media(workspace_id);
CREATE INDEX idx_workspace_media_hash ON workspace_media(image_hash);

ALTER TABLE workspace_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace_media_access" ON workspace_media
  FOR ALL USING (workspace_id IN (SELECT get_user_workspace_ids()));

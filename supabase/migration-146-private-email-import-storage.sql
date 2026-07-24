-- Migration 146: contact import CSVs contain customer names and email addresses. They are
-- shared with Locaweb through time-limited signed URLs and must not be public.
update storage.buckets
set public = false,
    file_size_limit = 52428800,
    allowed_mime_types = array['text/csv', 'text/plain']::text[]
where id = 'email-list-imports';

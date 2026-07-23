-- W-API rich message payloads (polls, buttons, locations, contacts, etc.).
-- Legacy columns remain for list previews and backwards compatibility.

ALTER TABLE public.wapi_group_dispatches
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.wapi_group_dispatches.payload IS
  'Normalized type-specific W-API payload, without phone/instance/token/delayMessage.';

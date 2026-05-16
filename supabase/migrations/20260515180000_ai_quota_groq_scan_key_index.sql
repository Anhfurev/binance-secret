-- Round-robin index for optional GROQ_API_KEY_SCAN* pool (separate from veto key ring).

ALTER TABLE public.ai_quota_state
  ADD COLUMN IF NOT EXISTS current_groq_scan_key_index integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.ai_quota_state.current_groq_scan_key_index IS
  'Last-used index into GROQ_API_KEY_SCANn scan pool; BUY veto/trap uses current_groq_key_index.';

NOTIFY pgrst, 'reload schema';

-- Set status to lowercase 'open' only for rows that are already open by meaning
-- (Open, OPEN, etc.). Does not touch closed/other statuses.
UPDATE public.trades
SET status = 'open',
    updated_at = now()
WHERE lower(trim(coalesce(status, ''))) = 'open'
  AND status IS DISTINCT FROM 'open';

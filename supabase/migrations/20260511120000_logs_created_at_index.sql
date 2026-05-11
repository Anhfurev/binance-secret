-- Speed up time-range deletes and pruning on public.logs (large append-heavy table).
create index if not exists idx_logs_created_at on public.logs (created_at desc);

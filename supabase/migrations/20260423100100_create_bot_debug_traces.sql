create table if not exists public.bot_debug_traces (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  symbol text not null,
  tech_score integer,
  rsi double precision,
  bb_position double precision,
  gemini_conf integer,
  groq_conf integer,
  final_decision text,
  raw_ai_response jsonb
);

create index if not exists idx_bot_debug_traces_created_at
  on public.bot_debug_traces (created_at desc);

create index if not exists idx_bot_debug_traces_symbol_created_at
  on public.bot_debug_traces (symbol, created_at desc);

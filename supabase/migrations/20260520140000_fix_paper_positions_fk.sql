-- Ensure paper FKs reference public.profiles (not auth.users).
alter table public.paper_positions
  drop constraint if exists paper_positions_user_id_fkey;

alter table public.paper_positions
  add constraint paper_positions_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

alter table public.paper_portfolio_snapshots
  drop constraint if exists paper_portfolio_snapshots_user_id_fkey;

alter table public.paper_portfolio_snapshots
  add constraint paper_portfolio_snapshots_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

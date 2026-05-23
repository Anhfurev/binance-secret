-- Live autopilot: allow up to 2 concurrent open legs per user (was 1).
update public.bot_settings
set max_open_trades = 2
where user_id = 'b0694630-fed7-4ed5-83a7-bd351ec02a6a'::uuid
  and is_autopilot_enabled = true
  and coalesce(is_ghost_execution, false) = false;

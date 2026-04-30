-- Enable autopilot for every bot_settings row so scheduled cycles pick up all users.
update public.bot_settings
set
  is_autopilot_enabled = true,
  updated_at = now();

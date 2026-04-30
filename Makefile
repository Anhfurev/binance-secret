# Supabase Edge Functions — deploy
#
# JWT verification is controlled in supabase/config.toml under [functions.<name>].
#   verify_jwt = true  → callers must send Authorization: Bearer <Supabase JWT>
#   verify_jwt = false → public/cron-style calls (e.g. binance-bot uses x-binance-bot-secret)
#
# The CLI only adds --no-verify-jwt to force-disable JWT; default deploy applies config.toml.

.PHONY: deploy deploy-bot deploy-sunday deploy-all

deploy deploy-all: deploy-bot deploy-sunday

deploy-bot:
	supabase functions deploy binance-bot

deploy-sunday:
	supabase functions deploy sunday-summary

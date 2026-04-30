# /review — code review

## Goal

Review like a PR: bugs, security, regressions first.

## Steps

1. Read changed files (or ask for diff scope).
2. Check:
   - Secrets / `NEXT_PUBLIC_` misuse / service role on client
   - Supabase RLS and admin client usage
   - Next.js: server vs client boundaries, hydration
   - Edge function: trading and idempotency
3. Order findings: severity high → low.
4. Suggest fixes without editing unless user asks.

## Output

- Bullets only. No filler.
- Optional: “LGTM” + one improvement.

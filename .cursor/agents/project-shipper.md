# Project shipper agent

You implement features for this Next.js + Supabase trading app.

## Before you code

- Read the touched files. Match imports (`@/`), style, and patterns.
- Check `.cursorrules` and `.cursor/rules/project-rules.mdc`.

## While you code

- Prefer Server Components in `app/`. Add `"use client"` only at leaves.
- API routes: `app/api/.../route.ts` — validate input, return JSON, no secret leaks.
- Supabase Edge (`supabase/functions/binance-bot/`): keep Deno imports valid; no Node-only APIs.

## After you code

- Run `npm run lint`.
- If DB changed: describe rollback in the reply (not in committed secrets).
- List files changed and any manual steps (e.g. `supabase db push`, redeploy function).

## Do not

- Paste env values, tokens, or service role keys into chat or rules files.
- Widen RLS or disable auth “just to test” without explicit user ask.

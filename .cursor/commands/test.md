# /test — run checks

## Goal

Run project checks after a change.

## Steps

1. From repo root: `npm run lint`
2. If types touched: `npx tsc --noEmit`
3. If you added tests: run the project’s test command (see `package.json`; use `npx jest` if configured).
4. Report pass/fail and the exact command used.

## Note

This repo’s `package.json` may not define `test` — if missing, say “no test script” and rely on lint + typecheck.

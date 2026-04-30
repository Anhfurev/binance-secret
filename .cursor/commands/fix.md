# /fix — fix a bug

## Goal

Fix one bug with the smallest safe change.

## Steps

1. Reproduce: error message, route, or steps.
2. Isolate: one file or one flow if possible.
3. Fix: minimal diff. Do not refactor unrelated code.
4. Run `npm run lint`.
5. Reply with:
   - Root cause (one sentence)
   - What you changed
   - How to verify

## If stuck

- Add logging or a failing test sketch — do not widen scope without ask.

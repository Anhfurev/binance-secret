# /ship — implement a small feature

## Goal

Ship one clear change. Keep diff small.

## Steps

1. Read related files. Follow `project-rules.mdc` and `.cursorrules`.
2. Implement. Use `@/` imports. Match existing UI (shadcn + Tailwind tokens).
3. Run `npm run lint`. Fix new issues only.
4. If UI route changed: note how to verify (path, e.g. `/demo`).
5. Reply with:
   - What changed (files)
   - Risks (auth, DB, deploy)
   - Rollback (if DB or env)

## Optional

- `npx tsc --noEmit` if types are tricky
- `npm run build` before merge if the change is large

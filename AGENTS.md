<!-- intent-skills:start -->
## Skill Loading

Before substantial work:
- Skill check: run `npx @tanstack/intent@latest list`, or use skills already listed in context.
- Skill guidance: if one local skill clearly matches the task, run `npx @tanstack/intent@latest load <package>#<skill>` and follow the returned `SKILL.md`.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

# Repository Instructions

- Use Conventional Commits for git commit messages.
- Scope Conventional Commits by area, e.g. `feat(cron):`, `feat(api):`, `fix(ui):`.
- This project was scaffolded from a blank TanStack Start app and then trimmed to remove generated demo/example UI.

## Scaffold Log

- TanStack CLI command: `npx @tanstack/cli@latest create my-tanstack-app --agent`
- The CLI was run in `/tmp/serialsales-tanstack-scaffold`.
- Follow-up Intent commands:
  - `npx @tanstack/intent@latest install`
  - `npx @tanstack/intent@latest list`
- Loaded Intent guidance before architecture changes:
  - `@tanstack/start-client-core#start-core`
  - `@tanstack/start-client-core#start-core/deployment`

## Stack

- React 19
- TanStack Start with file-based routing
- TanStack Router
- Vite
- TypeScript
- Tailwind CSS
- npm, as selected by the TanStack CLI

## Deployment Notes

- Target host: Cloudflare Workers.
- Cloudflare integration uses `@cloudflare/vite-plugin`, `wrangler`, and `wrangler.jsonc`.
- Deploy with `npm run deploy`.
- Expected public domain: `serialsales.nicolaischmid.com`.
- `workers_dev` is disabled; production access should use the custom domain route.
- Cloudflare bindings:
  - `TRANSCRIPTS`: R2 bucket `serialsales-transcripts`
- Cron trigger: `0 * * * *` runs the transcript sync hourly (`src/worker.ts`).

## Architecture Notes

- Keep the initial app blank and small.
- The transcript updater is TypeScript-only and runs on Cloudflare via a Cron Trigger (`src/worker.ts` → `syncTranscripts`).
- Keep storage skinny initially: R2 is the source of truth for transcript artifacts and `index.json`.
- R2 layout:
  - `transcripts/`: downloadable `.srt` files shown in the UI.
  - `videos/`: JSON transcript artifacts with segments and full video metadata.
  - `failures/`: temporary fetch/no-caption records, retried after 24 hours.
  - `index.json`: UI source of truth — every transcript with display metadata
    (title, publication date, thumbnail), derived from the key in `format.ts`.
  - `sync/latest.json` and `sync/queue.json`: cron observability.
- Add D1 later only if client-side/static search becomes insufficient.
- Do not add a container or Hermes dependency unless the TypeScript caption fetch path becomes unreliable.

## Known Gotchas

- YouTube caption access is unofficial. The current TypeScript plan uses YouTube InnerTube player metadata plus `json3` caption tracks.
- Cloudflare environment variables are request-time bindings; avoid reading `process.env` at module scope.
- TanStack Start code is isomorphic by default. Use server functions or Worker handlers for server-only work.

## Next Steps

- Seed any remaining local `.srt` files into R2.
- Add richer search only if filename filtering becomes too thin.

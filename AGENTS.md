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

## Architecture Notes

- Keep the initial app blank and small.
- The transcript updater should be TypeScript-only and run on Cloudflare using Cron Triggers.
- Prefer D1 for video metadata/search indexing and R2 for raw transcript artifacts.
- Do not add a container or Hermes dependency unless the TypeScript caption fetch path becomes unreliable.

## Known Gotchas

- YouTube caption access is unofficial. The current TypeScript plan uses YouTube InnerTube player metadata plus `json3` caption tracks.
- Cloudflare environment variables are request-time bindings; avoid reading `process.env` at module scope.
- TanStack Start code is isomorphic by default. Use server functions or Worker handlers for server-only work.

## Next Steps

- Add Cloudflare Workers deployment config.
- Add D1/R2 bindings and migrations.
- Add the hourly updater.
- Build archive/search UI in small commits.

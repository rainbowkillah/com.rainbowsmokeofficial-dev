# Repository Guidelines

## Project Structure & Module Organization
- `src/worker.js` hosts the Worker entry point, Durable Object `VisitCounter`, session helpers, and request routing. Keep new modules co-located if they are Worker-specific, and export them for clarity.
- `public/` contains static assets served through the `ASSETS` binding; add build artifacts elsewhere and sync here only if Wrangler needs them.
- `migrations/` stores ordered D1 SQL migrations (e.g., `0001_init.sql`). Create new migrations with a zero-padded numeric prefix and idempotent statements.
- `wrangler.toml` defines bindings for KV, D1, R2, and Durable Objects. Document any new binding in both this file and the PR description.

## Build, Test, and Development Commands
- `npm install` installs Wrangler and keeps the lockfile in sync.
- `npm run dev` launches the local Cloudflare Worker preview with asset serving and live reload.
- `npm run d1:migrate` applies pending SQL migrations to the configured `RAINBOW_DB`. Run this before deploying schema changes.
- `npm run deploy` publishes the Worker to production via Wrangler. Use the `--dry-run` flag during verification when possible.

## Coding Style & Naming Conventions
- Use modern JavaScript with async/await, two-space indentation, and trailing commas for multiline literals.
- Define constants in SCREAMING_SNAKE_CASE at the top of the file; helper functions should be lowerCamelCase.
- Prefer small, pure utilities over deeply nested logic; add short JSDoc comments only when behavior is non-obvious.
- Keep files in lowercase with word separators (`worker.js`, `visit-counter.js` if extracted).

## Testing Guidelines
- Rely on Wrangler’s preview to exercise routes (`curl http://127.0.0.1:8787/path`).
- When adding persistence logic, seed test data through `wrangler d1 execute RAINBOW_DB --command "<SQL>"`.
- Document manual verification steps in the PR until automated coverage is introduced; new features should include a smoke scenario and failure case.

## Commit & Pull Request Guidelines
- Write imperative, 72-character-or-less commit subjects (e.g., `feat: add contact session ttl`), followed by a concise body if context is needed.
- Reference issue IDs in the body when available and describe schema or binding changes explicitly.
- PRs must include: a summary of behavior changes, any environment variable updates, migration notes, manual test evidence, and UI screenshots when touching `public/`.

## Cloudflare Environment Notes
- Keep secrets out of source; define them with `wrangler secret put`, including `AI_GATEWAY_TOKEN` and any overrides such as `ACCESS_CODE_SALT`.
- Ensure `wrangler.toml` binding IDs match the target environment before deploying; update KV, D1, R2, and Durable Object identifiers in both code review notes and release tickets.
- CI/CD jobs must provide `CF_ACCOUNT_ID` and a scoped `CF_API_TOKEN` with Workers, KV, R2, and D1 permissions; mirror local `.dev.vars` secrets into pipeline-level secret storage.
- Coordinate binding additions with ops so resources are provisioned ahead of deploys, and document rollout steps when Durable Object classes or R2 prefixes change.

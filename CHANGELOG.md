# Changelog

Running log of what changed and why. Newest first.

## Unreleased

### Added

- Provisioned live Cloudflare resources on the `vizchitra` account: D1
  database `studio` (`5755274a-7116-4182-ac3a-0935756b1580`), R2 bucket
  `studio-media`, Queue `studio-media-processing`. Filled `account_id`/
  `database_id` into both `wrangler.toml` files.
- Configured Cloudflare Access: Google OAuth client (Google Cloud project
  `vizchitra-studio`) added as the Zero Trust identity provider; a
  self-hosted Access application gates `studio.vizchitra.com` behind an
  explicit email allowlist; DNS record added to the `vizchitra.com` zone.
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` GitHub Actions secrets
  set on `vizchitra/studio`.
- First manual deploy of `apps/studio` and `services/media` to
  production; first automated `deploy.yml` run on merge to `main`.
- Draft branch ruleset for `main` (PR required, `build` status check
  required, no bypass) in the GitHub dashboard — not yet enforced;
  `vizchitra` org is on GitHub Free, which doesn't support ruleset/branch
  -protection enforcement on private repos without upgrading.

- Rewrote `README.md` (was a 2-line stub) with repo layout, links to the
  other root docs, and the day-to-day command list.
- `oxlint` + `oxfmt` (root devDependencies, `.oxlintrc.json`,
  `.oxfmtrc.json`) for linting and formatting. `npm run lint`,
  `npm run format`, `npm run format:check`; wired into `ci.yml`.
  Markdown is excluded from `oxfmt` — see DESIGN.md.
- `.github/workflows/ci.yml` — typecheck, build, and migration-SQL
  validation on every PR.
- `.github/workflows/deploy.yml` — on merge to main, applies new D1
  migrations then deploys `apps/studio` and `services/media`.
- `.github/workflows/preview.yml` — uploads a Workers preview version per
  PR and comments the URL.
- `typecheck` script + `tsconfig.json` in `packages/domain`,
  `packages/shared`, `services/media`, `apps/studio`.
- Branch protection + GitHub Actions secrets setup instructions in
  `SETUP.md`.
- Monorepo scaffold: `apps/studio` (SvelteKit + Cloudflare adapter),
  `packages/domain` (entity types), `packages/shared` (ULID, canonical
  pipeline constants), `services/media` (upload endpoint + queue consumer),
  `services/publishing`, `services/search` (placeholders, Phase 2/3).
- D1 migrations: `0001_core_entities.sql` (Person, Organisation, Event,
  Session, Content, Collection, Tag, Relationship, Publication),
  `0002_media.sql` (Asset, AssetVersion, `asset_pipeline_run` for
  retryable processing state), `0003_cross_cutting.sql` (Activity,
  Comment, Note, Task, Notification, Permission, SearchIndex).
- `wrangler.toml` for `apps/studio` (Workers + Assets, D1/R2/Queue
  bindings, Access-gated route) and `services/media` (queue consumer).
- Media pipeline stubs (`services/media/src/pipeline.ts`) implementing
  the 12-step canonical order end to end as no-op TODOs, wired to the
  `asset_pipeline_run` table for idempotent retry.
- `Cf-Access-Authenticated-User-Email` read into `locals.user` via
  SvelteKit hooks — identity comes from Cloudflare Access, app has no
  auth code of its own.
- `SETUP.md` — exact terminal commands to provision Cloudflare resources
  and configure Access + Google as the login provider.

### Fixed

- `.github/workflows/ci.yml`, `preview.yml`, and `deploy.yml` were pinned
  to Node 20, but `wrangler@4.110.0` (and its `miniflare`/
  `kv-asset-handler` deps) require Node >=22 — silently broke
  `deploy.yml` on every merge to `main` since the first commit (job
  completed with the wrangler commands failing). Bumped all three to
  Node 22.
- `preview.yml`'s `cloudflare/wrangler-action@v3` defaulted to installing
  `wrangler@3.90.0`, conflicting with the workspace's own
  `wrangler ^4.110.0` / `@cloudflare/workers-types ^5.x` and breaking
  `npm install` in that job. Pinned `wranglerVersion: "4.110.0"` to
  match.
- `apps/studio/vite.config.js` imported `svelte` from
  `@sveltejs/vite-plugin-svelte` instead of `sveltekit` from
  `@sveltejs/kit/vite` — compiled fine but silently dropped SvelteKit's
  routing, so local dev 404'd on every route with no error. Also
  `app.html`, `app.css`, and `+layout.svelte` didn't exist yet; added
  all four.
- `architecture/` had three copies of the same content: `Studio
  Specification.md` duplicated `Studio Architecture.md`, `Studio Domain
  Model.md` and `Media Architecture.md` verbatim. Rewrote Specification
  as a lean index with a document-ownership table instead.
- `Studio Domain Model.md` and `Studio Data Model.md` both defined entity
  fields, inconsistently. Domain Model now owns concepts/relationships
  only; Data Model owns the field-level schema (types, nullability,
  cardinality).
- Asset processing pipeline was listed three different ways (9, 10, and
  11 steps, inconsistent naming) across RFC v1, Implementation Guide, and
  Media Architecture. Standardized to one 12-step canonical sequence,
  referenced rather than restated in two of the three places.
- Roadmap existed in two conflicting versions (4 phases in RFC v1, 3
  phases in Specification). Merged into one 3-phase roadmap living only
  in RFC v1.
- Shared "Permissions" service (Architecture.md) vs "Authorization"
  (RFC v1) naming mismatch. Standardized on Authorization.
- `Note` entity was defined in Domain Model but missing from Data
  Model's tables. Added to Data Model's cross-cutting tables.
- Migration scripts switched from manual `wrangler d1 execute --file`
  chains to `wrangler d1 migrations apply`, which tracks what's already
  applied — needed so `deploy.yml` can rerun it safely on every merge.
- All dependency versions were stale (pinned from training-data
  knowledge, ~1 year old). Re-pinned to current after verifying via web
  search and an actual `npm install`: svelte 5.56, `@sveltejs/kit` 2.69,
  `@sveltejs/adapter-cloudflare` 7.2.9, vite 8.1, wrangler 4.110,
  `@cloudflare/workers-types` 5.x. TypeScript held at 6.0 rather than 7 —
  SvelteKit's peer dependency doesn't support TS7 yet. See DESIGN.md.

## How to add entries

One line per change, present tense, grouped under Added / Changed /
Fixed / Removed. Link to the relevant architecture doc when a change
implements or corrects one.

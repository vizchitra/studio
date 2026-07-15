# Changelog

Running log of what changed and why. Newest first.

## Unreleased

### Added

- Enforce `person`'s Studio access role before upload (`services/media`
  `POST /assets`) and approve/reject (`apps/studio` `/assets` review UI)
  (closes #28). Introduces `StudioAccessRole` (administrator/editor/
  reviewer/photographer/volunteer/viewer) in `packages/domain` — a
  distinct concept from the existing `PersonRole` (speaker/contributor/
  etc.), which describes event participation, not Studio permissions;
  the two lists share some words ("reviewer", "photographer") coincidentally,
  not by design. Grants live in the existing `permission` table
  (`entity_type`/`entity_id`/`person_id`/`role`), which had no baseline-role
  convention until now: `entity_type = 'studio'`, `entity_id = 'global'` is
  the baseline grant, and any other `entity_type`/`entity_id` is an
  entity-level override that takes precedence for that entity — the same
  mechanism serves both, per the RFC's "role-based with entity-level
  overrides" model. Deny by default: no `permission` row means no access.
  Docs updated to stop the two role lists from reading as one concept
  (RFC v1 Permissions section, Domain Model Person section, Data Model
  Permission section).
- `quality_scoring` pipeline step (closes #16): computes blur (variance of
  a Laplacian-filtered grayscale downscale, Pech-Pacheco et al.) and
  exposure (mean grayscale brightness) heuristics via `@cf-wasm/photon`,
  writes a 0-100 `asset.quality_score` and `asset.quality_flags` (e.g.
  `["blurry", "underexposed"]`). Advisory only, surfaced in the `/assets`
  gallery for editorial triage — same nullability/skip rules as
  `duplicate_detection` (non-image, undecodable, or oversized originals).
- `LICENSE.md` (closes #25): MIT for code, all-rights-reserved for
  content/media data, ahead of making the repo public.

### Changed

- Moved `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD` (`services/media`) and
  `MEDIA_SERVICE_URL` (`apps/studio`) out of `wrangler.toml` `[vars]`
  into Worker secrets, and dropped `account_id` from both files entirely
  (closes #23) — none of these are true secrets by Cloudflare's model,
  but the repo may go public, so moved them anyway. `deploy.yml` now
  runs `wrangler secret put` for each after every deploy, piped from
  three new repo secrets of the same names; `CLOUDFLARE_ACCOUNT_ID`
  (already a repo secret) covers `account_id` via Wrangler's env-var
  fallback. No code changes needed — secrets and `[vars]` both surface
  identically on `env` at runtime. Local `wrangler dev` now needs a
  `.dev.vars` file per service (gitignored, documented in SETUP.md).

### Added

- Asset gallery + review UI at `/assets` in `apps/studio` (closes #15):
  lists uploaded assets (newest first, capped at 50) with thumbnail,
  status badge, kind, EXIF summary, and uploader name. Approve/reject
  actions update `asset.status` to `approved`/`archived` — `archived`
  is the closest fit for "rejected" in the existing entity status enum,
  there's no dedicated rejected state. New `/media/[...key]` route
  streams objects straight out of R2 so thumbnails actually render.
- `duplicate_detection` pipeline step (closes #14): computes a 64-bit
  dHash of the `original` image via `@cf-wasm/photon`, stores it on
  `asset.perceptual_hash` (new migration `0004`), flags likely
  duplicates via a new `possible_duplicate_of` relationship kind when
  another asset's hash is within Hamming distance 10. Scoped to compare
  against all assets rather than only the same Event — `session_inference`
  (which would associate an asset with an Event) doesn't exist yet.
- `preview_generation` pipeline step (closes #13): generates `web` (max
  1600px) and `thumbnail` (max 400px) `AssetVersion` rows from the
  original image via `@cf-wasm/photon`, resizing in-Worker rather than
  via Cloudflare Image Transformations (would need the original
  re-fetched over HTTP through a zone with Image Resizing enabled — a
  new endpoint and a plan-tier dependency this avoids). Idempotent on
  retry.
- Upload UI in `apps/studio` (closes #5): a form on the home page whose
  SvelteKit action forwards the file to the media service's `/assets`
  endpoint, reusing the same `Cf-Access-Jwt-Assertion` header Access
  attached to the incoming request. Completes login -> upload -> row in
  D1 + object in R2 end to end; verified against a real upload.
- Replaced the placeholder `app.css` with the real design system (brand
  OKLCH palette, fluid type/space scale, Cairo/IBM Plex Sans/Fira Code
  via `fonts.css`) and added the referenced `.woff2` files under
  `apps/studio/static/fonts/`.
- `exif_extraction` pipeline step (closes #6): reads the `original`
  `asset_version`'s bytes from R2, parses EXIF via `exifr`, writes the
  result to `asset_version.exif`. Non-image mime types and
  unparseable/corrupt EXIF are a normal skip, not a pipeline failure.
- `services/media` now verifies `Cf-Access-Jwt-Assertion` against
  Access's public keys (`access-auth.ts`, closes #3) instead of
  trusting the unverified `Cf-Access-Authenticated-User-Email` header —
  this Worker's own `workers.dev` URL bypasses Access's edge
  enforcement entirely, so the JWT signature is the only real trust
  boundary.
- Real SHA-256 checksum of uploaded bytes in `asset_version.checksum`,
  replacing the placeholder `ulid()` (closes #4).
- `@cloudflare/vitest-pool-workers` + Vitest for `services/media`, with
  D1 migrations applied in a test setup file. First tests cover
  `runPipelineStep`'s success path (records `done`, enqueues the next
  step) and failure path (records `failed`, does not enqueue, rethrows
  for the queue's retry policy) (closes #7). Wired into `ci.yml`.
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

- `apps/studio/tsconfig.json` was missing `"types": ["@cloudflare/workers-types"]`
  — `D1Database`/`R2Bucket`/`Queue` in `app.d.ts` only "worked" because
  `skipLibCheck` silently skips checking inside `.d.ts` files; a plain
  `.ts` file using the same global types (the gallery's
  `+page.server.ts`) surfaced the gap as a real error. Fixed properly.
- `preview_generation`'s derivatives used `photon-rs`'s `get_bytes_webp()`,
  which takes no quality argument (lossless only). Confirmed on a real
  upload: a 7.4KB original produced a 27.7KB thumbnail and a 17.7KB web
  version — both larger than the source, the opposite of the point.
  Switched to `get_bytes_jpeg(quality)` for real lossy control
  (web@82, thumbnail@75).
- Every upload crashed with Cloudflare error 1101: `asset.created_by`/
  `updated_by` are FKs to `person.id` (a ULID), not raw email addresses,
  and `person` starts empty — the D1 batch insert violated the FK
  constraint and threw uncaught. Predates #3's JWT work (the original
  `"system"` placeholder would have hit the same violation). Fixed by
  resolving-or-provisioning a `person` row for the Access-authenticated
  email before referencing it.
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

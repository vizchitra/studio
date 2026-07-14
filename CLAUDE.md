# CLAUDE.md

Guidance for any agent (Claude Code, Cowork, or otherwise) working in this
repo.

## What this is

VizChitra Studio — the internal authoring/publishing platform for
VizChitra. Read `architecture/Studio Specification.md` first; it's a short
index into the rest of `architecture/` and states which document is
authoritative for which concern. Do not duplicate content between those
documents — if a fact needs to live in two places, link instead of
restating it.

## Where things live

- `architecture/` — specs. Read before changing behavior that touches
  entities, the processing pipeline, permissions, or the roadmap.
- `apps/studio` — the SvelteKit app served at studio.vizchitra.com.
  Auth is Cloudflare Access; the app reads identity from a header
  (`src/hooks.server.ts`), it does not implement login.
- `packages/domain` — TypeScript entity types. Keep in sync with
  `architecture/Studio Data Model.md`; don't add fields here that aren't
  in that doc without updating the doc first.
- `packages/shared` — ULID generator, the canonical pipeline step list
  (`MEDIA_PIPELINE_STEPS`), status enum. Single source for anything
  multiple services need to agree on.
- `services/media` — asset ingestion + processing. Current status: skeleton
  only. `src/pipeline.ts` has all 12 canonical steps as stubs; fill them in
  one at a time rather than reordering or renaming steps (the order is the
  contract other docs reference).
- `services/publishing`, `services/search` — not started (Roadmap Phase 2
  and Phase 1 respectively).
- `migrations/` — D1 SQL, applied in numeric order. Never edit an already
  -applied migration; add a new one.

## Rules that come from the architecture docs, not from convenience

- Never duplicate entity definitions across modules — reference by id.
- Assets have no owning foreign key. Ownership/usage goes through the
  `relationship` table (many-to-many) or a dedicated nullable FK added
  later for singular references (e.g. a person's headshot).
- The asset processing pipeline order is fixed: import, exif_extraction,
  preview_generation, session_inference, reference_person_matching,
  face_clustering, duplicate_detection, ocr, vision_tagging,
  quality_scoring, search_indexing, publish. It's exported as
  `MEDIA_PIPELINE_STEPS` in `packages/shared` — import it, don't
  re-type it.
- AI output is advisory only; nothing it produces publishes without human
  confirmation.
- Publishing is immutable — never mutate a `publication` row after it's
  written.

## Working in this repo

- This scaffold needs a real Cloudflare account session (`wrangler
  login`) and a live dev loop — do that work in Claude Code / a local
  terminal, not in a sandboxed agent session. See `SETUP.md`.
- Log notable changes in `CHANGELOG.md` as you go, not retroactively.
- If you find contradictory statements between two architecture docs,
  that's a bug in the docs — fix the docs (per the ownership table in
  Specification.md) before writing code against either version.

# Studio

The internal operating system for VizChitra — authoring, media, and
publishing in one place, at `studio.vizchitra.com`.

## Start here

- [`architecture/Studio Specification.md`](architecture/Studio%20Specification.md)
  — what Studio is and why; index into the rest of `architecture/`.
- [`SETUP.md`](SETUP.md) — bootstrap commands: Cloudflare resources,
  migrations, Access/Google auth, CI/CD secrets, branch protection.
- [`CLAUDE.md`](CLAUDE.md) — repo conventions for anyone (human or agent)
  working in this codebase.
- [`DESIGN.md`](DESIGN.md) — concrete implementation decisions and the
  reasoning behind them.
- [`CHANGELOG.md`](CHANGELOG.md) — running log of what changed and why.

## Layout

```
apps/studio         SvelteKit app served at studio.vizchitra.com
packages/domain      TypeScript entity types (Person, Asset, Session, ...)
packages/shared       ULID ids, canonical pipeline constants
services/media        Asset ingestion + processing pipeline
services/publishing    Immutable release creation (not started — Phase 2)
services/search         Unified search indexing (not started — Phase 1)
migrations/          D1 schema, applied in numeric order
```

## Working on this repo

```
npm install
npm run dev          # apps/studio, local SvelteKit dev server
npm run typecheck
npm run lint          # oxlint
npm run format:check   # oxfmt --check
```

First-time Cloudflare setup (D1/R2/Queues, Access, secrets, branch
protection) is in `SETUP.md` — it needs a real `wrangler login` session,
so run it from a local terminal, not a sandboxed agent.

Current status: Phase 1 (see the Roadmap in
`architecture/Studio Architecture RFC v1.md`). Media module is the
active build target; Content, Programme, People, Publishing and
Communications haven't started.

# Studio UI Principles

This covers `apps/studio`'s presentation layer — the visual language and
interaction conventions for the app itself. It's a sibling to
`/DESIGN.md` (which covers backend/data decisions) and `/CLAUDE.md`
(which covers the whole repo) — this one is scoped to what a person
actually sees and clicks.

## What Studio is, for design purposes

Studio is an internal tool for a small team (organisers, editors,
reviewers, photographers, volunteers), not a public-facing site. It's
used repeatedly by people who already know what they're doing, to get
through review/approval work — not browsed once by a stranger who needs
to be persuaded. That distinction drives most of the decisions below:
favor density and clarity over marketing whitespace, favor visible state
over polish, favor plain controls over clever ones.

The brand tokens (color, type, the paper texture) are shared with
`vizchitra/website` — this app should look unmistakably like VizChitra,
not like a generic admin panel. But it's a working surface, and should
read as one.

## Principles

**Status is always visible, never behind a click.** Every asset carries
an editorial status (draft/review/approved/published/archived per
`architecture/Studio Architecture.md`) and, during processing, a
per-step pipeline status. Studio's whole job is answering "what state is
this in, and does it need a human" — so status renders as a badge on
every card, by default, not on hover or in a detail view.

**AI output looks provisional until a human confirms it, not just in the
data model but on screen.** CLAUDE.md's rule ("AI output is advisory
only; nothing it produces publishes without human confirmation") has to
be visible, not just enforced server-side. Unconfirmed face boxes get an
inline "who is this?" prompt right on the card, not tucked in a modal;
quality flags and detected tags read as suggestions, not facts, until
someone acts on them.

**Consequential actions are plain, labeled buttons — never icon-only.**
Approve, Reject, Reprocess, Publish. These are low-frequency,
high-consequence actions (publishing is immutable — see `/DESIGN.md`).
An icon someone has to guess at is the wrong tradeoff here; a text label
costs nothing and prevents mistakes.

**Permissions are reflected by what's shown, not by what's disabled.**
The reprocess control only renders at all when the signed-in person has
that role (`data.reprocessEnabled` gating in
`assets/+page.server.ts`/`+page.svelte`) — it doesn't render greyed-out
with a tooltip explaining why you can't click it. A missing control is
less confusing than a disabled one.

**Progressive enhancement, not a client-side app.** Actions are plain
HTML forms hitting SvelteKit form actions (`?/approve`, `?/reject`,
`?/reprocess`, `?/confirmFace`) — they work without JavaScript and get
enhanced, not built JS-first. This matches SvelteKit's own model and
keeps the app resilient on a flaky conference wifi connection, which is
a real scenario for this team.

**Density over decoration in data views.** The asset grid and pipeline
validation grid are compact by design — tight card padding, small
detail text, `auto-fill minmax` grids that reflow rather than fixed
columns. Someone reviewing 200 photos from an event doesn't want
generous whitespace between them.

## Foundations

Defined in `src/app.css`, shared with the wider VizChitra brand system:

- **Color** — OKLCH ramps (50–950) per brand hue (yellow, teal, blue,
  orange, pink, grey), exposed as semantic `--color-viz-{hue}-{variant}`
  tokens (subtle/light/muted/solid/dark) rather than raw ramp steps in
  component code. Neutral/paper tokens (`--color-paper`, `--color-ink`,
  `--color-neutral-*`) are light-theme only right now — see Open
  questions.
- **Type** — IBM Plex Sans for body (`--font-body`), Cairo for display
  (`--font-display`), Fira Code for anything monospace (`--font-mono`).
  Fluid scale via `clamp()` (`--text-flow-*`, minor-third ratio) so type
  scales with viewport instead of jumping at breakpoints.
- **Space** — same fluid-clamp approach (`--space-flow-*`), one base
  value driving the whole scale.
- **Paper texture** — a near-invisible noise + wash background
  (`--paper-noise`, `--paper-wash`) on `body`, blended with
  `multiply`. Signature brand texture, not a generic white background —
  keep it under new full-bleed sections rather than overriding it.

## Current patterns

Grounded in what's actually built (`assets/+page.svelte`,
`admin/pipeline-validation/`, `src/lib/components/`):

- **Status badge** — `<Badge kind="editorial" | "pipeline" value={status} />`
  (`src/lib/components/Badge.svelte`) — pill-shaped, uppercase, small; a
  neutral default (`--color-muted`) with specific overrides per
  `kind`-`value` pair (e.g. `.ui-badge--editorial-approved` in teal). The
  `kind` prop namespaces the class so editorial status
  (draft/review/approved/published/archived) and pipeline-step status
  (not_run/running/done/failed) can't collide. Add a
  `.ui-badge--{kind}-{value}` rule per new status rather than
  inline-styling one-offs.
- **Card** — `<Card>` (`Card.svelte`) — bordered, rounded, clipped
  overflow, flex-column. The unit of every grid view in the app so far.
- **Grid** — `<Grid min="220px">` (`Grid.svelte`) — `auto-fill
  minmax(min, 1fr)`, reflows by available width rather than a fixed
  column count. Reuse this instead of hand-rolling a new grid per page.
- **Notices** — `<Notice kind="error" | "success">` (`Notice.svelte`),
  wrapping `.content-notice` / `.notice-error` / `.notice-success` — for
  page-level feedback (form errors, confirmations), not per-card state
  (that's the status badge's job).
- **Overlay annotation** — `.face-box` / `.face-label` — absolutely
  positioned over an image using fractional coordinates
  (`x_min * 100%`), for anything that needs to point at a region of a
  photo. Not yet a shared component (only two consumers, both with
  slightly different markup needs); revisit if a third shows up.
- **Container** — `<Container>` / `<Container wide>` (`Container.svelte`)
  — wraps `.content-container` (48rem, prose measure — forms/text) or
  `.wide-container` (`var(--width-content)`, 80rem — data grids/tables).
- **Button** — `<Button variant="primary" | "danger" | "tertiary">`
  (`Button.svelte`) — primary for Approve/Publish, danger for Reject,
  tertiary for lower-stakes actions (Reprocess, Confirm, Upload's
  secondary case). Defaults to `type="submit"` since every action here is
  a form.
- **Table** — `<Table>` (`Table.svelte`) — scroll-wrapped `<table>`;
  pass `<thead>`/`<tbody>` as slot content. Used by pipeline validation's
  one-row-per-fixture, one-column-per-step grid.
- **Stack / Cluster** — `<Stack gap>` (vertical rhythm) / `<Cluster gap>`
  (wrapping inline groups) — thin flex wrappers over `--space-flow-*`
  values, for the ad hoc `flex-column`/`flex-wrap` rules that used to be
  hand-rolled per page (`.asset-meta`, `.asset-actions`).
- **Nav + SidePanel app shell** — `src/routes/+layout.svelte` composes
  `<Nav>` (top bar: hamburger toggle, brand, signed-in user) and
  `<SidePanel>` (left, primary nav links, admin-only links gated by
  `canReprocess` from `+layout.server.ts`) around every route's content.
  The sidebar collapse is a pure-CSS checkbox hack (`#sidepanel-toggle`
  in `Nav.svelte`, `:checked ~ .app-body .side-panel` in
  `+layout.svelte`) — no JS, per the progressive-enhancement principle.
  It resets on a full page reload, same as any other unpersisted UI
  state in this app today (nothing here uses `use:enhance` yet).

## Components

`src/lib/components/` — each is a thin Svelte wrapper over what used to
be a route-local CSS class, re-exported from `src/lib/components/index.ts`.
Two groups:

**Layout primitives** — no visual styling, just spacing/arrangement:
`Container`, `Stack`, `Cluster`, `Grid`.

**Content and interaction components**: `Card`, `Badge`, `Notice`,
`Button`, `Table`, plus the app-shell pair `Nav` / `SidePanel` (these two
are new design, not extraction — nothing rendered a global nav before).

**Not built yet:**

- `Combobox` (autocomplete) — needed by the attribution person-picker
  and venue/session tag-picker issues, neither of which has landed yet.
  Try a native `<datalist>`-backed input first when that work starts —
  works without JS — and only reach for a custom JS combobox if
  `<datalist>`'s limits (no inline "create new," no rich item rendering)
  actually block something. Not built speculatively ahead of a consumer.
- `Modal` — deliberately not building. Nothing built so far uses one —
  face-confirm is inline on the card — and a modal cuts against the
  "AI output stays inline, not tucked away" principle. The one plausible
  future case is a full-resolution image lightbox; don't build it
  speculatively.

## Open questions

- Dark theme isn't defined — `--color-paper`/`--color-ink` are
  explicitly commented "light theme only" in `app.css`. Not needed until
  someone asks for it.
- No accessibility audit done beyond what the reset provides
  (`button:focus:not(:focus-visible)` handling). Worth a real pass once
  the review workflow (the highest-frequency task in the app) is feature
  complete.

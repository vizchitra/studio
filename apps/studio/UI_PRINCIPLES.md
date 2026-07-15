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
`admin/pipeline-validation/`), not aspirational:

- **Status badge** — `.asset-status.status-{status}` — pill-shaped,
  uppercase, small; a neutral default (`--color-muted`) with specific
  overrides per status (e.g. `.status-approved` in teal). Add a
  `status-{x}` rule per new status rather than inline-styling one-offs.
- **Card** — `.asset-card` — bordered, rounded, clipped overflow,
  flex-column. The unit of every grid view in the app so far.
- **Grid** — `repeat(auto-fill, minmax(220px, 1fr))` — reflows by
  available width rather than a fixed column count. Reuse this instead
  of hand-rolling a new grid per page.
- **Notices** — `.content-notice`, with `.notice-error` /
  `.notice-success` modifiers — for page-level feedback (form errors,
  confirmations), not per-card state (that's the status badge's job).
- **Overlay annotation** — `.face-box` / `.face-label` — absolutely
  positioned over an image using fractional coordinates
  (`x_min * 100%`), for anything that needs to point at a region of a
  photo. Will matter again once face_clustering's Moondream bounding
  boxes (#31) and any future OCR region output land.
- **Wide container** — `.wide-container` (`max-width: var(--width-content)`,
  80rem) — `.content-container`'s 48rem max-width is a prose measure; a
  data table with a column per pipeline step (`admin/pipeline-validation/`)
  needs real width instead. This is the wide variant the Container entry
  below already called for, added ahead of the full extraction. Use
  `.wide-container` for grids/tables, `.content-container` for everything
  read top-to-bottom.

## Components

No shared component layer exists yet — each route defines its own
`<style>` block with route-scoped classes (`.asset-card`, not a
`<Card>` component). That was fine at two pages; the pipeline
validation view (#39) makes a third, and the attribution/tag-picker and
bulk-import work (see the media issues) will add more, so it's worth
extracting now rather than letting the duplication compound. Two groups:

**Layout primitives** — no visual styling, just spacing/arrangement.
Mostly already exist informally; this is extraction, not new design:

- `Container` — needs two widths, not one. The existing
  `.content-container` is prose-width (48rem, right for forms/text);
  data grids want `--width-content` (80rem) — that variant now exists as
  `.wide-container` (see Current patterns), ahead of a real `<Container>`
  component with a narrow/wide prop.
- `Stack` — consistent vertical rhythm using `--space-flow-*`. Ad hoc
  today (`.asset-meta`'s `flex-column, gap: 0.25rem`).
- `Cluster` — wrapping inline groups with consistent gap (tag lists,
  button rows). Ad hoc today (`.asset-actions`).
- `Grid` — the `auto-fill minmax(220px, 1fr)` reflow pattern, already
  used for the asset gallery, about to be reused for pipeline
  validation's fixture thumbnails. Distinct from Cluster — don't reach
  for Cluster on a thumbnail wall.

**Content and interaction components** — some exist informally, some
are net-new, driven by what's already filed as work:

- `Card` — generalize `.asset-card`.
- `Badge` — generalize `.asset-status.status-*`. Needs to carry two
  separate status vocabularies without them colliding: editorial status
  (draft/review/approved/published/archived) and pipeline-step status
  (pending/running/done/failed) — a `kind`/namespace, not one flat
  `status-*` class list.
- `Table` — net new. Nothing built so far is tabular (everything is
  card-grid), but pipeline validation (#39) is "one row per fixture
  asset, one column per pipeline step" — that's a table, not a card
  grid.
- `Button` — net new as a real component, not just the reset. Buttons
  currently get zero visual styling beyond
  `background: transparent; cursor: pointer` — clickable text, not
  visually buttons, which undercuts the "plain, labeled, hard to
  misclick" principle above. Needs primary/danger/tertiary variants
  (Approve/Publish vs Reject vs Reprocess shouldn't look equally
  weighted).
- `Combobox` (autocomplete) — net new, harder than a plain form
  control. Needed twice: the attribution person-picker and the
  venue/session tag-picker, both of which explicitly call for
  "autocomplete against existing records, not free text." Try a native
  `<datalist>`-backed input first — works without JS, matches the
  progressive-enhancement principle — and only reach for a custom JS
  combobox if `<datalist>`'s limits (no inline "create new," no rich
  item rendering) actually block something.
- `Notice` — already exists (`.content-notice` /
  `.notice-error` / `.notice-success`), just needs naming/extracting
  alongside the rest rather than new design work.

**Deliberately not building:** `Modal`. Nothing built so far uses one —
face-confirm is inline on the card — and a modal cuts against the
"AI output stays inline, not tucked away" principle. The one plausible
future case is a full-resolution image lightbox; don't build it
speculatively.

Build order: Container/Stack/Cluster/Card/Badge/Notice first — these
are extraction of what already exists, low risk. Table/Button/Combobox
next, since the filed issues (attribution prompt, bulk import, pipeline
validation) need them and nothing today provides them.

## Open questions

- Dark theme isn't defined — `--color-paper`/`--color-ink` are
  explicitly commented "light theme only" in `app.css`. Not needed until
  someone asks for it.
- No accessibility audit done beyond what the reset provides
  (`button:focus:not(:focus-visible)` handling). Worth a real pass once
  the review workflow (the highest-frequency task in the app) is feature
  complete.

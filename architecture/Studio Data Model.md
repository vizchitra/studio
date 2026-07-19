# Studio Data Model

## Purpose

Defines the canonical, field-level data model shared across all Studio
modules. This document is authoritative for types, nullability and
cardinality. For what entities mean conceptually and how they relate, see
[Studio Domain Model](Studio%20Domain%20Model.md).

## Identity

Every entity has:

| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | UUID/ULID | no | stable, immutable |
| type | string (enum) | no | entity discriminator |
| slug | string | yes | URL-safe, unique per type |
| status | string (enum) | no | Draft / Review / Approved / Published / Archived |
| created_at | timestamp | no | |
| updated_at | timestamp | no | |
| created_by | Person id (FK) | no | |
| updated_by | Person id (FK) | no | |

## Core Entities

### Person

Unified identity reused across all events.

### Organisation

Sponsors, partners, employers, venues. `kind` is one of sponsor / partner /
venue / employer / media / organiser — `organiser` is VizChitra itself, seeded
once (`services/media/scripts/seed-vizchitra-organisation.ts`) as the
`captured_by` target for official/final photos with no individual
photographer credit.

### Event

Container for sessions, assets and communications.

### Session

Belongs to an Event. References People, Assets and Content.

### Content

Articles, guides, pages, newsletters. References Assets.

### Asset

Stable identity for any media. References Event, Session, People and
Collections. `perceptual_hash` (string, nullable) is a 64-bit dHash of the
`original` AssetVersion's image, computed by the duplicate_detection
pipeline step and compared across assets via Hamming distance to flag
likely duplicates for editorial review — null for non-image assets or
assets predating this step. `quality_score` (real, nullable, 0-100) and
`quality_flags` (JSON string array, nullable, e.g. `["blurry",
"underexposed"]`) are basic blur/exposure heuristics computed by the
quality_scoring pipeline step for editorial triage — same nullability
caveats as `perceptual_hash`. `import_batch_id` (nullable FK to
ImportBatch) traces an asset back to the bulk import run that created it,
if any — null for assets created via the single-file upload path.

### ImportBatch

A traceable record of one zip-based bulk import run (issue #45).

| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | UUID/ULID | no | |
| mode | string (enum) | no | historical \| review — see Import Modes, Media Architecture.md |
| filename_template | string | no | e.g. `{date}_{code}_{n}` — configurable per batch, not hardcoded, since conventions differ by photographer and year |
| created_at | timestamp | no | |
| created_by | Person id (FK) | no | |

Per entry in the zip: the top-level folder name becomes a `tagged_with`
Tag (create-if-missing). The filename is matched against
`filename_template`'s token set (`{date}`, `{code}`, `{n}`) — a matched
`{date}` token is an EXIF fallback (used only if EXIF is missing/stripped);
a matched `{code}` token is looked up in
`services/media/photographer-codes.json` to resolve a `captured_by`
Person. If the code doesn't resolve to a known person, `captured_by`
defaults to the VizChitra Organisation (see Organisation section) — a
resolved code always wins over that default, in either import mode.
Non-matching filenames still import; they simply carry no derived
metadata and no `captured_by`, which the existing publish-time
attribution check (issue #44) already leaves unpublishable until someone
fixes it by hand in the review UI.

`mode = historical` (issue #46) means "final assets only, already
decided" — `reference_person_matching`, `face_clustering`,
`duplicate_detection` and `quality_scoring` are skipped for assets in
such a batch (they exist to help decide *what to keep*, which doesn't
apply to already-final assets), while `exif_extraction`,
`preview_generation` and `search_indexing` still run.
`mode = review` runs every step as normal. Either mode still requires a
resolved `captured_by` before publish — Historical Import doesn't skip
that requirement, it just satisfies it automatically via the
code-resolves-or-VizChitra-org fallback above. Publish is reached via an
explicit "Publish batch" admin action on `/admin/bulk-import` (reusing
the review UI's approve-action permission gating, not an automatic
chain), not automatically once processing finishes — so nothing
publishes without human confirmation, per CLAUDE.md, even at the batch
level.

### AssetVersion

Represents a concrete file. Types: - original - review - edited - web -
social - thumbnail

### FaceDetection

A detected face bounding box on an Asset, computed by the
`face_clustering` pipeline step via Moondream 3.1 on Workers AI (detection
only — see [DESIGN.md](../DESIGN.md) for why this model, and why matching
a box to a Person is a separate, later decision).

| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | UUID/ULID | no | |
| asset_id | Asset id (FK) | no | |
| x_min, y_min, x_max, y_max | real (0-1) | no | normalized fraction of image width/height, not pixels |
| person_id | Person id (FK) | yes | null until a human confirms a name against the box in the review UI |
| created_at | timestamp | no | |

### Collection

Editorial grouping.

### Publication

Immutable published release.

### Tag

Shared taxonomy. Membership (which entities carry a Tag) goes through
`Relationship` (`kind = tagged_with`), not a dedicated join table — see
Relationship below.

### Relationship

Generic edge between entities.

| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | UUID/ULID | no | |
| from_id | Entity id (FK) | no | |
| from_type | string (enum) | no | |
| to_id | Entity id (FK) | no | |
| to_type | string (enum) | no | |
| kind | string (enum) | no | presents, authored, illustrates, sponsors, member_of, reviews, tagged_with, captured_by |

Cardinality is many-to-many by default (a Person can present many
Sessions; a Session can have many presenting People). Specific relation
kinds may constrain this (e.g. Content.author is effectively one-to-many
from Person, enforced at the application layer, not the schema).

`tagged_with` (Asset -> Tag) and `captured_by` (Asset -> Person |
Organisation) both go through this same generic mechanism rather than a
dedicated table each — `captured_by` is deliberately separate from
`Asset.created_by` (the audit field for who performed the upload, not
necessarily who took the photo). Attribution is required, not optional:
the review UI's approve action (`apps/studio/src/routes/assets/
+page.server.ts`) refuses to approve an Asset with no `captured_by`
relationship.

## Cross-cutting Tables

Attach to any core entity via entity_id + entity_type.

-   Activity
-   Comment
-   Note
-   Task
-   Notification
-   Permission
-   SearchIndex

### Permission

Grants a `StudioAccessRole` (administrator/editor/reviewer/photographer/
volunteer/viewer — see [Studio Architecture RFC v1](Studio%20Architecture%20RFC%20v1.md),
Permissions section for the role list and semantics) to a Person, either as
their baseline role or as an entity-level override.

| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | UUID/ULID | no | |
| entity_id | Entity id or "global" | no | "global" for the baseline row |
| entity_type | string (enum) or "studio" | no | "studio" for the baseline row |
| person_id | Person id (FK) | no | |
| role | string (enum) | no | StudioAccessRole |
| created_at | timestamp | no | |

Baseline (non-override) grants use the convention `entity_type = "studio"`,
`entity_id = "global"` rather than a separate column or table — the same
row shape holds both the base role-based model and its entity-level
overrides, per the RFC's "role-based with entity-level overrides" model.
Effective role for a specific entity = the override for that entity if one
exists, else the baseline row, else no permission (deny by default).

Example — an administrator's baseline grant:

| id | entity_id | entity_type | person_id | role | created_at |
|---|---|---|---|---|---|
| 01J... | global | studio | 01H... (Person id) | administrator | 2026-01-01T00:00:00Z |

An entity-level override (e.g. a Volunteer granted Editor rights on one
specific Asset) would instead have `entity_type = "asset"`, `entity_id =
<asset id>`, `role = "editor"`.

## Design Rules

-   Never duplicate entities across modules.
-   Use references instead of embedded copies.
-   Publishing creates immutable Publications.
-   Asset metadata belongs to Asset, not AssetVersion.
-   AssetVersion stores file-specific metadata only.

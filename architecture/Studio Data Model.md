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

Sponsors, partners, employers, venues.

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
caveats as `perceptual_hash`.

### AssetVersion

Represents a concrete file. Types: - original - review - edited - web -
social - thumbnail

### Collection

Editorial grouping.

### Publication

Immutable published release.

### Tag

Shared taxonomy.

### Relationship

Generic edge between entities.

| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | UUID/ULID | no | |
| from_id | Entity id (FK) | no | |
| from_type | string (enum) | no | |
| to_id | Entity id (FK) | no | |
| to_type | string (enum) | no | |
| kind | string (enum) | no | e.g. presents, authored, illustrates, sponsors |

Cardinality is many-to-many by default (a Person can present many
Sessions; a Session can have many presenting People). Specific relation
kinds may constrain this (e.g. Content.author is effectively one-to-many
from Person, enforced at the application layer, not the schema).

## Cross-cutting Tables

Attach to any core entity via entity_id + entity_type.

-   Activity
-   Comment
-   Note
-   Task
-   Notification
-   Permission
-   SearchIndex

## Design Rules

-   Never duplicate entities across modules.
-   Use references instead of embedded copies.
-   Publishing creates immutable Publications.
-   Asset metadata belongs to Asset, not AssetVersion.
-   AssetVersion stores file-specific metadata only.

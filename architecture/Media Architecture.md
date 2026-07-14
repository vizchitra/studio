# Media Architecture

## Vision

The Media module is Studio's Digital Asset Management (DAM) system.

It is the canonical source of truth for every media asset used across
VizChitra.

Media manages Assets. It does not serve public media directly.

## Architectural Principles

1.  An Asset represents media, not a file.
2.  Files are versions of an Asset.
3.  No module stores files directly.
4.  Metadata belongs to the Asset.
5.  AI enriches Assets but never publishes automatically.
6.  Assets are reusable across Studio.

## Single Source of Truth

Every upload anywhere in Studio becomes a Media Asset.

Examples:

-   Speaker headshot → Person references Asset.
-   Hero image → Article references Asset.
-   Session slides → Session references Asset.
-   Sponsor logo → Organisation references Asset.
-   Press PDF → Communication references Asset.

The Media module owns:

-   Storage
-   Versions
-   Metadata
-   AI enrichment
-   Review
-   Publishing

Other modules store only Asset references.

## Asset Model

Asset - Stable identity - Metadata - Relationships - Editorial state

Asset Versions - Original - Review - Edited - Web - Social - Thumbnail

Supported originals include RAW, JPEG, HEIC, PNG, TIFF, MP4 and PDF.

## Import Modes

1.  Review Import
    -   Originals
    -   AI enrichment
    -   Editorial review
    -   Edited uploads
2.  Historical Import
    -   Final assets only
    -   Skip review
    -   Publish immediately
3.  Mixed Import
    -   Originals and edited files
    -   Associate with a single Asset

## Processing Pipeline

-   Import (see Import Modes above)
-   EXIF extraction
-   Preview generation
-   Session inference
-   Reference person matching
-   Face clustering
-   Duplicate detection
-   OCR
-   Vision tagging
-   Quality scoring
-   Search indexing
-   Publish (see Publishing below)

Canonical pipeline defined in Studio Architecture RFC v1. Each processor
is independent and idempotent.

## Publishing

Publishing creates immutable Asset Releases.

``` text
Asset
  ↓
Asset Version
  ↓
Published Release
  ↓
media.vizchitra.com
```

Publishing generates optimized derivatives such as AVIF, WebP, JPEG,
thumbnails and social crops.

## Delivery

Public media should be served from:

`media.vizchitra.com`

Studio assets remain private until published.

The delivery layer exposes only immutable published assets and never
editorial metadata, review state or drafts.

## Integration

Media enriches:

-   Content
-   Programme
-   People
-   Communications

Each module references Assets instead of storing files.

## Guiding Principle

Import once.

Enrich once.

Publish once.

Reuse everywhere.

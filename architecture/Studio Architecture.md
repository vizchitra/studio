# Studio Architecture

## Vision

`studio.vizchitra.com` is the internal operating system for VizChitra.

Studio is the canonical source of truth for all editorial content,
programme information, people, media assets, communications and
publishing workflows. The public website and other consumers never edit
content directly; they consume published releases from Studio.

## Responsibilities

Studio manages the lifecycle of:

-   Content
-   Programme
-   People
-   Media
-   Communications
-   Publishing

## Design Principles

1.  Content is structured, not pages.
2.  Everything is an entity.
3.  Every entity has a lifecycle.
4.  Editorial decisions are separate from presentation.
5.  Assets enrich content; they do not define it.
6.  AI assists; humans decide.
7.  Everything is searchable.
8.  Everything is versioned.
9.  Keyboard-first workflows.
10. Cloudflare-first architecture.

## Modules

### Content

Articles, guides, pages, announcements, documentation and editorial
metadata.

### Programme

CFPs, reviews, sessions, workshops, exhibitions, schedules and speaker
management.

### People

Unified profiles for speakers, contributors, volunteers, organisers,
sponsors, partners and photographers. Every module references the same
Person entity.

### Media

Owns every file in Studio through the Asset model. Photos, videos,
audio, PDFs, logos, transcripts and brand assets are managed here and
referenced elsewhere.

### Communications

Newsletters, social media, press resources, campaigns and reusable
publishing templates.

### Publishing

Creates immutable releases for public consumption.

## Shared Platform Services

-   Authentication
-   Authorization
-   Search
-   Version history
-   Activity log
-   Comments
-   Notifications
-   AI services
-   Publishing
-   File storage

Implement once and share across modules.

## Editorial Lifecycle

Draft → Review → Approved → Published → Archived

All entities share this lifecycle wherever practical.

## Architecture

``` text
Studio
│
├── Content
├── Programme
├── People
├── Media
├── Communications
└── Publishing
      │
      ├── Published Content
      ├── Published Programme
      ├── Published People
      └── Published Assets
             │
             ├── api.vizchitra.com
             ├── media.vizchitra.com
             └── vizchitra.com
```

## Public Architecture

-   **studio.vizchitra.com** --- authenticated authoring platform.
-   **api.vizchitra.com** --- public versioned API exposing published
    entities.
-   **media.vizchitra.com** --- immutable media delivery.
-   **vizchitra.com** --- public website consuming published APIs and
    media.

## Guiding Principle

Studio is where VizChitra is created, reviewed and published.

Every architectural decision should reinforce the separation between
authoring, publishing, delivery and presentation.

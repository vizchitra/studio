# Studio Implementation Guide

## Platform

-   SvelteKit
-   Cloudflare Workers
-   D1
-   R2
-   Queues
-   Image Transformations
-   Cloudflare Access
-   TypeScript

## Repository Structure

/apps /studio /packages /ui /domain /api /shared /services /media
/publishing /search

## Services

### Media

Asset ingestion, AI enrichment and publishing.

### Publishing

Creates immutable releases.

### Search

Indexes published entities and assets.

## Processing

Use asynchronous processors:

1.  Import
2.  EXIF extraction
3.  Preview generation
4.  Session inference
5.  Reference person matching
6.  Face clustering
7.  Duplicate detection
8.  OCR
9.  Vision tagging
10. Quality scoring
11. Search indexing
12. Publish

Canonical pipeline defined in Studio Architecture RFC v1. Processors must
be idempotent.

## APIs

REST-first.

Resources: - /events - /sessions - /people - /content - /assets -
/collections - /publications

## Coding Principles

-   Domain-first architecture.
-   Thin Workers.
-   Shared domain models.
-   Strong typing.
-   Modular services.
-   Independent processors.
-   Immutable published releases.
-   Comprehensive audit logging.

## Deployment

studio.vizchitra.com api.vizchitra.com media.vizchitra.com vizchitra.com

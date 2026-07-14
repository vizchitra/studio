# Studio Architecture RFC v1

## Status

Draft v1

## Purpose

This document is the implementation contract for VizChitra Studio. It
complements the architecture documents and provides the engineering
decisions required to build the platform.

------------------------------------------------------------------------

# Scope

Studio consists of:

-   Content
-   Programme
-   People
-   Media
-   Communications
-   Publishing

Shared platform services:

-   Authentication
-   Authorization
-   Search
-   AI
-   Versioning
-   Activity
-   Notifications
-   File Storage

------------------------------------------------------------------------

# System Context

Studio is the system of record.

Publishing produces immutable releases.

Public consumers access only published APIs and media.

    studio.vizchitra.com
            │
            ▼
    Publishing
       ├── api.vizchitra.com
       ├── media.vizchitra.com
       └── vizchitra.com

------------------------------------------------------------------------

# Bounded Contexts

Each module owns its workflows but shares the common domain model.

-   Content
-   Programme
-   People
-   Media
-   Communications
-   Publishing

Cross-module references always use stable IDs.

------------------------------------------------------------------------

# Entity Model

Core entities:

-   Person
-   Organisation
-   Event
-   Session
-   Content
-   Asset
-   AssetVersion
-   Collection
-   Publication
-   Tag
-   Task
-   Note
-   Activity

Never duplicate entity definitions between modules.

------------------------------------------------------------------------

# Data Storage

## D1

Transactional metadata.

## R2

Original and derived files.

## Queues

Asynchronous processing.

## Cache

Published API responses and media metadata.

------------------------------------------------------------------------

# Event Processing

Processors are independent and idempotent.

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

This is the canonical processing pipeline. Studio Implementation Guide and
Media Architecture reference this same sequence rather than restating
their own.

Failures must be retryable without data corruption.

------------------------------------------------------------------------

# API Guidelines

REST-first.

Future GraphQL support is optional.

Resources:

/events /sessions /people /content /assets /publications /search

Published APIs are read-only.

------------------------------------------------------------------------

# Permissions

Roles:

-   Administrator
-   Editor
-   Reviewer
-   Photographer
-   Volunteer
-   Viewer

Permissions are role-based with entity-level overrides.

------------------------------------------------------------------------

# Versioning

Every entity supports:

-   Draft
-   Current
-   Published
-   Historical versions

Publishing never mutates historical releases.

------------------------------------------------------------------------

# Search

Unified search indexes:

-   entities
-   OCR
-   AI tags
-   people
-   sessions
-   assets
-   semantic metadata

------------------------------------------------------------------------

# AI

AI is advisory.

Capabilities:

-   metadata
-   captions
-   alt text
-   speaker suggestions
-   OCR
-   quality scoring

Every AI output requires human confirmation before publication.

------------------------------------------------------------------------

# Testing

-   Unit tests
-   Integration tests
-   Processor tests
-   API contract tests
-   End-to-end tests

------------------------------------------------------------------------

# Deployment

Cloudflare-first.

-   Workers
-   D1
-   R2
-   Queues
-   Image Transformations
-   Access

CI/CD through GitHub Actions.

------------------------------------------------------------------------

# Roadmap

This is the single canonical roadmap for Studio. Other documents link here
rather than restating it.

**Phase 1 - Foundation**
Studio shell, authentication & authorization, shared domain model, Media
module, asset import, search.

**Phase 2 - Core Modules**
Content, Programme, People, publishing pipeline, public API.

**Phase 3 - Intelligence & Automation**
Communications, AI enrichment, semantic search, workflow automation.

------------------------------------------------------------------------

# Guiding Principles

-   Domain-first architecture.
-   Immutable publishing.
-   Single source of truth.
-   Assets referenced everywhere.
-   AI assists, humans decide.
-   Small independent services.
-   Reusable entities over module-specific models.

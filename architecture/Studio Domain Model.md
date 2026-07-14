# Studio Domain Model

## Purpose

The Studio Domain Model defines the core entities shared across every
Studio module.

It is the architectural contract for the platform.

Modules should extend these entities rather than introducing duplicate
concepts.

This document describes entities conceptually --- what they mean and how
they relate. For field-level schema (types, nullability, cardinality),
see [Studio Data Model](Studio%20Data%20Model.md).

------------------------------------------------------------------------

# Design Principles

1.  Everything is an Entity.
2.  Entities have stable identities.
3.  Relationships are first-class.
4.  Media is always referenced through Assets.
5.  Publishing creates immutable Releases.
6.  Modules own workflows, not core entities.

------------------------------------------------------------------------

# Core Entities

## Entity

Base type for every domain object. Every entity shares a common identity
structure (id, type, status, timestamps, audit fields). See Studio Data
Model for the authoritative field-level schema.

------------------------------------------------------------------------

## Asset

Reusable media managed by the Media module.

Examples:

-   Photo
-   Video
-   PDF
-   Logo
-   Transcript

Relationships:

-   Event
-   Session
-   Person
-   Organisation
-   Content
-   Collections

------------------------------------------------------------------------

## Person

Represents an individual.

Roles may include:

-   Speaker
-   Contributor
-   Reviewer
-   Volunteer
-   Organiser
-   Photographer
-   Sponsor Contact

A Person may participate in many Events and Sessions.

------------------------------------------------------------------------

## Organisation

Companies and institutions.

Examples:

-   Sponsors
-   Partners
-   Venues
-   Employers
-   Media organisations

------------------------------------------------------------------------

## Event

Top-level container.

Examples:

-   VizChitra 2026
-   Workshop
-   Meetup

Owns Sessions, Assets, Communications and Content.

------------------------------------------------------------------------

## Session

A scheduled programme item.

Examples:

-   Talk
-   Workshop
-   Dialogue
-   Exhibition
-   Panel

References:

-   Event
-   People
-   Assets
-   Content

------------------------------------------------------------------------

## Content

Editorial content.

Examples:

-   Article
-   Guide
-   Announcement
-   Page
-   Newsletter

Content references Assets rather than embedding files.

------------------------------------------------------------------------

## Collection

Editorial grouping of entities.

Examples:

-   Hero Images
-   Press Kit
-   Social Media
-   Best of Event

Collections may contain Assets or other supported entities.

------------------------------------------------------------------------

## Tag

Structured taxonomy.

Tags are reusable and shared across modules.

------------------------------------------------------------------------

## Task

Action assigned to one or more People.

May reference any Entity.

------------------------------------------------------------------------

## Note

Internal editorial note attached to any Entity.

Never published.

------------------------------------------------------------------------

## Activity

Immutable audit log.

Records changes, comments and workflow actions.

------------------------------------------------------------------------

## Publication

Represents an immutable published release.

References:

-   Entity
-   Version
-   Published URL
-   Published timestamp

------------------------------------------------------------------------

## Relationship

Generic relationship between entities.

Examples:

-   Speaker presents Session
-   Person authored Content
-   Asset illustrates Content
-   Organisation sponsors Event

Treat relationships as first-class objects to support future querying
and visualization.

------------------------------------------------------------------------

# Shared Services

Every core entity supports:

-   Version history
-   Comments
-   Permissions
-   Activity log
-   Search indexing
-   AI enrichment
-   Publishing state

Implement these once.

------------------------------------------------------------------------

# Ownership

  Module           Owns
  ---------------- -----------------------
  Content          Editorial content
  Programme        Sessions & scheduling
  People           Person profiles
  Media            Assets
  Communications   Campaigns
  Publishing       Releases

All modules reference the same shared domain entities.

------------------------------------------------------------------------

# Guiding Principle

Build a unified knowledge graph rather than isolated modules.

Studio should model VizChitra as a connected network of People, Events,
Sessions, Content, Assets and Organisations. Every module contributes to
and consumes this shared graph.

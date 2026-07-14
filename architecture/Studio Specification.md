# Studio Specification

> Canonical entry point for VizChitra Studio architecture documentation.

## Documents

1.  [Studio Architecture](Studio%20Architecture.md) --- vision, modules,
    design principles, system architecture.
2.  [Studio Architecture RFC v1](Studio%20Architecture%20RFC%20v1.md) ---
    implementation contract: bounded contexts, storage, event processing,
    API, permissions, versioning, testing, deployment, roadmap.
3.  [Studio Domain Model](Studio%20Domain%20Model.md) --- conceptual
    entities and relationships.
4.  [Studio Data Model](Studio%20Data%20Model.md) --- field-level schema,
    types, cardinality.
5.  [Media Architecture](Media%20Architecture.md) --- the Digital Asset
    Management subsystem.
6.  [Studio Implementation Guide](Studio%20Implementation%20Guide.md) ---
    repository structure, services, coding principles, deployment.

## Reading order

New to Studio: start with Architecture for vision and modules, then
Domain Model for how entities relate.

Building a feature: read the RFC for contracts, Data Model for schema,
and the Implementation Guide for repo conventions.

Working on media: read Media Architecture.

## Roadmap

See the Roadmap section in Studio Architecture RFC v1 --- that is the
single canonical roadmap. It is not restated here.

## Document ownership

Each concern has exactly one authoritative document.

  Concern                                                              Authoritative document
  --------------------------------------------------------------------- ------------------------------
  Vision, modules, principles                                          Studio Architecture
  Engineering contract (storage, APIs, permissions, versioning, testing, deployment)   Studio Architecture RFC v1
  Entity concepts & relationships                                      Studio Domain Model
  Field-level schema                                                   Studio Data Model
  Media / DAM subsystem                                                Media Architecture
  Repo structure & coding conventions                                  Studio Implementation Guide

No content is duplicated between these documents. If the same fact
appears in two places, that is a bug --- fix it by deleting the
duplicate and linking instead.

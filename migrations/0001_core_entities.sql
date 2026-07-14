-- Core entities. Source of truth: architecture/Studio Data Model.md
-- Every entity table carries the shared Identity columns: id, slug, status,
-- created_at, updated_at, created_by, updated_by. `type` is implicit in the
-- table name rather than a discriminator column.

CREATE TABLE person (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  name TEXT NOT NULL,
  email TEXT,
  bio TEXT,
  roles TEXT NOT NULL DEFAULT '[]', -- JSON array: speaker, contributor, reviewer, volunteer, organiser, photographer, sponsor_contact
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES person(id),
  updated_by TEXT REFERENCES person(id)
);

CREATE TABLE organisation (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  name TEXT NOT NULL,
  kind TEXT NOT NULL, -- sponsor | partner | venue | employer | media
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES person(id),
  updated_by TEXT NOT NULL REFERENCES person(id)
);

CREATE TABLE event (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  name TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES person(id),
  updated_by TEXT NOT NULL REFERENCES person(id)
);

CREATE TABLE session (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  event_id TEXT NOT NULL REFERENCES event(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL, -- talk | workshop | dialogue | exhibition | panel
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES person(id),
  updated_by TEXT NOT NULL REFERENCES person(id)
);
CREATE INDEX idx_session_event ON session(event_id);

CREATE TABLE content (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  kind TEXT NOT NULL, -- article | guide | announcement | page | newsletter
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  author_id TEXT REFERENCES person(id),
  event_id TEXT REFERENCES event(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES person(id),
  updated_by TEXT NOT NULL REFERENCES person(id)
);
CREATE INDEX idx_content_event ON content(event_id);

CREATE TABLE collection (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES person(id),
  updated_by TEXT NOT NULL REFERENCES person(id)
);

-- Polymorphic membership: a Collection may contain Assets or other entities.
CREATE TABLE collection_item (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collection(id),
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_collection_item_collection ON collection_item(collection_id);
CREATE INDEX idx_collection_item_entity ON collection_item(entity_type, entity_id);

CREATE TABLE tag (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE
);

-- Polymorphic tag membership, shared across modules.
CREATE TABLE entity_tag (
  tag_id TEXT NOT NULL REFERENCES tag(id),
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  PRIMARY KEY (tag_id, entity_id, entity_type)
);
CREATE INDEX idx_entity_tag_entity ON entity_tag(entity_type, entity_id);

-- Generic first-class relationship edge. See Studio Data Model.md.
CREATE TABLE relationship (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  from_type TEXT NOT NULL,
  to_id TEXT NOT NULL,
  to_type TEXT NOT NULL,
  kind TEXT NOT NULL, -- presents | authored | illustrates | sponsors | member_of | reviews
  created_at TEXT NOT NULL
);
CREATE INDEX idx_relationship_from ON relationship(from_type, from_id);
CREATE INDEX idx_relationship_to ON relationship(to_type, to_id);

CREATE TABLE publication (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  version TEXT NOT NULL,
  published_url TEXT NOT NULL,
  published_at TEXT NOT NULL
);
CREATE INDEX idx_publication_entity ON publication(entity_type, entity_id);

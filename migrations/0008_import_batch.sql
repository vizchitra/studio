-- Zip-based bulk import (issue #45). Source of truth:
-- architecture/Studio Data Model.md.

CREATE TABLE import_batch (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL, -- historical | review
  filename_template TEXT NOT NULL, -- e.g. '{date}_{code}_{n}'
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES person(id)
);

-- Singular reference (an asset belongs to at most one import batch) — a
-- dedicated nullable FK, not the many-to-many `relationship` table, per
-- the carve-out in migrations/0002_media.sql's header comment.
ALTER TABLE asset ADD COLUMN import_batch_id TEXT REFERENCES import_batch(id);
CREATE INDEX idx_asset_import_batch ON asset(import_batch_id);

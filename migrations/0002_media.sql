-- Media module. Source of truth: architecture/Media Architecture.md,
-- architecture/Studio Data Model.md
--
-- Asset is the stable identity; AssetVersion is a concrete file. Asset
-- carries no owning foreign key — ownership/usage is expressed through
-- `relationship` (many-to-many, e.g. Asset illustrates Content) or, for a
-- single primary reference like a person's headshot, a nullable FK added
-- to the owning table in a later migration once that field is needed.

CREATE TABLE asset (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft', -- draft|review|approved|published|archived
  kind TEXT NOT NULL, -- photo | video | audio | pdf | logo | transcript | brand
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES person(id),
  updated_by TEXT NOT NULL REFERENCES person(id)
);
CREATE INDEX idx_asset_status ON asset(status);

CREATE TABLE asset_version (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES asset(id),
  kind TEXT NOT NULL, -- original | review | edited | web | social | thumbnail
  mime_type TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  duration_seconds REAL,
  checksum TEXT NOT NULL,
  exif TEXT, -- JSON blob, populated by the exif_extraction pipeline step
  created_at TEXT NOT NULL
);
CREATE INDEX idx_asset_version_asset ON asset_version(asset_id);
CREATE UNIQUE INDEX idx_asset_version_r2_key ON asset_version(r2_key);

-- One row per asset per canonical pipeline step (see
-- architecture/Studio Architecture RFC v1.md, Event Processing).
-- Lets each processor be independently retryable without corrupting state.
CREATE TABLE asset_pipeline_run (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES asset(id),
  step TEXT NOT NULL, -- import|exif_extraction|preview_generation|session_inference|
                       -- reference_person_matching|face_clustering|duplicate_detection|
                       -- ocr|vision_tagging|quality_scoring|search_indexing|publish
  status TEXT NOT NULL DEFAULT 'pending', -- pending|running|done|failed
  output TEXT, -- JSON blob, step-specific result
  error TEXT,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX idx_pipeline_run_asset ON asset_pipeline_run(asset_id);
CREATE INDEX idx_pipeline_run_step_status ON asset_pipeline_run(step, status);

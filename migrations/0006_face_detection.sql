-- Detected face bounding boxes for editorial review, computed by the
-- face_clustering pipeline step (services/media/src/pipeline.ts) via
-- Moondream 3.1 on Workers AI. Coordinates are normalized 0-1 (fraction of
-- image width/height, matching Moondream's own output) rather than pixels
-- — resolution-independent, so they render correctly as CSS percentages
-- against whatever derivative the review UI displays.
--
-- person_id is null until a human confirms a name against the box in the
-- review UI (apps/studio/src/routes/assets/); automatic identity matching
-- is a separate, not-yet-built step (reference_person_matching).
CREATE TABLE face_detection (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES asset(id),
  x_min REAL NOT NULL,
  y_min REAL NOT NULL,
  x_max REAL NOT NULL,
  y_max REAL NOT NULL,
  person_id TEXT REFERENCES person(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_face_detection_asset ON face_detection(asset_id);

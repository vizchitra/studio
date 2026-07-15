-- Basic blur/exposure quality heuristics computed by the quality_scoring
-- pipeline step (services/media/src/pipeline.ts) for editorial triage.
-- quality_score: 0-100 composite (higher = better). quality_flags: JSON
-- array of specific issues found, e.g. ["blurry", "underexposed"]. Both
-- NULL for non-image assets, assets whose image couldn't be decoded, or
-- assets uploaded before this step existed.
ALTER TABLE asset ADD COLUMN quality_score REAL;
ALTER TABLE asset ADD COLUMN quality_flags TEXT;

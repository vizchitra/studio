-- Perceptual hash (64-bit dHash, hex-encoded) of the 'original' asset_version's
-- image, computed by the duplicate_detection pipeline step (services/media/src/
-- pipeline.ts) and compared across assets via Hamming distance to flag likely
-- duplicates for editorial review. NULL for non-image assets, assets whose
-- image couldn't be decoded, or assets uploaded before this step existed.
ALTER TABLE asset ADD COLUMN perceptual_hash TEXT;
CREATE INDEX idx_asset_perceptual_hash ON asset(perceptual_hash);

-- duplicate_detection also introduces a new relationship kind, written to the
-- existing `relationship` table (0001_core_entities.sql) rather than a new
-- one: `possible_duplicate_of` — from_id/from_type is the newly processed
-- asset, to_id/to_type is the earlier asset it perceptually matches. Not
-- modifying 0001's kind comment since it's already applied; recorded here
-- instead.

import { monotonicFactory } from "ulid";

/** Canonical ID generator. Every entity id is a ULID (sortable, unique). */
export const ulid = monotonicFactory();

/** Editorial lifecycle shared by every entity — see Studio Architecture.md. */
export const ENTITY_STATUSES = ["draft", "review", "approved", "published", "archived"] as const;

/** Canonical asset processing pipeline order — see Studio Architecture RFC v1.md. */
export const MEDIA_PIPELINE_STEPS = [
  "import",
  "exif_extraction",
  "preview_generation",
  "session_inference",
  "reference_person_matching",
  "face_clustering",
  "duplicate_detection",
  "ocr",
  "vision_tagging",
  "quality_scoring",
  "search_indexing",
  "publish",
] as const;

export type MediaPipelineStep = (typeof MEDIA_PIPELINE_STEPS)[number];

/** Hex-encoded SHA-256 digest — used for asset_version.checksum. */
export async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

import { monotonicFactory } from "ulid";
import type { StudioAccessRole } from "@studio/domain";

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

/**
 * Canonical StudioAccessRole list — see Studio Architecture RFC v1.md,
 * Permissions section (authoritative for the list itself). Runtime array,
 * not just the `@studio/domain` type, so a role selector UI and submitted-
 * value validation have one shared source instead of each hardcoding the
 * six values separately.
 */
export const STUDIO_ACCESS_ROLES: readonly StudioAccessRole[] = [
  "administrator",
  "editor",
  "reviewer",
  "photographer",
  "volunteer",
  "viewer",
];

// Which StudioAccessRole values gate which Studio action. Both services/media
// (upload) and apps/studio (review) need to agree on this, hence living here
// rather than duplicated per service — see Studio Architecture RFC v1.md,
// Permissions section for the role list itself.
const UPLOAD_ROLES: readonly StudioAccessRole[] = ["administrator", "editor", "photographer"];
const REVIEW_ROLES: readonly StudioAccessRole[] = ["administrator", "editor", "reviewer"];
const REPROCESS_ROLES: readonly StudioAccessRole[] = ["administrator"];
const MANAGE_ROLES_ROLES: readonly StudioAccessRole[] = ["administrator"];

/** Deny by default: a missing or unrecognized role has no permissions. */
export function canUpload(role: StudioAccessRole | null | undefined): boolean {
  return !!role && UPLOAD_ROLES.includes(role);
}

export function canReview(role: StudioAccessRole | null | undefined): boolean {
  return !!role && REVIEW_ROLES.includes(role);
}

export function canReprocess(role: StudioAccessRole | null | undefined): boolean {
  return !!role && REPROCESS_ROLES.includes(role);
}

/** Gates `/people` (#58) — assigning StudioAccessRole is administrator-only. */
export function canManageRoles(role: StudioAccessRole | null | undefined): boolean {
  return !!role && MANAGE_ROLES_ROLES.includes(role);
}

/** Hex-encoded SHA-256 digest — used for asset_version.checksum. */
export async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

import { error, fail, redirect } from "@sveltejs/kit";
import { ulid, canReview, canReprocess, MEDIA_PIPELINE_STEPS } from "@studio/shared";
import type { Actions, PageServerLoad } from "./$types";
import type { StudioAccessRole } from "@studio/domain";
import type { MediaPipelineStep } from "@studio/shared";

interface AssetRow {
  id: string;
  status: string;
  kind: string;
  title: string | null;
  created_at: string;
  created_by_name: string | null;
  thumbnail_r2_key: string | null;
  exif_json: string | null;
  quality_score: number | null;
  quality_flags_json: string | null;
}

interface FaceRow {
  id: string;
  asset_id: string;
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
  person_name: string | null;
}

export const load: PageServerLoad = async ({ platform, locals }) => {
  const db = platform?.env.DB;
  if (!db) error(500, "DB binding not available");

  const { results } = await db
    .prepare(
      `SELECT
         a.id, a.status, a.kind, a.title, a.created_at,
         a.quality_score, a.quality_flags as quality_flags_json,
         p.name as created_by_name,
         thumb.r2_key as thumbnail_r2_key,
         orig.exif as exif_json
       FROM asset a
       LEFT JOIN person p ON p.id = a.created_by
       LEFT JOIN asset_version thumb ON thumb.asset_id = a.id AND thumb.kind = 'thumbnail'
       LEFT JOIN asset_version orig ON orig.asset_id = a.id AND orig.kind = 'original'
       ORDER BY a.created_at DESC
       LIMIT 50`,
    )
    .all<AssetRow>();

  const assets = results.map((row) => {
    let exifSummary: string | null = null;
    if (row.exif_json) {
      try {
        const exif = JSON.parse(row.exif_json) as Record<string, unknown>;
        const parts = [exif.Make, exif.Model, exif.DateTimeOriginal]
          .filter((v): v is string => typeof v === "string")
          .join(" · ");
        exifSummary = parts || null;
      } catch {
        exifSummary = null;
      }
    }

    let qualityFlags: string[] = [];
    if (row.quality_flags_json) {
      try {
        qualityFlags = JSON.parse(row.quality_flags_json) as string[];
      } catch {
        qualityFlags = [];
      }
    }

    return { ...row, exifSummary, qualityFlags };
  });

  const facesByAsset = new Map<string, FaceRow[]>();
  if (results.length > 0) {
    const placeholders = results.map(() => "?").join(", ");
    const { results: faceRows } = await db
      .prepare(
        `SELECT fd.id, fd.asset_id, fd.x_min, fd.y_min, fd.x_max, fd.y_max, p.name as person_name
         FROM face_detection fd
         LEFT JOIN person p ON p.id = fd.person_id
         WHERE fd.asset_id IN (${placeholders})`,
      )
      .bind(...results.map((row) => row.id))
      .all<FaceRow>();
    for (const face of faceRows) {
      const list = facesByAsset.get(face.asset_id) ?? [];
      list.push(face);
      facesByAsset.set(face.asset_id, list);
    }
  }
  const assetsWithFaces = assets.map((asset) => ({
    ...asset,
    faces: facesByAsset.get(asset.id) ?? [],
  }));

  let reprocessEnabled = false;
  if (locals.user) {
    const personId = await getOrCreatePersonId(db, locals.user.email);
    const role = await getEffectiveRole(db, personId, "studio", "global");
    reprocessEnabled = canReprocess(role);
  }

  return { assets: assetsWithFaces, reprocessEnabled, pipelineSteps: MEDIA_PIPELINE_STEPS };
};

// asset.updated_by is a FK to person.id, not a raw email — same resolution
// as services/media/src/index.ts's getOrCreatePersonId.
async function getOrCreatePersonId(db: D1Database, email: string): Promise<string> {
  const existing = await db
    .prepare(`SELECT id FROM person WHERE email = ?`)
    .bind(email)
    .first<{ id: string }>();
  if (existing) return existing.id;

  const id = ulid();
  const now = new Date().toISOString();
  await db
    .prepare(`INSERT INTO person (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, email, email, now, now)
    .run();
  return id;
}

// Resolve-or-create by name rather than email — a confirmed face has no
// email to key on, unlike getOrCreatePersonId's Access-authenticated users.
async function getOrCreatePersonByName(db: D1Database, name: string): Promise<string> {
  const existing = await db
    .prepare(`SELECT id FROM person WHERE name = ? COLLATE NOCASE`)
    .bind(name)
    .first<{ id: string }>();
  if (existing) return existing.id;

  const id = ulid();
  const now = new Date().toISOString();
  await db
    .prepare(`INSERT INTO person (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .bind(id, name, now, now)
    .run();
  return id;
}

// Effective StudioAccessRole for a specific entity: an entity-level override
// (a `permission` row scoped to that entity) takes precedence over the
// baseline grant (entity_type = 'studio', entity_id = 'global') — see
// architecture/Studio Data Model.md, Permission section.
async function getEffectiveRole(
  db: D1Database,
  personId: string,
  entityType: string,
  entityId: string,
): Promise<StudioAccessRole | null> {
  const override = await db
    .prepare(
      `SELECT role FROM permission WHERE entity_type = ? AND entity_id = ? AND person_id = ?`,
    )
    .bind(entityType, entityId, personId)
    .first<{ role: StudioAccessRole }>();
  if (override) return override.role;

  const baseline = await db
    .prepare(
      `SELECT role FROM permission WHERE entity_type = 'studio' AND entity_id = 'global' AND person_id = ?`,
    )
    .bind(personId)
    .first<{ role: StudioAccessRole }>();
  return baseline?.role ?? null;
}

async function setStatus(
  db: D1Database,
  assetId: string,
  status: "approved" | "archived",
  updatedBy: string,
) {
  await db
    .prepare(`UPDATE asset SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?`)
    .bind(status, new Date().toISOString(), updatedBy, assetId)
    .run();
}

export const actions: Actions = {
  approve: async ({ request, platform, locals }) => {
    if (!locals.user) return fail(401, { error: "Not signed in" });
    const form = await request.formData();
    const assetId = form.get("assetId");
    if (typeof assetId !== "string") return fail(400, { error: "Missing assetId" });

    const db = platform?.env.DB;
    const queue = platform?.env.MEDIA_QUEUE;
    if (!db || !queue) return fail(500, { error: "DB or queue binding not available" });
    const personId = await getOrCreatePersonId(db, locals.user.email);
    const role = await getEffectiveRole(db, personId, "asset", assetId);
    if (!canReview(role)) return fail(403, { error: "Insufficient permissions to approve" });
    await setStatus(db, assetId, "approved", personId);
    // The pipeline already ran 'publish' once automatically on upload, but
    // skipped it (asset was still 'draft') — re-send it now that the status
    // check will pass, see services/media/src/pipeline.ts publishStep.
    await queue.send({ assetId, step: "publish" });
    redirect(303, "/assets");
  },

  reject: async ({ request, platform, locals }) => {
    if (!locals.user) return fail(401, { error: "Not signed in" });
    const form = await request.formData();
    const assetId = form.get("assetId");
    if (typeof assetId !== "string") return fail(400, { error: "Missing assetId" });

    // No dedicated "rejected" state in the entity status enum
    // (draft|review|approved|published|archived) — archived is the closest
    // fit for "reviewed and not going forward".
    const db = platform?.env.DB;
    if (!db) return fail(500, { error: "DB binding not available" });
    const personId = await getOrCreatePersonId(db, locals.user.email);
    const role = await getEffectiveRole(db, personId, "asset", assetId);
    if (!canReview(role)) return fail(403, { error: "Insufficient permissions to reject" });
    await setStatus(db, assetId, "archived", personId);
    redirect(303, "/assets");
  },

  // Re-enqueues an existing asset at a chosen pipeline step (closes #32) —
  // for assets stuck with stale/empty results because they were processed
  // before a step's real implementation shipped. runPipelineStep already
  // enqueues the next step on success, so resuming at step X naturally
  // cascades through everything after it; no new pipeline logic needed.
  // Gated by canReprocess (administrator only) — this bypasses whatever a
  // step already recorded, so it isn't available to reviewers/editors.
  reprocess: async ({ request, platform, locals }) => {
    if (!locals.user) return fail(401, { error: "Not signed in" });
    const form = await request.formData();
    const assetId = form.get("assetId");
    const step = form.get("step");
    if (typeof assetId !== "string") return fail(400, { error: "Missing assetId" });
    if (typeof step !== "string" || !MEDIA_PIPELINE_STEPS.includes(step as MediaPipelineStep)) {
      return fail(400, { error: "Missing or invalid step" });
    }

    const db = platform?.env.DB;
    const queue = platform?.env.MEDIA_QUEUE;
    if (!db || !queue) return fail(500, { error: "DB or queue binding not available" });
    const personId = await getOrCreatePersonId(db, locals.user.email);
    const role = await getEffectiveRole(db, personId, "studio", "global");
    if (!canReprocess(role)) return fail(403, { error: "Insufficient permissions to reprocess" });

    await queue.send({ assetId, step: step as MediaPipelineStep });
    redirect(303, "/assets");
  },

  // Manual identity confirmation for a detected face box (closes #31) —
  // automatic matching (reference_person_matching) is a separate, later
  // step; this just lets a human attach a name to a box Moondream found.
  confirmFace: async ({ request, platform, locals }) => {
    if (!locals.user) return fail(401, { error: "Not signed in" });
    const form = await request.formData();
    const faceId = form.get("faceId");
    const personName = form.get("personName");
    if (typeof faceId !== "string") return fail(400, { error: "Missing faceId" });
    if (typeof personName !== "string" || personName.trim() === "") {
      return fail(400, { error: "Missing person name" });
    }

    const db = platform?.env.DB;
    if (!db) return fail(500, { error: "DB binding not available" });

    const face = await db
      .prepare(`SELECT asset_id FROM face_detection WHERE id = ?`)
      .bind(faceId)
      .first<{ asset_id: string }>();
    if (!face) return fail(404, { error: "Face not found" });

    const personId = await getOrCreatePersonId(db, locals.user.email);
    const role = await getEffectiveRole(db, personId, "asset", face.asset_id);
    if (!canReview(role)) return fail(403, { error: "Insufficient permissions to confirm a face" });

    const confirmedPersonId = await getOrCreatePersonByName(db, personName.trim());
    await db
      .prepare(`UPDATE face_detection SET person_id = ? WHERE id = ?`)
      .bind(confirmedPersonId, faceId)
      .run();
    redirect(303, "/assets");
  },
};

import { error } from "@sveltejs/kit";
import { MEDIA_PIPELINE_STEPS, canReprocess } from "@studio/shared";
import { getBaselineRoleByEmail } from "$lib/server/permissions";
import type { MediaPipelineStep } from "@studio/shared";
import type { PageServerLoad } from "./$types";

// Same email the seed script (services/media/scripts/seed-fixtures.ts) uses
// to own every fixture asset it creates — that's how this page finds them,
// rather than a dedicated flag column.
const FIXTURE_PERSON_EMAIL = "fixtures@vizchitra.internal";

interface AssetRow {
  id: string;
  title: string | null;
  kind: string;
  quality_score: number | null;
  quality_flags: string | null;
  perceptual_hash: string | null;
}

interface RunRow {
  asset_id: string;
  step: MediaPipelineStep;
  status: string;
  output: string | null;
  error: string | null;
  finished_at: string | null;
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

export interface StepCell {
  step: MediaPipelineStep;
  status: "not_run" | "running" | "done" | "failed";
  output: Record<string, unknown> | null;
  error: string | null;
}

export interface FixtureRow {
  id: string;
  title: string;
  kind: string;
  thumbnailR2Key: string | null;
  qualityScore: number | null;
  qualityFlags: string[];
  perceptualHash: string | null;
  faces: {
    id: string;
    x_min: number;
    y_min: number;
    x_max: number;
    y_max: number;
    personName: string | null;
  }[];
  steps: StepCell[];
}

export const load: PageServerLoad = async ({ platform, locals }) => {
  const db = platform?.env.DB;
  if (!db) error(500, "DB binding not available");
  if (!locals.user) error(401, "Not signed in");

  const role = await getBaselineRoleByEmail(db, locals.user.email);
  if (!canReprocess(role)) {
    error(403, "Administrators only");
  }

  const fixturePerson = await db
    .prepare(`SELECT id FROM person WHERE email = ?`)
    .bind(FIXTURE_PERSON_EMAIL)
    .first<{ id: string }>();

  if (!fixturePerson) {
    return { fixtures: [] as FixtureRow[], pipelineSteps: MEDIA_PIPELINE_STEPS };
  }

  const { results: assets } = await db
    .prepare(
      `SELECT id, title, kind, quality_score, quality_flags, perceptual_hash
       FROM asset WHERE created_by = ? ORDER BY title`,
    )
    .bind(fixturePerson.id)
    .all<AssetRow>();

  if (assets.length === 0) {
    return { fixtures: [] as FixtureRow[], pipelineSteps: MEDIA_PIPELINE_STEPS };
  }

  const assetIds = assets.map((a) => a.id);
  const placeholders = assetIds.map(() => "?").join(", ");

  const { results: thumbnails } = await db
    .prepare(
      `SELECT asset_id, r2_key FROM asset_version WHERE kind = 'thumbnail' AND asset_id IN (${placeholders})`,
    )
    .bind(...assetIds)
    .all<{ asset_id: string; r2_key: string }>();
  const thumbnailByAsset = new Map(thumbnails.map((t) => [t.asset_id, t.r2_key]));

  // Latest run per (asset_id, step) — a step can have multiple rows over
  // time (retries, admin reprocess), so this is "what actually happened
  // most recently", not "everything that ever happened".
  const { results: runs } = await db
    .prepare(
      `SELECT asset_id, step, status, output, error, finished_at FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY asset_id, step ORDER BY started_at DESC) AS rn
         FROM asset_pipeline_run WHERE asset_id IN (${placeholders})
       ) WHERE rn = 1`,
    )
    .bind(...assetIds)
    .all<RunRow>();
  const runByAssetStep = new Map(runs.map((r) => [`${r.asset_id}:${r.step}`, r]));

  const { results: faces } = await db
    .prepare(
      `SELECT fd.id, fd.asset_id, fd.x_min, fd.y_min, fd.x_max, fd.y_max, p.name as person_name
       FROM face_detection fd
       LEFT JOIN person p ON p.id = fd.person_id
       WHERE fd.asset_id IN (${placeholders})`,
    )
    .bind(...assetIds)
    .all<FaceRow>();
  const facesByAsset = new Map<string, FaceRow[]>();
  for (const face of faces) {
    const list = facesByAsset.get(face.asset_id) ?? [];
    list.push(face);
    facesByAsset.set(face.asset_id, list);
  }

  const fixtures: FixtureRow[] = assets.map((asset) => {
    let qualityFlags: string[] = [];
    if (asset.quality_flags) {
      try {
        qualityFlags = JSON.parse(asset.quality_flags) as string[];
      } catch {
        qualityFlags = [];
      }
    }

    const steps: StepCell[] = MEDIA_PIPELINE_STEPS.map((step) => {
      const run = runByAssetStep.get(`${asset.id}:${step}`);
      if (!run) return { step, status: "not_run", output: null, error: null };
      let output: Record<string, unknown> | null = null;
      if (run.output) {
        try {
          output = JSON.parse(run.output) as Record<string, unknown>;
        } catch {
          output = null;
        }
      }
      return {
        step,
        status: run.status as StepCell["status"],
        output,
        error: run.error,
      };
    });

    return {
      id: asset.id,
      title: asset.title ?? asset.id,
      kind: asset.kind,
      thumbnailR2Key: thumbnailByAsset.get(asset.id) ?? null,
      qualityScore: asset.quality_score,
      qualityFlags,
      perceptualHash: asset.perceptual_hash,
      faces: (facesByAsset.get(asset.id) ?? []).map((f) => ({
        id: f.id,
        x_min: f.x_min,
        y_min: f.y_min,
        x_max: f.x_max,
        y_max: f.y_max,
        personName: f.person_name,
      })),
      steps,
    };
  });

  return { fixtures, pipelineSteps: MEDIA_PIPELINE_STEPS };
};

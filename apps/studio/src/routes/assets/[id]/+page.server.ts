import { error } from "@sveltejs/kit";
import { canReview, canReprocess, MEDIA_PIPELINE_STEPS } from "@studio/shared";
import { getEffectiveRole, getOrCreatePersonId } from "$lib/server/permissions";
import type { PageServerLoad } from "./$types";
import type { MediaPipelineStep } from "@studio/shared";

interface AssetRow {
  id: string;
  status: string;
  kind: string;
  title: string | null;
  created_at: string;
  created_by_name: string | null;
  quality_score: number | null;
  quality_flags_json: string | null;
}

interface VersionRow {
  id: string;
  kind: string;
  mime_type: string;
  r2_key: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  checksum: string;
  exif: string | null;
  created_at: string;
}

interface RunRow {
  id: string;
  step: MediaPipelineStep;
  status: string;
  output: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export const load: PageServerLoad = async ({ params, platform, locals }) => {
  const db = platform?.env.DB;
  if (!db) error(500, "DB binding not available");

  const asset = await db
    .prepare(
      `SELECT a.id, a.status, a.kind, a.title, a.created_at,
              a.quality_score, a.quality_flags as quality_flags_json,
              p.name as created_by_name
       FROM asset a
       LEFT JOIN person p ON p.id = a.created_by
       WHERE a.id = ?`,
    )
    .bind(params.id)
    .first<AssetRow>();
  if (!asset) error(404, "Asset not found");

  let qualityFlags: string[] = [];
  if (asset.quality_flags_json) {
    try {
      qualityFlags = JSON.parse(asset.quality_flags_json) as string[];
    } catch {
      qualityFlags = [];
    }
  }

  const { results: versions } = await db
    .prepare(
      `SELECT id, kind, mime_type, r2_key, size_bytes, width, height,
              duration_seconds, checksum, exif, created_at
       FROM asset_version WHERE asset_id = ? ORDER BY created_at ASC`,
    )
    .bind(params.id)
    .all<VersionRow>();

  // "Largest available derivative, whichever renders" (#56) — web is the
  // browser-safe derivative every original gets downsized into; fall back
  // to original only when there's no web derivative yet (still processing).
  const displayVersion =
    versions.find((v) => v.kind === "web") ?? versions.find((v) => v.kind === "original");

  // Same curated field set as the assets grid's summary (Make/Model/
  // DateTimeOriginal), plus a few more that matter once you're looking at
  // one asset in depth rather than scanning a grid.
  const originalExif = versions.find((v) => v.kind === "original")?.exif ?? null;
  let exifSummary: string | null = null;
  if (originalExif) {
    try {
      const exif = JSON.parse(originalExif) as Record<string, unknown>;
      const parts = [
        exif.Make,
        exif.Model,
        exif.DateTimeOriginal,
        exif.ISO !== undefined ? `ISO ${exif.ISO}` : undefined,
        exif.FNumber !== undefined ? `f/${exif.FNumber}` : undefined,
        exif.FocalLength !== undefined ? `${exif.FocalLength}mm` : undefined,
      ]
        .filter((v): v is string | number => v !== undefined && v !== null)
        .join(" · ");
      exifSummary = parts || null;
    } catch {
      exifSummary = null;
    }
  }

  const { results: runs } = await db
    .prepare(
      `SELECT id, step, status, output, error, started_at, finished_at
       FROM asset_pipeline_run WHERE asset_id = ? ORDER BY started_at DESC`,
    )
    .bind(params.id)
    .all<RunRow>();

  const pipelineRuns = runs.map((run) => {
    let output: Record<string, unknown> | null = null;
    if (run.output) {
      try {
        output = JSON.parse(run.output) as Record<string, unknown>;
      } catch {
        output = null;
      }
    }
    return { ...run, output };
  });

  const { results: tagRows } = await db
    .prepare(
      `SELECT t.name FROM relationship r
       JOIN tag t ON t.id = r.to_id
       WHERE r.from_id = ? AND r.from_type = 'asset' AND r.kind = 'tagged_with' AND r.to_type = 'tag'
       ORDER BY t.name`,
    )
    .bind(params.id)
    .all<{ name: string }>();
  const tags = tagRows.map((t) => t.name);

  const capturedByRel = await db
    .prepare(
      `SELECT to_id, to_type FROM relationship
       WHERE from_id = ? AND from_type = 'asset' AND kind = 'captured_by' LIMIT 1`,
    )
    .bind(params.id)
    .first<{ to_id: string; to_type: string }>();

  let capturedBy: string | null = null;
  if (capturedByRel) {
    const table = capturedByRel.to_type === "organisation" ? "organisation" : "person";
    const row = await db
      .prepare(`SELECT name FROM ${table} WHERE id = ?`)
      .bind(capturedByRel.to_id)
      .first<{ name: string }>();
    capturedBy = row?.name ?? null;
  }

  let canReviewAsset = false;
  let canReprocessAsset = false;
  if (locals.user) {
    const personId = await getOrCreatePersonId(db, locals.user.email);
    const assetRole = await getEffectiveRole(db, personId, "asset", params.id);
    canReviewAsset = canReview(assetRole);
    const studioRole = await getEffectiveRole(db, personId, "studio", "global");
    canReprocessAsset = canReprocess(studioRole);
  }

  return {
    asset: { ...asset, qualityFlags },
    versions,
    displayVersion,
    exifSummary,
    pipelineRuns,
    tags,
    capturedBy,
    canReviewAsset,
    canReprocessAsset,
    pipelineSteps: MEDIA_PIPELINE_STEPS,
  };
};

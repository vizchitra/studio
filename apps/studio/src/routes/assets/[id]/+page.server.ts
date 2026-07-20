import { error, fail, redirect } from "@sveltejs/kit";
import { canReview, canReprocess, MEDIA_PIPELINE_STEPS } from "@studio/shared";
import {
  getEffectiveRole,
  getOrCreatePersonByName,
  getOrCreatePersonId,
} from "$lib/server/permissions";
import { replaceAssetTags, setCapturedBy } from "$lib/server/relationships";
import type { Actions, PageServerLoad } from "./$types";
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

  // Autocomplete sources for the metadata edit form (#57) — same
  // read-only, side-effect-free lookups the upload form already does on
  // GET (src/routes/+page.server.ts).
  let personNames: string[] = [];
  let tagNames: string[] = [];
  let orgName: string | null = null;
  if (canReviewAsset) {
    const [people, allTags, org] = await Promise.all([
      db
        .prepare(`SELECT DISTINCT name FROM person WHERE name IS NOT NULL ORDER BY name LIMIT 200`)
        .all<{ name: string }>(),
      db.prepare(`SELECT name FROM tag ORDER BY name LIMIT 200`).all<{ name: string }>(),
      db
        .prepare(`SELECT name FROM organisation WHERE slug = 'vizchitra'`)
        .first<{ name: string }>(),
    ]);
    personNames = people.results.map((p) => p.name);
    tagNames = allTags.results.map((t) => t.name);
    orgName = org?.name ?? null;
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
    personNames,
    tagNames,
    orgName,
  };
};

export const actions: Actions = {
  // Correct title/tags/captured_by after the fact (#57) — set once at
  // import/upload with no way to fix a wrong or missing credit until now.
  // Allowed post-publish: publication rows stay immutable per CLAUDE.md,
  // but that's a release snapshot, not a lock on the asset's own
  // metadata — a correction is picked up by the next publish.
  updateMetadata: async ({ request, params, platform, locals }) => {
    if (!locals.user) return fail(401, { error: "Not signed in" });
    const db = platform?.env.DB;
    if (!db) return fail(500, { error: "DB binding not available" });

    const personId = await getOrCreatePersonId(db, locals.user.email);
    const role = await getEffectiveRole(db, personId, "asset", params.id);
    if (!canReview(role)) return fail(403, { error: "Insufficient permissions to edit metadata" });

    const form = await request.formData();
    const title = form.get("title");
    const tagsRaw = form.get("tags");
    const capturedByName = form.get("capturedByName");

    if (typeof capturedByName !== "string" || capturedByName.trim() === "") {
      return fail(400, { error: "Captured by is required" });
    }

    const trimmedTitle = typeof title === "string" ? title.trim() : "";
    await db
      .prepare(`UPDATE asset SET title = ?, updated_at = ?, updated_by = ? WHERE id = ?`)
      .bind(trimmedTitle || null, new Date().toISOString(), personId, params.id)
      .run();

    const tagNames = typeof tagsRaw === "string" ? tagsRaw : "";
    await replaceAssetTags(
      db,
      params.id,
      tagNames
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t !== ""),
    );

    // Typing the org's own name (e.g. "VizChitra") re-selects the org
    // default; anything else resolves to a Person, same rule the bulk
    // import fallback uses in reverse (issue #45).
    const org = await db
      .prepare(`SELECT id, name FROM organisation WHERE slug = 'vizchitra'`)
      .first<{ id: string; name: string }>();
    const trimmedCapturedBy = capturedByName.trim();
    if (org && trimmedCapturedBy.toLowerCase() === org.name.toLowerCase()) {
      await setCapturedBy(db, params.id, org.id, "organisation");
    } else {
      const capturedById = await getOrCreatePersonByName(db, trimmedCapturedBy);
      await setCapturedBy(db, params.id, capturedById, "person");
    }

    redirect(303, `/assets/${params.id}`);
  },
};

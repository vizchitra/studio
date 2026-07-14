import { ulid, MEDIA_PIPELINE_STEPS, type MediaPipelineStep } from "@studio/shared";

export interface PipelineContext {
  assetId: string;
  db: D1Database;
  bucket: R2Bucket;
  queue: Queue;
}

export type PipelineStepFn = (ctx: PipelineContext) => Promise<Record<string, unknown>>;

// Each step is a stub. Fill in real logic module by module — the contract
// (idempotent, retryable, returns a JSON-serializable result) must not change.
// Canonical order/source: architecture/Studio Architecture RFC v1.md, Event Processing.

async function importStep(_ctx: PipelineContext) {
  // Original file already lands in R2 via the upload handler in index.ts.
  // This step confirms the object exists and records byte size/checksum.
  return { done: true };
}

async function exifExtractionStep(_ctx: PipelineContext) {
  // TODO: read the original AssetVersion from R2, parse EXIF, write to
  // asset_version.exif for the 'original' version row.
  return { done: true };
}

async function previewGenerationStep(_ctx: PipelineContext) {
  // TODO: use Cloudflare Image Transformations to generate web/thumbnail
  // AssetVersion rows.
  return { done: true };
}

async function sessionInferenceStep(_ctx: PipelineContext) {
  // TODO: infer likely Session from EXIF timestamp + Event schedule,
  // write a `relationship` row (kind: illustrates) pending confirmation.
  return { done: true };
}

async function referencePersonMatchingStep(_ctx: PipelineContext) {
  // TODO: compare detected faces against known Person reference photos.
  return { done: true };
}

async function faceClusteringStep(_ctx: PipelineContext) {
  // TODO: cluster unmatched faces across the batch for human labeling.
  return { done: true };
}

async function duplicateDetectionStep(_ctx: PipelineContext) {
  // TODO: perceptual hash against existing Assets in the same Event.
  return { done: true };
}

async function ocrStep(_ctx: PipelineContext) {
  // TODO: OCR for slides/PDFs/signage photos.
  return { done: true };
}

async function visionTaggingStep(_ctx: PipelineContext) {
  // TODO: AI vision tags + alt text draft. Advisory only — human confirms
  // before publish, per architecture/Studio Architecture RFC v1.md, AI section.
  return { done: true };
}

async function qualityScoringStep(_ctx: PipelineContext) {
  // TODO: blur/exposure/composition heuristics to help editorial triage.
  return { done: true };
}

async function searchIndexingStep(_ctx: PipelineContext) {
  // TODO: upsert search_index row from Asset + AssetVersion + tags.
  return { done: true };
}

async function publishStep(_ctx: PipelineContext) {
  // TODO: only runs if Asset.status === 'approved'. Creates immutable
  // Publication row + derivative AssetVersions, pushes to media.vizchitra.com.
  return { done: true };
}

export const PIPELINE: Record<MediaPipelineStep, PipelineStepFn> = {
  import: importStep,
  exif_extraction: exifExtractionStep,
  preview_generation: previewGenerationStep,
  session_inference: sessionInferenceStep,
  reference_person_matching: referencePersonMatchingStep,
  face_clustering: faceClusteringStep,
  duplicate_detection: duplicateDetectionStep,
  ocr: ocrStep,
  vision_tagging: visionTaggingStep,
  quality_scoring: qualityScoringStep,
  search_indexing: searchIndexingStep,
  publish: publishStep,
};

export function nextStep(step: MediaPipelineStep): MediaPipelineStep | null {
  const i = MEDIA_PIPELINE_STEPS.indexOf(step);
  return i >= 0 && i < MEDIA_PIPELINE_STEPS.length - 1 ? MEDIA_PIPELINE_STEPS[i + 1] : null;
}

/**
 * Runs one pipeline step for one asset, recording the attempt in
 * asset_pipeline_run so failures are retryable without corrupting state
 * (architecture/Studio Architecture RFC v1.md, Event Processing).
 * Enqueues the next step on success; leaves status='failed' on error so a
 * retry sweep can pick it back up.
 */
export async function runPipelineStep(step: MediaPipelineStep, ctx: PipelineContext) {
  const runId = ulid();
  const startedAt = new Date().toISOString();

  await ctx.db
    .prepare(
      `INSERT INTO asset_pipeline_run (id, asset_id, step, status, started_at)
       VALUES (?, ?, ?, 'running', ?)`,
    )
    .bind(runId, ctx.assetId, step, startedAt)
    .run();

  try {
    const output = await PIPELINE[step](ctx);
    await ctx.db
      .prepare(
        `UPDATE asset_pipeline_run SET status = 'done', output = ?, finished_at = ? WHERE id = ?`,
      )
      .bind(JSON.stringify(output), new Date().toISOString(), runId)
      .run();

    const next = nextStep(step);
    if (next) {
      await ctx.queue.send({ assetId: ctx.assetId, step: next });
    }
  } catch (err) {
    await ctx.db
      .prepare(
        `UPDATE asset_pipeline_run SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`,
      )
      .bind(String(err), new Date().toISOString(), runId)
      .run();
    throw err; // let the Queue's retry policy (see wrangler.toml) handle redelivery
  }
}

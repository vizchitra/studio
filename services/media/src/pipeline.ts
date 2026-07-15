import { parse as parseExif } from "exifr";
import { PhotonImage, SamplingFilter, resize } from "@cf-wasm/photon/workerd";
import { ulid, sha256Hex, MEDIA_PIPELINE_STEPS, type MediaPipelineStep } from "@studio/shared";

// Keep extraction to plain, JSON-serializable metadata (timestamps, camera
// info, GPS, orientation) — skip binary/large segments (makerNote, thumbnail,
// icc) that aren't useful here and don't round-trip cleanly through JSON.
const EXIF_PARSE_OPTIONS = {
  tiff: true,
  exif: true,
  gps: true,
  interop: false,
  makerNote: false,
  userComment: false,
  xmp: false,
  icc: false,
  iptc: false,
  jfif: false,
  translateKeys: true,
  translateValues: true,
  reviveValues: true,
  mergeOutput: true,
};

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

async function exifExtractionStep(ctx: PipelineContext) {
  const version = await ctx.db
    .prepare(
      `SELECT id, r2_key, mime_type FROM asset_version WHERE asset_id = ? AND kind = 'original'`,
    )
    .bind(ctx.assetId)
    .first<{ id: string; r2_key: string; mime_type: string }>();

  if (!version) {
    throw new Error(`No 'original' asset_version found for asset ${ctx.assetId}`);
  }

  if (!version.mime_type.startsWith("image/")) {
    return { skipped: true, reason: `mime_type ${version.mime_type} is not an image` };
  }

  const object = await ctx.bucket.get(version.r2_key);
  if (!object) {
    throw new Error(`R2 object ${version.r2_key} not found for asset ${ctx.assetId}`);
  }
  const bytes = await object.arrayBuffer();

  let exif: Record<string, unknown> | null;
  try {
    exif = (await parseExif(bytes, EXIF_PARSE_OPTIONS)) ?? null;
  } catch (err) {
    // Corrupt or unsupported EXIF data isn't a pipeline failure — the image
    // itself is still valid, it just has no (or malformed) metadata to record.
    return { skipped: true, reason: `EXIF parse failed: ${String(err)}` };
  }

  await ctx.db
    .prepare(`UPDATE asset_version SET exif = ? WHERE id = ?`)
    .bind(exif ? JSON.stringify(exif) : null, version.id)
    .run();

  return { done: true, hasExif: exif !== null };
}

// Longest-edge cap + JPEG quality per derivative kind. Resizing happens
// in-Worker via @cf-wasm/photon (WASM) rather than Cloudflare Image
// Transformations, which would need the original re-fetched over HTTP
// through a zone with Image Resizing enabled — this avoids that extra infra
// and plan dependency. JPEG over WebP because photon-rs's get_bytes_webp()
// takes no quality argument (lossless only) — for simple/already-compressed
// source images that reliably came out *larger* than the original, which
// defeats the point of a "web" derivative. get_bytes_jpeg(quality) gives
// real lossy control.
const PREVIEW_SIZES: { kind: "web" | "thumbnail"; maxDimension: number; quality: number }[] = [
  { kind: "web", maxDimension: 1600, quality: 82 },
  { kind: "thumbnail", maxDimension: 400, quality: 75 },
];

// Workers cap memory around 128MB; stay well clear of that for decode + resize.
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

async function previewGenerationStep(ctx: PipelineContext) {
  const version = await ctx.db
    .prepare(
      `SELECT id, r2_key, mime_type, size_bytes FROM asset_version WHERE asset_id = ? AND kind = 'original'`,
    )
    .bind(ctx.assetId)
    .first<{ id: string; r2_key: string; mime_type: string; size_bytes: number }>();

  if (!version) {
    throw new Error(`No 'original' asset_version found for asset ${ctx.assetId}`);
  }

  if (!version.mime_type.startsWith("image/")) {
    return { skipped: true, reason: `mime_type ${version.mime_type} is not an image` };
  }

  if (version.size_bytes > MAX_SOURCE_BYTES) {
    return {
      skipped: true,
      reason: `original is ${version.size_bytes} bytes, over the ${MAX_SOURCE_BYTES} processing cap`,
    };
  }

  const object = await ctx.bucket.get(version.r2_key);
  if (!object) {
    throw new Error(`R2 object ${version.r2_key} not found for asset ${ctx.assetId}`);
  }
  const sourceBytes = new Uint8Array(await object.arrayBuffer());

  let sourceImage: PhotonImage;
  try {
    sourceImage = PhotonImage.new_from_byteslice(sourceBytes);
  } catch (err) {
    // Corrupt or unsupported image data isn't a pipeline failure — retrying
    // won't decode it any better.
    return { skipped: true, reason: `image decode failed: ${String(err)}` };
  }

  const created: { kind: string; versionId: string; reused: boolean }[] = [];
  try {
    for (const { kind, maxDimension, quality } of PREVIEW_SIZES) {
      // Idempotent: a retried run must not recreate (or duplicate-key on) a
      // derivative an earlier partial attempt already produced.
      const existing = await ctx.db
        .prepare(`SELECT id FROM asset_version WHERE asset_id = ? AND kind = ?`)
        .bind(ctx.assetId, kind)
        .first<{ id: string }>();
      if (existing) {
        created.push({ kind, versionId: existing.id, reused: true });
        continue;
      }

      const longestEdge = Math.max(sourceImage.get_width(), sourceImage.get_height());
      const scale = Math.min(1, maxDimension / longestEdge);
      const width = Math.round(sourceImage.get_width() * scale);
      const height = Math.round(sourceImage.get_height() * scale);

      const resized = resize(sourceImage, width, height, SamplingFilter.Lanczos3);
      let outputBytes: Uint8Array;
      try {
        outputBytes = resized.get_bytes_jpeg(quality);
      } finally {
        resized.free();
      }

      const versionId = ulid();
      const r2Key = `derivatives/${ctx.assetId}/${kind}.jpg`;
      const checksum = await sha256Hex(outputBytes as Uint8Array<ArrayBuffer>);
      const now = new Date().toISOString();

      await ctx.bucket.put(r2Key, outputBytes, { httpMetadata: { contentType: "image/jpeg" } });
      await ctx.db
        .prepare(
          `INSERT INTO asset_version (id, asset_id, kind, mime_type, r2_key, size_bytes, width, height, checksum, created_at)
           VALUES (?, ?, ?, 'image/jpeg', ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          versionId,
          ctx.assetId,
          kind,
          r2Key,
          outputBytes.byteLength,
          width,
          height,
          checksum,
          now,
        )
        .run();

      created.push({ kind, versionId, reused: false });
    }
  } finally {
    sourceImage.free();
  }

  return { done: true, created };
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

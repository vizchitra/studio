import { parse as parseExif } from "exifr";
import { PhotonImage, SamplingFilter, grayscale, laplace, resize } from "@cf-wasm/photon/workerd";
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

// 64-bit difference hash (dHash): resize to 9x8 grayscale, then for each of
// the 8 rows compare each of the 9 pixels to its right neighbor — 8
// comparisons per row * 8 rows = 64 bits. Robust to resizing/compression,
// cheap to compute, no extra dependency beyond Photon (already in use for
// preview_generation).
function computeDHash(image: PhotonImage): string {
  const resized = resize(image, 9, 8, SamplingFilter.Nearest);
  try {
    grayscale(resized);
    const pixels = resized.get_raw_pixels(); // RGBA, grayscale so R=G=B
    let bits = "";
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const left = pixels[(row * 9 + col) * 4];
        const right = pixels[(row * 9 + col + 1) * 4];
        bits += left < right ? "1" : "0";
      }
    }
    let hex = "";
    for (let i = 0; i < 64; i += 4) {
      hex += Number.parseInt(bits.slice(i, i + 4), 2).toString(16);
    }
    return hex;
  } finally {
    resized.free();
  }
}

function hammingDistance(hexA: string, hexB: string): number {
  if (hexA.length !== hexB.length) return Number.MAX_SAFE_INTEGER;
  let distance = 0;
  for (let i = 0; i < hexA.length; i++) {
    let x = Number.parseInt(hexA[i], 16) ^ Number.parseInt(hexB[i], 16);
    while (x) {
      distance += x & 1;
      x >>= 1;
    }
  }
  return distance;
}

// Heuristic: <=10 out of 64 bits differing reliably means "same or
// near-identical image" for dHash in practice (re-encodes, minor crops,
// thumbnail-vs-original). Tune once real usage shows false positives/negatives.
const DUPLICATE_HAMMING_THRESHOLD = 10;

async function duplicateDetectionStep(ctx: PipelineContext) {
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
    return { skipped: true, reason: `image decode failed: ${String(err)}` };
  }

  let hash: string;
  try {
    hash = computeDHash(sourceImage);
  } finally {
    sourceImage.free();
  }

  await ctx.db
    .prepare(`UPDATE asset SET perceptual_hash = ? WHERE id = ?`)
    .bind(hash, ctx.assetId)
    .run();

  // Scoped to all assets, not just the same Event — session_inference (which
  // would associate an asset with an Event) doesn't exist yet, so there's no
  // Event to scope to. Revisit once it does.
  const candidates = await ctx.db
    .prepare(`SELECT id, perceptual_hash FROM asset WHERE perceptual_hash IS NOT NULL AND id != ?`)
    .bind(ctx.assetId)
    .all<{ id: string; perceptual_hash: string }>();

  const duplicates: { assetId: string; distance: number }[] = [];
  const now = new Date().toISOString();
  for (const candidate of candidates.results) {
    const distance = hammingDistance(hash, candidate.perceptual_hash);
    if (distance > DUPLICATE_HAMMING_THRESHOLD) continue;

    // Idempotent: don't re-flag a pair a previous (partial) attempt already
    // flagged, in either direction.
    const existing = await ctx.db
      .prepare(
        `SELECT id FROM relationship
         WHERE kind = 'possible_duplicate_of'
           AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))`,
      )
      .bind(ctx.assetId, candidate.id, candidate.id, ctx.assetId)
      .first<{ id: string }>();
    if (existing) {
      duplicates.push({ assetId: candidate.id, distance });
      continue;
    }

    await ctx.db
      .prepare(
        `INSERT INTO relationship (id, from_id, from_type, to_id, to_type, kind, created_at)
         VALUES (?, ?, 'asset', ?, 'asset', 'possible_duplicate_of', ?)`,
      )
      .bind(ulid(), ctx.assetId, candidate.id, now)
      .run();
    duplicates.push({ assetId: candidate.id, distance });
  }

  return { done: true, hash, duplicates };
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

// Analysis happens on a small downscale (blur/exposure don't need full
// resolution, and this keeps CPU/memory bounded regardless of source size).
const QUALITY_ANALYSIS_MAX_DIMENSION = 512;

// Heuristic thresholds — starting points, not measured against a labeled
// dataset. Tune once real usage shows false positives/negatives, same as
// duplicate_detection's Hamming threshold.
// - Blur: variance of the Laplacian-filtered grayscale image (Pech-Pacheco
//   et al.) — sharp images have lots of high-contrast edges (high variance),
//   blurry ones don't.
// - Exposure: mean grayscale brightness (0-255); far from mid-grey (128) in
//   either direction suggests under/overexposure.
const BLUR_VARIANCE_THRESHOLD = 100;
const UNDEREXPOSED_MEAN_THRESHOLD = 50;
const OVEREXPOSED_MEAN_THRESHOLD = 205;

function computeQualityMetrics(image: PhotonImage): {
  meanBrightness: number;
  blurVariance: number;
  flags: string[];
  score: number;
} {
  const longestEdge = Math.max(image.get_width(), image.get_height());
  const scale = Math.min(1, QUALITY_ANALYSIS_MAX_DIMENSION / longestEdge);
  const width = Math.max(1, Math.round(image.get_width() * scale));
  const height = Math.max(1, Math.round(image.get_height() * scale));

  const analysisImage = resize(image, width, height, SamplingFilter.Nearest);
  try {
    grayscale(analysisImage);
    const grayPixels = analysisImage.get_raw_pixels(); // RGBA, grayscale so R=G=B
    const pixelCount = width * height;

    let brightnessSum = 0;
    for (let i = 0; i < grayPixels.length; i += 4) {
      brightnessSum += grayPixels[i];
    }
    const meanBrightness = brightnessSum / pixelCount;

    laplace(analysisImage); // in-place edge-detection filter
    const edgePixels = analysisImage.get_raw_pixels();
    let edgeSum = 0;
    for (let i = 0; i < edgePixels.length; i += 4) {
      edgeSum += edgePixels[i];
    }
    const edgeMean = edgeSum / pixelCount;
    let blurVariance = 0;
    for (let i = 0; i < edgePixels.length; i += 4) {
      blurVariance += (edgePixels[i] - edgeMean) ** 2;
    }
    blurVariance /= pixelCount;

    const flags: string[] = [];
    if (meanBrightness < UNDEREXPOSED_MEAN_THRESHOLD) flags.push("underexposed");
    if (meanBrightness > OVEREXPOSED_MEAN_THRESHOLD) flags.push("overexposed");
    if (blurVariance < BLUR_VARIANCE_THRESHOLD) flags.push("blurry");

    const blurScore = Math.min(100, (blurVariance / (BLUR_VARIANCE_THRESHOLD * 4)) * 100);
    const exposureScore = Math.max(0, 100 - (Math.abs(meanBrightness - 128) / 128) * 100);
    const score = Math.round((blurScore + exposureScore) / 2);

    return { meanBrightness, blurVariance, flags, score };
  } finally {
    analysisImage.free();
  }
}

async function qualityScoringStep(ctx: PipelineContext) {
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
    return { skipped: true, reason: `image decode failed: ${String(err)}` };
  }

  let metrics: ReturnType<typeof computeQualityMetrics>;
  try {
    metrics = computeQualityMetrics(sourceImage);
  } finally {
    sourceImage.free();
  }

  await ctx.db
    .prepare(`UPDATE asset SET quality_score = ?, quality_flags = ? WHERE id = ?`)
    .bind(metrics.score, JSON.stringify(metrics.flags), ctx.assetId)
    .run();

  return { done: true, ...metrics };
}

// search_index.tags is left empty for now — the only tag source would be
// vision_tagging, which is still a stub. quality_flags (blurry/under-
// /overexposed) go into `body` instead of `tags`: they describe image
// condition, not subject matter, but they're still useful free-text search
// terms (e.g. an editor searching "blurry" to find rejects).
async function searchIndexingStep(ctx: PipelineContext) {
  const asset = await ctx.db
    .prepare(`SELECT title, kind, quality_flags FROM asset WHERE id = ?`)
    .bind(ctx.assetId)
    .first<{ title: string | null; kind: string; quality_flags: string | null }>();
  if (!asset) {
    throw new Error(`No asset found for ${ctx.assetId}`);
  }

  const version = await ctx.db
    .prepare(`SELECT exif FROM asset_version WHERE asset_id = ? AND kind = 'original'`)
    .bind(ctx.assetId)
    .first<{ exif: string | null }>();

  const bodyParts = [asset.kind];
  if (version?.exif) {
    try {
      const exif = JSON.parse(version.exif) as Record<string, unknown>;
      for (const key of ["Make", "Model", "DateTimeOriginal"]) {
        if (typeof exif[key] === "string") bodyParts.push(exif[key]);
      }
    } catch {
      // Malformed EXIF JSON — already handled as a skip in exif_extraction,
      // just don't let it block indexing here.
    }
  }
  if (asset.quality_flags) {
    try {
      const flags = JSON.parse(asset.quality_flags) as string[];
      bodyParts.push(...flags);
    } catch {
      // Same — don't let malformed data block indexing.
    }
  }

  const now = new Date().toISOString();
  await ctx.db
    .prepare(
      `INSERT INTO search_index (entity_id, entity_type, title, body, tags, updated_at)
       VALUES (?, 'asset', ?, ?, ?, ?)
       ON CONFLICT (entity_type, entity_id) DO UPDATE SET
         title = excluded.title, body = excluded.body, tags = excluded.tags,
         updated_at = excluded.updated_at`,
    )
    .bind(ctx.assetId, asset.title, bodyParts.join(" "), JSON.stringify([]), now)
    .run();

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

import { unzipSync } from "fflate";
import { ulid, sha256Hex, canUpload } from "@studio/shared";
import type { StudioAccessRole } from "@studio/domain";
import { runPipelineStep, type PipelineContext } from "./pipeline";
import { verifyAccessJwt, AccessAuthError, type AccessEnv } from "./access-auth";
import { compileTemplate, parseFilename } from "./import-template";
import { createRelationship, getOrCreateTagId, getVizchitraOrganisationId } from "./relationships";
import photographerCodesJson from "../photographer-codes.json";

interface PhotographerCodeEntry {
  code: string;
  person_id: string;
  note?: string;
}
// Cast rather than let resolveJsonModule infer the type from the single
// placeholder entry — that would make every future field it happens to
// have (e.g. `note`) look required.
const PHOTOGRAPHER_CODES = photographerCodesJson as PhotographerCodeEntry[];

const DEFAULT_IMPORT_TEMPLATE = "{date}_{code}_{n}";
// Soft protective limit — bulk-import runs synchronously inside one Worker
// request (I/O-bound, not CPU-bound, so this is generous headroom, not a
// hard platform limit); split larger batches into multiple zips rather
// than raising this without re-checking request duration in practice.
const MAX_BULK_IMPORT_ENTRIES = 500;

const EXTENSION_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

export interface Env extends AccessEnv {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  MEDIA_QUEUE: Queue;
  AI: Ai;
}

interface QueueMessage {
  assetId: string;
  step: import("@studio/shared").MediaPipelineStep;
}

export default {
  /**
   * POST /assets — multipart upload. Creates the Asset + first AssetVersion
   * ('original') row, writes the file to R2, and kicks off the pipeline at
   * 'import'. Auth: this Worker's own workers.dev URL is reachable directly
   * (it has no Access-gated route of its own), so every request is verified
   * against Access's public keys here rather than trusting Access to have
   * blocked it upstream — see access-auth.ts.
   *
   * TODO: this is a stub — no request validation beyond auth, no support for
   * Historical/Mixed import modes (architecture/Media Architecture.md,
   * Import Modes). Build those before wiring this up to a real upload UI.
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/assets/bulk-import") {
      return handleBulkImport(request, env);
    }
    if (request.method !== "POST" || url.pathname !== "/assets") {
      return new Response("Not found", { status: 404 });
    }

    let userEmail: string;
    try {
      userEmail = await verifyAccessJwt(request, env);
    } catch (err) {
      if (err instanceof AccessAuthError) {
        return new Response(err.message, { status: 401 });
      }
      throw err;
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return new Response("Expected multipart field 'file'", { status: 400 });
    }

    // asset.created_by/updated_by are FKs to person.id, not raw emails —
    // resolve (or provision) the person row for the authenticated user.
    const personId = await getOrCreatePersonId(env.DB, userEmail);

    const role = await getBaselineRole(env.DB, personId);
    if (!canUpload(role)) {
      return new Response("Forbidden: insufficient permissions to upload", { status: 403 });
    }

    const assetId = ulid();
    const versionId = ulid();
    const r2Key = `originals/${assetId}/${file.name}`;
    const now = new Date().toISOString();

    const bytes = await file.arrayBuffer();
    const checksum = await sha256Hex(bytes);

    await env.MEDIA_BUCKET.put(r2Key, bytes, {
      httpMetadata: { contentType: file.type },
    });

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO asset (id, status, kind, title, created_at, updated_at, created_by, updated_by)
         VALUES (?, 'draft', ?, ?, ?, ?, ?, ?)`,
      ).bind(assetId, guessKind(file.type), file.name, now, now, personId, personId),
      env.DB.prepare(
        `INSERT INTO asset_version (id, asset_id, kind, mime_type, r2_key, size_bytes, checksum, created_at)
         VALUES (?, ?, 'original', ?, ?, ?, ?, ?)`,
      ).bind(versionId, assetId, file.type, r2Key, file.size, checksum, now),
    ]);

    await env.MEDIA_QUEUE.send({ assetId, step: "import" } satisfies QueueMessage);

    return Response.json({ assetId, versionId }, { status: 201 });
  },

  /**
   * Queue consumer — advances one asset through one pipeline step per
   * message, then enqueues the next step. See pipeline.ts for the step
   * implementations and architecture/Studio Architecture RFC v1.md for the
   * canonical 12-step order.
   */
  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const { assetId, step } = message.body;
      const ctx: PipelineContext = {
        assetId,
        db: env.DB,
        bucket: env.MEDIA_BUCKET,
        queue: env.MEDIA_QUEUE,
        ai: env.AI,
      };
      try {
        await runPipelineStep(step, ctx);
        message.ack();
      } catch {
        message.retry();
      }
    }
  },
};

interface BulkImportResultEntry {
  assetId: string;
  path: string;
  folderTag: string | null;
  date: string | null;
  code: string | null;
  capturedBy: "photographer" | "organisation" | "none";
}

/**
 * POST /assets/bulk-import — admin zip upload (issue #45). Per entry: the
 * top-level folder becomes a tagged_with Tag; the filename is matched
 * against a configurable template ({date}/{code}/{n} tokens) to derive an
 * EXIF-fallback date and a captured_by photographer via
 * photographer-codes.json, falling back to the VizChitra Organisation
 * (see relationships.ts) when the code doesn't resolve. Non-matching
 * filenames still import, just without derived metadata — the existing
 * publish-time attribution check (issue #44) leaves them unpublishable
 * until someone fixes attribution by hand.
 *
 * Runs synchronously in one Worker request (unzip + per-entry R2 put + D1
 * writes) — I/O-bound, so this comfortably covers the batch sizes an
 * admin uploads by hand; see MAX_BULK_IMPORT_ENTRIES for the current cap.
 */
async function handleBulkImport(request: Request, env: Env): Promise<Response> {
  let userEmail: string;
  try {
    userEmail = await verifyAccessJwt(request, env);
  } catch (err) {
    if (err instanceof AccessAuthError) {
      return new Response(err.message, { status: 401 });
    }
    throw err;
  }

  const personId = await getOrCreatePersonId(env.DB, userEmail);
  const role = await getBaselineRole(env.DB, personId);
  if (!canUpload(role)) {
    return new Response("Forbidden: insufficient permissions to upload", { status: 403 });
  }

  const form = await request.formData();
  const zipFile = form.get("file");
  if (!(zipFile instanceof File)) {
    return new Response("Expected multipart field 'file' (a .zip)", { status: 400 });
  }

  const modeRaw = form.get("mode");
  const mode = modeRaw === "historical" || modeRaw === "review" ? modeRaw : null;
  if (!mode) {
    return new Response("mode must be 'historical' or 'review'", { status: 400 });
  }

  const templateRaw = form.get("template");
  const template =
    typeof templateRaw === "string" && templateRaw.trim() !== ""
      ? templateRaw.trim()
      : DEFAULT_IMPORT_TEMPLATE;

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await zipFile.arrayBuffer()));
  } catch {
    return new Response("Could not read zip file", { status: 400 });
  }

  const paths = Object.keys(entries).filter(isImportableEntry);
  if (paths.length === 0) {
    return new Response("Zip contained no importable files", { status: 400 });
  }
  if (paths.length > MAX_BULK_IMPORT_ENTRIES) {
    return new Response(
      `Zip has ${paths.length} files, over the ${MAX_BULK_IMPORT_ENTRIES}-file bulk-import limit — split into smaller batches`,
      { status: 400 },
    );
  }

  const compiled = compileTemplate(template);
  const batchId = ulid();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO import_batch (id, mode, filename_template, created_at, created_by) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(batchId, mode, template, now, personId)
    .run();

  const vizchitraOrgId = await getVizchitraOrganisationId(env.DB);
  const imported: BulkImportResultEntry[] = [];

  for (const path of paths) {
    const bytes = entries[path];
    const segments = path.split("/");
    const filename = segments[segments.length - 1];
    const folderTag = segments.length > 1 ? segments[0] : null;
    const extIndex = filename.lastIndexOf(".");
    const basename = extIndex > 0 ? filename.slice(0, extIndex) : filename;
    const ext = extIndex > 0 ? filename.slice(extIndex).toLowerCase() : "";
    const mimeType = EXTENSION_MIME_TYPES[ext] ?? "application/octet-stream";
    const parsed = parseFilename(compiled, basename);

    const assetId = ulid();
    const versionId = ulid();
    const r2Key = `originals/${assetId}/${filename}`;
    const checksum = await sha256Hex(bytes as Uint8Array<ArrayBuffer>);

    await env.MEDIA_BUCKET.put(r2Key, bytes, { httpMetadata: { contentType: mimeType } });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO asset (id, status, kind, title, created_at, updated_at, created_by, updated_by, import_batch_id)
         VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(assetId, guessKind(mimeType), filename, now, now, personId, personId, batchId),
      env.DB.prepare(
        `INSERT INTO asset_version (id, asset_id, kind, mime_type, r2_key, size_bytes, checksum, created_at)
         VALUES (?, ?, 'original', ?, ?, ?, ?, ?)`,
      ).bind(versionId, assetId, mimeType, r2Key, bytes.byteLength, checksum, now),
    ]);

    // A resolved photographer code always wins over the VizChitra-org
    // fallback, in either import mode — see architecture/Studio Data
    // Model.md, ImportBatch section.
    let capturedBy: BulkImportResultEntry["capturedBy"] = "none";
    if (parsed?.code) {
      const codeEntry = PHOTOGRAPHER_CODES.find(
        (c) => c.code.toLowerCase() === parsed.code?.toLowerCase(),
      );
      if (codeEntry) {
        const person = await env.DB.prepare(`SELECT id FROM person WHERE id = ?`)
          .bind(codeEntry.person_id)
          .first<{ id: string }>();
        if (person) {
          await createRelationship(env.DB, {
            fromId: assetId,
            fromType: "asset",
            toId: person.id,
            toType: "person",
            kind: "captured_by",
          });
          capturedBy = "photographer";
        }
      }
    }
    if (capturedBy === "none" && vizchitraOrgId) {
      await createRelationship(env.DB, {
        fromId: assetId,
        fromType: "asset",
        toId: vizchitraOrgId,
        toType: "organisation",
        kind: "captured_by",
      });
      capturedBy = "organisation";
    }

    if (folderTag) {
      const tagId = await getOrCreateTagId(env.DB, folderTag);
      await createRelationship(env.DB, {
        fromId: assetId,
        fromType: "asset",
        toId: tagId,
        toType: "tag",
        kind: "tagged_with",
      });
    }

    await env.MEDIA_QUEUE.send({ assetId, step: "import" } satisfies QueueMessage);

    imported.push({
      assetId,
      path,
      folderTag,
      date: parsed?.date ?? null,
      code: parsed?.code ?? null,
      capturedBy,
    });
  }

  return Response.json({ batchId, mode, template, imported }, { status: 201 });
}

// Skips directory entries, macOS zip cruft, and dotfiles (e.g. .DS_Store)
// — everything else is treated as an importable file.
function isImportableEntry(path: string): boolean {
  if (path.endsWith("/")) return false;
  if (path.startsWith("__MACOSX/")) return false;
  const filename = path.split("/").pop() ?? "";
  return filename !== "" && !filename.startsWith(".");
}

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

// Baseline StudioAccessRole grant — a `permission` row with entity_type =
// 'studio', entity_id = 'global' (see architecture/Studio Data Model.md,
// Permission section). No entity-level override lookup here: uploading
// creates the asset, so there's no existing entity to hold an override yet.
async function getBaselineRole(db: D1Database, personId: string): Promise<StudioAccessRole | null> {
  const row = await db
    .prepare(
      `SELECT role FROM permission WHERE entity_type = 'studio' AND entity_id = 'global' AND person_id = ?`,
    )
    .bind(personId)
    .first<{ role: StudioAccessRole }>();
  return row?.role ?? null;
}

function guessKind(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "photo";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf") return "pdf";
  return "photo";
}

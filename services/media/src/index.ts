import { ulid } from "@studio/shared";
import { runPipelineStep, type PipelineContext } from "./pipeline";

export interface Env {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  MEDIA_QUEUE: Queue;
}

interface QueueMessage {
  assetId: string;
  step: import("@studio/shared").MediaPipelineStep;
}

export default {
  /**
   * POST /assets — multipart upload. Creates the Asset + first AssetVersion
   * ('original') row, writes the file to R2, and kicks off the pipeline at
   * 'import'. Auth: this Worker is only reachable behind Cloudflare Access
   * on studio.vizchitra.com (see apps/studio/wrangler.toml).
   *
   * TODO: this is a stub — no request validation, no auth check on the
   * calling user yet, no support for Historical/Mixed import modes
   * (architecture/Media Architecture.md, Import Modes). Build those before
   * wiring this up to a real upload UI.
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/assets") {
      return new Response("Not found", { status: 404 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return new Response("Expected multipart field 'file'", { status: 400 });
    }

    const assetId = ulid();
    const versionId = ulid();
    const r2Key = `originals/${assetId}/${file.name}`;
    const now = new Date().toISOString();

    await env.MEDIA_BUCKET.put(r2Key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });

    const checksum = ulid(); // TODO: replace with real content hash (e.g. SHA-256 of the bytes)

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO asset (id, status, kind, title, created_at, updated_at, created_by, updated_by)
         VALUES (?, 'draft', ?, ?, ?, ?, ?, ?)`,
      ).bind(assetId, guessKind(file.type), file.name, now, now, "system", "system"),
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

function guessKind(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "photo";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf") return "pdf";
  return "photo";
}

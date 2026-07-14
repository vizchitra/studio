import { ulid } from "@studio/shared";
import { runPipelineStep, type PipelineContext } from "./pipeline";
import { verifyAccessJwt, AccessAuthError, type AccessEnv } from "./access-auth";

export interface Env extends AccessEnv {
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
      ).bind(assetId, guessKind(file.type), file.name, now, now, userEmail, userEmail),
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

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function guessKind(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "photo";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf") return "pdf";
  return "photo";
}

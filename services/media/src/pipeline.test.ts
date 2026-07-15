import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhotonImage } from "@cf-wasm/photon/workerd";
import { PIPELINE, runPipelineStep, type PipelineContext } from "./pipeline";

function makeTestPng(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 200; // R
    pixels[i + 1] = 80; // G
    pixels[i + 2] = 40; // B
    pixels[i + 3] = 255; // A
  }
  const image = new PhotonImage(pixels, width, height);
  try {
    return image.get_bytes();
  } finally {
    image.free();
  }
}

describe("runPipelineStep", () => {
  let ctx: PipelineContext;

  beforeEach(async () => {
    const assetId = `test-asset-${crypto.randomUUID()}`;
    ctx = {
      assetId,
      db: env.DB,
      bucket: env.MEDIA_BUCKET,
      queue: env.MEDIA_QUEUE,
    };

    // asset_pipeline_run.asset_id -> asset.id -> asset.created_by -> person.id,
    // all enforced by D1. Seed the chain so the FK constraints are satisfied.
    const personId = `test-person-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await ctx.db.batch([
      ctx.db
        .prepare(`INSERT INTO person (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
        .bind(personId, "Test Person", now, now),
      ctx.db
        .prepare(
          `INSERT INTO asset (id, status, kind, title, created_at, updated_at, created_by, updated_by)
           VALUES (?, 'draft', 'photo', ?, ?, ?, ?, ?)`,
        )
        .bind(assetId, "test.jpg", now, now, personId, personId),
    ]);
  });

  it("records a done run and enqueues the next step on success", async () => {
    const sendSpy = vi.spyOn(ctx.queue, "send");

    await runPipelineStep("import", ctx);

    const row = await ctx.db
      .prepare(
        `SELECT status, output FROM asset_pipeline_run WHERE asset_id = ? AND step = 'import'`,
      )
      .bind(ctx.assetId)
      .first<{ status: string; output: string }>();

    expect(row?.status).toBe("done");
    expect(JSON.parse(row?.output ?? "{}")).toEqual({ done: true });
    expect(sendSpy).toHaveBeenCalledWith({ assetId: ctx.assetId, step: "exif_extraction" });
  });

  describe("when the step throws", () => {
    const original = PIPELINE.import;

    beforeEach(() => {
      PIPELINE.import = vi.fn().mockRejectedValue(new Error("boom"));
    });

    afterEach(() => {
      PIPELINE.import = original;
    });

    it("records a failed run, does not enqueue a next step, and rethrows", async () => {
      const sendSpy = vi.spyOn(ctx.queue, "send");

      await expect(runPipelineStep("import", ctx)).rejects.toThrow("boom");

      const row = await ctx.db
        .prepare(
          `SELECT status, error FROM asset_pipeline_run WHERE asset_id = ? AND step = 'import'`,
        )
        .bind(ctx.assetId)
        .first<{ status: string; error: string }>();

      expect(row?.status).toBe("failed");
      expect(row?.error).toContain("boom");
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });
});

describe("exif_extraction step", () => {
  let ctx: PipelineContext;

  beforeEach(async () => {
    const assetId = `test-asset-${crypto.randomUUID()}`;
    ctx = {
      assetId,
      db: env.DB,
      bucket: env.MEDIA_BUCKET,
      queue: env.MEDIA_QUEUE,
    };

    const personId = `test-person-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await ctx.db.batch([
      ctx.db
        .prepare(`INSERT INTO person (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
        .bind(personId, "Test Person", now, now),
      ctx.db
        .prepare(
          `INSERT INTO asset (id, status, kind, title, created_at, updated_at, created_by, updated_by)
           VALUES (?, 'draft', 'photo', ?, ?, ?, ?, ?)`,
        )
        .bind(assetId, "test.jpg", now, now, personId, personId),
    ]);
  });

  it("throws when there is no 'original' asset_version row (retryable)", async () => {
    await expect(runPipelineStep("exif_extraction", ctx)).rejects.toThrow(
      "No 'original' asset_version found",
    );

    const row = await ctx.db
      .prepare(
        `SELECT status FROM asset_pipeline_run WHERE asset_id = ? AND step = 'exif_extraction'`,
      )
      .bind(ctx.assetId)
      .first<{ status: string }>();
    expect(row?.status).toBe("failed");
  });

  it("skips non-image mime types without writing exif or failing the run", async () => {
    const versionId = `test-version-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await ctx.db
      .prepare(
        `INSERT INTO asset_version (id, asset_id, kind, mime_type, r2_key, size_bytes, checksum, created_at)
         VALUES (?, ?, 'original', 'application/pdf', ?, 0, 'deadbeef', ?)`,
      )
      .bind(versionId, ctx.assetId, `originals/${ctx.assetId}/doc.pdf`, now)
      .run();

    await runPipelineStep("exif_extraction", ctx);

    const run = await ctx.db
      .prepare(
        `SELECT status, output FROM asset_pipeline_run WHERE asset_id = ? AND step = 'exif_extraction'`,
      )
      .bind(ctx.assetId)
      .first<{ status: string; output: string }>();
    expect(run?.status).toBe("done");
    expect(JSON.parse(run?.output ?? "{}")).toMatchObject({ skipped: true });

    const version = await ctx.db
      .prepare(`SELECT exif FROM asset_version WHERE id = ?`)
      .bind(versionId)
      .first<{ exif: string | null }>();
    expect(version?.exif).toBeNull();
  });
});

describe("preview_generation step", () => {
  let ctx: PipelineContext;

  beforeEach(async () => {
    const assetId = `test-asset-${crypto.randomUUID()}`;
    ctx = {
      assetId,
      db: env.DB,
      bucket: env.MEDIA_BUCKET,
      queue: env.MEDIA_QUEUE,
    };

    const personId = `test-person-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await ctx.db.batch([
      ctx.db
        .prepare(`INSERT INTO person (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
        .bind(personId, "Test Person", now, now),
      ctx.db
        .prepare(
          `INSERT INTO asset (id, status, kind, title, created_at, updated_at, created_by, updated_by)
           VALUES (?, 'draft', 'photo', ?, ?, ?, ?, ?)`,
        )
        .bind(assetId, "test.png", now, now, personId, personId),
    ]);
  });

  it("throws when there is no 'original' asset_version row (retryable)", async () => {
    await expect(runPipelineStep("preview_generation", ctx)).rejects.toThrow(
      "No 'original' asset_version found",
    );
  });

  it("skips non-image mime types", async () => {
    const versionId = `test-version-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await ctx.db
      .prepare(
        `INSERT INTO asset_version (id, asset_id, kind, mime_type, r2_key, size_bytes, checksum, created_at)
         VALUES (?, ?, 'original', 'application/pdf', ?, 0, 'deadbeef', ?)`,
      )
      .bind(versionId, ctx.assetId, `originals/${ctx.assetId}/doc.pdf`, now)
      .run();

    await runPipelineStep("preview_generation", ctx);

    const run = await ctx.db
      .prepare(
        `SELECT status, output FROM asset_pipeline_run WHERE asset_id = ? AND step = 'preview_generation'`,
      )
      .bind(ctx.assetId)
      .first<{ status: string; output: string }>();
    expect(run?.status).toBe("done");
    expect(JSON.parse(run?.output ?? "{}")).toMatchObject({ skipped: true });
  });

  it("creates web + thumbnail derivatives from a real image, and is idempotent on retry", async () => {
    const png = makeTestPng(800, 600);
    const versionId = `test-version-${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    const r2Key = `originals/${ctx.assetId}/test.png`;
    await ctx.bucket.put(r2Key, png, { httpMetadata: { contentType: "image/png" } });
    await ctx.db
      .prepare(
        `INSERT INTO asset_version (id, asset_id, kind, mime_type, r2_key, size_bytes, checksum, created_at)
         VALUES (?, ?, 'original', 'image/png', ?, ?, 'deadbeef', ?)`,
      )
      .bind(versionId, ctx.assetId, r2Key, png.byteLength, now)
      .run();

    await runPipelineStep("preview_generation", ctx);

    const versions = await ctx.db
      .prepare(
        `SELECT kind, mime_type, r2_key, width, height FROM asset_version WHERE asset_id = ? AND kind != 'original' ORDER BY kind`,
      )
      .bind(ctx.assetId)
      .all<{ kind: string; mime_type: string; r2_key: string; width: number; height: number }>();

    expect(versions.results.map((v) => v.kind).sort()).toEqual(["thumbnail", "web"]);
    for (const v of versions.results) {
      expect(v.mime_type).toBe("image/jpeg");
      const object = await ctx.bucket.get(v.r2_key);
      expect(object).not.toBeNull();
      // 800x600 source: web (max 1600) stays at original size, thumbnail
      // (max 400) scales down proportionally to 400x300.
      if (v.kind === "thumbnail") {
        expect(v.width).toBe(400);
        expect(v.height).toBe(300);
      } else {
        expect(v.width).toBe(800);
        expect(v.height).toBe(600);
      }
    }

    // Retry: re-running must not fail on duplicate r2_key/UNIQUE constraints,
    // and must not create extra rows.
    await runPipelineStep("preview_generation", ctx);
    const afterRetry = await ctx.db
      .prepare(
        `SELECT COUNT(*) as count FROM asset_version WHERE asset_id = ? AND kind != 'original'`,
      )
      .bind(ctx.assetId)
      .first<{ count: number }>();
    expect(afterRetry?.count).toBe(2);
  });
});

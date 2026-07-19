import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhotonImage } from "@cf-wasm/photon/workerd";
import { PIPELINE, isRawExtension, runPipelineStep, type PipelineContext } from "./pipeline";

// D1 storage isn't reset between `it()` blocks in the same file (only
// between test files). dHash only encodes *relative* brightness between
// neighboring pixels, so a flat single-color image always hashes to
// "0000000000000000" regardless of which color it is — a fixed-color image
// would spuriously "match" every other flat-color image across every test
// in this file. `seed` drives a per-pixel gradient so images with different
// seeds produce genuinely different hashes, while the same seed always
// reproduces the identical image (for the "these are duplicates" case).
function makeTestPng(width: number, height: number, seed = 0): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const value = (x * 47 + y * 91 + seed * 137) % 256;
      pixels[i] = value;
      pixels[i + 1] = value;
      pixels[i + 2] = value;
      pixels[i + 3] = 255; // A
    }
  }
  const image = new PhotonImage(pixels, width, height);
  try {
    return image.get_bytes();
  } finally {
    image.free();
  }
}

// A genuinely flat image (no edges at all) for blur/exposure testing —
// unlike makeTestPng's gradient, which has periodic modulo-wraparound seams
// that read as spurious high-frequency edges to a Laplacian filter.
function makeFlatPng(width: number, height: number, brightness: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = brightness;
    pixels[i + 1] = brightness;
    pixels[i + 2] = brightness;
    pixels[i + 3] = 255;
  }
  const image = new PhotonImage(pixels, width, height);
  try {
    return image.get_bytes();
  } finally {
    image.free();
  }
}

// A high-contrast checkerboard — plenty of sharp edges for the blur
// heuristic to detect as "not blurry".
function makeCheckerboardPng(width: number, height: number, squareSize = 4): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const value = (Math.floor(x / squareSize) + Math.floor(y / squareSize)) % 2 === 0 ? 0 : 255;
      pixels[i] = value;
      pixels[i + 1] = value;
      pixels[i + 2] = value;
      pixels[i + 3] = 255;
    }
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

describe("duplicate_detection step", () => {
  let ctx: PipelineContext;
  let personId: string;

  async function seedOriginal(assetId: string, png: Uint8Array) {
    const versionId = `test-version-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const r2Key = `originals/${assetId}/test.png`;
    await env.MEDIA_BUCKET.put(r2Key, png, { httpMetadata: { contentType: "image/png" } });
    await env.DB.prepare(
      `INSERT INTO asset_version (id, asset_id, kind, mime_type, r2_key, size_bytes, checksum, created_at)
       VALUES (?, ?, 'original', 'image/png', ?, ?, 'deadbeef', ?)`,
    )
      .bind(versionId, assetId, r2Key, png.byteLength, now)
      .run();
  }

  beforeEach(async () => {
    const assetId = `test-asset-${crypto.randomUUID()}`;
    ctx = {
      assetId,
      db: env.DB,
      bucket: env.MEDIA_BUCKET,
      queue: env.MEDIA_QUEUE,
    };

    personId = `test-person-${crypto.randomUUID()}`;
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
    await expect(runPipelineStep("duplicate_detection", ctx)).rejects.toThrow(
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

    await runPipelineStep("duplicate_detection", ctx);

    const run = await ctx.db
      .prepare(
        `SELECT status, output FROM asset_pipeline_run WHERE asset_id = ? AND step = 'duplicate_detection'`,
      )
      .bind(ctx.assetId)
      .first<{ status: string; output: string }>();
    expect(run?.status).toBe("done");
    expect(JSON.parse(run?.output ?? "{}")).toMatchObject({ skipped: true });
  });

  it("computes and stores a perceptual hash even with no other assets to compare", async () => {
    await seedOriginal(ctx.assetId, makeTestPng(64, 64, 1));

    await runPipelineStep("duplicate_detection", ctx);

    const asset = await ctx.db
      .prepare(`SELECT perceptual_hash FROM asset WHERE id = ?`)
      .bind(ctx.assetId)
      .first<{ perceptual_hash: string | null }>();
    expect(asset?.perceptual_hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("flags a near-identical existing asset as a possible duplicate, and is idempotent on retry", async () => {
    const png = makeTestPng(64, 64, 2);

    const otherAssetId = `test-asset-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await ctx.db
      .prepare(
        `INSERT INTO asset (id, status, kind, title, created_at, updated_at, created_by, updated_by)
         VALUES (?, 'draft', 'photo', ?, ?, ?, ?, ?)`,
      )
      .bind(otherAssetId, "other.png", now, now, personId, personId)
      .run();
    await seedOriginal(otherAssetId, png);
    await runPipelineStep("duplicate_detection", { ...ctx, assetId: otherAssetId });

    await seedOriginal(ctx.assetId, png);
    await runPipelineStep("duplicate_detection", ctx);

    const relationships = await ctx.db
      .prepare(
        `SELECT from_id, to_id FROM relationship
         WHERE kind = 'possible_duplicate_of' AND (from_id = ? OR to_id = ?)`,
      )
      .bind(ctx.assetId, ctx.assetId)
      .all<{ from_id: string; to_id: string }>();
    expect(relationships.results).toHaveLength(1);
    expect([relationships.results[0].from_id, relationships.results[0].to_id]).toContain(
      otherAssetId,
    );

    await runPipelineStep("duplicate_detection", ctx);
    const afterRetry = await ctx.db
      .prepare(
        `SELECT COUNT(*) as count FROM relationship
         WHERE kind = 'possible_duplicate_of' AND (from_id = ? OR to_id = ?)`,
      )
      .bind(ctx.assetId, ctx.assetId)
      .first<{ count: number }>();
    expect(afterRetry?.count).toBe(1);
  });
});

describe("quality_scoring step", () => {
  let ctx: PipelineContext;

  async function seedOriginal(assetId: string, png: Uint8Array) {
    const versionId = `test-version-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const r2Key = `originals/${assetId}/test.png`;
    await env.MEDIA_BUCKET.put(r2Key, png, { httpMetadata: { contentType: "image/png" } });
    await env.DB.prepare(
      `INSERT INTO asset_version (id, asset_id, kind, mime_type, r2_key, size_bytes, checksum, created_at)
       VALUES (?, ?, 'original', 'image/png', ?, ?, 'deadbeef', ?)`,
    )
      .bind(versionId, assetId, r2Key, png.byteLength, now)
      .run();
  }

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
    await expect(runPipelineStep("quality_scoring", ctx)).rejects.toThrow(
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

    await runPipelineStep("quality_scoring", ctx);

    const run = await ctx.db
      .prepare(
        `SELECT status, output FROM asset_pipeline_run WHERE asset_id = ? AND step = 'quality_scoring'`,
      )
      .bind(ctx.assetId)
      .first<{ status: string; output: string }>();
    expect(run?.status).toBe("done");
    expect(JSON.parse(run?.output ?? "{}")).toMatchObject({ skipped: true });
  });

  it("flags a flat image as blurry and stores a score", async () => {
    await seedOriginal(ctx.assetId, makeFlatPng(128, 128, 128));

    await runPipelineStep("quality_scoring", ctx);

    const asset = await ctx.db
      .prepare(`SELECT quality_score, quality_flags FROM asset WHERE id = ?`)
      .bind(ctx.assetId)
      .first<{ quality_score: number; quality_flags: string }>();
    expect(asset?.quality_score).toBeGreaterThanOrEqual(0);
    expect(asset?.quality_score).toBeLessThanOrEqual(100);
    expect(JSON.parse(asset?.quality_flags ?? "[]")).toContain("blurry");
  });

  it("does not flag a high-contrast checkerboard as blurry", async () => {
    await seedOriginal(ctx.assetId, makeCheckerboardPng(128, 128));

    await runPipelineStep("quality_scoring", ctx);

    const asset = await ctx.db
      .prepare(`SELECT quality_flags FROM asset WHERE id = ?`)
      .bind(ctx.assetId)
      .first<{ quality_flags: string }>();
    expect(JSON.parse(asset?.quality_flags ?? "[]")).not.toContain("blurry");
  });

  it("flags a very dark flat image as underexposed", async () => {
    await seedOriginal(ctx.assetId, makeFlatPng(128, 128, 10));

    await runPipelineStep("quality_scoring", ctx);

    const asset = await ctx.db
      .prepare(`SELECT quality_flags FROM asset WHERE id = ?`)
      .bind(ctx.assetId)
      .first<{ quality_flags: string }>();
    expect(JSON.parse(asset?.quality_flags ?? "[]")).toContain("underexposed");
  });

  it("flags a very bright flat image as overexposed", async () => {
    await seedOriginal(ctx.assetId, makeFlatPng(128, 128, 250));

    await runPipelineStep("quality_scoring", ctx);

    const asset = await ctx.db
      .prepare(`SELECT quality_flags FROM asset WHERE id = ?`)
      .bind(ctx.assetId)
      .first<{ quality_flags: string }>();
    expect(JSON.parse(asset?.quality_flags ?? "[]")).toContain("overexposed");
  });
});

describe("search_indexing step", () => {
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
        .bind(assetId, "Sunset over the venue", now, now, personId, personId),
    ]);
  });

  it("throws when the asset row doesn't exist", async () => {
    // Calling PIPELINE.search_indexing directly (not via runPipelineStep):
    // asset_pipeline_run.asset_id is itself an FK to asset.id, so a
    // nonexistent assetId would fail at that INSERT before ever reaching
    // the step — this test is only about the step's own guard.
    await expect(
      PIPELINE.search_indexing({ ...ctx, assetId: `missing-${crypto.randomUUID()}` }),
    ).rejects.toThrow("No asset found");
  });

  it("indexes title, kind, EXIF summary, and quality flags into body, with empty tags", async () => {
    const now = new Date().toISOString();
    await ctx.db
      .prepare(
        `INSERT INTO asset_version (id, asset_id, kind, mime_type, r2_key, size_bytes, checksum, exif, created_at)
         VALUES (?, ?, 'original', 'image/jpeg', ?, 0, 'deadbeef', ?, ?)`,
      )
      .bind(
        `test-version-${crypto.randomUUID()}`,
        ctx.assetId,
        `originals/${ctx.assetId}/test.jpg`,
        JSON.stringify({ Make: "Canon", Model: "EOS R5", DateTimeOriginal: "2026:01:01 10:00:00" }),
        now,
      )
      .run();
    await ctx.db
      .prepare(`UPDATE asset SET quality_flags = ? WHERE id = ?`)
      .bind(JSON.stringify(["blurry"]), ctx.assetId)
      .run();

    await runPipelineStep("search_indexing", ctx);

    const row = await ctx.db
      .prepare(
        `SELECT title, body, tags FROM search_index WHERE entity_type = 'asset' AND entity_id = ?`,
      )
      .bind(ctx.assetId)
      .first<{ title: string; body: string; tags: string }>();
    expect(row?.title).toBe("Sunset over the venue");
    expect(row?.body).toContain("photo");
    expect(row?.body).toContain("Canon");
    expect(row?.body).toContain("EOS R5");
    expect(row?.body).toContain("blurry");
    expect(JSON.parse(row?.tags ?? "null")).toEqual([]);
  });

  it("is idempotent on retry (upsert, not insert)", async () => {
    await runPipelineStep("search_indexing", ctx);
    await runPipelineStep("search_indexing", ctx);

    const count = await ctx.db
      .prepare(
        `SELECT COUNT(*) as count FROM search_index WHERE entity_type = 'asset' AND entity_id = ?`,
      )
      .bind(ctx.assetId)
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });
});

describe("publish step", () => {
  let ctx: PipelineContext;

  async function seedOriginal(assetId: string, png: Uint8Array) {
    const versionId = `test-version-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const r2Key = `originals/${assetId}/test.png`;
    await env.MEDIA_BUCKET.put(r2Key, png, { httpMetadata: { contentType: "image/png" } });
    await env.DB.prepare(
      `INSERT INTO asset_version (id, asset_id, kind, mime_type, r2_key, size_bytes, checksum, created_at)
       VALUES (?, ?, 'original', 'image/png', ?, ?, 'deadbeef', ?)`,
    )
      .bind(versionId, assetId, r2Key, png.byteLength, now)
      .run();
  }

  async function seedAsset(status: string) {
    const assetId = `test-asset-${crypto.randomUUID()}`;
    const personId = `test-person-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO person (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ).bind(personId, "Test Person", now, now),
      env.DB.prepare(
        `INSERT INTO asset (id, status, kind, title, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, 'photo', ?, ?, ?, ?, ?)`,
      ).bind(assetId, status, "test.png", now, now, personId, personId),
    ]);
    return assetId;
  }

  it("skips (does not publish) an asset that isn't approved", async () => {
    const assetId = await seedAsset("draft");
    ctx = { assetId, db: env.DB, bucket: env.MEDIA_BUCKET, queue: env.MEDIA_QUEUE };
    await seedOriginal(assetId, makeTestPng(64, 64, 10));

    await runPipelineStep("publish", ctx);

    const run = await ctx.db
      .prepare(
        `SELECT status, output FROM asset_pipeline_run WHERE asset_id = ? AND step = 'publish'`,
      )
      .bind(assetId)
      .first<{ status: string; output: string }>();
    expect(run?.status).toBe("done");
    expect(JSON.parse(run?.output ?? "{}")).toMatchObject({ skipped: true });

    const publication = await ctx.db
      .prepare(`SELECT id FROM publication WHERE entity_type = 'asset' AND entity_id = ?`)
      .bind(assetId)
      .first();
    expect(publication).toBeNull();
  });

  it("publishes an approved asset: creates a 'social' derivative and an immutable publication row", async () => {
    const assetId = await seedAsset("approved");
    ctx = { assetId, db: env.DB, bucket: env.MEDIA_BUCKET, queue: env.MEDIA_QUEUE };
    await seedOriginal(assetId, makeTestPng(800, 600, 11));

    await runPipelineStep("publish", ctx);

    const social = await ctx.db
      .prepare(`SELECT r2_key FROM asset_version WHERE asset_id = ? AND kind = 'social'`)
      .bind(assetId)
      .first<{ r2_key: string }>();
    expect(social).not.toBeNull();
    expect(await ctx.bucket.get(social!.r2_key)).not.toBeNull();

    const publication = await ctx.db
      .prepare(
        `SELECT version, published_url FROM publication WHERE entity_type = 'asset' AND entity_id = ?`,
      )
      .bind(assetId)
      .first<{ version: string; published_url: string }>();
    expect(publication?.version).toBe("1");
    expect(publication?.published_url).toContain(social!.r2_key);
  });

  it("is idempotent on retry: does not duplicate the social derivative or the publication row", async () => {
    const assetId = await seedAsset("approved");
    ctx = { assetId, db: env.DB, bucket: env.MEDIA_BUCKET, queue: env.MEDIA_QUEUE };
    await seedOriginal(assetId, makeTestPng(800, 600, 12));

    await runPipelineStep("publish", ctx);
    await runPipelineStep("publish", ctx);

    const versionCount = await ctx.db
      .prepare(`SELECT COUNT(*) as count FROM asset_version WHERE asset_id = ? AND kind = 'social'`)
      .bind(assetId)
      .first<{ count: number }>();
    expect(versionCount?.count).toBe(1);

    const publicationCount = await ctx.db
      .prepare(
        `SELECT COUNT(*) as count FROM publication WHERE entity_type = 'asset' AND entity_id = ?`,
      )
      .bind(assetId)
      .first<{ count: number }>();
    expect(publicationCount?.count).toBe(1);
  });
});

describe("face_clustering step", () => {
  let ctx: PipelineContext;

  function makeAi(response: unknown) {
    return { run: vi.fn().mockResolvedValue(response) } as unknown as Ai;
  }

  async function seedVersion(assetId: string, kind: "web" | "original", png: Uint8Array) {
    const versionId = `test-version-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const r2Key = `${kind === "original" ? "originals" : "derivatives"}/${assetId}/test.png`;
    await env.MEDIA_BUCKET.put(r2Key, png, { httpMetadata: { contentType: "image/png" } });
    await env.DB.prepare(
      `INSERT INTO asset_version (id, asset_id, kind, mime_type, r2_key, size_bytes, checksum, created_at)
       VALUES (?, ?, ?, 'image/png', ?, ?, 'deadbeef', ?)`,
    )
      .bind(versionId, assetId, kind, r2Key, png.byteLength, now)
      .run();
  }

  beforeEach(async () => {
    const assetId = `test-asset-${crypto.randomUUID()}`;
    ctx = {
      assetId,
      db: env.DB,
      bucket: env.MEDIA_BUCKET,
      queue: env.MEDIA_QUEUE,
      ai: makeAi({ objects: [] }),
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

  it("throws when there is no 'web' or 'original' asset_version row (retryable)", async () => {
    await expect(runPipelineStep("face_clustering", ctx)).rejects.toThrow(
      "No 'web' or 'original' asset_version found",
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

    await runPipelineStep("face_clustering", ctx);

    const run = await ctx.db
      .prepare(
        `SELECT status, output FROM asset_pipeline_run WHERE asset_id = ? AND step = 'face_clustering'`,
      )
      .bind(ctx.assetId)
      .first<{ status: string; output: string }>();
    expect(run?.status).toBe("done");
    expect(JSON.parse(run?.output ?? "{}")).toMatchObject({ skipped: true });
  });

  it("stores a face_detection row per valid detected box", async () => {
    await seedVersion(ctx.assetId, "web", makeTestPng(64, 64, 20));
    ctx.ai = makeAi({
      objects: [
        { x_min: 0.1, y_min: 0.1, x_max: 0.4, y_max: 0.5 },
        { x_min: 0.6, y_min: 0.2, x_max: 0.9, y_max: 0.7 },
      ],
    });

    await runPipelineStep("face_clustering", ctx);

    const rows = await ctx.db
      .prepare(
        `SELECT x_min, y_min, x_max, y_max, person_id FROM face_detection WHERE asset_id = ?`,
      )
      .bind(ctx.assetId)
      .all<{
        x_min: number;
        y_min: number;
        x_max: number;
        y_max: number;
        person_id: string | null;
      }>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results[0].person_id).toBeNull();
  });

  it("ignores malformed or out-of-range objects from the model response without failing", async () => {
    await seedVersion(ctx.assetId, "web", makeTestPng(64, 64, 21));
    ctx.ai = makeAi({
      objects: [
        { x_min: 0.1, y_min: 0.1, x_max: 1.4, y_max: 0.5 }, // x_max out of [0,1]
        { x_min: 0.5, y_min: 0.5, x_max: 0.1, y_max: 0.1 }, // min > max
        "not even an object",
      ],
    });

    await runPipelineStep("face_clustering", ctx);

    const count = await ctx.db
      .prepare(`SELECT COUNT(*) as count FROM face_detection WHERE asset_id = ?`)
      .bind(ctx.assetId)
      .first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it("is idempotent on retry: does not re-detect once rows already exist", async () => {
    await seedVersion(ctx.assetId, "web", makeTestPng(64, 64, 22));
    ctx.ai = makeAi({ objects: [{ x_min: 0.1, y_min: 0.1, x_max: 0.4, y_max: 0.5 }] });

    await runPipelineStep("face_clustering", ctx);
    await runPipelineStep("face_clustering", ctx);

    expect(ctx.ai!.run).toHaveBeenCalledTimes(1);
    const count = await ctx.db
      .prepare(`SELECT COUNT(*) as count FROM face_detection WHERE asset_id = ?`)
      .bind(ctx.assetId)
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("prefers the 'web' derivative over 'original' when both exist", async () => {
    await seedVersion(ctx.assetId, "original", makeTestPng(64, 64, 23));
    await seedVersion(ctx.assetId, "web", makeTestPng(32, 32, 24));

    await runPipelineStep("face_clustering", ctx);

    const [, inputs] = (ctx.ai!.run as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { image: string },
    ];
    const webVersion = await ctx.db
      .prepare(`SELECT r2_key FROM asset_version WHERE asset_id = ? AND kind = 'web'`)
      .bind(ctx.assetId)
      .first<{ r2_key: string }>();
    const webObject = await ctx.bucket.get(webVersion!.r2_key);
    const webBytes = new Uint8Array(await webObject!.arrayBuffer());
    let binary = "";
    for (let i = 0; i < webBytes.length; i++) binary += String.fromCharCode(webBytes[i]);
    expect(inputs.image).toBe(`data:image/png;base64,${btoa(binary)}`);
  });
});

describe("Historical Import mode (issue #46)", () => {
  let ctx: PipelineContext;

  async function seedHistoricalAsset(): Promise<PipelineContext> {
    const assetId = `test-asset-${crypto.randomUUID()}`;
    const personId = `test-person-${crypto.randomUUID()}`;
    const batchId = `test-batch-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO person (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ).bind(personId, "Test Person", now, now),
      env.DB.prepare(
        `INSERT INTO import_batch (id, mode, filename_template, created_at, created_by)
           VALUES (?, 'historical', '{date}_{code}_{n}', ?, ?)`,
      ).bind(batchId, now, personId),
      env.DB.prepare(
        `INSERT INTO asset (id, status, kind, title, created_at, updated_at, created_by, updated_by, import_batch_id)
           VALUES (?, 'draft', 'photo', ?, ?, ?, ?, ?, ?)`,
      ).bind(assetId, "test.jpg", now, now, personId, personId, batchId),
    ]);
    return {
      assetId,
      db: env.DB,
      bucket: env.MEDIA_BUCKET,
      queue: env.MEDIA_QUEUE,
      ai: { run: vi.fn() } as unknown as Ai,
    };
  }

  beforeEach(async () => {
    ctx = await seedHistoricalAsset();
  });

  it.each([
    "reference_person_matching",
    "face_clustering",
    "duplicate_detection",
    "quality_scoring",
  ] as const)("skips %s for an asset from a historical import batch", async (step) => {
    await runPipelineStep(step, ctx);

    const run = await ctx.db
      .prepare(`SELECT status, output FROM asset_pipeline_run WHERE asset_id = ? AND step = ?`)
      .bind(ctx.assetId, step)
      .first<{ status: string; output: string }>();
    expect(run?.status).toBe("done");
    expect(JSON.parse(run?.output ?? "{}")).toMatchObject({
      skipped: true,
      reason: expect.stringContaining("historical"),
    });

    if (step === "face_clustering") {
      expect(ctx.ai!.run).not.toHaveBeenCalled();
    }
  });

  it("does not skip those steps for an asset with no import batch (single-upload path)", async () => {
    const assetId = `test-asset-${crypto.randomUUID()}`;
    const personId = `test-person-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO person (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ).bind(personId, "Test Person", now, now),
      env.DB.prepare(
        `INSERT INTO asset (id, status, kind, title, created_at, updated_at, created_by, updated_by)
           VALUES (?, 'draft', 'photo', ?, ?, ?, ?, ?)`,
      ).bind(assetId, "test.jpg", now, now, personId, personId),
    ]);
    const nonHistoricalCtx: PipelineContext = {
      assetId,
      db: env.DB,
      bucket: env.MEDIA_BUCKET,
      queue: env.MEDIA_QUEUE,
      ai: { run: vi.fn() } as unknown as Ai,
    };

    // No asset_version at all — reference_person_matching has no file
    // dependency and just no-ops; the others throw on a missing 'original'
    // rather than silently skipping, proving the historical-mode guard
    // didn't fire.
    await expect(PIPELINE.duplicate_detection(nonHistoricalCtx)).rejects.toThrow(
      "No 'original' asset_version found",
    );
    await expect(PIPELINE.quality_scoring(nonHistoricalCtx)).rejects.toThrow(
      "No 'original' asset_version found",
    );
    const referenceOutput = await PIPELINE.reference_person_matching(nonHistoricalCtx);
    expect(referenceOutput).toEqual({ done: true });
  });
});

describe("RAW originals (issue #47)", () => {
  let ctx: PipelineContext;

  // A real, decodable JPEG — stands in for the embedded EXIF thumbnail a
  // real RAW file carries.
  function makeEmbeddedJpeg(): Uint8Array {
    const image = new PhotonImage(new Uint8Array(16 * 16 * 4).fill(128), 16, 16);
    try {
      return image.get_bytes_jpeg(70);
    } finally {
      image.free();
    }
  }

  // Hand-builds a real, valid, minimal TIFF/EXIF byte structure — no
  // mocking of exifr. RAW files are TIFF-based, so a real (if
  // content-free) TIFF is a faithful stand-in: IFD0 with zero entries,
  // optionally followed by an IFD1 carrying the three standard thumbnail
  // tags (Compression, ThumbnailOffset, ThumbnailLength) plus the embedded
  // JPEG bytes themselves — exactly the structure exifr.thumbnail() reads.
  function makeMinimalTiff(embeddedJpeg?: Uint8Array): Uint8Array {
    if (!embeddedJpeg) {
      // IFD0 (0 entries) with no IFD1 at all.
      const buf = new Uint8Array(8 + 2 + 4);
      const view = new DataView(buf.buffer);
      buf[0] = 0x49;
      buf[1] = 0x49; // "II" little-endian
      view.setUint16(2, 42, true);
      view.setUint32(4, 8, true); // offset to IFD0
      view.setUint16(8, 0, true); // IFD0: 0 entries
      view.setUint32(10, 0, true); // no next IFD
      return buf;
    }

    const ifd1EntryCount = 3;
    const jpegOffset = 8 + 6 + 2 + ifd1EntryCount * 12 + 4;
    const buf = new Uint8Array(jpegOffset + embeddedJpeg.length);
    const view = new DataView(buf.buffer);
    buf[0] = 0x49;
    buf[1] = 0x49;
    view.setUint16(2, 42, true);
    view.setUint32(4, 8, true);

    view.setUint16(8, 0, true); // IFD0: 0 entries
    view.setUint32(10, 14, true); // IFD0 -> IFD1 at offset 14

    let off = 14;
    view.setUint16(off, ifd1EntryCount, true);
    off += 2;
    // Compression = 6 (JPEG)
    view.setUint16(off, 0x0103, true);
    view.setUint16(off + 2, 3, true);
    view.setUint32(off + 4, 1, true);
    view.setUint16(off + 8, 6, true);
    off += 12;
    // ThumbnailOffset (JPEGInterchangeFormat)
    view.setUint16(off, 0x0201, true);
    view.setUint16(off + 2, 4, true);
    view.setUint32(off + 4, 1, true);
    view.setUint32(off + 8, jpegOffset, true);
    off += 12;
    // ThumbnailLength (JPEGInterchangeFormatLength)
    view.setUint16(off, 0x0202, true);
    view.setUint16(off + 2, 4, true);
    view.setUint32(off + 4, 1, true);
    view.setUint32(off + 8, embeddedJpeg.length, true);
    off += 12;
    view.setUint32(off, 0, true); // no next IFD

    buf.set(embeddedJpeg, jpegOffset);
    return buf;
  }

  async function seedRawAsset(filename: string, bytes: Uint8Array): Promise<PipelineContext> {
    const assetId = `test-asset-${crypto.randomUUID()}`;
    const personId = `test-person-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const r2Key = `originals/${assetId}/${filename}`;
    await env.MEDIA_BUCKET.put(r2Key, bytes);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO person (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ).bind(personId, "Test Person", now, now),
      env.DB.prepare(
        `INSERT INTO asset (id, status, kind, title, created_at, updated_at, created_by, updated_by)
           VALUES (?, 'draft', 'photo', ?, ?, ?, ?, ?)`,
      ).bind(assetId, filename, now, now, personId, personId),
      env.DB.prepare(
        `INSERT INTO asset_version (id, asset_id, kind, mime_type, r2_key, size_bytes, checksum, created_at)
           VALUES (?, ?, 'original', 'application/octet-stream', ?, ?, 'deadbeef', ?)`,
      ).bind(`test-version-${crypto.randomUUID()}`, assetId, r2Key, bytes.byteLength, now),
    ]);
    return { assetId, db: env.DB, bucket: env.MEDIA_BUCKET, queue: env.MEDIA_QUEUE };
  }

  it.each([".cr2", ".cr3", ".nef", ".arw", ".dng", ".raf", ".orf", ".rw2", ".CR2"])(
    "recognizes %s as a RAW extension",
    (ext) => {
      expect(isRawExtension(`originals/asset-id/photo${ext}`)).toBe(true);
    },
  );

  it("does not treat other extensions as RAW", () => {
    expect(isRawExtension("originals/asset-id/photo.jpg")).toBe(false);
    expect(isRawExtension("originals/asset-id/doc.pdf")).toBe(false);
    expect(isRawExtension("originals/asset-id/no-extension")).toBe(false);
  });

  it("generates web/thumbnail derivatives from a RAW file's embedded preview", async () => {
    ctx = await seedRawAsset("photo.cr2", makeMinimalTiff(makeEmbeddedJpeg()));

    await runPipelineStep("preview_generation", ctx);

    const run = await ctx.db
      .prepare(
        `SELECT status, output FROM asset_pipeline_run WHERE asset_id = ? AND step = 'preview_generation'`,
      )
      .bind(ctx.assetId)
      .first<{ status: string; output: string }>();
    expect(run?.status).toBe("done");
    expect(JSON.parse(run?.output ?? "{}")).toMatchObject({ done: true });

    const versions = await ctx.db
      .prepare(`SELECT kind FROM asset_version WHERE asset_id = ? ORDER BY kind`)
      .bind(ctx.assetId)
      .all<{ kind: string }>();
    expect(versions.results.map((v) => v.kind).sort()).toEqual(["original", "thumbnail", "web"]);
  });

  it("fails clearly (not a silent skip) when the RAW file has no embedded preview", async () => {
    ctx = await seedRawAsset("photo.nef", makeMinimalTiff());

    await expect(runPipelineStep("preview_generation", ctx)).rejects.toThrow(
      "No embedded preview/thumbnail found",
    );

    const run = await ctx.db
      .prepare(
        `SELECT status, error FROM asset_pipeline_run WHERE asset_id = ? AND step = 'preview_generation'`,
      )
      .bind(ctx.assetId)
      .first<{ status: string; error: string }>();
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("No embedded preview/thumbnail found");
  });

  it("lets exif_extraction attempt a RAW file instead of skipping it as 'not an image'", async () => {
    ctx = await seedRawAsset("photo.arw", makeMinimalTiff());

    await runPipelineStep("exif_extraction", ctx);

    const run = await ctx.db
      .prepare(
        `SELECT status, output FROM asset_pipeline_run WHERE asset_id = ? AND step = 'exif_extraction'`,
      )
      .bind(ctx.assetId)
      .first<{ status: string; output: string }>();
    expect(run?.status).toBe("done");
    // A content-free IFD0 legitimately has no metadata to record — the
    // point here is *why*: it must not be `skipped` at all, since that
    // would mean the old mime_type-based gate (which used to reject every
    // RAW file outright) fired instead of a real parse attempt.
    const output = JSON.parse(run?.output ?? "{}");
    expect(output.skipped).not.toBe(true);
  });
});

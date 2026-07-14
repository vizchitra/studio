import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PIPELINE, runPipelineStep, type PipelineContext } from "./pipeline";

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

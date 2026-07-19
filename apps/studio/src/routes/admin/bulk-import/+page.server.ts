import { error, fail } from "@sveltejs/kit";
import { canReview, canUpload } from "@studio/shared";
import {
  getBaselineRoleByEmail,
  getEffectiveRole,
  getOrCreatePersonId,
} from "$lib/server/permissions";
import { hasCapturedBy } from "$lib/server/relationships";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, platform }) => {
  const db = platform?.env.DB;
  if (!locals.user || !db) error(401, "Not signed in");

  const role = await getBaselineRoleByEmail(db, locals.user.email);
  if (!canUpload(role)) error(403, "Insufficient permissions to bulk import");

  return {};
};

interface BulkImportResultEntry {
  assetId: string;
  path: string;
  folderTag: string | null;
  date: string | null;
  code: string | null;
  capturedBy: "photographer" | "organisation" | "none";
}

interface BulkImportResponse {
  batchId: string;
  mode: "historical" | "review";
  template: string;
  imported: BulkImportResultEntry[];
}

export const actions: Actions = {
  bulkImport: async ({ request, platform }) => {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return fail(400, { error: "Choose a .zip file to upload" });
    }
    const mode = form.get("mode");
    if (mode !== "historical" && mode !== "review") {
      return fail(400, { error: "Choose an import mode" });
    }
    const template = form.get("template");

    const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!jwt) {
      return fail(401, { error: "Missing Access authentication" });
    }

    const mediaForm = new FormData();
    mediaForm.set("file", file, file.name);
    mediaForm.set("mode", mode);
    if (typeof template === "string" && template.trim() !== "") {
      mediaForm.set("template", template.trim());
    }

    const response = await fetch(`${platform?.env.MEDIA_SERVICE_URL}/assets/bulk-import`, {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": jwt },
      body: mediaForm,
    });

    if (!response.ok) {
      return fail(response.status, { error: await response.text() });
    }

    const result = (await response.json()) as BulkImportResponse;
    return { success: true, ...result };
  },

  // Explicit admin bulk-action reusing /assets' approve-action gating
  // pattern (canReview, per #30) rather than an automatic chain — so
  // CLAUDE.md's "nothing publishes without human confirmation" still
  // holds at the batch level for Historical Import (#46). Publish still
  // requires a resolved captured_by per-asset (#44); an asset the bulk
  // import couldn't attribute just gets skipped here, same as it would
  // be blocked in the regular /assets approve action, until someone
  // fixes attribution by hand.
  publishBatch: async ({ request, platform, locals }) => {
    if (!locals.user) return fail(401, { error: "Not signed in" });
    const form = await request.formData();
    const batchId = form.get("batchId");
    if (typeof batchId !== "string") return fail(400, { error: "Missing batchId" });

    const db = platform?.env.DB;
    const queue = platform?.env.MEDIA_QUEUE;
    if (!db || !queue) return fail(500, { error: "DB or queue binding not available" });

    const personId = await getOrCreatePersonId(db, locals.user.email);
    const role = await getEffectiveRole(db, personId, "studio", "global");
    if (!canReview(role)) return fail(403, { error: "Insufficient permissions to publish" });

    const { results: assets } = await db
      .prepare(`SELECT id FROM asset WHERE import_batch_id = ? AND status IN ('draft', 'review')`)
      .bind(batchId)
      .all<{ id: string }>();

    let published = 0;
    let needsAttribution = 0;
    const now = new Date().toISOString();
    for (const asset of assets) {
      if (!(await hasCapturedBy(db, asset.id))) {
        needsAttribution += 1;
        continue;
      }
      await db
        .prepare(
          `UPDATE asset SET status = 'approved', updated_at = ?, updated_by = ? WHERE id = ?`,
        )
        .bind(now, personId, asset.id)
        .run();
      await queue.send({ assetId: asset.id, step: "publish" });
      published += 1;
    }

    return { batchPublished: true, batchId, published, needsAttribution };
  },
};

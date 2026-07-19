import { error, fail } from "@sveltejs/kit";
import { canUpload } from "@studio/shared";
import { getBaselineRoleByEmail } from "$lib/server/permissions";
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
};

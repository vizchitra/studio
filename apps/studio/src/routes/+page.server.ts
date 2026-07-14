import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals }) => {
  return { user: locals.user };
};

export const actions: Actions = {
  upload: async ({ request, platform }) => {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return fail(400, { error: "Choose a file to upload" });
    }

    // Access already verified this request at the edge before it reached us;
    // forward the same JWT so the media service (which has no Access-gated
    // route of its own) can independently verify it too — see
    // services/media/src/access-auth.ts.
    const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!jwt) {
      return fail(401, { error: "Missing Access authentication" });
    }

    const mediaForm = new FormData();
    mediaForm.set("file", file, file.name);

    const response = await fetch(`${platform?.env.MEDIA_SERVICE_URL}/assets`, {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": jwt },
      body: mediaForm,
    });

    if (!response.ok) {
      return fail(response.status, { error: await response.text() });
    }

    const result = (await response.json()) as { assetId: string; versionId: string };
    return { success: true, ...result };
  },
};

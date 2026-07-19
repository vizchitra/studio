import { fail } from "@sveltejs/kit";
import { getOrCreatePersonByName, getOrCreatePersonId } from "$lib/server/permissions";
import { createRelationship, getOrCreateTagId } from "$lib/server/relationships";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, platform }) => {
  const db = platform?.env.DB;
  if (!locals.user || !db) {
    return {
      user: locals.user,
      attributionSuggestion: locals.user?.email ?? "",
      personNames: [],
      tagNames: [],
    };
  }

  // Read-only lookup, not getOrCreatePersonId — a GET shouldn't create a
  // person row as a side effect. Falls back to the raw email for a
  // first-time visitor who has no person row yet (created on their first
  // upload instead).
  const [person, people, tags] = await Promise.all([
    db
      .prepare(`SELECT name FROM person WHERE email = ?`)
      .bind(locals.user.email)
      .first<{ name: string }>(),
    db
      .prepare(`SELECT DISTINCT name FROM person WHERE name IS NOT NULL ORDER BY name LIMIT 200`)
      .all<{
        name: string;
      }>(),
    db.prepare(`SELECT name FROM tag ORDER BY name LIMIT 200`).all<{ name: string }>(),
  ]);

  return {
    user: locals.user,
    attributionSuggestion: person?.name ?? locals.user.email,
    personNames: people.results.map((p) => p.name),
    tagNames: tags.results.map((t) => t.name),
  };
};

export const actions: Actions = {
  upload: async ({ request, platform, locals }) => {
    if (!locals.user) return fail(401, { error: "Not signed in" });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return fail(400, { error: "Choose a file to upload" });
    }

    // Required, not inferred from the filename — see issue #44. Default
    // suggestion in the UI is the uploader themselves, but the field stays
    // free text/editable since the uploader and photographer are often
    // different people.
    const photographerName = form.get("photographerName");
    if (typeof photographerName !== "string" || photographerName.trim() === "") {
      return fail(400, { error: "Who took this photo? is required" });
    }
    const contextTag = form.get("contextTag");

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

    const db = platform?.env.DB;
    if (db) {
      // A free-text photographer name resolves to a lightweight Person
      // record (create-if-missing by name), same as a confirmed face
      // (getOrCreatePersonByName, #31) — attribution-only names have no
      // email to key on, so this is the existing answer to that question,
      // not a new one.
      const photographerId = await getOrCreatePersonByName(db, photographerName.trim());
      await createRelationship(db, {
        fromId: result.assetId,
        fromType: "asset",
        toId: photographerId,
        toType: "person",
        kind: "captured_by",
      });

      if (typeof contextTag === "string" && contextTag.trim() !== "") {
        const tagId = await getOrCreateTagId(db, contextTag.trim());
        await createRelationship(db, {
          fromId: result.assetId,
          fromType: "asset",
          toId: tagId,
          toType: "tag",
          kind: "tagged_with",
        });
      }

      // Ensures the uploader has a person row too (independent of whether
      // they're also the photographer) — same lazy-create-on-write pattern
      // /assets already uses for approve/reject/reprocess.
      await getOrCreatePersonId(db, locals.user.email);
    }

    return { success: true, ...result };
  },
};

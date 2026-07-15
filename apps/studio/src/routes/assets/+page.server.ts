import { error, fail, redirect } from "@sveltejs/kit";
import { ulid } from "@studio/shared";
import type { Actions, PageServerLoad } from "./$types";

interface AssetRow {
  id: string;
  status: string;
  kind: string;
  title: string | null;
  created_at: string;
  created_by_name: string | null;
  thumbnail_r2_key: string | null;
  exif_json: string | null;
  quality_score: number | null;
  quality_flags_json: string | null;
}

export const load: PageServerLoad = async ({ platform }) => {
  const db = platform?.env.DB;
  if (!db) error(500, "DB binding not available");

  const { results } = await db
    .prepare(
      `SELECT
         a.id, a.status, a.kind, a.title, a.created_at,
         a.quality_score, a.quality_flags as quality_flags_json,
         p.name as created_by_name,
         thumb.r2_key as thumbnail_r2_key,
         orig.exif as exif_json
       FROM asset a
       LEFT JOIN person p ON p.id = a.created_by
       LEFT JOIN asset_version thumb ON thumb.asset_id = a.id AND thumb.kind = 'thumbnail'
       LEFT JOIN asset_version orig ON orig.asset_id = a.id AND orig.kind = 'original'
       ORDER BY a.created_at DESC
       LIMIT 50`,
    )
    .all<AssetRow>();

  const assets = results.map((row) => {
    let exifSummary: string | null = null;
    if (row.exif_json) {
      try {
        const exif = JSON.parse(row.exif_json) as Record<string, unknown>;
        const parts = [exif.Make, exif.Model, exif.DateTimeOriginal]
          .filter((v): v is string => typeof v === "string")
          .join(" · ");
        exifSummary = parts || null;
      } catch {
        exifSummary = null;
      }
    }

    let qualityFlags: string[] = [];
    if (row.quality_flags_json) {
      try {
        qualityFlags = JSON.parse(row.quality_flags_json) as string[];
      } catch {
        qualityFlags = [];
      }
    }

    return { ...row, exifSummary, qualityFlags };
  });

  return { assets };
};

// asset.updated_by is a FK to person.id, not a raw email — same resolution
// as services/media/src/index.ts's getOrCreatePersonId.
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

async function setStatus(
  db: D1Database,
  assetId: string,
  status: "approved" | "archived",
  updatedBy: string,
) {
  await db
    .prepare(`UPDATE asset SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?`)
    .bind(status, new Date().toISOString(), updatedBy, assetId)
    .run();
}

export const actions: Actions = {
  approve: async ({ request, platform, locals }) => {
    if (!locals.user) return fail(401, { error: "Not signed in" });
    const form = await request.formData();
    const assetId = form.get("assetId");
    if (typeof assetId !== "string") return fail(400, { error: "Missing assetId" });

    const db = platform?.env.DB;
    if (!db) return fail(500, { error: "DB binding not available" });
    const personId = await getOrCreatePersonId(db, locals.user.email);
    await setStatus(db, assetId, "approved", personId);
    redirect(303, "/assets");
  },

  reject: async ({ request, platform, locals }) => {
    if (!locals.user) return fail(401, { error: "Not signed in" });
    const form = await request.formData();
    const assetId = form.get("assetId");
    if (typeof assetId !== "string") return fail(400, { error: "Missing assetId" });

    // No dedicated "rejected" state in the entity status enum
    // (draft|review|approved|published|archived) — archived is the closest
    // fit for "reviewed and not going forward".
    const db = platform?.env.DB;
    if (!db) return fail(500, { error: "DB binding not available" });
    const personId = await getOrCreatePersonId(db, locals.user.email);
    await setStatus(db, assetId, "archived", personId);
    redirect(303, "/assets");
  },
};

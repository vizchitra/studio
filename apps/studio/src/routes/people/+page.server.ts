import { error, fail, redirect } from "@sveltejs/kit";
import { canManageRoles, STUDIO_ACCESS_ROLES, ulid } from "@studio/shared";
import { getBaselineRoleByEmail } from "$lib/server/permissions";
import type { StudioAccessRole } from "@studio/domain";
import type { Actions, PageServerLoad } from "./$types";

interface PersonRow {
  id: string;
  name: string;
  email: string | null;
  role: StudioAccessRole | null;
}

export const load: PageServerLoad = async ({ platform, locals }) => {
  const db = platform?.env.DB;
  if (!db) error(500, "DB binding not available");
  if (!locals.user) error(401, "Not signed in");

  const role = await getBaselineRoleByEmail(db, locals.user.email);
  if (!canManageRoles(role)) error(403, "Administrators only");

  const { results: people } = await db
    .prepare(
      `SELECT p.id, p.name, p.email, perm.role as role
       FROM person p
       LEFT JOIN permission perm
         ON perm.person_id = p.id AND perm.entity_type = 'studio' AND perm.entity_id = 'global'
       ORDER BY p.name`,
    )
    .all<PersonRow>();

  return { people, roles: STUDIO_ACCESS_ROLES };
};

export const actions: Actions = {
  // Assigns/changes a Person's baseline StudioAccessRole (#58) — the only
  // way to do this today is a direct D1 write. Entity-level overrides are
  // deliberately out of scope: nothing in the app checks them yet
  // (getEffectiveRole's override branch has no UI writer), and building an
  // override UI ahead of anything enforcing it would be misleading.
  setRole: async ({ request, platform, locals }) => {
    if (!locals.user) return fail(401, { error: "Not signed in" });
    const db = platform?.env.DB;
    if (!db) return fail(500, { error: "DB binding not available" });

    const actorRole = await getBaselineRoleByEmail(db, locals.user.email);
    if (!canManageRoles(actorRole)) {
      return fail(403, { error: "Insufficient permissions to manage roles" });
    }

    const form = await request.formData();
    const personId = form.get("personId");
    const role = form.get("role");
    if (typeof personId !== "string") return fail(400, { error: "Missing personId" });
    if (typeof role !== "string" || !STUDIO_ACCESS_ROLES.includes(role as StudioAccessRole)) {
      return fail(400, { error: "Missing or invalid role" });
    }

    const current = await db
      .prepare(
        `SELECT role FROM permission WHERE entity_type = 'studio' AND entity_id = 'global' AND person_id = ?`,
      )
      .bind(personId)
      .first<{ role: StudioAccessRole }>();

    // Refuse to leave the team locked out of this same page — only matters
    // when the target is currently an administrator and is losing that role.
    if (current?.role === "administrator" && role !== "administrator") {
      const { count } = (await db
        .prepare(
          `SELECT COUNT(*) as count FROM permission WHERE entity_type = 'studio' AND entity_id = 'global' AND role = 'administrator'`,
        )
        .first<{ count: number }>()) ?? { count: 0 };
      if (count <= 1) {
        return fail(400, { error: "Refusing to remove the last administrator" });
      }
    }

    if (current) {
      await db
        .prepare(
          `UPDATE permission SET role = ? WHERE entity_type = 'studio' AND entity_id = 'global' AND person_id = ?`,
        )
        .bind(role, personId)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO permission (id, entity_id, entity_type, person_id, role, created_at) VALUES (?, 'global', 'studio', ?, ?, ?)`,
        )
        .bind(ulid(), personId, role, new Date().toISOString())
        .run();
    }

    redirect(303, "/people");
  },
};

import { canManageRoles, canReprocess, canUpload } from "@studio/shared";
import { getBaselineRoleByEmail } from "$lib/server/permissions";
import type { LayoutServerLoad } from "./$types";

// Drives the app-shell Nav/SidePanel: which user is shown, and which
// admin-only links render at all (per UI_PRINCIPLES.md — "permissions are
// reflected by what's shown, not by what's disabled").
export const load: LayoutServerLoad = async ({ locals, platform }) => {
  const db = platform?.env.DB;
  if (!locals.user || !db) {
    return { user: locals.user, canReprocess: false, canUpload: false, canManageRoles: false };
  }
  const role = await getBaselineRoleByEmail(db, locals.user.email);
  return {
    user: locals.user,
    canReprocess: canReprocess(role),
    canUpload: canUpload(role),
    canManageRoles: canManageRoles(role),
  };
};

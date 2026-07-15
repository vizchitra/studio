import { ulid } from "@studio/shared";
import type { StudioAccessRole } from "@studio/domain";

// asset.created_by/updated_by are FKs to person.id, not a raw email — same
// resolution as services/media/src/index.ts's getOrCreatePersonId.
export async function getOrCreatePersonId(db: D1Database, email: string): Promise<string> {
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

// Resolve-or-create by name rather than email — a confirmed face has no
// email to key on, unlike getOrCreatePersonId's Access-authenticated users.
export async function getOrCreatePersonByName(db: D1Database, name: string): Promise<string> {
  const existing = await db
    .prepare(`SELECT id FROM person WHERE name = ? COLLATE NOCASE`)
    .bind(name)
    .first<{ id: string }>();
  if (existing) return existing.id;

  const id = ulid();
  const now = new Date().toISOString();
  await db
    .prepare(`INSERT INTO person (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .bind(id, name, now, now)
    .run();
  return id;
}

// Effective StudioAccessRole for a specific entity: an entity-level override
// (a `permission` row scoped to that entity) takes precedence over the
// baseline grant (entity_type = 'studio', entity_id = 'global') — see
// architecture/Studio Data Model.md, Permission section.
export async function getEffectiveRole(
  db: D1Database,
  personId: string,
  entityType: string,
  entityId: string,
): Promise<StudioAccessRole | null> {
  const override = await db
    .prepare(
      `SELECT role FROM permission WHERE entity_type = ? AND entity_id = ? AND person_id = ?`,
    )
    .bind(entityType, entityId, personId)
    .first<{ role: StudioAccessRole }>();
  if (override) return override.role;

  const baseline = await db
    .prepare(
      `SELECT role FROM permission WHERE entity_type = 'studio' AND entity_id = 'global' AND person_id = ?`,
    )
    .bind(personId)
    .first<{ role: StudioAccessRole }>();
  return baseline?.role ?? null;
}

// Baseline-only convenience: looks a person up by email (Access identity)
// and resolves their studio-wide role, without requiring an entity-level
// override lookup. Used by the root layout (nav gating) and pages that
// only care about the global role, not a per-asset override.
export async function getBaselineRoleByEmail(
  db: D1Database,
  email: string,
): Promise<StudioAccessRole | null> {
  const person = await db
    .prepare(`SELECT id FROM person WHERE email = ?`)
    .bind(email)
    .first<{ id: string }>();
  if (!person) return null;
  return getEffectiveRole(db, person.id, "studio", "global");
}

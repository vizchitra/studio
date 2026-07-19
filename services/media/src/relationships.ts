import { ulid } from "@studio/shared";
import type { RelationshipKind } from "@studio/domain";

// Mirrors apps/studio/src/lib/server/relationships.ts — duplicated rather
// than shared across the two deployables, same tradeoff already made for
// getOrCreatePersonId (services/media/src/index.ts vs
// apps/studio/src/lib/server/permissions.ts): two Workers, two D1Database
// binding types, not worth a cross-package extraction for this size of
// helper.
export async function createRelationship(
  db: D1Database,
  params: {
    fromId: string;
    fromType: string;
    toId: string;
    toType: string;
    kind: RelationshipKind;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO relationship (id, from_id, from_type, to_id, to_type, kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      ulid(),
      params.fromId,
      params.fromType,
      params.toId,
      params.toType,
      params.kind,
      new Date().toISOString(),
    )
    .run();
}

export async function getOrCreateTagId(db: D1Database, name: string): Promise<string> {
  const existing = await db
    .prepare(`SELECT id FROM tag WHERE name = ? COLLATE NOCASE`)
    .bind(name)
    .first<{ id: string }>();
  if (existing) return existing.id;

  const id = ulid();
  const slug = await getUniqueSlug(db, name);
  await db.prepare(`INSERT INTO tag (id, name, slug) VALUES (?, ?, ?)`).bind(id, name, slug).run();
  return id;
}

async function getUniqueSlug(db: D1Database, name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "tag";

  const existing = await db.prepare(`SELECT 1 FROM tag WHERE slug = ?`).bind(base).first();
  if (!existing) return base;

  return `${base}-${ulid().slice(-6).toLowerCase()}`;
}

export async function getVizchitraOrganisationId(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare(`SELECT id FROM organisation WHERE slug = 'vizchitra'`)
    .first<{ id: string }>();
  return row?.id ?? null;
}

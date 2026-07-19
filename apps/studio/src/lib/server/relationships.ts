import { ulid } from "@studio/shared";
import type { RelationshipKind } from "@studio/domain";

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

// Resolve-or-create a Tag by name (case-insensitive) — used for
// folder-derived and manually-entered "context tag" attribution alike
// (issues #43/#44/#45), so a folder named "Workshop Hall" and someone
// typing "workshop hall" at upload time land on the same Tag.
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

  // Base slug taken by a differently-cased/punctuated name that normalized
  // to the same string — disambiguate rather than fail the whole request.
  return `${base}-${ulid().slice(-6).toLowerCase()}`;
}

export async function hasCapturedBy(db: D1Database, assetId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM relationship WHERE from_id = ? AND from_type = 'asset' AND kind = 'captured_by' LIMIT 1`,
    )
    .bind(assetId)
    .first();
  return row !== null;
}

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

// Editorial correction (#57) — an asset's captured_by is set once at
// import/upload but can be wrong or missing (bulk imports default to the
// VizChitra org until someone identifies the real photographer). Replaces
// rather than appends, since captured_by is meant to be singular per
// hasCapturedBy's usage.
export async function setCapturedBy(
  db: D1Database,
  assetId: string,
  toId: string,
  toType: "person" | "organisation",
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM relationship WHERE from_id = ? AND from_type = 'asset' AND kind = 'captured_by'`,
    )
    .bind(assetId)
    .run();
  await createRelationship(db, {
    fromId: assetId,
    fromType: "asset",
    toId,
    toType,
    kind: "captured_by",
  });
}

// Editorial correction (#57) — replaces the full tag set for an asset
// (not additive) so the edit form's "Tags" field is a straightforward
// source of truth rather than an append-only list a user can't remove
// from.
export async function replaceAssetTags(
  db: D1Database,
  assetId: string,
  tagNames: string[],
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM relationship WHERE from_id = ? AND from_type = 'asset' AND kind = 'tagged_with'`,
    )
    .bind(assetId)
    .run();
  for (const name of tagNames) {
    const tagId = await getOrCreateTagId(db, name);
    await createRelationship(db, {
      fromId: assetId,
      fromType: "asset",
      toId: tagId,
      toType: "tag",
      kind: "tagged_with",
    });
  }
}

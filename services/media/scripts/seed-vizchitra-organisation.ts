/**
 * Seeds a single `organisation` row for VizChitra itself (issue #43) — the
 * `captured_by` relationship target for official/final photos with no
 * individual photographer credit. Organisation.kind gained an `organiser`
 * value for exactly this case; see architecture/Studio Data Model.md,
 * Organisation section.
 *
 * Shells out to `wrangler d1 execute`, same approach as
 * seed-fixtures.ts, since there's no way to reach a live Worker's D1
 * binding from outside the Worker.
 *
 * Idempotent: skips if an organisation with slug 'vizchitra' already
 * exists.
 *
 * Run: node scripts/seed-vizchitra-organisation.ts [--remote]
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ulid } from "@studio/shared";

const REMOTE = process.argv.includes("--remote");
const SERVICE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_NAME = "studio";
const SYSTEM_PERSON_EMAIL = "system@vizchitra.internal";
const ORG_SLUG = "vizchitra";

// Single quotes are the only thing that can break these hand-built SQL
// strings; escaping is free insurance for a script whose whole job is
// writing to a real database.
function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function d1(sql: string): string {
  const args = [
    "d1",
    "execute",
    DB_NAME,
    "--command",
    sql,
    "--json",
    REMOTE ? "--remote" : "--local",
  ];
  return execFileSync("npx", ["wrangler", ...args], { encoding: "utf-8", cwd: SERVICE_DIR });
}

function d1First<T>(sql: string): T | null {
  const output = d1(sql);
  const parsed = JSON.parse(output) as { results: T[] }[];
  return parsed[0]?.results[0] ?? null;
}

// Not the fixture-seeder person (services/media/scripts/seed-fixtures.ts) —
// that identity means "created by the fixture-generation tooling", a
// different fact than "system-owned reference data" like this org.
function getOrCreateSystemPersonId(): string {
  const existing = d1First<{ id: string }>(
    `SELECT id FROM person WHERE email = ${sqlString(SYSTEM_PERSON_EMAIL)}`,
  );
  if (existing) return existing.id;

  const id = ulid();
  const now = new Date().toISOString();
  d1(
    `INSERT INTO person (id, name, email, created_at, updated_at) VALUES (${sqlString(id)}, ${sqlString(
      "VizChitra Studio",
    )}, ${sqlString(SYSTEM_PERSON_EMAIL)}, ${sqlString(now)}, ${sqlString(now)})`,
  );
  return id;
}

function main() {
  const existing = d1First<{ id: string }>(
    `SELECT id FROM organisation WHERE slug = ${sqlString(ORG_SLUG)}`,
  );
  if (existing) {
    console.log(`skip (already seeded): organisation ${existing.id}`);
    return;
  }

  const personId = getOrCreateSystemPersonId();
  const id = ulid();
  const now = new Date().toISOString();
  d1(
    `INSERT INTO organisation (id, slug, status, name, kind, created_at, updated_at, created_by, updated_by)
     VALUES (${sqlString(id)}, ${sqlString(ORG_SLUG)}, 'approved', ${sqlString("VizChitra")}, 'organiser', ${sqlString(now)}, ${sqlString(now)}, ${sqlString(personId)}, ${sqlString(personId)})`,
  );
  console.log(`seeded: organisation ${id} (slug '${ORG_SLUG}')`);
}

main();

/**
 * Seeds services/media/fixtures/ (see manifest.json, issue #38) into D1 + R2
 * for pipeline validation (issue #39). Creates `asset` + `asset_version`
 * rows and uploads each fixture's bytes to R2 under a dedicated `fixtures/`
 * prefix — mirroring the real upload path in src/index.ts, but run from a
 * plain Node script (shelling out to `wrangler d1 execute` / `wrangler r2
 * object put`) since there's no way to invoke a live Worker's D1/R2
 * bindings — or its Queue — from outside the Worker.
 *
 * Each seeded asset is left at status 'draft' with no pipeline runs — this
 * script does not (and cannot, from the CLI) enqueue a Queue message. Start
 * processing a fixture via the /assets review UI's admin Reprocess action,
 * resuming at 'import' (closes the loop with #32's reprocess mechanism
 * instead of building a second way to kick off the pipeline).
 *
 * Idempotent: re-running skips any fixture whose asset_version.r2_key
 * already exists.
 *
 * Run: node scripts/seed-fixtures.ts [--remote]
 * (--remote targets the live Cloudflare D1/R2; default targets local
 * wrangler dev storage — see SETUP.md)
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Hex, ulid } from "@studio/shared";

const REMOTE = process.argv.includes("--remote");
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const DB_NAME = "studio";
const BUCKET_NAME = "studio-media";
const FIXTURE_PERSON_EMAIL = "fixtures@vizchitra.internal";

interface ManifestEntry {
  file: string;
  source: string;
  case: string;
  exercises: string[];
  notes: string;
}

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
};

function guessKind(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "photo";
  if (mimeType === "application/pdf") return "pdf";
  return "photo";
}

// Single quotes are the only thing that can break these hand-built SQL
// strings; none of our fixture data actually contains one, but escaping is
// free insurance for a script whose whole job is writing to a real database.
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
  return execFileSync("npx", ["wrangler", ...args], {
    encoding: "utf-8",
    cwd: dirname(FIXTURES_DIR),
  });
}

function d1First<T>(sql: string): T | null {
  const output = d1(sql);
  const parsed = JSON.parse(output) as { results: T[] }[];
  return parsed[0]?.results[0] ?? null;
}

function r2Put(key: string, filePath: string, contentType: string) {
  const args = [
    "r2",
    "object",
    "put",
    `${BUCKET_NAME}/${key}`,
    "--file",
    filePath,
    "--content-type",
    contentType,
    REMOTE ? "--remote" : "--local",
  ];
  execFileSync("npx", ["wrangler", ...args], {
    encoding: "utf-8",
    cwd: dirname(FIXTURES_DIR),
    stdio: "pipe",
  });
}

function getOrCreateFixturePersonId(): string {
  const existing = d1First<{ id: string }>(
    `SELECT id FROM person WHERE email = ${sqlString(FIXTURE_PERSON_EMAIL)}`,
  );
  if (existing) return existing.id;

  const id = ulid();
  const now = new Date().toISOString();
  d1(
    `INSERT INTO person (id, name, email, created_at, updated_at) VALUES (${sqlString(id)}, ${sqlString(
      "Fixture Seeder",
    )}, ${sqlString(FIXTURE_PERSON_EMAIL)}, ${sqlString(now)}, ${sqlString(now)})`,
  );
  return id;
}

async function seedFixture(entry: ManifestEntry, personId: string) {
  const r2Key = `fixtures/${entry.file}`;

  const existing = d1First<{ id: string }>(
    `SELECT id FROM asset_version WHERE r2_key = ${sqlString(r2Key)}`,
  );
  if (existing) {
    console.log(`skip (already seeded): ${entry.file}`);
    return;
  }

  const filePath = join(FIXTURES_DIR, entry.file);
  const bytes = readFileSync(filePath);
  const mimeType = MIME_TYPES[extname(entry.file).toLowerCase()] ?? "application/octet-stream";
  const checksum = await sha256Hex(bytes);

  r2Put(r2Key, filePath, mimeType);

  const assetId = ulid();
  const versionId = ulid();
  const now = new Date().toISOString();

  d1(
    `INSERT INTO asset (id, status, kind, title, created_at, updated_at, created_by, updated_by)
     VALUES (${sqlString(assetId)}, 'draft', ${sqlString(guessKind(mimeType))}, ${sqlString(entry.file)}, ${sqlString(now)}, ${sqlString(now)}, ${sqlString(personId)}, ${sqlString(personId)})`,
  );
  d1(
    `INSERT INTO asset_version (id, asset_id, kind, mime_type, r2_key, size_bytes, checksum, created_at)
     VALUES (${sqlString(versionId)}, ${sqlString(assetId)}, 'original', ${sqlString(mimeType)}, ${sqlString(r2Key)}, ${bytes.byteLength}, ${sqlString(checksum)}, ${sqlString(now)})`,
  );

  console.log(`seeded: ${entry.file} -> asset ${assetId}`);
}

async function main() {
  const manifest = JSON.parse(
    readFileSync(join(FIXTURES_DIR, "manifest.json"), "utf-8"),
  ) as ManifestEntry[];
  console.log(
    `Seeding ${manifest.length} fixtures against ${REMOTE ? "remote" : "local"} D1/R2...`,
  );

  const personId = getOrCreateFixturePersonId();
  for (const entry of manifest) {
    await seedFixture(entry, personId);
  }

  console.log(
    "\nDone. Each fixture asset is status='draft' with no pipeline runs yet — use the /assets review UI's admin Reprocess action (resume at 'import') to process one.",
  );
}

await main();

/**
 * Generates services/media/fixtures/ — synthetic images covering the cases
 * each pipeline step needs to be checked against (see fixtures/manifest.json
 * and issue #38). Every fixture here is procedurally generated, not a real
 * photo of a real person: reusing already-published VizChitra photos was
 * the original plan (they're already consented for public display), but an
 * agent can't source or curate those without a human's involvement, so this
 * covers what's honestly achievable synthetically. Swapping in real
 * published photos for the portrait/group-shot cases is a manual follow-up.
 *
 * Run: node scripts/generate-fixtures.ts (from services/media/), then
 * `npm run format` — oxfmt reformats the generated manifest.json slightly
 * differently than JSON.stringify's default output.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PhotonImage, Rgba, draw_text_with_color } from "@cf-wasm/photon/node";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
mkdirSync(FIXTURES_DIR, { recursive: true });

interface FixtureSpec {
  file: string;
  source: "generated";
  case: string;
  exercises: string[];
  notes: string;
}

const manifest: FixtureSpec[] = [];

function rgbaPixels(
  width: number,
  height: number,
  fill: (x: number, y: number) => number,
): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = fill(x, y);
      pixels[i] = v;
      pixels[i + 1] = v;
      pixels[i + 2] = v;
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

// A soft circular bright region on a darker background — a synthetic stand-in
// for "one subject, roughly centered" (single-face portrait shape), not an
// actual face. cx/cy/radius are fractions of width/height.
function blobBrightness(
  x: number,
  y: number,
  width: number,
  height: number,
  blobs: { cx: number; cy: number; radius: number }[],
  background: number,
  peak: number,
): number {
  let brightest = background;
  for (const blob of blobs) {
    const dx = x - blob.cx * width;
    const dy = y - blob.cy * height;
    const dist = Math.sqrt(dx * dx + dy * dy) / (blob.radius * Math.min(width, height));
    const falloff = Math.max(0, 1 - dist);
    const value = background + (peak - background) * falloff ** 2;
    brightest = Math.max(brightest, value);
  }
  return Math.min(255, Math.max(0, Math.round(brightest)));
}

function saveJpeg(
  filename: string,
  pixels: Uint8Array,
  width: number,
  height: number,
  quality: number,
) {
  const image = new PhotonImage(pixels, width, height);
  try {
    writeFileSync(join(FIXTURES_DIR, filename), image.get_bytes_jpeg(quality));
  } finally {
    image.free();
  }
}

function savePng(filename: string, pixels: Uint8Array, width: number, height: number) {
  const image = new PhotonImage(pixels, width, height);
  try {
    writeFileSync(join(FIXTURES_DIR, filename), image.get_bytes());
  } finally {
    image.free();
  }
}

const W = 640;
const H = 480;

// 1-3: single-subject "portraits" (face_clustering / reference_person_matching)
for (const [suffix, peak, background] of [
  ["bright", 235, 90],
  ["dim", 160, 30],
  ["side", 220, 70],
] as const) {
  const cx = suffix === "side" ? 0.3 : 0.5;
  const pixels = rgbaPixels(W, H, (x, y) =>
    blobBrightness(x, y, W, H, [{ cx, cy: 0.45, radius: 0.35 }], background, peak),
  );
  saveJpeg(`portrait-like-${suffix}.jpg`, pixels, W, H, 85);
  manifest.push({
    file: `portrait-like-${suffix}.jpg`,
    source: "generated",
    case: "single-subject portrait stand-in",
    exercises: ["face_clustering", "reference_person_matching"],
    notes:
      "Synthetic radial-gradient blob simulating one roughly-centered subject, NOT a real face. Moondream will likely detect 0 faces on this — that's expected, not a bug; it's a real-photo-shaped hole in this fixture set until a real published-photo replacement lands.",
  });
}

// 4: group shot stand-in, 3 blobs (face_clustering)
{
  const pixels = rgbaPixels(W, H, (x, y) =>
    blobBrightness(
      x,
      y,
      W,
      H,
      [
        { cx: 0.2, cy: 0.5, radius: 0.22 },
        { cx: 0.5, cy: 0.4, radius: 0.22 },
        { cx: 0.8, cy: 0.55, radius: 0.22 },
      ],
      70,
      220,
    ),
  );
  saveJpeg("group-like-3.jpg", pixels, W, H, 85);
  manifest.push({
    file: "group-like-3.jpg",
    source: "generated",
    case: "group shot stand-in, 3+ subjects",
    exercises: ["face_clustering"],
    notes:
      "Synthetic image with three radial-gradient blobs simulating three subjects, NOT a real group photo. Moondream will likely detect 0 faces on this — that's expected, not a bug; it's a real-photo-shaped hole in this fixture set until a real published-photo replacement lands.",
  });
}

// 5-6: near-duplicate pair (duplicate_detection) — identical pixels, two
// different JPEG qualities, simulating "same photo, re-compressed/re-uploaded".
{
  const pixels = rgbaPixels(W, H, (x, y) => (x * 47 + y * 91) % 256);
  saveJpeg("near-duplicate-original.jpg", pixels, W, H, 95);
  saveJpeg("near-duplicate-recompressed.jpg", pixels, W, H, 55);
  for (const file of ["near-duplicate-original.jpg", "near-duplicate-recompressed.jpg"]) {
    manifest.push({
      file,
      source: "generated",
      case: "near-duplicate pair",
      exercises: ["duplicate_detection"],
      notes:
        "Identical source pixels re-encoded at different JPEG quality (95 vs 55), simulating the same photo re-uploaded/re-compressed. Should hash within the Hamming threshold of each other.",
    });
  }
}

// 7: distinct control — must NOT match anything above (duplicate_detection)
{
  const pixels = rgbaPixels(W, H, (x, y) => (x * 13 + y * 197 + 61) % 256);
  saveJpeg("distinct-control.jpg", pixels, W, H, 85);
  manifest.push({
    file: "distinct-control.jpg",
    source: "generated",
    case: "distinct image, not a duplicate of anything else in this set",
    exercises: ["duplicate_detection"],
    notes: "Control case — verifies unrelated images are not flagged as duplicates.",
  });
}

// 8: blurry (quality_scoring)
{
  const pixels = rgbaPixels(W, H, () => 128);
  saveJpeg("blurry.jpg", pixels, W, H, 85);
  manifest.push({
    file: "blurry.jpg",
    source: "generated",
    case: "low blur-variance (flat/no edges)",
    exercises: ["quality_scoring"],
    notes: "Flat mid-grey image — no edges for the Laplacian-variance blur heuristic to find.",
  });
}

// 9: underexposed (quality_scoring)
{
  const pixels = rgbaPixels(W, H, () => 12);
  saveJpeg("underexposed.jpg", pixels, W, H, 85);
  manifest.push({
    file: "underexposed.jpg",
    source: "generated",
    case: "underexposed (very dark)",
    exercises: ["quality_scoring"],
    notes: "Flat very-dark image, well below UNDEREXPOSED_MEAN_THRESHOLD.",
  });
}

// 10: overexposed (quality_scoring)
{
  const pixels = rgbaPixels(W, H, () => 248);
  saveJpeg("overexposed.jpg", pixels, W, H, 85);
  manifest.push({
    file: "overexposed.jpg",
    source: "generated",
    case: "overexposed (very bright)",
    exercises: ["quality_scoring"],
    notes: "Flat very-bright image, well above OVEREXPOSED_MEAN_THRESHOLD.",
  });
}

// 11: sharp control — must NOT be flagged blurry (quality_scoring)
{
  const squareSize = 8;
  const pixels = rgbaPixels(W, H, (x, y) =>
    (Math.floor(x / squareSize) + Math.floor(y / squareSize)) % 2 === 0 ? 20 : 235,
  );
  saveJpeg("sharp-control.jpg", pixels, W, H, 85);
  manifest.push({
    file: "sharp-control.jpg",
    source: "generated",
    case: "high blur-variance (sharp), mid exposure",
    exercises: ["quality_scoring"],
    notes:
      "High-contrast checkerboard — control case, verifies sharp/well-exposed images aren't flagged.",
  });
}

// 12: text-heavy (vision_tagging / future ocr) — real rendered text, not a
// fake pattern: draw_text uses Photon's built-in Roboto font.
{
  const textW = 800;
  const textH = 300;
  const pixels = rgbaPixels(textW, textH, () => 245);
  const image = new PhotonImage(pixels, textW, textH);
  try {
    // draw_text_with_color takes ownership of the Rgba (wasm-bindgen consumes
    // it) — a fresh instance per call, not reused across calls.
    draw_text_with_color(image, "VizChitra 2026 — Schedule", 24, 40, 32, new Rgba(20, 20, 20, 255));
    draw_text_with_color(
      image,
      "Session A: Data Visualisation",
      24,
      100,
      24,
      new Rgba(20, 20, 20, 255),
    );
    draw_text_with_color(
      image,
      "Session B: Design Systems",
      24,
      150,
      24,
      new Rgba(20, 20, 20, 255),
    );
    draw_text_with_color(image, "Room 3 - 10:00-11:00", 24, 200, 24, new Rgba(20, 20, 20, 255));
    writeFileSync(join(FIXTURES_DIR, "text-heavy.jpg"), image.get_bytes_jpeg(90));
  } finally {
    image.free();
  }
  manifest.push({
    file: "text-heavy.jpg",
    source: "generated",
    case: "text-heavy (slide/signage stand-in)",
    exercises: ["vision_tagging", "ocr"],
    notes:
      "Real rendered text (Photon's built-in Roboto font draw_text), not a photo of an actual slide.",
  });
}

// 13: no-EXIF + non-JPEG format in one fixture (exif_extraction, preview_generation)
{
  const pixels = rgbaPixels(W, H, (x, y) => (x + y) % 256);
  savePng("no-exif.png", pixels, W, H);
  manifest.push({
    file: "no-exif.png",
    source: "generated",
    case: "non-JPEG format with no EXIF data",
    exercises: ["exif_extraction", "preview_generation"],
    notes:
      "PNG (not JPEG) with no EXIF segment at all — covers exif_extraction's null-handling path and a non-JPEG source format.",
  });
}

// 14: a non-image asset (preview_generation / exif_extraction skip path).
// Hand-built rather than via a library — byte offsets are computed, not
// hand-typed, so the xref table is actually correct.
{
  const objects: string[] = [];
  objects[1] = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
  objects[2] = "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n";
  objects[3] =
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n";
  objects[4] = "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n";
  const stream = "BT /F1 14 Tf 20 150 Td (VizChitra fixture PDF) Tj ET";
  objects[5] = `5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = Buffer.byteLength(pdf, "latin1");
    pdf += objects[i];
  }
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) {
    pdf += `${offsets[i].toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  writeFileSync(join(FIXTURES_DIR, "sample.pdf"), Buffer.from(pdf, "latin1"));
  manifest.push({
    file: "sample.pdf",
    source: "generated",
    case: "non-image asset",
    exercises: [
      "preview_generation",
      "exif_extraction",
      "duplicate_detection",
      "quality_scoring",
      "face_clustering",
    ],
    notes:
      "Minimal valid single-page PDF — exercises every image-only step's non-image skip path at once.",
  });
}

writeFileSync(join(FIXTURES_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Generated ${manifest.length} fixtures + manifest.json in ${FIXTURES_DIR}`);

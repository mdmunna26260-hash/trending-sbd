import sharp from "sharp";
import fs from "fs";
import path from "path";

/* WhatsApp media pipeline (Phase 2).
   WhatsApp accepts an image up to ~5 MB, but a 3–4 MB phone photo takes forever on a 3G customer's
   phone and eats the daily data — so every upload from the panel is re-encoded here, server-side:
   auto-rotate by EXIF → max 1600 px on the long edge → JPEG, quality stepped down until the file
   is under ~950 KB. The stored file is what the bridge hands to WhatsApp, so nothing large ever
   leaves the building (and the worker never downloads a giant original to re-send it).

   Files live in public/uploads/wa/ (served statically, same origin as the store), which also means
   the bridge can fetch them over http://127.0.0.1:3000 without touching the database. */

export const WA_IMAGE_TARGET_BYTES = 950 * 1024;
export const WA_IMAGE_MAX_UPLOAD = 25 * 1024 * 1024;
export const WA_MAX_IMAGES = 10;

const ALLOWED = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif", "image/gif"]);
const QUALITIES = [84, 76, 68, 60, 52];
const SIZES = [1600, 1600, 1600, 1280, 1080, 900];

export const WA_UPLOAD_SUBDIR = "uploads/wa";

export function waUploadDir(): string {
  return path.join(process.cwd(), "public", WA_UPLOAD_SUBDIR);
}

export type WaProcessedImage =
  | { ok: true; url: string; width: number; height: number; bytes: number; originalBytes: number; quality: number; resized: boolean; saved: number }
  | { ok: false; error: string };

/** Compress + store one uploaded image. Returns the public URL the message will carry. */
export async function processWaImage(file: { name?: string | null; type?: string | null; data: Buffer }): Promise<WaProcessedImage> {
  const type = String(file.type || "").toLowerCase();
  const data = file.data;
  if (!data?.length) return { ok: false, error: "Empty file" };
  if (!ALLOWED.has(type)) return { ok: false, error: "Only JPG / PNG / WebP / AVIF / GIF images" };
  if (data.length > WA_IMAGE_MAX_UPLOAD) return { ok: false, error: "Image is larger than 25 MB" };

  let best: { buf: Buffer; width: number; height: number; quality: number; size: number } | null = null;
  try {
    for (let i = 0; i < SIZES.length; i++) {
      const quality = QUALITIES[Math.min(i, QUALITIES.length - 1)];
      const out = await sharp(new Uint8Array(data), { animated: false })
        .rotate() // honour EXIF orientation (phone photos)
        .resize({ width: SIZES[i], height: SIZES[i], fit: "inside", withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:2:0" })
        .toBuffer({ resolveWithObject: true });
      const cand = { buf: Buffer.from(out.data), width: out.info.width, height: out.info.height, quality, size: out.data.length };
      if (!best || cand.size < best.size) best = cand;
      if (cand.size <= WA_IMAGE_TARGET_BYTES) break;
      if (out.info.width <= 900 && i >= SIZES.length - 1) break;
    }
  } catch (e: any) {
    return { ok: false, error: "Image process korte parlam na: " + String(e?.message || e).slice(0, 120) };
  }
  if (!best) return { ok: false, error: "Image process failed" };

  try {
    const dir = waUploadDir();
    fs.mkdirSync(dir, { recursive: true });
    const name = `wa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.jpg`;
    fs.writeFileSync(path.join(dir, name), Uint8Array.from(best.buf));
    return {
      ok: true,
      url: `/${WA_UPLOAD_SUBDIR}/${name}`,
      width: best.width,
      height: best.height,
      bytes: best.size,
      originalBytes: data.length,
      quality: best.quality,
      resized: best.size < data.length,
      saved: Math.max(0, data.length - best.size),
    };
  } catch (e: any) {
    return { ok: false, error: "Image save korte parlam na: " + String(e?.message || e).slice(0, 120) };
  }
}

/** Remove an uploaded file — only inside our own upload folder, never a path from the request. */
export function deleteWaMedia(url: string): boolean {
  const u = String(url || "");
  const prefix = `/${WA_UPLOAD_SUBDIR}/`;
  if (!u.startsWith(prefix)) return false;
  const name = path.basename(u.slice(prefix.length));
  const dir = waUploadDir();
  const full = path.join(dir, name);
  /* basename() above already strips any directory component, so `name` cannot contain a
     separator — but compare against "dir + sep" rather than a bare prefix anyway. A bare
     startsWith(dir) would also accept a sibling like "…/uploads/wa-secrets", which is the
     usual way this check quietly stops being a check. */
  if (full !== dir && !full.startsWith(dir + path.sep)) return false;
  try { fs.rmSync(full, { force: true }); return true; } catch { return false; }
}

/** Human size for the UI ("1.4 MB → 380 KB, 72% kom"). */
export function waSizeText(bytes: number): string {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

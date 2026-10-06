/**
 * 图片表情包 — on-device file storage.
 *
 * Layout under <documentDirectory>/dudu-stickers/:
 *   <packId>/<fileName>   pack files (deleted with the pack)
 *   sent/<stable>         message-scoped copies — a sent bubble points here,
 *                         so deleting a pack never breaks history
 *                         (privio-messenger rule).
 *   ai/                   the AI library pack dir (seeded from the devil
 *                         mascot art via mascotUri, i.e. her own art —
 *                         nothing sourced from outside).
 *
 * PURE-ish module: expo-file-system is loaded lazily so this stays
 * importable in plain node tests (callers inject fakes there).
 */

import { isStickerImageFile } from "./types";

async function loadFs() {
  const mod = await import("expo-file-system/legacy");
  return mod as typeof import("expo-file-system/legacy");
}

export const STICKER_DIR_NAME = "dudu-stickers";
export const SENT_DIR_NAME = "sent";

async function baseDir(): Promise<string> {
  const fs = await loadFs();
  const base = fs.documentDirectory ?? fs.cacheDirectory ?? "";
  const dir = `${base}${STICKER_DIR_NAME}/`;
  const info = await fs.getInfoAsync(dir);
  if (!info.exists) await fs.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

export async function packDir(packId: string): Promise<string> {
  const fs = await loadFs();
  const dir = `${await baseDir()}${packId}/`;
  const info = await fs.getInfoAsync(dir);
  if (!info.exists) await fs.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

export async function sentDir(): Promise<string> {
  const fs = await loadFs();
  const dir = `${await baseDir()}${SENT_DIR_NAME}/`;
  const info = await fs.getInfoAsync(dir);
  if (!info.exists) await fs.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

/** Full file:// URI for a pack sticker (for <Image> source). */
export async function stickerFileUri(packId: string, fileName: string): Promise<string> {
  return `${await packDir(packId)}${fileName}`;
}

function stableName(srcUri: string): string {
  const ext = (srcUri.split(".").pop()?.toLowerCase() ?? "").split("?")[0];
  const safeExt = isStickerImageFile(`x.${ext}`) ? ext : "png";
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `st_${ts}_${rand}.${safeExt}`;
}

/**
 * Copy an image into a pack dir. Returns the stored fileName.
 * Best-effort: throws on failure so the caller can show an honest error
 * (adding a sticker that didn't save would be a lie).
 */
export async function addStickerFile(packId: string, srcUri: string): Promise<string> {
  const fs = await loadFs();
  const dir = await packDir(packId);
  const fileName = stableName(srcUri);
  await fs.copyAsync({ from: srcUri, to: `${dir}${fileName}` });
  return fileName;
}

/**
 * Copy-on-send: duplicate a pack file into the sent dir and return the new
 * URI to embed in the chat message. The bubble then survives pack deletion.
 * Best-effort: on failure the source URI is returned unchanged so sending
 * never breaks.
 */
export async function copyForSend(srcUri: string): Promise<string> {
  try {
    const fs = await loadFs();
    const dir = await sentDir();
    const dest = `${dir}${stableName(srcUri)}`;
    await fs.copyAsync({ from: srcUri, to: dest });
    return dest;
  } catch {
    return srcUri;
  }
}

/** Remove a pack's files (metadata is removed by the store). */
export async function deletePackFiles(packId: string): Promise<void> {
  try {
    const fs = await loadFs();
    await fs.deleteAsync(`${await baseDir()}${packId}/`, { idempotent: true });
  } catch {
    // Best-effort: orphaned files are harmless.
  }
}

/** Remove one sticker file from a pack dir. */
export async function deleteStickerFile(packId: string, fileName: string): Promise<void> {
  try {
    const fs = await loadFs();
    await fs.deleteAsync(`${await packDir(packId)}${fileName}`, { idempotent: true });
  } catch {
    // Best-effort.
  }
}

/**
 * Voice message audio files — stable, portable storage. (P2-5)
 *
 * The recorder hands back a temp/cache URI; the OS may purge it and it is
 * never part of a backup, so old voice bubbles go silent after a reinstall
 * or a move to a new device. Every voice message is copied here, into
 * `<documentDirectory>/dudu-voice-messages/<stable-name>.m4a`, before it is
 * sent — m4a plays everywhere expo-audio does.
 *
 * PURE module: expo-file-system is loaded lazily so this stays importable
 * in plain node tests.
 */

async function loadFs() {
  const mod = await import("expo-file-system/legacy");
  return mod as typeof import("expo-file-system/legacy");
}

/** Folder name under the app document directory. */
export const VOICE_MESSAGE_DIR_NAME = "dudu-voice-messages";

export async function voiceMessageDir(): Promise<string> {
  const fs = await loadFs();
  const base = fs.documentDirectory ?? fs.cacheDirectory ?? "";
  const dir = `${base}${VOICE_MESSAGE_DIR_NAME}/`;
  const info = await fs.getInfoAsync(dir);
  if (!info.exists) await fs.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

function stableName(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `vm_${ts}_${rand}.m4a`;
}

/**
 * Copy a just-recorded audio file into stable storage. Returns the new
 * file:// URI to embed in the chat message. Best-effort: on failure the
 * original URI is returned unchanged so sending never breaks.
 */
export async function persistVoiceMessage(srcUri: string): Promise<string> {
  try {
    const dir = await voiceMessageDir();
    const name = stableName();
    const dest = `${dir}${name}`;
    const fs = await loadFs();
    await fs.copyAsync({ from: srcUri, to: dest });
    return dest;
  } catch {
    return srcUri;
  }
}

/** File names (not full URIs) currently in stable storage. */
export async function listVoiceMessageFiles(): Promise<string[]> {
  try {
    const dir = await voiceMessageDir();
    const fs = await loadFs();
    const names = await fs.readDirectoryAsync(dir);
    return names.filter((n) => n.endsWith(".m4a"));
  } catch {
    return [];
  }
}

/** Read one stored voice file as base64 (for backup). Null on failure. */
export async function readVoiceMessageFile(name: string): Promise<string | null> {
  try {
    if (name.includes("/") || name.includes("\\") || name.startsWith(".")) return null;
    const dir = await voiceMessageDir();
    const fs = await loadFs();
    return await fs.readAsStringAsync(`${dir}${name}`, { encoding: "base64" });
  } catch {
    return null;
  }
}

/** Write one restored voice file (base64) into stable storage. */
export async function writeVoiceMessageFile(name: string, base64: string): Promise<boolean> {
  try {
    if (name.includes("/") || name.includes("\\") || name.startsWith(".")) return false;
    if (!/^[A-Za-z0-9+/=]+$/.test(base64)) return false;
    const dir = await voiceMessageDir();
    const fs = await loadFs();
    await fs.writeAsStringAsync(`${dir}${name}`, base64, { encoding: "base64" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Rewrite voice-message URIs inside chat message contents after a restore.
 * Backups store absolute file:// URIs; on a new device (or reinstall) the
 * document directory differs, so every `dudu-voice-messages/<name>` URI is
 * re-pointed at this device's stable directory. Pure string surgery — no
 * FS access needed.
 */
export function rewriteVoiceMessageUris(content: string, newDir: string): string {
  return content.replace(
    /file:\/\/[^"]*?dudu-voice-messages\//g,
    newDir.endsWith("/") ? newDir : `${newDir}/`,
  );
}

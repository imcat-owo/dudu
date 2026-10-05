/**
 * Long-paste → file — PURE module (no top-level React Native imports;
 * expo-file-system is loaded lazily so this stays importable in node tests).
 *
 * D7: When she pastes a huge chunk of text, don't jam it into the input
 * box — save it as a text file attachment instead. Keeps long context
 * from turning the chat into mush.
 *
 * The UI (chat.tsx) calls shouldConvertPaste(text) on paste; if true, it
 * saves via savePasteAsFile() and attaches the file instead of the text.
 */

const DEFAULT_THRESHOLD = 2000; // chars

type FileSystemModule = typeof import("expo-file-system/legacy");

async function loadFS(): Promise<FileSystemModule> {
  return (await import("expo-file-system/legacy")) as FileSystemModule;
}

export function shouldConvertPaste(text: string, threshold = DEFAULT_THRESHOLD): boolean {
  return text.length >= threshold;
}

export interface PasteFile {
  uri: string;
  name: string;
  size: number;
}

/** Save pasted text as a .txt file. Returns the file info for attaching. */
export async function savePasteAsFile(text: string): Promise<PasteFile> {
  const FileSystem = await loadFS();
  const dir = FileSystem.documentDirectory;
  if (!dir) throw new Error("No document directory");
  const pasteDir = `${dir}pastes/`;
  try {
    await FileSystem.makeDirectoryAsync(pasteDir, { intermediates: true });
  } catch {
    // exists
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const name = `paste-${stamp}.txt`;
  const uri = `${pasteDir}${name}`;
  await FileSystem.writeAsStringAsync(uri, text, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  const info = await FileSystem.getInfoAsync(uri);
  return {
    uri,
    name,
    size: info.exists && "size" in info ? (info.size as number) : text.length,
  };
}

/** Preview line for the attachment chip. */
export function pastePreview(text: string, maxLen = 120): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > maxLen ? oneLine.slice(0, maxLen) + "…" : oneLine;
}

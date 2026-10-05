/**
 * H7 — Files.app integration (TS side).
 *
 * The native FileProvider extension (see plugins/dudu-platform/fileprovider/)
 * exposes the app's shared file directory in the system Files app.
 * This module is the TS side: publish files into the shared container so
 * they appear in Files.app, and list what's published.
 *
 * Uses the `DuduSharedData` native module for the shared container path.
 * Falls back gracefully when unavailable.
 */

import { getNativeModule } from "./types";

export interface PublishedFile {
  name: string;
  path: string;
  size: number;
  modifiedAt: number;
}

interface FileSystemModule {
  copyAsync(options: { from: string; to: string }): Promise<void>;
  readDirectoryAsync(path: string): Promise<string[]>;
  getInfoAsync(path: string): Promise<{
    exists: boolean;
    isDirectory: boolean;
    size?: number;
    modificationTime?: number;
  }>;
}

function loadFS(): FileSystemModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const req = (typeof require !== "undefined" ? require : null) as
      | ((id: string) => unknown)
      | null;
    if (!req) return null;
    return req("expo-file-system") as FileSystemModule;
  } catch {
    return null;
  }
}

async function loadSharedModule(): Promise<{
  getSharedFileDir(): Promise<string | null>;
} | null> {
  return getNativeModule<{
    getSharedFileDir(): Promise<string | null>;
  }>("DuduSharedData");
}

/** Absolute path of the shared container's file directory, or null. */
export async function getSharedFileDir(): Promise<string | null> {
  const mod = await loadSharedModule();
  if (!mod) return null;
  try {
    return await mod.getSharedFileDir();
  } catch {
    return null;
  }
}

/**
 * Publish a file (by absolute path) into the Files.app-visible directory.
 * Returns the published path, or null when the native side is missing.
 */
export async function publishToFilesApp(sourcePath: string, fileName: string): Promise<string | null> {
  const dir = await getSharedFileDir();
  if (!dir) return null;
  const FS = loadFS();
  if (!FS) return null;
  try {
    const dest = `${dir}/${fileName}`;
    await FS.copyAsync({ from: sourcePath, to: dest });
    return dest;
  } catch {
    return null;
  }
}

/** List files currently visible in Files.app via our provider. */
export async function listPublishedFiles(): Promise<PublishedFile[]> {
  const dir = await getSharedFileDir();
  if (!dir) return [];
  const FS = loadFS();
  if (!FS) return [];
  try {
    const names = await FS.readDirectoryAsync(dir);
    const out: PublishedFile[] = [];
    for (const name of names) {
      try {
        const info = await FS.getInfoAsync(`${dir}/${name}`);
        if (info.exists && !info.isDirectory) {
          out.push({
            name,
            path: `${dir}/${name}`,
            size: info.size ?? 0,
            modifiedAt: (info.modificationTime ?? 0) * 1000,
          });
        }
      } catch {
        /* skip unreadable entries */
      }
    }
    return out.sort((a, b) => b.modifiedAt - a.modifiedAt);
  } catch {
    return [];
  }
}

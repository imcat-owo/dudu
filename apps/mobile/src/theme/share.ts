/**
 * Theme pack import/export — pure logic (theme-design.md §7).
 *
 * The share format is the ThemeBundle JSON itself:
 *   { "kind": "dudu-theme-bundle", "version": 1, ... }
 * Unknown fields are ignored on import (forward compatibility);
 * the version is checked and rejected loudly when unsupported.
 *
 * Error codes are mapped to i18n strings by the UI ("theme.share.*").
 */

import { isThemeBundle, type ThemeBundle } from "./types";

export type ImportErrorCode = "empty" | "not-json" | "invalid-bundle";

export type ImportResult =
  | { ok: true; bundle: ThemeBundle }
  | { ok: false; code: ImportErrorCode; detail?: string };

/** Serialize a bundle for sharing (clipboard / share sheet / QR). */
export function exportBundleJson(bundle: ThemeBundle): string {
  return JSON.stringify(bundle);
}

/**
 * Parse pasted/scanned text into a ThemeBundle.
 * Fails loudly with a machine-readable code — never silently accepts.
 */
export function parseImportBundle(text: string): ImportResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, code: "empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return {
      ok: false,
      code: "not-json",
      detail: e instanceof Error ? e.message : undefined,
    };
  }
  if (!isThemeBundle(parsed)) {
    // Give a slightly more helpful detail when kind/version are the problem.
    const o = parsed as Record<string, unknown>;
    const detail =
      o.kind !== "dudu-theme-bundle"
        ? `kind=${JSON.stringify(o.kind)}`
        : `version=${JSON.stringify(o.version)}`;
    return { ok: false, code: "invalid-bundle", detail };
  }
  return { ok: true, bundle: parsed };
}

/**
 * QR capacity guard. A version-40 QR code in byte mode holds ~2953 bytes;
 * stay well under it so the code stays scannable.
 */
export const QR_MAX_BYTES = 2400;

export function bundleFitsQr(json: string): boolean {
  return new TextEncoder().encode(json).length <= QR_MAX_BYTES;
}

/**
 * Local file:// image URIs (wallpaper/avatar picked on this device) are
 * meaningless on another device. Strip them on export with a flag so the
 * UI can tell the user honestly what didn't travel.
 */
export function stripLocalUris(bundle: ThemeBundle): { bundle: ThemeBundle; stripped: string[] } {
  const stripped: string[] = [];
  const next: ThemeBundle = { ...bundle };
  if (next.wallpaper?.uri.startsWith("file://")) {
    stripped.push("wallpaper");
    delete next.wallpaper;
  }
  if (next.avatar) {
    const avatar = { ...next.avatar };
    if (avatar.user?.startsWith("file://")) {
      stripped.push("avatar.user");
      delete avatar.user;
    }
    if (avatar.assistant?.startsWith("file://")) {
      stripped.push("avatar.assistant");
      delete avatar.assistant;
    }
    next.avatar = avatar;
  }
  return { bundle: next, stripped };
}

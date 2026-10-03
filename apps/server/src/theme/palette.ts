/**
 * Dominant-color extraction from an image URL (theme-design.md §3
 * extract_palette_from_image). Pure-JS decoders (pngjs, jpeg-js) —
 * no native deps. Honest failures: unsupported formats (webp/gif),
 * oversized files and fetch errors are reported, never faked.
 */

import jpeg from "jpeg-js";
import { PNG } from "pngjs";

const MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;

export type PaletteResult =
  | { ok: true; dominant: string; palette: string[]; suggestedText: string }
  | { ok: false; error: string };

function toHex(r: number, g: number, b: number): string {
  const to = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 0xff) + 0.7152 * ch((n >> 8) & 0xff) + 0.0722 * ch(n & 0xff);
}

function decode(
  bytes: Buffer,
  contentType: string,
): { data: Buffer | Uint8Array; width: number; height: number } | null {
  const ct = contentType.toLowerCase();
  try {
    if (ct.includes("png")) {
      const png = PNG.sync.read(bytes);
      return { data: png.data, width: png.width, height: png.height };
    }
    if (ct.includes("jpeg") || ct.includes("jpg")) {
      const jpg = jpeg.decode(bytes, { maxMemoryUsageInMB: 64 });
      return { data: jpg.data, width: jpg.width, height: jpg.height };
    }
  } catch {
    return null;
  }
  return null;
}

export async function extractPalette(imageUrl: string): Promise<PaletteResult> {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    return { ok: false, error: `Not a valid URL: ${imageUrl}` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only http(s) image URLs are supported (local file URIs cannot be fetched server-side)" };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return { ok: false, error: `Image fetch failed: HTTP ${res.status}` };
    const contentType = res.headers.get("content-type") ?? "";
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) return { ok: false, error: "Image too large (max 5MB)" };
    const decoded = decode(bytes, contentType);
    if (!decoded) {
      return { ok: false, error: `Unsupported image format (${contentType || "unknown"}) — PNG and JPEG are supported` };
    }
    const { data, width, height } = decoded;
    // Downsample: sample at most ~4096 pixels on a grid.
    const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 4096)));
    const bins = new Map<string, { count: number; r: number; g: number; b: number }>();
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const i = (y * width + x) * 4;
        const a = data[i + 3];
        if (a < 128) continue; // skip transparent
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        // 4 bits per channel → 4096 bins.
        const key = `${r >> 4},${g >> 4},${b >> 4}`;
        const bin = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
        bin.count += 1;
        bin.r += r;
        bin.g += g;
        bin.b += b;
        bins.set(key, bin);
      }
    }
    if (bins.size === 0) return { ok: false, error: "No opaque pixels found" };
    const sorted = [...bins.values()].sort((a, b) => b.count - a.count);
    // Take top bins, skipping near-duplicates of already chosen colors.
    const chosen: string[] = [];
    for (const bin of sorted) {
      const hex = toHex(bin.r / bin.count, bin.g / bin.count, bin.b / bin.count);
      const duplicate = chosen.some((c) => {
        const n1 = Number.parseInt(c.slice(1), 16);
        const n2 = Number.parseInt(hex.slice(1), 16);
        const dr = ((n1 >> 16) & 255) - ((n2 >> 16) & 255);
        const dg = ((n1 >> 8) & 255) - ((n2 >> 8) & 255);
        const db = (n1 & 255) - (n2 & 255);
        return Math.sqrt(dr * dr + dg * dg + db * db) < 48;
      });
      if (!duplicate) chosen.push(hex);
      if (chosen.length >= 5) break;
    }
    const dominant = chosen[0];
    // Suggest readable text: dark text on light dominant, light text on dark.
    const suggestedText = luminance(dominant) > 0.4 ? "#1a1d21" : "#f5f2ec";
    return { ok: true, dominant, palette: chosen, suggestedText };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Image fetch failed" };
  } finally {
    clearTimeout(timer);
  }
}

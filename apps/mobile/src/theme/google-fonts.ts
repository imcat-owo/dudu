/**
 * Google Fonts downloadable picker — PURE module (no RN imports).
 *
 * Learned from Kelivo's google_fonts_service.dart: the catalog is the
 * expo/google-fonts directory-data.json (a static JSON on GitHub, no API
 * key needed). We download the TTF and hand the bytes to the caller, which
 * saves it via expo-file-system and registers with expo-font.
 *
 * The catalog is ~8MB; we fetch it once and cache the parsed list.
 */

/** One font in the catalog. */
export interface GoogleFontEntry {
  family: string;
  /** Direct TTF/OTF URL (latin subset, regular 400). */
  url: string;
  /** Subsets, e.g. ["latin", "latin-ext", "chinese-simplified"]. */
  subsets: string[];
}

/** Minimal fetch surface. */
export interface FontFetch {
  (url: string): Promise<Response>;
}

/** Minimal cache KV. */
export interface FontCacheKV {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const CATALOG_URL =
  "https://raw.githubusercontent.com/expo/google-fonts/main/packages/generator/data/directory-data.json";
const CATALOG_CACHE_KEY = "dudu.fonts.v1.catalog";
const CATALOG_CACHE_TTL = 7 * 24 * 3600 * 1000; // 7 days

/** Parse the expo directory-data.json into font entries. */
export function parseFontCatalog(json: unknown): GoogleFontEntry[] {
  const data = json as Record<string, unknown>;
  const entries: GoogleFontEntry[] = [];
  for (const [family, info] of Object.entries(data)) {
    const o = info as Record<string, unknown>;
    // The catalog has variants; we want the regular latin TTF.
    const variants = o.variants as Record<string, unknown> | undefined;
    const regular = variants?.regular as Record<string, unknown> | undefined;
    // Try latin subset first, fall back to any.
    const subsets = (o.subsets as string[] | undefined) ?? [];
    let url: string | null = null;
    if (regular) {
      const latin = (regular.latin as Record<string, unknown> | undefined)?.url;
      if (typeof latin === "string") url = latin;
      else {
        // Fall back to the first available URL.
        for (const v of Object.values(regular)) {
          const u = (v as Record<string, unknown>)?.url;
          if (typeof u === "string") {
            url = u;
            break;
          }
        }
      }
    }
    if (!url) continue;
    entries.push({ family, url, subsets });
  }
  return entries.sort((a, b) => a.family.localeCompare(b.family));
}

/** Fetch the catalog (with 7-day cache). */
export async function fetchFontCatalog(
  kv: FontCacheKV,
  fetchFn: FontFetch = fetch,
  now: number = Date.now(),
): Promise<GoogleFontEntry[]> {
  try {
    const cached = await kv.getItem(CATALOG_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as { at: number; entries: GoogleFontEntry[] };
      if (now - parsed.at < CATALOG_CACHE_TTL && parsed.entries.length > 0) {
        return parsed.entries;
      }
    }
  } catch {
    // fall through to fetch
  }
  const res = await fetchFn(CATALOG_URL);
  if (!res.ok) throw new Error(`font-catalog-failed:${res.status}`);
  const json = await res.json();
  const entries = parseFontCatalog(json);
  try {
    await kv.setItem(CATALOG_CACHE_KEY, JSON.stringify({ at: now, entries }));
  } catch {
    // cache is best-effort
  }
  return entries;
}

/** Search the catalog by family name prefix. */
export function searchFonts(entries: GoogleFontEntry[], query: string): GoogleFontEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries.slice(0, 50);
  return entries.filter((e) => e.family.toLowerCase().includes(q)).slice(0, 50);
}

/** Download a font file. Returns the bytes. */
export async function downloadFont(entry: GoogleFontEntry, fetchFn: FontFetch = fetch): Promise<Uint8Array> {
  const res = await fetchFn(entry.url);
  if (!res.ok) throw new Error(`font-download-failed:${res.status}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 64 * 1024 * 1024) throw new Error("font-too-large");
  if (buf.byteLength === 0) throw new Error("font-empty");
  return new Uint8Array(buf);
}

/** Suggest a filename for the downloaded font. */
export function fontFilename(entry: GoogleFontEntry): string {
  const safe = entry.family
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  const ext = entry.url.toLowerCase().endsWith(".otf") ? "otf" : "ttf";
  return `google-${safe}.${ext}`;
}

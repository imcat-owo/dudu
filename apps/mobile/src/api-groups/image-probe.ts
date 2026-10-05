/**
 * B17: image endpoint probing — find where this provider draws pictures.
 *
 * Some providers serve image generation on a different path than chat
 * (`/images/generations` on OpenAI-compatible gateways, `/v1/images`
 * elsewhere). Instead of making her guess the URL, we probe the
 * common candidates and remember which one answered.
 *
 * Probing is a HEAD-ish GET — it never generates an image, it only
 * checks the route exists (a 404/405 means "wrong door", anything
 * else means "something lives here").
 */

import type { ApiGroup } from "./types";
import { resolveAuth } from "./direct-transport";
import { normalizeBaseUrl } from "./types";

export interface ImageEndpointProbe {
  path: string;
  /** Full URL that answered. */
  url: string;
  /** true = the route exists (didn't 404). */
  reachable: boolean;
  status: number | null;
  note: string;
}

/** Candidate image-generation paths, most common first. */
export const IMAGE_PATH_CANDIDATES = [
  "/images/generations",
  "/v1/images/generations",
  "/images",
  "/v1/images",
];

/**
 * Probe candidate image endpoints for a group. Returns one entry per
 * candidate, in order. Stops early on the first reachable route.
 */
export async function probeImageEndpoints(group: ApiGroup): Promise<ImageEndpointProbe[]> {
  const base = normalizeBaseUrl(group.baseUrl);
  let auth: { headers: Record<string, string> };
  try {
    auth = await resolveAuth(group);
  } catch {
    auth = { headers: { "Content-Type": "application/json" } };
  }
  const results: ImageEndpointProbe[] = [];
  for (const path of IMAGE_PATH_CANDIDATES) {
    const url = `${base}${path}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      // GET on a POST-only route returns 405 = "route exists".
      const res = await fetch(url, { method: "GET", headers: auth.headers, signal: ctrl.signal });
      const reachable = res.status !== 404;
      results.push({
        path,
        url,
        reachable,
        status: res.status,
        note: reachable ? "route answered" : "not found here",
      });
      if (reachable) break;
    } catch {
      results.push({ path, url, reachable: false, status: null, note: "network error" });
    } finally {
      clearTimeout(timer);
    }
  }
  return results;
}

/**
 * Extract image URLs from a chat response that embeds them
 * (some gateways return images as markdown / data URLs in content).
 * Pure — safe to run on any reply text.
 */
export function extractImageUrls(text: string): string[] {
  const out: string[] = [];
  const md = /!\[[^\]]*\]\((https?:\/\/[^)\s]+|data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = md.exec(text)) !== null) out.push(m[1]);
  const bare = /\bhttps?:\/\/[^\s)"']+\.(?:png|jpe?g|webp|gif)\b/gi;
  while ((m = bare.exec(text)) !== null) {
    if (!out.includes(m[0])) out.push(m[0]);
  }
  return out;
}

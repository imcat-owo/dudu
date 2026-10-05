/**
 * B12: share / import provider configs via QR code or text.
 *
 * Learned from Kelivo's share_provider_sheet.dart: the config serializes
 * to `ai-provider:v1:<base64(json)>`. We use our own prefix
 * `dudu-provider:v1:` so the two are never confused.
 *
 * SECURITY: the payload contains the API key in plaintext (that's the
 * point — move a working config to another phone). The UI must show an
 * explicit warning before displaying the QR. Importing validates the
 * shape and never executes anything.
 */

import type { ApiGroup } from "./types";
import { blankGroup, newApiGroupId } from "./types";

export const SHARE_PREFIX = "dudu-provider:v1:";

export interface SharedProviderPayload {
  v: 1;
  name: string;
  vendor: ApiGroup["vendor"];
  baseUrl: string;
  apiKey: string;
  model: string;
  headers: Record<string, string>;
  /** Present when the sharer included their key pool. */
  apiKeys?: Array<{ name: string; key: string; priority: number }>;
  exportedAt: number;
}

export function encodeShare(group: ApiGroup, includeKeys: boolean): string {
  const payload: SharedProviderPayload = {
    v: 1,
    name: group.name,
    vendor: group.vendor,
    baseUrl: group.baseUrl,
    apiKey: includeKeys ? (group.apiKey ?? "") : "",
    model: group.model,
    headers: includeKeys ? group.headers : {},
    exportedAt: Date.now(),
  };
  if (includeKeys && group.apiKeys?.length) {
    payload.apiKeys = group.apiKeys.map((k) => ({
      name: k.name,
      key: k.key,
      priority: k.priority,
    }));
  }
  const json = JSON.stringify(payload);
  const b64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(json, "utf8").toString("base64")
      : btoa(
          encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_m, hex) =>
            String.fromCharCode(parseInt(hex, 16)),
          ),
        );
  return `${SHARE_PREFIX}${b64}`;
}

function b64ToUtf8(b64: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(b64, "base64").toString("utf8");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Parse a shared payload. Returns null when the text isn't ours. Pure. */
export function decodeShare(text: string): SharedProviderPayload | null {
  const t = text.trim();
  if (!t.startsWith(SHARE_PREFIX)) return null;
  try {
    const payload = JSON.parse(b64ToUtf8(t.slice(SHARE_PREFIX.length))) as SharedProviderPayload;
    if (
      typeof payload !== "object" ||
      payload === null ||
      payload.v !== 1 ||
      typeof payload.baseUrl !== "string" ||
      typeof payload.model !== "string"
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/** Turn a shared payload into an ApiGroup draft (new id, unvalidated). */
export function payloadToGroup(payload: SharedProviderPayload): ApiGroup {
  const g = blankGroup(payload.vendor === "anthropic" || payload.vendor === "gemini" ? "custom" : payload.vendor);
  g.id = newApiGroupId();
  g.name = payload.name || "导入的配置";
  g.baseUrl = payload.baseUrl;
  g.apiKey = payload.apiKey;
  g.model = payload.model;
  g.headers = payload.headers ?? {};
  g.bodyExtras = {};
  g.createdAt = Date.now();
  return g;
}

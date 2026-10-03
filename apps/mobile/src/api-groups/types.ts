/**
 * API group model — one named connection to a model backend.
 *
 * A group is everything needed to talk to a chat model directly from the
 * phone: base URL + key + model name (+ optional extra headers for
 * proxies/gateways). The user fills these in herself; nothing is
 * pre-provisioned and nothing ever enters the repo (open source) — groups
 * live in expo-secure-store via ./store.ts.
 *
 * v1 wire format: OpenAI-compatible `/chat/completions` (SSE). Vendor
 * presets below only fill in base URLs — native Anthropic/Gemini wire
 * formats are deliberately deferred (see direct-transport.ts).
 */

export type ApiVendor = "openai" | "anthropic" | "gemini" | "custom";

export interface ApiGroup {
  /** Stable id, generated on creation. */
  id: string;
  /** User-visible name, e.g. "主力", "备用". */
  name: string;
  /** Which preset tab created it — informational only in v1. */
  vendor: ApiVendor;
  /** Base URL, e.g. https://api.openai.com/v1 (no trailing slash). */
  baseUrl: string;
  /** Secret. Stored in SecureStore, never logged, never in repo. Optional:
   * keyless local endpoints (Ollama-style) don't need one — no Authorization
   * header is sent when absent. */
  apiKey?: string;
  /** Model name sent as `model` in the request body. */
  model: string;
  /** Extra HTTP headers (for proxies/gateways). Values are secrets too. */
  headers: Record<string, string>;
  /** Unix ms of creation — used for stable list ordering. */
  createdAt: number;
}

export interface ApiVendorPreset {
  vendor: ApiVendor;
  label: string;
  baseUrl: string;
  placeholderModel: string;
}

/**
 * Kelivo-style vendor tabs: presets fill the form, they don't lock it.
 * The user can always edit the URL after picking a preset.
 */
export const VENDOR_PRESETS: ApiVendorPreset[] = [
  {
    vendor: "openai",
    label: "OpenAI 兼容",
    baseUrl: "https://api.openai.com/v1",
    placeholderModel: "gpt-4o-mini",
  },
  {
    vendor: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    placeholderModel: "claude-sonnet-4-20250514",
  },
  {
    vendor: "gemini",
    label: "Google",
    baseUrl: "https://generativelanguage.googleapis.com",
    placeholderModel: "gemini-2.0-flash",
  },
  {
    vendor: "custom",
    label: "自定义",
    baseUrl: "",
    placeholderModel: "model-name",
  },
];

export function newApiGroupId(): string {
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function blankGroup(vendor: ApiVendor = "custom"): ApiGroup {
  const preset = VENDOR_PRESETS.find((p) => p.vendor === vendor) ?? VENDOR_PRESETS[3];
  return {
    id: newApiGroupId(),
    name: "",
    vendor,
    baseUrl: preset.baseUrl,
    apiKey: "",
    model: "",
    headers: {},
    createdAt: Date.now(),
  };
}

/** User-facing validation — returns the first problem, or null when valid. */
export function validateGroup(
  g: Pick<ApiGroup, "name" | "baseUrl" | "apiKey" | "model">,
): string | null {
  if (!g.name.trim()) return "nameRequired";
  const url = g.baseUrl.trim().replace(/\/$/, "");
  if (!url) return "baseUrlRequired";
  if (!/^https?:\/\//i.test(url)) return "baseUrlInvalid";
  if (!g.model.trim()) return "modelRequired";
  return null;
}

export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

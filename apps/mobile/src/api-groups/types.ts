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

/** Feature switch: "auto" = optimistic ON, downgrade only when proven. */
export type FeatureSwitch = "on" | "off" | "auto";

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
  /**
   * Embedding model for the knowledge base (`/v1/embeddings`). Optional —
   * defaults to `text-embedding-3-small` when unset.
   */
  embeddingModel?: string;
  /** Extra HTTP headers (for proxies/gateways). Values are secrets too. */
  headers: Record<string, string>;
  /** Unix ms of creation — used for stable list ordering. */
  createdAt: number;
  /**
   * Vision (image understanding) config. Optional — when absent, the group
   * is treated as text-only and image attaches fail loudly with guidance.
   */
  vision?: VisionConfig;
  /**
   * Feature switches. "auto" (default) = optimistic: tools+thinking ON,
   * auto-downgrade only when proven unsupported (see model-profiles.ts).
   * "on"/"off" = her manual override, always respected.
   */
  toolsMode?: FeatureSwitch;
  thinkingMode?: FeatureSwitch;
}

/**
 * How this group sees images.
 * - native: the chat model itself accepts images (OpenAI `image_url`
 *   content blocks) — zero extra calls.
 * - otherwise: images go through the describe pipeline (4-part prompt) to
 *   `model` (defaults to the group's chat model), and the description is
 *   fed to the chat model as text.
 */
export interface VisionConfig {
  native: boolean;
  /** Vision model override. Defaults to the group's chat `model`. */
  model?: string;
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
/**
 * Vendor presets for the group editor tabs.
 *
 * Only OpenAI-compatible endpoints are offered (P1-7): the transport
 * (direct-transport.ts) always speaks the OpenAI wire format
 * (POST {baseUrl}/chat/completions, Authorization: Bearer). Native
 * Anthropic/Gemini formats are deliberately deferred (see types.ts note),
 * so offering those tabs let her paste a real key into a guaranteed
 * failure — the tabs are removed until native formats land.
 * The ApiVendor type still includes "anthropic"/"gemini" for stored groups.
 */
const CUSTOM_PRESET: ApiVendorPreset = {
  vendor: "custom",
  label: "自定义",
  baseUrl: "",
  placeholderModel: "model-name",
};

export const VENDOR_PRESETS: ApiVendorPreset[] = [
  {
    vendor: "openai",
    label: "OpenAI 兼容",
    baseUrl: "https://api.openai.com/v1",
    placeholderModel: "gpt-4o-mini",
  },
  CUSTOM_PRESET,
];

export function newApiGroupId(): string {
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function blankGroup(vendor: ApiVendor = "custom"): ApiGroup {
  const preset = VENDOR_PRESETS.find((p) => p.vendor === vendor) ?? CUSTOM_PRESET;
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

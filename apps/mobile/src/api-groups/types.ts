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

/** B2: key rotation strategy for a group's key pool. */
export type KeyRotationStrategy = "roundRobin" | "priority" | "leastUsed" | "random";

/** One API key inside a group's pool (B2). The key itself is a secret. */
export interface ApiKeyEntry {
  id: string;
  /** User label, e.g. "主号". */
  name: string;
  /** Secret — SecureStore, never logged. */
  key: string;
  /** 1–10, smaller = higher priority (priority strategy). */
  priority: number;
  enabled: boolean;
  /** Consecutive failures; auto-disabled at the threshold. */
  consecutiveFailures: number;
  /** Total successful requests (leastUsed strategy). */
  totalRequests: number;
  /** Unix ms when auto-disabled; null when healthy. */
  disabledUntil: number | null;
  lastError: string | null;
  createdAt: number;
}

/** B7: prompt caching (server-side when the endpoint supports it). */
export interface CachingConfig {
  enabled: boolean;
}

/** B11: sampling parameters. Null = don't send, use the vendor default. */
export interface SamplingConfig {
  temperature: number | null;
  topP: number | null;
  maxTokens: number | null;
}

/** B10: vendor-native tools. "auto" = offer when the vendor is known to support it. */
export interface NativeToolsConfig {
  webSearch: FeatureSwitch;
  codeExecution: FeatureSwitch;
  imageGeneration: FeatureSwitch;
}

/** B14: Azure OpenAI mode — full deployment URL + api-version. */
export interface AzureConfig {
  enabled: boolean;
  /** e.g. https://xxx.openai.azure.com/openai/deployments/gpt-4o */
  deploymentUrl: string;
  /** e.g. 2024-10-01-preview */
  apiVersion: string;
}

/** B3: balance query config. */
export interface BalanceConfig {
  enabled: boolean;
  /** Path appended to baseUrl, e.g. /dashboard/billing/credit_grants */
  apiPath: string;
  /** Dot path into the JSON result, e.g. total_available */
  resultPath: string;
}

/** B5: proxy config. NOTE (honest): iOS React Native fetch/XHR uses the
 * system network stack — per-app proxy cannot be applied. This type is
 * intentionally NOT wired anywhere; see the B5 note in the batch report. */
export interface ProxyConfig {
  enabled: boolean;
  type: "http" | "https" | "socks5";
  host: string;
  port: number;
  username?: string;
  password?: string;
}

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
  /**
   * B6: extra top-level body fields merged into every chat request
   * (after the built-ins). For gateways that need custom parameters.
   */
  bodyExtras?: Record<string, unknown>;
  /** B15: custom User-Agent override. When empty, the default is sent. */
  userAgent?: string;
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
  // ---- Batch 2 (gap B) extensions — all optional, all backward compatible ----
  /** B2: key pool. When non-empty, the legacy `apiKey` is ignored. */
  apiKeys?: ApiKeyEntry[];
  keyRotation?: KeyRotationStrategy;
  /** B2: consecutive failures before a key is auto-disabled (default 3). */
  keyAutoDisableAfter?: number;
  /** B2: minutes before an auto-disabled key is retried (default 5). */
  keyRecoverAfterMinutes?: number;
  /** B1: OAuth account id (see oauth.ts). When set, the access token is used. */
  oauthAccountId?: string;
  /** B3: balance query. */
  balance?: BalanceConfig;
  /** B4: user-defined grouping tag (her own categories, separate from capability auto-groups). */
  userGroup?: string;
  /** B7: prompt caching. */
  caching?: CachingConfig;
  /** B11: sampling parameters. */
  sampling?: SamplingConfig;
  /** B10: vendor-native tools. */
  nativeTools?: NativeToolsConfig;
  /** B14: Azure OpenAI mode. */
  azure?: AzureConfig;
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
    bodyExtras: {},
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

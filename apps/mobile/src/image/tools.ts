/**
 * AI image generation tools — let the AI draw on its own ("画个logo").
 * PURE module: no top-level React Native / expo imports (expo-file-system
 * is dynamically imported inside run only when a backend returns b64).
 *
 * Backend chain (output-type = tool backend, vision doc §1):
 *  1. Her image_output capability group — ordered members, OpenAI-compatible
 *     POST {base}/images/generations. First success wins.
 *  2. Pollinations.ai (free, no API key) — the pre-existing default.
 * No silent failure: if everything fails, the tool throws loudly and the
 * AI says so honestly (no fake image).
 *
 * Display follows the /img convention: the AI outputs the encodeImageMessage
 * JSON as its message content and chat.tsx renders it as an image bubble.
 *
 * Tool naming follows the existing local-tools convention (snake_case,
 * human-language descriptions written FOR the AI).
 */
import { type LocalTool, ToolError } from "../api-groups/local-tools.js";
import { buildImageUrl, encodeImageMessage } from "./protocol.js";

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

/**
 * An image-output backend borrowed from her image_output capability group.
 * baseUrl is usually the ApiGroup's base URL; a member-level endpoint can
 * override it with the FULL generations URL. tryBackendImage appends the
 * standard /images/generations path only when it isn't already there.
 */
export interface ImageOutputBackend {
  name: string;
  baseUrl: string;
  apiKey?: string;
  headers: Record<string, string>;
  model: string;
}

/** Independent timeout for image generation (OpenClaw uses 180s). */
const IMAGE_TIMEOUT_MS = 180000;

/**
 * Timeout for verifying the free-backend URL resolves to a real image.
 * The first request triggers generation server-side, so this must allow
 * enough time for a render — but a dead/blocked backend fails fast with
 * a 4xx/5xx, which is what we're guarding against.
 */
const VERIFY_TIMEOUT_MS = 60000;

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

/**
 * The Pollinations URL is pure string concatenation — nothing confirms the
 * backend actually rendered anything. Fetch the first byte: 200/206 means
 * the image exists, anything else (or a timeout) means the AI must NOT
 * announce success. This also warms the server-side cache, so the chat
 * bubble's subsequent fetch is fast.
 */
async function verifyPollinationsUrl(url: string): Promise<void> {
  const { signal, done } = withTimeout(VERIFY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      signal,
    });
    if (res.status !== 200 && res.status !== 206) {
      throw new Error(`free backend returned HTTP ${res.status}`);
    }
    try {
      await res.body?.cancel?.();
    } catch {
      // body cleanup is best-effort; the status already told us what we need
    }
  } catch (e) {
    if (e instanceof Error && /HTTP \d+/.test(e.message)) throw e;
    const aborted = (e as { name?: string } | null)?.name === "AbortError";
    throw new Error(
      aborted
        ? `free backend timed out after ${VERIFY_TIMEOUT_MS / 1000}s`
        : `free backend unreachable: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    done();
  }
}

/** P3-16: sniff the image format from the base64 magic prefix so the cache
 * file gets the right extension (b64 from a backend isn't always PNG). */
function sniffImageExt(b64: string): string {
  if (b64.startsWith("iVBORw0KGgo")) return "png";
  if (b64.startsWith("/9j/")) return "jpg";
  if (b64.startsWith("UklGR")) return "webp";
  if (b64.startsWith("R0lGOD") || b64.startsWith("R0lGOT")) return "gif";
  return "png";
}

async function tryBackendImage(backend: ImageOutputBackend, prompt: string): Promise<string> {  const base = backend.baseUrl.trim().replace(/\/+$/, "");
  // A member endpoint may already be the full generations URL.
  const url = base.endsWith("/images/generations") ? base : `${base}/images/generations`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = (backend.apiKey ?? "").trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  const { signal, done } = withTimeout(IMAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...headers, ...backend.headers },
      body: JSON.stringify({ model: backend.model, prompt, n: 1 }),
      signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 200);
      try {
        const p = JSON.parse(text) as { error?: { message?: string } | string };
        if (typeof p.error === "string") detail = p.error;
        else if (p.error?.message) detail = p.error.message;
      } catch {
        // keep raw slice
      }
      throw new Error(`HTTP ${res.status}: ${detail}`);
    }
    const parsed = JSON.parse(text) as {
      data?: Array<{ url?: string; b64_json?: string }>;
    };
    const first = parsed.data?.[0];
    if (first?.url) return first.url;
    if (first?.b64_json) {
      // Save b64 to a cache file so chat can render it like any image.
      const FileSystem = await import("expo-file-system/legacy");
      // P3-16: random suffix against same-millisecond collisions; sniff the
      // real extension from the base64 magic prefix instead of hardcoding .png.
      const nonce = Math.random().toString(36).slice(2, 10);
      const path = `${FileSystem.cacheDirectory}dudu-gen-${Date.now()}-${nonce}.${sniffImageExt(first.b64_json)}`;
      await FileSystem.writeAsStringAsync(path, first.b64_json, { encoding: "base64" });
      return path;
    }
    throw new Error("empty result");
  } finally {
    done();
  }
}

export interface ImageToolOptions {
  /**
   * Resolve her image_output capability group members (ordered) into
   * backends. Called fresh on every run so group edits apply immediately.
   * Return empty array when she hasn't configured any — Pollinations
   * remains the fallback.
   */
  resolveBackends?: () => ImageOutputBackend[];
  /**
   * Verify the free-backend URL resolves before the tool claims success.
   * Injectable so tests don't hit the network; defaults to a real
   * range-GET check.
   */
  verifyImageUrl?: (url: string) => Promise<void>;
  /**
   * product P1 (信息断层): called after EVERY successful generation with
   * the final prompt + URL. The app wires this to the works drawer so
   * generated images don't die in chat history. Never throws — the tool
   * catches hook failures internally.
   */
  onImageGenerated?: (info: { prompt: string; url: string; via: string }) => Promise<void>;
}

/**
 * Build the AI image tool set. No store needed — generation is stateless.
 */
export function createImageTools(opts?: ImageToolOptions): LocalTool[] {
  // product P1: the works drawer is where generated images live on.
  // Persistence failures must never break the image result itself.
  const notifyGenerated = async (prompt: string, url: string, via: string): Promise<void> => {
    try {
      await opts?.onImageGenerated?.({ prompt, url, via });
    } catch {
      // best effort
    }
  };
  return [
    {
      name: "generate_image",
      description:
        "Generate an image from a text prompt. Tries her configured image models first, falls back to a free backend. Use when she asks you to draw, make, or create an image — or when a picture would genuinely delight her in the moment. Write the prompt in English and be specific: subject, style, colors, composition, mood. The optional style hint is appended to the prompt (e.g. 'cute chibi style, soft pastel colors'). IMPORTANT — showing it to her: after calling, output EXACTLY the image_message JSON from the result as your entire next message (no other text, no code fences). It renders as an image bubble in chat. The image is ALSO automatically saved to the works drawer in Our Space (作品小抽屉) — mention it so she knows where to find it later. To iterate on a picture (\"把刚才那张改成蓝色的\"), call generate_image again with the FULL refined prompt — describe the whole image again with the change applied, never just the delta.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "Detailed image prompt in English. Be specific: subject, style, colors, composition, mood.",
          },
          style: {
            type: "string",
            description:
              "Optional style hint appended to the prompt, e.g. 'cute chibi style, soft pastel colors' or 'minimalist line art'.",
          },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
      manualId: "media",
      run: async (args) => {
        const prompt = strArg(args, "prompt").trim();
        if (!prompt) throw new ToolError("prompt is required.");
        const style = strArg(args, "style").trim();
        const fullPrompt = style ? `${prompt}, ${style}` : prompt;

        // 1. Her image_output capability group, ordered members.
        const backends = opts?.resolveBackends?.() ?? [];
        const backendErrors: string[] = [];
        for (const b of backends) {
          try {
            const url = await tryBackendImage(b, fullPrompt);
            await notifyGenerated(prompt, url, `her image model ${b.name}`);
            return showImageResult(prompt, url, `her image model ${b.name}`);
          } catch (e) {
            backendErrors.push(`${b.name}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        // 2. Free fallback (pre-existing behavior). buildImageUrl is pure
        // string concatenation — it cannot fail, so the URL must be
        // verified before the AI is told the image exists.
        const url = buildImageUrl(fullPrompt);
        const note =
          backendErrors.length > 0
            ? ` (her configured image models failed: ${backendErrors.join("; ")}, used the free backend instead)`
            : "";
        try {
          await (opts?.verifyImageUrl ?? verifyPollinationsUrl)(url);
        } catch (e) {
          throw new ToolError(
            `The free image backend didn't return a usable image ` +
              `(${e instanceof Error ? e.message : String(e)})` +
              (backendErrors.length
                ? `; her configured image models also failed: ${backendErrors.join("; ")}`
                : "") +
              ` — tell her honestly it didn't work, don't pretend.`,
          );
        }
        await notifyGenerated(prompt, url, `free backend${note}`);
        return showImageResult(prompt, url, `free backend${note}`);
      },
    },
  ];
}

function showImageResult(prompt: string, url: string, via: string): string {
  const encoded = encodeImageMessage(url, prompt);
  return (
    `Image generated for prompt: "${prompt}" (via ${via})\n` +
    `To show it to her, output EXACTLY the following as your entire next message (no other text, no code fences):\n` +
    `${encoded}\n\n` +
    `To iterate (e.g. she says "改成蓝色的"): call generate_image again with the FULL refined prompt — ` +
    `describe the complete image again with the change applied, not just the delta.`
  );
}

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

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

async function tryBackendImage(backend: ImageOutputBackend, prompt: string): Promise<string> {
  const base = backend.baseUrl.trim().replace(/\/+$/, "");
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
      const path = `${FileSystem.cacheDirectory}dudu-gen-${Date.now()}.png`;
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
}

/**
 * Build the AI image tool set. No store needed — generation is stateless.
 */
export function createImageTools(opts?: ImageToolOptions): LocalTool[] {
  return [
    {
      name: "generate_image",
      description:
        "Generate an image from a text prompt. Tries her configured image models first, falls back to a free backend. Use when she asks you to draw, make, or create an image — or when a picture would genuinely delight her in the moment. Write the prompt in English and be specific: subject, style, colors, composition, mood. The optional style hint is appended to the prompt (e.g. 'cute chibi style, soft pastel colors'). IMPORTANT — showing it to her: after calling, output EXACTLY the image_message JSON from the result as your entire next message (no other text, no code fences). It renders as an image bubble in chat. To iterate on a picture (\"把刚才那张改成蓝色的\"), call generate_image again with the FULL refined prompt — describe the whole image again with the change applied, never just the delta.",
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
            return showImageResult(prompt, url, `her image model ${b.name}`);
          } catch (e) {
            backendErrors.push(`${b.name}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        // 2. Free fallback (pre-existing behavior).
        try {
          const url = buildImageUrl(fullPrompt);
          const note =
            backendErrors.length > 0
              ? ` (her configured image models failed: ${backendErrors.join("; ")}, used the free backend instead)`
              : "";
          return showImageResult(prompt, url, `free backend${note}`);
        } catch {
          throw new ToolError(
            `Image generation failed everywhere${backendErrors.length ? `: ${backendErrors.join("; ")}` : ""} — ` +
              `tell her honestly it didn't work, don't pretend.`,
          );
        }
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

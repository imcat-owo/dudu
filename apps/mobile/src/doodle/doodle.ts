/**
 * 用户照片涂鸦回应 (photo doodle response) — PURE module, no React
 * Native / expo imports.
 *
 * When SHE sends a photo, he can doodle ON it — a heart, a circle
 * around something, an arrow, a handwritten-style note — and send it
 * back, playful like Risu/Nomi image play.
 *
 * Honesty rules (enforced by the manual + validation):
 * - Coordinates are normalized 0..1 and clamped; the AI places doodles
 *   from what it actually SAW via 识图 (vision/describe.ts). If vision
 *   failed, the manual tells it to say what it drew blindly — never
 *   "I see X" when it doesn't.
 * - This module only validates actions and builds the SVG overlay spec.
 *   Rasterization happens on-device (compose.tsx, ViewShot); node tests
 *   use an injected composer.
 */

export type DoodleAction =
  | { kind: "heart"; x: number; y: number; size: number; color: string }
  | { kind: "circle"; x: number; y: number; radius: number; color: string }
  | { kind: "arrow"; x1: number; y1: number; x2: number; y2: number; color: string }
  | { kind: "text"; x: number; y: number; text: string; color: string };

export class DoodleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DoodleError";
  }
}

export const MAX_DOODLE_ACTIONS = 8;
export const MAX_DOODLE_TEXT_LEN = 40;

/** Small curated palette — doodles stay cute, never garish. */
export const DOODLE_COLORS: Record<string, string> = {
  pink: "#ff7fa5",
  red: "#ff5a5a",
  yellow: "#ffd84d",
  blue: "#6db9ff",
  green: "#7fd69a",
  purple: "#c39bff",
  white: "#ffffff",
  black: "#2b2b2b",
};

function resolveColor(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return DOODLE_COLORS.pink;
  const v = raw.trim().toLowerCase();
  if (DOODLE_COLORS[v]) return DOODLE_COLORS[v];
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(v)) return v;
  throw new DoodleError(
    `Bad doodle color: ${raw}. Use a name (${Object.keys(DOODLE_COLORS).join("/")}) or #hex.`,
  );
}

function num01(raw: unknown, name: string): number {
  const v = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(v)) throw new DoodleError(`Bad doodle coordinate ${name}: ${raw}.`);
  return Math.min(1, Math.max(0, v));
}

function frac(raw: unknown, name: string, min: number, max: number, fallback: number): number {
  if (raw === undefined || raw === null) return fallback;
  const v = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(v)) throw new DoodleError(`Bad doodle size ${name}: ${raw}.`);
  return Math.min(max, Math.max(min, v));
}

function str(raw: unknown, name: string, maxLen: number): string {
  if (typeof raw !== "string" || !raw.trim()) throw new DoodleError(`Doodle ${name} needs text.`);
  const t = raw.trim();
  if (t.length > maxLen) throw new DoodleError(`Doodle text too long (max ${maxLen}).`);
  return t;
}

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Validate raw tool args into doodle actions. Throws DoodleError with a
 * human-readable reason (surfaced to the AI so it can fix its call).
 */
export function validateDoodleActions(raw: unknown): DoodleAction[] {
  if (!Array.isArray(raw)) throw new DoodleError("doodle actions must be an array.");
  if (raw.length === 0) throw new DoodleError("Give at least one doodle action.");
  if (raw.length > MAX_DOODLE_ACTIONS)
    throw new DoodleError(
      `At most ${MAX_DOODLE_ACTIONS} doodles per photo — keep it playful, not graffiti.`,
    );

  return raw.map((a, i) => {
    if (typeof a !== "object" || a === null)
      throw new DoodleError(`Doodle #${i + 1}: not an object.`);
    const o = a as Record<string, unknown>;
    const kind = o.kind;
    const color = resolveColor(o.color);
    switch (kind) {
      case "heart":
        return {
          kind: "heart" as const,
          x: num01(o.x, "x"),
          y: num01(o.y, "y"),
          size: frac(o.size, "size", 0.03, 0.45, 0.12),
          color,
        };
      case "circle":
        return {
          kind: "circle" as const,
          x: num01(o.x, "x"),
          y: num01(o.y, "y"),
          radius: frac(o.radius ?? o.size, "radius", 0.02, 0.45, 0.1),
          color,
        };
      case "arrow":
        return {
          kind: "arrow" as const,
          x1: num01(o.x1 ?? o.x, "x1"),
          y1: num01(o.y1 ?? o.y, "y1"),
          x2: num01(o.x2, "x2"),
          y2: num01(o.y2, "y2"),
          color,
        };
      case "text":
        return {
          kind: "text" as const,
          x: num01(o.x, "x"),
          y: num01(o.y, "y"),
          text: str(o.text, "text", MAX_DOODLE_TEXT_LEN),
          color,
        };
      default:
        throw new DoodleError(
          `Doodle #${i + 1}: unknown kind "${String(kind)}". Use heart / circle / arrow / text.`,
        );
    }
  });
}

/** Heart path centered at origin, spanning [-1, 1] in both axes. */
function heartPath(): string {
  // Classic parametric-ish heart as cubic beziers.
  return (
    "M 0 0.9 C -0.15 0.55 -1 0.25 -1 -0.35 C -1 -0.75 -0.55 -1 -0.2 -1 " +
    "C -0.05 -1 0 -0.9 0 -0.75 C 0 -0.9 0.05 -1 0.2 -1 C 0.55 -1 1 -0.75 " +
    "1 -0.35 C 1 0.25 0.15 0.55 0 0.9 Z"
  );
}

/**
 * Device/render-agnostic shape specs: absolute pixel numbers for a
 * width×height canvas. Both buildDoodleSvg (string) and compose.tsx
 * (react-native-svg) render from these, so they can never disagree.
 */
export type DoodleShape =
  | { type: "heart"; cx: number; cy: number; scale: number; color: string; heartPath: string }
  | {
      type: "circle";
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      strokeWidth: number;
      color: string;
    }
  | {
      type: "arrow";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      strokeWidth: number;
      color: string;
      markerId: string;
    }
  | {
      type: "text";
      x: number;
      y: number;
      fontSize: number;
      color: string;
      text: string;
      halo: string;
      haloWidth: number;
    };

const f1 = (n: number) => Number(n.toFixed(1));

export function doodleRenderSpec(
  width: number,
  height: number,
  actions: DoodleAction[],
): DoodleShape[] {
  const minDim = Math.min(width, height);
  const px = (fx: number) => f1(fx * width);
  const py = (fy: number) => f1(fy * height);
  return actions.map((a, i) => {
    switch (a.kind) {
      case "heart":
        return {
          type: "heart" as const,
          cx: px(a.x),
          cy: py(a.y),
          scale: f1(a.size * minDim),
          color: a.color,
          heartPath: heartPath(),
        };
      case "circle": {
        const r = f1(a.radius * minDim);
        return {
          type: "circle" as const,
          cx: px(a.x),
          cy: py(a.y),
          rx: r,
          ry: f1(r * 0.82),
          strokeWidth: f1(minDim * 0.012),
          color: a.color,
        };
      }
      case "arrow":
        return {
          type: "arrow" as const,
          x1: px(a.x1),
          y1: py(a.y1),
          x2: px(a.x2),
          y2: py(a.y2),
          strokeWidth: f1(minDim * 0.014),
          color: a.color,
          markerId: `dah${i}`,
        };
      case "text":
        return {
          type: "text" as const,
          x: px(a.x),
          y: py(a.y),
          fontSize: f1(minDim * 0.055),
          color: a.color,
          text: a.text,
          halo: "#ffffff",
          haloWidth: f1(minDim * 0.008),
        };
      default:
        // Unreachable: validateDoodleActions constrains kind. Fail loud
        // rather than silently dropping a doodle.
        throw new DoodleError(
          `Unknown doodle kind: ${JSON.stringify((a as { kind: unknown }).kind)}`,
        );
    }
  });
}

/**
 * Build the SVG overlay for the doodles. width/height are the photo's
 * pixel size; coordinates are normalized 0..1. Returns a standalone SVG
 * string (also what compose.tsx renders via react-native-svg — both go
 * through doodleRenderSpec so string and device output always agree).
 */
export function buildDoodleSvg(width: number, height: number, actions: DoodleAction[]): string {
  const shapes = doodleRenderSpec(width, height, actions);
  const parts: string[] = [];
  for (const s of shapes) {
    switch (s.type) {
      case "heart":
        parts.push(
          `<g transform="translate(${s.cx} ${s.cy}) scale(${s.scale}) rotate(-8)" ` +
            `fill="${s.color}" fill-opacity="0.92" stroke="#ffffff" stroke-width="0.06">` +
            `<path d="${heartPath()}"/></g>`,
        );
        break;
      case "circle":
        parts.push(
          `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" ` +
            `fill="none" stroke="${s.color}" stroke-width="${s.strokeWidth}" ` +
            `stroke-linecap="round"/>`,
        );
        break;
      case "arrow":
        parts.push(
          `<defs><marker id="${s.markerId}" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">` +
            `<path d="M0,0 L8,4 L0,8 Z" fill="${s.color}"/></marker></defs>` +
            `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" ` +
            `stroke="${s.color}" stroke-width="${s.strokeWidth}" stroke-linecap="round" marker-end="url(#${s.markerId})"/>`,
        );
        break;
      case "text":
        parts.push(
          `<text x="${s.x}" y="${s.y}" font-size="${s.fontSize}" fill="${s.color}" ` +
            `font-family="sans-serif" font-weight="700" text-anchor="middle" ` +
            `paint-order="stroke" stroke="${s.halo}" stroke-width="${s.haloWidth}" ` +
            `stroke-linejoin="round" transform="rotate(-4 ${s.x} ${s.y})">${escXml(s.text)}</text>`,
        );
        break;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`
  );
}

function quadrant(x: number, y: number): string {
  const left = x < 0.33;
  const right = x > 0.67;
  const top = y < 0.33;
  const bottom = y > 0.67;
  if (top && left) return "左上";
  if (top && right) return "右上";
  if (bottom && left) return "左下";
  if (bottom && right) return "右下";
  if (top) return "上边";
  if (bottom) return "下边";
  if (left) return "左边";
  if (right) return "右边";
  return "中间";
}

const KIND_CN: Record<DoodleAction["kind"], string> = {
  heart: "爱心",
  circle: "圈",
  arrow: "箭头",
  text: "手写小字",
};

/**
 * Honest one-line-per-doodle summary in her language, so the AI can say
 * exactly what it drew and where — no fake "I see X".
 */
export function describeDoodles(actions: DoodleAction[]): string[] {
  return actions.map((a) => {
    switch (a.kind) {
      case "heart":
        return `在照片${quadrant(a.x, a.y)}画了个${KIND_CN.heart}`;
      case "circle":
        return `在照片${quadrant(a.x, a.y)}画了个${KIND_CN.circle}`;
      case "arrow":
        return `在照片上画了个${KIND_CN.arrow}`;
      case "text":
        return `在照片${quadrant(a.x, a.y)}写了${KIND_CN.text}「${a.text}」`;
      default:
        throw new DoodleError(
          `Unknown doodle kind: ${JSON.stringify((a as { kind: unknown }).kind)}`,
        );
    }
  });
}

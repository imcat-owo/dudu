/**
 * 照片涂鸦 (photo doodle) — tests.
 *
 * Under test:
 *  1. validateDoodleActions: accepts the 4 kinds, clamps coords, rejects
 *     bad kinds / bad colors / too many / empty / overlong text.
 *  2. buildDoodleSvg: real SVG string with the shapes at the right
 *     positions; doodleRenderSpec agrees with the string (same numbers).
 *  3. describeDoodles: honest Chinese summary of what/where.
 *  4. photo_doodle tool (mock composer): validates, resolves size,
 *     composes, returns an image_message envelope that round-trips
 *     through extractImageMessage; the composer receives the real spec.
 *  5. Incognito: photo_doodle is blocked.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBlockedInIncognito } from "../src/api-groups/incognito-guard.js";
import {
  buildDoodleSvg,
  describeDoodles,
  doodleRenderSpec,
  MAX_DOODLE_ACTIONS,
  validateDoodleActions,
} from "../src/doodle/doodle.js";
import { createDoodleTools, type DoodleToolEnv } from "../src/doodle/tools.js";
import { extractImageMessage } from "../src/image/protocol.js";

const CTX = { authorize: async () => true } as never;

function mockEnv(seen: { uri?: string; w?: number; h?: number; n?: number }): DoodleToolEnv {
  return {
    compose: async (photoUri, width, height, actions) => {
      seen.uri = photoUri;
      seen.w = width;
      seen.h = height;
      seen.n = actions.length;
      return { uri: "file:///tmp/doodled.png" };
    },
    getImageSize: async () => ({ width: 1200, height: 800 }),
  };
}

describe("validateDoodleActions", () => {
  it("accepts all four kinds and clamps coordinates", () => {
    const actions = validateDoodleActions([
      { kind: "heart", x: 0.2, y: 1.5, size: 0.1, color: "pink" },
      { kind: "circle", x: -0.2, y: 0.3, radius: 0.08 },
      { kind: "arrow", x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9, color: "#ff0000" },
      { kind: "text", x: 0.5, y: 0.5, text: "想你", color: "white" },
    ]);
    assert.equal(actions.length, 4);
    assert.equal(actions[0].kind, "heart");
    assert.equal((actions[0] as { y: number }).y, 1); // clamped
    assert.equal((actions[1] as { x: number }).x, 0); // clamped
    assert.equal((actions[0] as { color: string }).color, "#ff7fa5");
  });

  it("rejects unknown kinds, bad colors, empty, too many, overlong text", () => {
    assert.throws(() => validateDoodleActions([{ kind: "star", x: 0.5, y: 0.5 }]), /unknown kind/);
    assert.throws(
      () => validateDoodleActions([{ kind: "heart", x: 0.5, y: 0.5, color: "notacolor" }]),
      /Bad doodle color/,
    );
    assert.throws(() => validateDoodleActions([]), /at least one/);
    assert.throws(
      () =>
        validateDoodleActions(
          new Array(MAX_DOODLE_ACTIONS + 1).fill({ kind: "heart", x: 0.5, y: 0.5 }),
        ),
      /At most/,
    );
    assert.throws(
      () => validateDoodleActions([{ kind: "text", x: 0.5, y: 0.5, text: "x".repeat(41) }]),
      /too long/,
    );
    assert.throws(() => validateDoodleActions("nope"), /must be an array/);
  });
});

describe("buildDoodleSvg", () => {
  const actions = validateDoodleActions([
    { kind: "heart", x: 0.25, y: 0.25, size: 0.1, color: "pink" },
    { kind: "circle", x: 0.75, y: 0.6, radius: 0.1, color: "blue" },
    { kind: "arrow", x1: 0.1, y1: 0.9, x2: 0.4, y2: 0.7, color: "red" },
    { kind: "text", x: 0.5, y: 0.1, text: "想你", color: "white" },
  ]);

  it("produces a valid standalone SVG with all shapes", () => {
    const svg = buildDoodleSvg(1200, 800, actions);
    assert.ok(svg.startsWith("<svg"));
    assert.ok(svg.includes('width="1200"'));
    assert.ok(svg.includes("<path")); // heart
    assert.ok(svg.includes("<ellipse")); // circle
    assert.ok(svg.includes("<line")); // arrow
    assert.ok(svg.includes("想你")); // text
    assert.ok(svg.includes("#ff7fa5")); // pink resolved
  });

  it("agrees with doodleRenderSpec (device renderer uses the same numbers)", () => {
    const svg = buildDoodleSvg(1200, 800, actions);
    const spec = doodleRenderSpec(1200, 800, actions);
    const heart = spec.find((s) => s.type === "heart");
    assert.ok(heart, "heart spec exists");
    assert.ok(svg.includes(`translate(${heart.cx} ${heart.cy})`));
    const circle = spec.find((s) => s.type === "circle");
    assert.ok(circle, "circle spec exists");
    assert.ok(svg.includes(`cx="${circle.cx}"`));
    const text = spec.find((s) => s.type === "text");
    assert.ok(text, "text spec exists");
    assert.ok(svg.includes(`font-size="${text.fontSize}"`));
  });
});

describe("describeDoodles", () => {
  it("says what was drawn and where, honestly", () => {
    const actions = validateDoodleActions([
      { kind: "heart", x: 0.1, y: 0.1, color: "pink" },
      { kind: "text", x: 0.5, y: 0.5, text: "晚安" },
    ]);
    const lines = describeDoodles(actions);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /左上.*爱心/);
    assert.match(lines[1], /中间.*晚安/);
  });
});

describe("photo_doodle tool", () => {
  it("composes and returns a real image_message envelope", async () => {
    const seen: { uri?: string; w?: number; h?: number; n?: number } = {};
    const [tool] = createDoodleTools(mockEnv(seen));
    assert.equal(tool.name, "photo_doodle");
    const raw = await tool.run(
      {
        photoUri: "file:///tmp/her-photo.jpg",
        actions: [{ kind: "heart", x: 0.2, y: 0.2, color: "pink" }],
      },
      CTX,
    );
    const parsed = JSON.parse(raw) as { image_message: string; drew: string[] };
    // Composer got the real spec.
    assert.equal(seen.uri, "file:///tmp/her-photo.jpg");
    assert.equal(seen.w, 1200);
    assert.equal(seen.h, 800);
    assert.equal(seen.n, 1);
    // The envelope round-trips through the real image protocol and
    // renders as an image bubble in chat.
    const hit = extractImageMessage(parsed.image_message);
    assert.ok(hit, "envelope must parse");
    assert.equal(hit.image.uri, "file:///tmp/doodled.png");
    assert.ok(parsed.drew.length === 1);
  });

  it("rejects bad actions with a human-readable error", async () => {
    const [tool] = createDoodleTools(mockEnv({}));
    await assert.rejects(
      () => tool.run({ photoUri: "file:///x.jpg", actions: [{ kind: "nope" }] }, CTX),
      /unknown kind/,
    );
    await assert.rejects(() => tool.run({ actions: [] }, CTX), /photoUri is required/);
  });

  it("is blocked in incognito", () => {
    assert.equal(isBlockedInIncognito("photo_doodle"), true);
  });
});

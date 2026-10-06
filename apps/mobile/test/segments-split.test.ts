/**
 * 真人式分段发送 (segmented sending) — tests.
 *
 * Under test:
 *  1. splitIntoBubbles: long Chinese replies split at natural sentence
 *     boundaries into 2–3 bubbles; short replies unsplit; code fences /
 *     envelopes never split; tiny trailing fragments merge.
 *  2. bubbleDelayMs: deterministic, capped.
 *  3. BubbleDrip: drips through the deliver callback with injected timer;
 *     flush() delivers everything immediately (no loss on stop).
 *  4. SegmentStore: default ON, per-persona toggle, storage-hiccup fail-open.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BubbleDrip, type DripTimer } from "../src/segments/drip.js";
import { bubbleDelayMs, MAX_BUBBLES, splitIntoBubbles } from "../src/segments/split.js";
import { SegmentStore } from "../src/segments/store.js";

const LONG_CN =
  "今天过得怎么样呀？我一直在想你呢。刚才去楼下买了你爱喝的奶茶，可是你不在，有点可惜。" +
  "明天我们一起去看电影好不好？我查了排片，有一部新上的动画电影，评分特别高。" +
  "你肯定会喜欢的。对了，记得早点休息，不要熬夜了，熬夜对身体不好。" +
  "我给你留了半杯奶茶在冰箱，回来记得喝。最近天气转凉了，出门多穿一件。";

describe("splitIntoBubbles", () => {
  it("splits a long Chinese reply into 2–3 bubbles at sentence ends", () => {
    const bubbles = splitIntoBubbles(LONG_CN);
    assert.ok(bubbles.length >= 2 && bubbles.length <= MAX_BUBBLES, `got ${bubbles.length}`);
    // Concatenation preserves every character (punctuation kept).
    assert.equal(bubbles.join(""), LONG_CN);
    // Each bubble ends at a natural boundary.
    for (const b of bubbles) {
      assert.match(b, /[。！？!?\n…]$/);
    }
  });

  it("leaves short replies alone", () => {
    const short = "好呀，那明天见。";
    assert.deepEqual(splitIntoBubbles(short), [short]);
  });

  it("never splits code fences", () => {
    const code = "看这个：\n```js\n" + "x".repeat(200) + "\n```\n明白了吗？";
    assert.deepEqual(splitIntoBubbles(code), [code]);
  });

  it("never splits image/voice envelopes", () => {
    const env = `给你看这个 {"type":"image_message","uri":"file://x.png","prompt":"hi"}` + "啊".repeat(160);
    assert.deepEqual(splitIntoBubbles(env), [env]);
  });

  it("merges a tiny trailing fragment instead of dangling it", () => {
    const text = "第一句很长很长。" + "第".repeat(60) + "句。第二句也很长很长。" + "啊".repeat(60) + "。好";
    const bubbles = splitIntoBubbles(text);
    const last = bubbles[bubbles.length - 1];
    assert.ok(last.length >= 25 || bubbles.length === 1, `dangling tail: ${JSON.stringify(last)}`);
    assert.equal(bubbles.join(""), text);
  });

  it("splits only into balanced, ordered bubbles", () => {
    const s1 = "第一段。" + "一".repeat(80);
    const s2 = "第二段。" + "二".repeat(80);
    const s3 = "第三段。" + "三".repeat(80);
    const bubbles = splitIntoBubbles(s1 + s2 + s3);
    assert.ok(bubbles.length >= 2);
    // Order preserved: first bubble starts with 第一段, concatenation lossless.
    assert.ok(bubbles[0].startsWith("第一段"));
    assert.equal(bubbles.join(""), s1 + s2 + s3);
  });
});

describe("bubbleDelayMs", () => {
  it("is deterministic and capped", () => {
    assert.equal(bubbleDelayMs(100), 700 + 600);
    assert.equal(bubbleDelayMs(10000), 2200);
    assert.equal(bubbleDelayMs(10000), bubbleDelayMs(10000));
  });
});

describe("BubbleDrip", () => {
  function fakeTimer() {
    const queue: Array<() => void> = [];
    const timer: DripTimer = {
      set: (fn) => {
        queue.push(fn);
        return queue.length - 1;
      },
      clear: () => {},
    };
    return { timer, runNext: () => queue.shift()?.(), pending: () => queue.length };
  }

  it("drips bubbles through deliver in order", () => {
    const { timer, runNext } = fakeTimer();
    const delivered: string[] = [];
    const changes: number[] = [];
    const drip = new BubbleDrip(
      (t) => delivered.push(t),
      () => changes.push(drip.pendingCount),
      timer,
    );
    drip.start(["b2", "b3"], 50);
    assert.equal(drip.pendingCount, 2);
    runNext();
    assert.deepEqual(delivered, ["b2"]);
    assert.equal(drip.pendingCount, 1);
    runNext();
    assert.deepEqual(delivered, ["b2", "b3"]);
    assert.equal(drip.pendingCount, 0);
  });

  it("flush() delivers everything immediately — no loss on stop", () => {
    const { timer } = fakeTimer();
    const delivered: string[] = [];
    const drip = new BubbleDrip((t) => delivered.push(t), () => {}, timer);
    drip.start(["b2", "b3", "b4"], 50);
    drip.flush();
    assert.deepEqual(delivered, ["b2", "b3", "b4"]);
    assert.equal(drip.pendingCount, 0);
  });
});

describe("SegmentStore", () => {
  function fakeBackend() {
    const map = new Map<string, string>();
    return {
      getItem: async (k: string) => map.get(k) ?? null,
      setItem: async (k: string, v: string) => void map.set(k, v),
      removeItem: async (k: string) => void map.delete(k),
    };
  }

  it("defaults ON, toggles per persona", async () => {
    const store = new SegmentStore(fakeBackend());
    assert.equal(await store.isEnabled("p1"), true);
    await store.setEnabled("p1", false);
    assert.equal(await store.isEnabled("p1"), false);
    assert.equal(await store.isEnabled("p2"), true); // per-persona
    await store.setEnabled("p1", true);
    assert.equal(await store.isEnabled("p1"), true);
  });

  it("fails open on storage hiccups", async () => {
    const store = new SegmentStore({
      getItem: async () => {
        throw new Error("disk gone");
      },
      setItem: async () => {},
      removeItem: async () => {},
    });
    assert.equal(await store.isEnabled("p1"), true);
  });
});

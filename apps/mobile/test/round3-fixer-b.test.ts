import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOutreachSection } from "../src/outreach/prompt.js";
import { createKeyedWriteChain, sharedKeyedChain } from "../src/util/write-chain.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("write-chain: keyed runner serializes same-key writes", () => {
  it("two concurrent same-key read-modify-write cycles never interleave", async () => {
    const chain = createKeyedWriteChain();
    let value = 0;
    const order: string[] = [];
    await Promise.all([
      chain("k", async () => {
        const seen = value;
        order.push("a-read");
        await sleep(20);
        value = seen + 1;
        order.push("a-write");
      }),
      chain("k", async () => {
        const seen = value;
        order.push("b-read");
        await sleep(10);
        value = seen + 1;
        order.push("b-write");
      }),
    ]);
    assert.equal(value, 2, "lost update if the cycles interleaved");
    assert.deepEqual(order, ["a-read", "a-write", "b-read", "b-write"]);
  });

  it("different keys proceed independently", async () => {
    const chain = createKeyedWriteChain();
    const order: string[] = [];
    await Promise.all([
      chain("k1", async () => {
        await sleep(30);
        order.push("k1");
      }),
      chain("k2", async () => {
        order.push("k2");
      }),
    ]);
    assert.deepEqual(order, ["k2", "k1"]);
  });

  it("a failed write does not wedge later writes", async () => {
    const chain = createKeyedWriteChain();
    await assert.rejects(
      chain("k", async () => {
        throw new Error("boom");
      }),
      /boom/,
    );
    let ran = false;
    await chain("k", async () => {
      ran = true;
    });
    assert.equal(ran, true);
  });

  it("sharedKeyedChain is one instance for cross-module keys (code P2-6)", async () => {
    // Both chat/cross-dialog.ts and api-groups/local-agent.ts write
    // dudu.local-chat.<id>.v1 through this instance — same key, one queue.
    // Prove it functionally: two simulated modules racing on the same key
    // through the shared instance must serialize, never interleave.
    assert.equal(typeof sharedKeyedChain, "function");
    const order: string[] = [];
    await Promise.all([
      // "module A" (cross-dialog.ts)
      sharedKeyedChain("dudu.local-chat.demo.v1", async () => {
        await sleep(20);
        order.push("a");
      }),
      // "module B" (local-agent.ts)
      sharedKeyedChain("dudu.local-chat.demo.v1", async () => {
        order.push("b");
      }),
    ]);
    assert.deepEqual(order, ["a", "b"], "same key must serialize on the one shared instance");
  });
});

describe("outreach prompt lines (xiaomeng P1-2 / P2-2)", () => {
  it("anniversary line tells him to write a letter in-session, never announce", () => {
    const section = buildOutreachSection([
      { kind: "anniversary", priority: 2, detail: "相识纪念日", daysUntil: 1 },
    ]);
    assert.match(section, /love_letter_write/);
    assert.match(section, /never a notification/i);
    assert.match(section, /do not announce/i);
  });

  it("tell_later line tells him to mark done after telling", () => {
    const section = buildOutreachSection([
      { kind: "tell_later", priority: 3, detail: "提醒她喝水" },
    ]);
    assert.match(section, /tell_later_done/);
  });

  it("on_this_day brings up the shared memory once, never as trivia", () => {
    const section = buildOutreachSection([
      { kind: "on_this_day", priority: 3, detail: "去年的今天我们第一次去海边", yearsAgo: 1 },
    ]);
    assert.match(section, /This day last year/);
    assert.match(section, /去年的今天我们第一次去海边/);
    assert.match(section, /never a trivia dump/);
  });

  it("empty triggers stay silent", () => {
    assert.equal(buildOutreachSection([]), "");
  });
});

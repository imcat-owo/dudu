/**
 * voice-call propose tests: the AI-initiated call consent contract.
 *
 * A call is the most intrusive proactive act, so the bar is highest:
 * - the AI proposes (with a reason — "call me" with no why is rejected)
 * - she explicitly accepts or declines
 * - declined/missed is TERMINAL: never silently retried
 * - an unanswered ring expires to "missed" after 60s
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acceptProposal,
  declineProposal,
  expireProposal,
  getRingingProposal,
  listProposals,
  type ProposalStore,
  proposeCall,
  RING_TIMEOUT_MS,
  type RingNotifier,
} from "../src/voice-call/propose";

function makeStore(): ProposalStore & { data: unknown } {
  const data: Record<string, string> = {};
  return {
    data,
    async getItem(k: string) {
      return data[k] ?? null;
    },
    async setItem(k: string, v: string) {
      data[k] = v;
    },
  };
}

function makeNotifier(): RingNotifier & {
  scheduled: string[];
  cancelled: string[];
} {
  const scheduled: string[] = [];
  const cancelled: string[] = [];
  return {
    scheduled,
    cancelled,
    async scheduleNotificationAsync(req: { identifier: string }) {
      scheduled.push(req.identifier);
      return req.identifier;
    },
    async cancelScheduledNotificationAsync(id: string) {
      cancelled.push(id);
    },
  };
}

const base = {
  personaId: "p1",
  personaName: "小梦",
  reason: "想你了，想听听你的声音",
};

describe("proposeCall", () => {
  it("requires a reason — empty reason throws", async () => {
    const store = makeStore();
    const notify = makeNotifier();
    await assert.rejects(() => proposeCall(store, notify, { ...base, reason: "   " }), /reason/);
    assert.deepEqual(await listProposals(store), []);
  });

  it("creates a ringing proposal and schedules the ring notification", async () => {
    const store = makeStore();
    const notify = makeNotifier();
    const p = await proposeCall(store, notify, base);
    assert.equal(p.status, "ringing");
    assert.equal(notify.scheduled.length, 1);
    assert.equal(await getRingingProposal(store).then((r) => r?.id), p.id);
  });

  it("accept → accepted; only from ringing", async () => {
    const store = makeStore();
    const notify = makeNotifier();
    const p = await proposeCall(store, notify, base);
    const accepted = await acceptProposal(store, notify, p.id);
    assert.equal(accepted?.status, "accepted");
    // Cancels the ring notification.
    assert.deepEqual(notify.cancelled, notify.scheduled);
    // Accepting again is a no-op (not ringing anymore).
    assert.equal(await acceptProposal(store, notify, p.id), null);
  });

  it("decline → declined; terminal — cannot be re-accepted or re-declined", async () => {
    const store = makeStore();
    const notify = makeNotifier();
    const p = await proposeCall(store, notify, base);
    const declined = await declineProposal(store, notify, p.id);
    assert.equal(declined?.status, "declined");
    // Terminal: no transition out.
    assert.equal(await acceptProposal(store, notify, p.id), null);
    assert.equal(await declineProposal(store, notify, p.id), null);
    assert.equal(await expireProposal(store, notify, p.id, Date.now() + 1e9), null);
    const all = await listProposals(store);
    assert.equal(all[0].status, "declined");
  });

  it("unanswered ring expires to missed after 60s", async () => {
    const store = makeStore();
    const notify = makeNotifier();
    let now = 1_000_000;
    const p = await proposeCall(store, notify, { ...base, nowMs: () => now });
    // Before the timeout: still ringing.
    now += RING_TIMEOUT_MS - 1;
    assert.equal(await expireProposal(store, notify, p.id, now), null);
    assert.equal((await getRingingProposal(store))?.status, "ringing");
    // After: missed.
    now += 1;
    const missed = await expireProposal(store, notify, p.id, now);
    assert.equal(missed?.status, "missed");
    assert.equal(await getRingingProposal(store), null);
  });

  it("missed is terminal — the AI must make a NEW proposal to ring again", async () => {
    const store = makeStore();
    const notify = makeNotifier();
    const now = 1_000_000;
    const p = await proposeCall(store, notify, { ...base, nowMs: () => now });
    await expireProposal(store, notify, p.id, now + RING_TIMEOUT_MS + 1);
    assert.equal(await acceptProposal(store, notify, p.id), null);
    // A new proposal rings fresh.
    const p2 = await proposeCall(store, notify, { ...base, nowMs: () => now });
    assert.equal(p2.status, "ringing");
    assert.equal(notify.scheduled.length, 2);
  });

  it("unknown proposal ids are safe no-ops", async () => {
    const store = makeStore();
    const notify = makeNotifier();
    assert.equal(await acceptProposal(store, notify, "nope"), null);
    assert.equal(await declineProposal(store, notify, "nope"), null);
    assert.equal(await expireProposal(store, notify, "nope"), null);
  });
});

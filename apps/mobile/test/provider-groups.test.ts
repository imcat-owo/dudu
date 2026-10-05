import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findBucketForGroup,
  nextBucketMember,
  type UserProviderGroup,
} from "../src/api-groups/provider-groups.js";
import { createGroupStore, type SecureBackend } from "../src/api-groups/store.js";
import { type ApiGroup, blankGroup } from "../src/api-groups/types.js";

function fakeSecure(): SecureBackend {
  const data = new Map<string, string>();
  return {
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => {
      data.set(k, v);
    },
    deleteItem: async (k) => {
      data.delete(k);
    },
  };
}

function g(id: string, name: string): ApiGroup {
  const grp = blankGroup("openai");
  grp.id = id;
  grp.name = name;
  return grp;
}

function bucket(id: string, name: string, groupIds: string[]): UserProviderGroup {
  return { id, name, groupIds, createdAt: 1 };
}

describe("D27 findBucketForGroup", () => {
  it("finds the bucket containing the group", () => {
    const buckets = [bucket("ug1", "主力", ["g1", "g2"]), bucket("ug2", "白嫖", ["g3"])];
    assert.equal(findBucketForGroup(buckets, "g2")?.id, "ug1");
    assert.equal(findBucketForGroup(buckets, "g3")?.id, "ug2");
  });

  it("returns null when the group is in no bucket", () => {
    const buckets = [bucket("ug1", "主力", ["g1"])];
    assert.equal(findBucketForGroup(buckets, "gx"), null);
    assert.equal(findBucketForGroup([], "g1"), null);
  });
});

describe("D27 nextBucketMember", () => {
  it("walks bucket order and wraps around", () => {
    const b = bucket("ug1", "主力", ["g1", "g2", "g3"]);
    const live = new Set(["g1", "g2", "g3"]);
    assert.equal(nextBucketMember(b, "g1", live), "g2");
    assert.equal(nextBucketMember(b, "g2", live), "g3");
    assert.equal(nextBucketMember(b, "g3", live), "g1");
  });

  it("skips deleted members", () => {
    const b = bucket("ug1", "主力", ["g1", "gdead", "g2"]);
    const live = new Set(["g1", "g2"]);
    assert.equal(nextBucketMember(b, "g1", live), "g2");
    assert.equal(nextBucketMember(b, "g2", live), "g1");
  });

  it("returns null when fewer than 2 members are alive", () => {
    const b = bucket("ug1", "主力", ["g1", "gdead"]);
    assert.equal(nextBucketMember(b, "g1", new Set(["g1"])), null);
    assert.equal(nextBucketMember(bucket("ug2", "solo", ["g1"]), "g1", new Set(["g1"])), null);
  });
});

describe("D27 failoverToNextInBucket", () => {
  it("advances the active group through the bucket and wraps", async () => {
    const store = createGroupStore(fakeSecure());
    await store.upsert(g("g1", "主力"));
    await store.upsert(g("g2", "备用1"));
    await store.upsert(g("g3", "备用2"));
    const buckets = [bucket("ug1", "主力篮", ["g1", "g2", "g3"])];

    const n1 = await store.failoverToNextInBucket("g1", buckets);
    assert.equal(n1?.id, "g2");
    assert.equal(store.getSnapshot().activeId, "g2");

    const n2 = await store.failoverToNextInBucket("g2", buckets);
    assert.equal(n2?.id, "g3");

    const n3 = await store.failoverToNextInBucket("g3", buckets);
    assert.equal(n3?.id, "g1"); // wraps around
  });

  it("returns null when the group is in no bucket or alone", async () => {
    const store = createGroupStore(fakeSecure());
    await store.upsert(g("g1", "主力"));
    await store.upsert(g("g2", "备用1"));

    assert.equal(await store.failoverToNextInBucket("g1", []), null);
    assert.equal(await store.failoverToNextInBucket("g1", [bucket("ug1", "solo", ["g1"])]), null);
    // active untouched
    assert.equal(store.getSnapshot().activeId, "g1");
  });

  it("skips bucket members that no longer exist", async () => {
    const store = createGroupStore(fakeSecure());
    await store.upsert(g("g1", "主力"));
    await store.upsert(g("g3", "备用2"));
    const buckets = [bucket("ug1", "篮", ["g1", "gdead", "g3"])];

    const n = await store.failoverToNextInBucket("g1", buckets);
    assert.equal(n?.id, "g3");
  });
});

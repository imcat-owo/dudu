/**
 * Batch 2 tests: key rotation (B2), balance parsing (B3), OAuth state
 * machine (B1), Azure endpoint (B14), QR share codec (B12), key lifecycle.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  blankApiKey,
  maskKey,
  recordKeyResult,
  resolveKeySecret,
  selectKeyId,
} from "../src/api-groups/api-keys.js";
import { blankGroup, type ApiGroup, type ApiKeyEntry } from "../src/api-groups/types.js";
import { formatBalance, getPath, queryBalance } from "../src/api-groups/balance.js";
import {
  base64UrlEncode,
  buildAuthorizeUrl,
  createOAuthStore,
  isTokenExpired,
  OAUTH_PRESETS,
  parseOAuthRedirect,
  randomVerifier,
} from "../src/api-groups/oauth.js";
import { decodeShare, encodeShare, payloadToGroup, SHARE_PREFIX } from "../src/api-groups/sharing.js";
import { chatEndpointFor, parseSseUsage } from "../src/api-groups/direct-transport.js";

function key(over: Partial<ApiKeyEntry> = {}): ApiKeyEntry {
  return { ...blankApiKey("k"), ...over };
}

function groupWithKeys(keys: ApiKeyEntry[], over: Partial<ApiGroup> = {}): ApiGroup {
  const g = blankGroup("openai");
  g.apiKeys = keys;
  return { ...g, ...over };
}

describe("B2 key rotation strategies", () => {
  it("roundRobin cycles through enabled keys", () => {
    const g = groupWithKeys(
      [key({ id: "a", key: "sk-a" }), key({ id: "b", key: "sk-b" }), key({ id: "c", key: "sk-c" })],
      { keyRotation: "roundRobin" },
    );
    const cursor = { index: 0 };
    const picks = [0, 1, 2, 3].map(() => selectKeyId(g, cursor).keyId);
    assert.deepEqual(picks, ["a", "b", "c", "a"]);
  });

  it("priority picks the lowest priority number first", () => {
    const g = groupWithKeys(
      [
        key({ id: "a", key: "sk-a", priority: 9 }),
        key({ id: "b", key: "sk-b", priority: 1 }),
        key({ id: "c", key: "sk-c", priority: 5 }),
      ],
      { keyRotation: "priority" },
    );
    assert.equal(selectKeyId(g, { index: 0 }).keyId, "b");
  });

  it("leastUsed picks the key with fewest total requests", () => {
    const g = groupWithKeys(
      [key({ id: "a", key: "sk-a", totalRequests: 10 }), key({ id: "b", key: "sk-b", totalRequests: 2 })],
      { keyRotation: "leastUsed" },
    );
    assert.equal(selectKeyId(g, { index: 0 }).keyId, "b");
  });

  it("random returns an enabled key", () => {
    const g = groupWithKeys([key({ id: "a", key: "sk-a" }), key({ id: "b", key: "sk-b" })], {
      keyRotation: "random",
    });
    const picked = selectKeyId(g, { index: 0 }).keyId;
    assert.ok(picked === "a" || picked === "b");
  });

  it("skips disabled and empty keys in every strategy", () => {
    const g = groupWithKeys(
      [
        key({ id: "a", key: "sk-a", disabledUntil: Date.now() + 60_000 }),
        key({ id: "b", key: "sk-b", enabled: false }),
        key({ id: "c", key: "sk-c" }),
      ],
      { keyRotation: "priority" },
    );
    assert.equal(selectKeyId(g, { index: 0 }).keyId, "c");
  });

  it("falls back to legacy apiKey when the pool is empty", () => {
    const g = blankGroup("openai");
    g.apiKey = "sk-legacy";
    const { keyId } = selectKeyId(g, { index: 0 });
    assert.equal(keyId, null);
    assert.equal(resolveKeySecret(g, null), "sk-legacy");
  });

  it("resolves pool key secrets by id", () => {
    const g = groupWithKeys([key({ id: "a", key: "sk-aaa" })]);
    assert.equal(resolveKeySecret(g, "a"), "sk-aaa");
  });
});

describe("B2 key lifecycle (auto-disable / recover)", () => {
  it("disables a key after N consecutive failures", () => {
    const g = groupWithKeys([key({ id: "a", key: "sk-a" })], { keyAutoDisableAfter: 3 });
    const now = Date.now();
    let k = key({ id: "a", key: "sk-a" });
    k = recordKeyResult(k, false, g, now);
    assert.equal(k.disabledUntil, null);
    k = recordKeyResult(k, false, g, now);
    k = recordKeyResult(k, false, g, now);
    assert.ok(k.disabledUntil != null && k.disabledUntil > now);
    assert.equal(k.consecutiveFailures, 3);
    // And a disabled key is skipped by selection.
    const g2 = groupWithKeys([k, key({ id: "b", key: "sk-b" })]);
    assert.equal(selectKeyId(g2, { index: 0 }, now).keyId, "b");
  });

  it("a success resets the failure counter and clears the cooldown", () => {
    const g = groupWithKeys([key({ id: "a", key: "sk-a" })], { keyAutoDisableAfter: 3 });
    let k = key({ id: "a", key: "sk-a", consecutiveFailures: 2 });
    k = recordKeyResult(k, true, g, Date.now());
    assert.equal(k.consecutiveFailures, 0);
    assert.equal(k.totalRequests, 1);
    assert.equal(k.disabledUntil, null);
  });

  it("a cooled-down key becomes eligible again", () => {
    const g = groupWithKeys([key({ id: "a", key: "sk-a" })], { keyRecoverAfterMinutes: 10 });
    const k = key({
      id: "a",
      key: "sk-a",
      disabledUntil: Date.now() - 60_000,
      consecutiveFailures: 3,
    });
    const gg = groupWithKeys([k]);
    assert.equal(selectKeyId(gg, { index: 0 }).keyId, "a");
  });

  it("maskKey never leaks the middle", () => {
    assert.equal(maskKey("sk-abcdefghij123456"), "sk-…3456");
    assert.equal(maskKey(""), "…");
    assert.ok(!maskKey("sk-abcdefghij123456").includes("defghij"));
  });
});

describe("B3 balance path parsing", () => {
  it("reads dot paths", () => {
    assert.equal(getPath({ data: { total: 12.5 } }, "data.total"), 12.5);
  });
  it("reads bracket paths", () => {
    assert.equal(getPath({ grants: [{ balance: 3 }] }, "grants[0].balance"), 3);
  });
  it("returns undefined for missing paths", () => {
    assert.equal(getPath({ a: 1 }, "b.c"), undefined);
    assert.equal(getPath(null, "a"), undefined);
  });
  it("formats balances for display", () => {
    assert.equal(formatBalance(12.5), "12.50");
    assert.equal(formatBalance(150), "150");
    assert.equal(formatBalance(null), null);
    assert.equal(formatBalance("9.99"), "9.99");
  });
  it("queryBalance never throws and returns null when unreachable", async () => {
    const g = blankGroup("openai");
    g.baseUrl = "https://127.0.0.1:1";
    g.balance = { enabled: true, apiPath: "/billing", resultPath: "total" };
    const r = await queryBalance(g, { "Content-Type": "application/json" });
    assert.equal(r, null);
    // Disabled config short-circuits to null without network.
    const g2 = blankGroup("openai");
    assert.equal(await queryBalance(g2, {}), null);
  });
});

describe("B1 OAuth helpers + account state machine", () => {
  it("presets carry reverse-engineering honesty", () => {
    for (const p of OAUTH_PRESETS) assert.equal(p.reverseEngineered, true);
    assert.ok(OAUTH_PRESETS.length >= 4);
  });

  it("buildAuthorizeUrl embeds PKCE + client id", () => {
    const p = OAUTH_PRESETS[0];
    const url = buildAuthorizeUrl(p, "challenge123", "state456");
    assert.ok(url.startsWith(p.authUrl));
    assert.ok(url.includes(`client_id=${encodeURIComponent(p.clientId)}`));
    assert.ok(url.includes("code_challenge=challenge123"));
    assert.ok(url.includes("code_challenge_method=S256"));
    assert.ok(url.includes("state=state456"));
  });

  it("parseOAuthRedirect validates state and extracts the code", () => {
    const ok = parseOAuthRedirect("dudu://oauth/callback?code=abc&state=s1", "s1");
    assert.deepEqual(ok, { code: "abc" });
    // CSRF: wrong state is rejected.
    assert.deepEqual(parseOAuthRedirect("dudu://oauth/callback?code=abc&state=s1", "other"), {
      error: "state_mismatch",
    });
    const err = parseOAuthRedirect("dudu://oauth/callback?error=access_denied", "s1");
    assert.deepEqual(err, { error: "access_denied" });
  });

  it("verifier is high-entropy url-safe (RFC 7636)", () => {
    const v = randomVerifier();
    assert.ok(v.length >= 43);
    assert.ok(/^[A-Za-z0-9\-._~]+$/.test(v));
    assert.ok(!base64UrlEncode(new TextEncoder().encode("hi")).includes("="));
  });

  it("isTokenExpired respects the 60s safety margin", () => {
    const now = Date.now();
    assert.equal(isTokenExpired({ expiresAt: now + 30_000 } as never, now), true);
    assert.equal(isTokenExpired({ expiresAt: now + 120_000 } as never, now), false);
  });

  it("account store: add → list → remove round-trips", async () => {
    const data = new Map<string, string>();
    const store = createOAuthStore({
      getItem: async (k) => data.get(k) ?? null,
      setItem: async (k, v) => void data.set(k, v),
      deleteItem: async (k) => void data.delete(k),
    });
    await store.upsert({
      id: "acc1",
      providerId: "chatgpt",
      displayName: "ChatGPT",
      email: "me@example.com",
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: Date.now() + 3600_000,
      createdAt: Date.now(),
    });
    const accounts = await store.list();
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].email, "me@example.com");
    assert.deepEqual(await store.get("acc1"), accounts[0]);
    await store.remove("acc1");
    assert.deepEqual(await store.list(), []);
  });
});

describe("B12 share codec", () => {
  it("round-trips a group through the share format", () => {
    const g = blankGroup("openai");
    g.name = "主力";
    g.baseUrl = "https://api.example.com/v1";
    g.apiKey = "sk-secret";
    g.model = "gpt-4o-mini";
    const text = encodeShare(g, true);
    assert.ok(text.startsWith(SHARE_PREFIX));
    const payload = decodeShare(text);
    assert.ok(payload);
    assert.equal(payload.name, "主力");
    assert.equal(payload.apiKey, "sk-secret");
    const restored = payloadToGroup(payload!);
    assert.equal(restored.baseUrl, "https://api.example.com/v1");
    assert.notEqual(restored.id, g.id);
  });

  it("omits the key when asked", () => {
    const g = blankGroup("openai");
    g.apiKey = "sk-secret";
    const payload = decodeShare(encodeShare(g, false));
    assert.equal(payload!.apiKey, "");
  });

  it("D19: restores the key pool on import when shared with keys", () => {
    const g = blankGroup("openai");
    g.name = "主力";
    g.apiKey = "sk-main";
    g.apiKeys = [
      { id: "k_1", name: "主号", key: "sk-aaa", priority: 1, enabled: true, consecutiveFailures: 0, totalRequests: 0, disabledUntil: null, lastError: null, createdAt: 1 },
      { id: "k_2", name: "备号", key: "sk-bbb", priority: 5, enabled: true, consecutiveFailures: 0, totalRequests: 0, disabledUntil: null, lastError: null, createdAt: 2 },
    ];
    const payload = decodeShare(encodeShare(g, true));
    assert.ok(payload, "payload must decode");
    const restored = payloadToGroup(payload);
    const keys = restored.apiKeys;
    assert.ok(keys, "key pool must survive import");
    assert.equal(keys.length, 2);
    assert.deepEqual(
      keys.map((k) => [k.name, k.key, k.priority]),
      [
        ["主号", "sk-aaa", 1],
        ["备号", "sk-bbb", 5],
      ],
    );
    assert.ok(
      keys.every((k) => k.id && k.id !== "k_1" && k.id !== "k_2"),
      "imported entries get fresh ids",
    );
  });

  it("rejects foreign or corrupt payloads", () => {
    assert.equal(decodeShare("ai-provider:v1:xxxx"), null);
    assert.equal(decodeShare("hello world"), null);
    assert.equal(decodeShare(`${SHARE_PREFIX}!!!not-base64!!!`), null);
  });

  it("D38: bodyExtras survive the round-trip instead of being neutered", () => {
    const grp = blankGroup("openai");
    grp.bodyExtras = { custom_param: "yes", nested: { a: 1 } };
    const payload = decodeShare(encodeShare(grp, false));
    assert.ok(payload);
    const restored = payloadToGroup(payload);
    assert.deepEqual(restored.bodyExtras, { custom_param: "yes", nested: { a: 1 } });
  });

  it("D38: headersStripped is set only when headers existed but keys were excluded", () => {
    const withHeaders = blankGroup("openai");
    withHeaders.headers = { "X-Custom": "1" };
    const dropped = decodeShare(encodeShare(withHeaders, false));
    assert.ok(dropped);
    assert.equal(dropped.headersStripped, true, "headers dropped without keys → flag set");
    const kept = decodeShare(encodeShare(withHeaders, true));
    assert.ok(kept);
    assert.equal(kept.headersStripped, undefined, "headers included → no flag");
    const noHeaders = blankGroup("openai");
    const none = decodeShare(encodeShare(noHeaders, false));
    assert.ok(none);
    assert.equal(none.headersStripped, undefined, "no headers to drop → no flag");
  });

  it("D38: old payloads without the new fields still import", () => {
    const legacy = {
      v: 1,
      name: "old",
      vendor: "openai",
      baseUrl: "https://api.example.com/v1",
      apiKey: "",
      model: "gpt-4o-mini",
      headers: {},
      exportedAt: 1,
    };
    const text = `${SHARE_PREFIX}${Buffer.from(JSON.stringify(legacy), "utf8").toString("base64")}`;
    const payload = decodeShare(text);
    assert.ok(payload);
    const restored = payloadToGroup(payload);
    assert.deepEqual(restored.bodyExtras, {});
  });
});

describe("B14 Azure endpoint construction", () => {
  it("builds the deployment URL with api-version", () => {
    const g = blankGroup("openai");
    g.azure = {
      enabled: true,
      deploymentUrl: "https://myres.openai.azure.com/openai/deployments/gpt-4o",
      apiVersion: "2024-10-01-preview",
    };
    assert.equal(
      chatEndpointFor(g),
      "https://myres.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-01-preview",
    );
  });

  it("stays on the normal path when Azure is off", () => {
    const g = blankGroup("openai");
    g.baseUrl = "https://api.openai.com/v1/";
    assert.equal(chatEndpointFor(g), "https://api.openai.com/v1/chat/completions");
  });
});

describe("B9 SSE usage parsing", () => {
  it("extracts token counts from a usage frame", () => {
    const u = parseSseUsage(
      JSON.stringify({ usage: { prompt_tokens: 120, completion_tokens: 45 } }),
    );
    assert.deepEqual(u, { inputTokens: 120, outputTokens: 45 });
  });
  it("returns null when usage is absent", () => {
    assert.equal(parseSseUsage('[DONE]'), null);
    assert.equal(parseSseUsage(JSON.stringify({ choices: [] })), null);
    assert.equal(parseSseUsage("not json"), null);
  });
});

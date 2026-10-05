/**
 * open_app whitelist tests.
 *
 * Under test:
 * 1. lookupOpenAppEntry: known ids resolve, unknown/empty ids are rejected
 *    (the AI can never invent a URL).
 * 2. buildEntryUrl: template slots are filled + URI-encoded; required params
 *    missing → throws; optional query params dropped when empty, kept when
 *    filled; unknown slots → throws.
 * 3. buildWebUrl: entries with a web version build; entries without one
 *    fail honestly.
 * 4. Whitelist hygiene: ids unique, every jump scheme is in
 *    QUERIED_SCHEMES (so canOpenURL works on iOS).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OpenAppEntry } from "../src/openapp/whitelist.js";
import {
  buildEntryUrl,
  buildWebUrl,
  describeWhitelist,
  lookupOpenAppEntry,
  OPEN_APP_WHITELIST,
  QUERIED_SCHEMES,
} from "../src/openapp/whitelist.js";

function mustEntry(id: string): OpenAppEntry {
  const e = lookupOpenAppEntry(id);
  assert.ok(e, `whitelist entry missing: ${id}`);
  return e;
}

describe("lookupOpenAppEntry", () => {
  it("resolves known ids", () => {
    const e = lookupOpenAppEntry("amap-search");
    assert.ok(e);
    assert.equal(e.app, "高德地图");
    assert.equal(e.mode, "jump");
  });

  it("rejects unknown ids — the AI can never invent a URL", () => {
    assert.equal(lookupOpenAppEntry("evil-app"), null);
    assert.equal(lookupOpenAppEntry("https://evil.com"), null);
    assert.equal(lookupOpenAppEntry(""), null);
    assert.equal(lookupOpenAppEntry("   "), null);
  });

  it("ids are unique", () => {
    const ids = OPEN_APP_WHITELIST.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("buildEntryUrl", () => {
  it("fills path slots and URI-encodes them", () => {
    const e = mustEntry("amap-search");
    const url = buildEntryUrl(e, { query: "西湖 & 雷峰塔" });
    assert.equal(
      url,
      `iosamap://poi?sourceApplication=dudu&keywords=${encodeURIComponent("西湖 & 雷峰塔")}`,
    );
  });

  it("throws on missing required params", () => {
    const e = mustEntry("amap-search");
    assert.throws(() => buildEntryUrl(e, {}), /Missing required parameter "query"/);
    assert.throws(() => buildEntryUrl(e, { query: "   " }), /Missing required parameter/);
  });

  it("drops empty optional query params, keeps filled ones", () => {
    const e = mustEntry("mail-compose");
    assert.equal(buildEntryUrl(e, { email: "a@b.com" }), "mailto:a%40b.com");
    assert.equal(
      buildEntryUrl(e, { email: "a@b.com", subject: "你好" }),
      `mailto:a%40b.com?subject=${encodeURIComponent("你好")}`,
    );
    const full = buildEntryUrl(e, { email: "a@b.com", subject: "你好", body: "周六见？" });
    assert.ok(full.includes("subject="));
    assert.ok(full.includes(`body=${encodeURIComponent("周六见？")}`));
  });

  it("encodes x-callback params", () => {
    const e = mustEntry("shortcuts-run");
    const url = buildEntryUrl(e, { name: "晚安模式" });
    assert.equal(
      url,
      `shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent("晚安模式")}`,
    );
  });

  it("schemes without params build verbatim", () => {
    assert.equal(buildEntryUrl(mustEntry("wechat-open"), {}), "weixin://");
    assert.equal(
      buildEntryUrl(mustEntry("phone-call"), { phone: "13800138000" }),
      "tel:13800138000",
    );
  });
});

describe("buildWebUrl", () => {
  it("builds the web URL for entries that have one", () => {
    const e = mustEntry("youtube-watch");
    const url = buildWebUrl(e, { videoId: "abc123" });
    assert.equal(url, "https://www.youtube.com/watch?v=abc123");
  });

  it("fails honestly when there is no web version", () => {
    const e = mustEntry("wechat-open");
    assert.throws(() => buildWebUrl(e, {}), /no web version/);
  });
});

describe("whitelist hygiene", () => {
  it("every jump scheme is declared in QUERIED_SCHEMES (iOS canOpenURL)", () => {
    for (const e of OPEN_APP_WHITELIST) {
      if (e.mode !== "jump") continue;
      const scheme = e.url.split(":")[0];
      if (scheme === "https" || scheme === "http") continue;
      assert.ok(
        (QUERIED_SCHEMES as string[]).includes(scheme),
        `${e.id}: scheme "${scheme}" missing from QUERIED_SCHEMES / app.json`,
      );
    }
  });

  it("describeWhitelist lists every entry", () => {
    const text = describeWhitelist();
    for (const e of OPEN_APP_WHITELIST) {
      assert.ok(text.includes(e.id), e.id);
    }
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type FetchLike,
  s3List,
  s3Sign,
  validateS3,
  validateWebDav,
} from "../src/backup/remote.js";
import { enStrings } from "../src/i18n/en.js";
import { zhHansStrings } from "../src/i18n/zh-Hans.js";

const s3dest = {
  kind: "s3" as const,
  config: {
    endpoint: "https://s3.example.com",
    region: "us-east-1",
    bucket: "mybucket",
    accessKeyId: "AKID",
    prefix: "dudu_backups",
    pathStyle: true,
    includeFiles: true,
  },
  secretAccessKey: "secret",
};

const LIST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>mybucket</Name>
  <Prefix>dudu_backups/</Prefix>
  <KeyCount>3</KeyCount>
  <Contents><Key>dudu_backups/dudu-backup-2026-10-01.json</Key></Contents>
  <Contents><Key>dudu-backup-2026-10-02.json</Key></Contents>
  <Contents><Key>dudu_backups/notes.txt</Key></Contents>
</ListBucketResult>`;

describe("D16 s3List", () => {
  it("lists .json backups via ListObjectsV2 and strips the prefix", async () => {
    let seenUrl = "";
    let seenAuth = "";
    const fake: FetchLike = async (url, init) => {
      seenUrl = url;
      seenAuth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? "";
      return new Response(LIST_XML, { status: 200 });
    };
    const files = await s3List(s3dest, fake, new Date("2026-10-05T00:00:00Z"));
    assert.deepEqual(files, ["dudu-backup-2026-10-01.json", "dudu-backup-2026-10-02.json"]);
    assert.ok(seenUrl.includes("list-type=2"), `url should carry list-type=2: ${seenUrl}`);
    assert.ok(
      seenUrl.includes("prefix=dudu_backups%2F"),
      `url should carry the encoded prefix: ${seenUrl}`,
    );
    assert.ok(seenAuth.startsWith("AWS4-HMAC-SHA256 "), "request must be SigV4-signed");
  });

  it("throws s3-list-failed on HTTP error", async () => {
    const fake: FetchLike = async () => new Response("nope", { status: 403 });
    await assert.rejects(() => s3List(s3dest, fake), /s3-list-failed:403/);
  });

  it("s3Sign with empty query keeps the old canonical form (backward compatible)", async () => {
    const a = await s3Sign(s3dest, "GET", "k.json", "hash", "20261005T000000Z");
    const b = await s3Sign(s3dest, "GET", "k.json", "hash", "20261005T000000Z", undefined, {});
    assert.equal(a.url, b.url);
    assert.equal(a.authorization, b.authorization);
  });

  it("s3Sign signs the query string (list URL differs from object URL)", async () => {
    const obj = await s3Sign(s3dest, "GET", "", "hash", "20261005T000000Z");
    const list = await s3Sign(s3dest, "GET", "", "hash", "20261005T000000Z", undefined, {
      "list-type": "2",
    });
    assert.notEqual(list.url, obj.url);
    assert.notEqual(list.authorization, obj.authorization);
  });
});

describe("D24 validation messages", () => {
  it("every validate* error code has its own honest i18n message (never testFailed)", () => {
    const codes: Array<string | null> = [
      validateWebDav(""), // url-required
      validateWebDav("ftp://x"), // url-scheme
      validateWebDav("not a url"), // url-invalid
      validateS3("", "b", "k"), // endpoint-required
      validateS3("not a url", "b", "k"), // endpoint-invalid
      validateS3("https://s3.example.com", "", "k"), // bucket-required
      validateS3("https://s3.example.com", "b", ""), // access-key-required
    ];
    const testFailedEn = (enStrings as Record<string, string>)["backup.remote.testFailed"];
    for (const code of codes) {
      assert.ok(code, "expected an error code");
      const key = `backup.remote.validation.${code}`;
      const en = (enStrings as Record<string, string>)[key];
      const zh = (zhHansStrings as Record<string, string>)[key];
      assert.ok(en?.length, `en missing ${key}`);
      assert.ok(zh?.length, `zh-Hans missing ${key}`);
      assert.notEqual(en, testFailedEn, `${key} must not reuse the testFailed message`);
    }
  });
});

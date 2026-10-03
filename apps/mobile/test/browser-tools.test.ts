import assert from "node:assert/strict";
import test from "node:test";
import { type BrowserWebViewRef, browserController } from "../src/browser/controller.js";
import { createBrowserTools } from "../src/browser/tools.js";
import { getManual } from "../src/manuals/index.js";

/** Fake WebView that simulates page responses. */
function makeFakeWebView(): BrowserWebViewRef & { lastJs: string } {
  const fake = {
    lastJs: "",
    injectJavaScript(js: string) {
      fake.lastJs = js;
      // Simulate the page responding via postMessage.
      // Extract the id from the wrapped JS.
      const m = js.match(/id:"(eval_\d+_\d+)"/);
      if (m) {
        const id = m[1];
        // Simulate async page response.
        setTimeout(() => {
          browserController.handleMessage(JSON.stringify({ id, ok: true, value: "fake-result" }));
        }, 10);
      }
    },
    goBack() {},
    goForward() {},
    reload() {},
    async captureScreenshot() {
      return "file:///fake-screenshot.png";
    },
  };
  return fake;
}

test("browser tools are registered with manualId", () => {
  const tools = createBrowserTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("browser_navigate"));
  assert.ok(names.includes("browser_snapshot"));
  assert.ok(names.includes("browser_click"));
  assert.ok(names.includes("browser_input"));
  assert.ok(names.includes("browser_back"));
  assert.ok(names.includes("browser_forward"));
  for (const t of tools) {
    assert.equal(t.manualId, "browser");
  }
});

test("browser manual exists and is resolvable", () => {
  const m = getManual("browser");
  assert.ok(m);
  assert.equal(m.id, "browser");
  assert.ok(m.body.length > 100);
});

test("browser_navigate rejects invalid URLs honestly", async () => {
  const tools = createBrowserTools();
  const nav = tools.find((t) => t.name === "browser_navigate");
  assert.ok(nav);
  const ctx = { authorize: async () => true };
  await assert.rejects(() => nav.run({ url: "not a url" }, ctx), /website address/);
  await assert.rejects(() => nav.run({ url: "" }, ctx), /Missing required/);
});

test("browser tools fail honestly when WebView not mounted", async () => {
  browserController.setWebView(null);
  const tools = createBrowserTools();
  const ctx = { authorize: async () => true };
  const snapshot = tools.find((t) => t.name === "browser_snapshot");
  assert.ok(snapshot);
  await assert.rejects(() => snapshot.run({}, ctx), /not ready|not mounted/);
});

test("browser_navigate works with mounted WebView", async () => {
  const fake = makeFakeWebView();
  browserController.setWebView(fake);
  const tools = createBrowserTools();
  const ctx = { authorize: async () => true };
  const nav = tools.find((t) => t.name === "browser_navigate");
  assert.ok(nav);
  const result = await nav.run({ url: "example.com" }, ctx);
  assert.ok(result.includes("example.com"));
  assert.ok(fake.lastJs.includes("location.href"));
  browserController.setWebView(null);
});

test("controller correlates evaluate responses", async () => {
  const fake = makeFakeWebView();
  browserController.setWebView(fake);
  const r = await browserController.evaluate("1+1");
  assert.equal(r.ok, true);
  assert.equal(r.value, "fake-result");
  browserController.setWebView(null);
});

test("browser_screenshot returns SCREENSHOT marker with file URI", async () => {
  const fake = makeFakeWebView();
  browserController.setWebView(fake);
  const tools = createBrowserTools();
  const ctx = { authorize: async () => true };
  const shot = tools.find((t) => t.name === "browser_screenshot");
  assert.ok(shot);
  const result = await shot.run({}, ctx);
  assert.ok(result.startsWith("[SCREENSHOT]\n"));
  assert.ok(result.includes("file:///fake-screenshot.png"));
  browserController.setWebView(null);
});

test("browser_screenshot fails honestly when WebView not mounted", async () => {
  browserController.setWebView(null);
  const tools = createBrowserTools();
  const ctx = { authorize: async () => true };
  const shot = tools.find((t) => t.name === "browser_screenshot");
  assert.ok(shot);
  await assert.rejects(() => shot.run({}, ctx), /not ready|not mounted/);
});

test("browser_screenshot fails honestly when capture throws", async () => {
  const fake = makeFakeWebView();
  fake.captureScreenshot = async () => {
    throw new Error("Screenshot not available — needs a dev build");
  };
  browserController.setWebView(fake);
  const tools = createBrowserTools();
  const ctx = { authorize: async () => true };
  const shot = tools.find((t) => t.name === "browser_screenshot");
  assert.ok(shot);
  await assert.rejects(() => shot.run({}, ctx), /dev build/);
  browserController.setWebView(null);
});

test("contentToText handles string and blocks", async () => {
  const { contentToText } = await import("../src/api-groups/local-agent.js");
  assert.equal(contentToText("hello"), "hello");
  assert.equal(
    contentToText([
      { type: "text", text: "page shot:" },
      { type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
    ]),
    "page shot:\n[image]",
  );
});

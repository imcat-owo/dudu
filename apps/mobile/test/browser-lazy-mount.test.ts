import "./helpers/rn-stub.js";
import assert from "node:assert/strict";
import test from "node:test";
import { type BrowserWebViewRef, browserController } from "../src/browser/controller.js";
import {
  __resetBrowserViewMount,
  isBrowserViewMounted,
  onBrowserViewMountChange,
  requestBrowserViewMount,
} from "../src/browser/mount.js";
import { __setBrowserMountWaitMs, createBrowserTools } from "../src/browser/tools.js";

const ctx = { authorize: async () => true };

/** Fake WebView that simulates page responses. */
function makeFakeWebView(): BrowserWebViewRef {
  const fake: BrowserWebViewRef & { lastJs: string } = {
    lastJs: "",
    injectJavaScript(js: string) {
      fake.lastJs = js;
      const m = js.match(/id:"(eval_\d+_\d+)"/);
      if (m) {
        const id = m[1];
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

function resetAll() {
  __resetBrowserViewMount();
  browserController.setWebView(null);
  __setBrowserMountWaitMs(12000);
}

test("mount gate starts unmounted (startup bisection)", () => {
  resetAll();
  assert.equal(isBrowserViewMounted(), false);
});

test("requestBrowserViewMount flips the gate and notifies listeners once", () => {
  resetAll();
  const seen: boolean[] = [];
  const unsub = onBrowserViewMountChange((m) => seen.push(m));
  requestBrowserViewMount();
  requestBrowserViewMount(); // idempotent
  assert.equal(isBrowserViewMounted(), true);
  assert.deepEqual(seen, [true]);
  unsub();
  requestBrowserViewMount();
  assert.deepEqual(seen, [true]); // unsubscribed: no more calls
});

test("first browser tool call requests the mount, then drives the webview", async () => {
  resetAll();
  __setBrowserMountWaitMs(5000);
  const tools = createBrowserTools();
  const navigate = tools.find((t) => t.name === "browser_navigate");
  assert.ok(navigate);
  // No view mounted yet; the webview appears 100ms after the tool asks.
  setTimeout(() => browserController.setWebView(makeFakeWebView()), 100);
  const out = await navigate.run({ url: "https://example.com" }, ctx);
  assert.equal(isBrowserViewMounted(), true);
  assert.match(String(out), /Opened https:\/\/example.com/);
  resetAll();
});

test("tool fails honestly when the view never mounts", async () => {
  resetAll();
  __setBrowserMountWaitMs(400);
  const tools = createBrowserTools();
  const snapshot = tools.find((t) => t.name === "browser_snapshot");
  assert.ok(snapshot);
  await assert.rejects(() => snapshot.run({}, ctx), /did not mount in time/);
  // The mount was still requested (bisection mark), even though it timed out.
  assert.equal(isBrowserViewMounted(), true);
  resetAll();
});

test("already-mounted view: tools proceed without waiting", async () => {
  resetAll();
  browserController.setWebView(makeFakeWebView());
  requestBrowserViewMount();
  const tools = createBrowserTools();
  const back = tools.find((t) => t.name === "browser_back");
  assert.ok(back);
  const out = await back.run({}, ctx);
  assert.match(String(out), /Went back/);
  resetAll();
});

/**
 * AI Browser Tools — PURE module (no React Native imports).
 *
 * The AI's hands for the web. Drives a real WebView through
 * browserController (src/browser/controller.ts). The WebView is mounted
 * by AIBrowserView; if it's not mounted, tools fail honestly — never fake.
 *
 * browser_screenshot captures via react-native-view-shot (native module,
 * dev build only) and returns a [SCREENSHOT] marker with the file URI;
 * the agent loop (local-agent.ts) converts it into an image_url block
 * for the model's vision. If the model can't see images, the describe
 * pipeline kicks in — same as user-sent photos.
 *
 * These tools do NOT need her authorization popup: browsing is in-app,
 * read-mostly, and she can see the browser view. Out-of-app actions
 * (downloading files, opening external apps) are not offered.
 *
 * Tool naming follows the existing convention (snake_case).
 */

import type { LocalTool, ToolDeps } from "../api-groups/local-tools.js";
import { browserAddress } from "../browser-address.js";
import { browserController } from "./controller.js";

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

/** Escape a string for safe embedding in a JS single-quoted literal. */
function jsStr(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'`;
}

export function createBrowserTools(_deps: ToolDeps = {}): LocalTool[] {
  const tools: LocalTool[] = [
    {
      name: "browser_navigate",
      description:
        "Open a web page in the app browser. Use when she asks you to look something up, open a site, or check a page. The page loads in the browser view she can also see.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to open (e.g. https://example.com).",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
      manualId: "browser",
      run: async (args) => {
        const raw = strArg(args, "url");
        if (!raw) throw new Error("Missing required argument: url.");
        let url: string;
        try {
          url = browserAddress(raw);
        } catch (e) {
          throw new Error(e instanceof Error ? e.message : "Invalid URL.");
        }
        if (!browserController.isReady()) {
          throw new Error("Browser is not ready — the browser view is not mounted.");
        }
        // Navigation goes through the view layer via a pending URL.
        // The controller holds it; AIBrowserView picks it up.
        browserController.setUrl(url);
        const r = await browserController.evaluate(`location.href=${jsStr(url)}; "navigating"`);
        if (!r.ok) throw new Error(r.error || "Navigation failed.");
        return `Opened ${url}. Use browser_snapshot to read the page.`;
      },
    },
    {
      name: "browser_snapshot",
      description:
        "Read the current page as text (title, URL, and main content). Call after browser_navigate to see what's on the page.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "browser",
      run: async () => {
        const r = await browserController.evaluate(`
          (function(){
            var title = document.title || "";
            var url = location.href || "";
            var body = document.body ? document.body.innerText || "" : "";
            body = body.replace(/\\s+/g, " ").trim().slice(0, 8000);
            return "TITLE: " + title + "\\nURL: " + url + "\\n\\n" + body;
          })()
        `);
        if (!r.ok) throw new Error(r.error || "Could not read the page.");
        return r.value || "(empty page)";
      },
    },
    {
      name: "browser_click",
      description:
        "Click an element on the page by its visible text or CSS selector. Use after browser_snapshot to interact with buttons, links, etc.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description:
              'Visible text of the element to click (e.g. "Sign in"), or a CSS selector prefixed with "css:" (e.g. "css:button.submit").',
          },
        },
        required: ["target"],
        additionalProperties: false,
      },
      manualId: "browser",
      run: async (args) => {
        const target = strArg(args, "target");
        if (!target) throw new Error("Missing required argument: target.");
        const r = await browserController.evaluate(`
          (function(){
            var t = ${jsStr(target)};
            var el = null;
            if (t.indexOf("css:") === 0) {
              el = document.querySelector(t.slice(4));
            } else {
              var els = document.querySelectorAll("a,button,[role=button],input[type=submit]");
              for (var i = 0; i < els.length; i++) {
                if ((els[i].innerText || "").trim().indexOf(t) !== -1) { el = els[i]; break; }
              }
            }
            if (!el) return "NOT_FOUND";
            el.click();
            return "CLICKED";
          })()
        `);
        if (!r.ok) throw new Error(r.error || "Click failed.");
        if (r.value === "NOT_FOUND") {
          throw new Error(`No clickable element found for "${target}".`);
        }
        return `Clicked "${target}". Use browser_snapshot to see the result.`;
      },
    },
    {
      name: "browser_input",
      description:
        "Type text into an input field on the page. Find the field by its placeholder, label text, or CSS selector.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description:
              'Placeholder or label text of the input (e.g. "Search"), or CSS selector prefixed with "css:" (e.g. "css:input[name=q]").',
          },
          text: { type: "string", description: "The text to type." },
          submit: {
            type: "boolean",
            description: "Press Enter after typing (default false).",
          },
        },
        required: ["target", "text"],
        additionalProperties: false,
      },
      manualId: "browser",
      run: async (args) => {
        const target = strArg(args, "target");
        const text = strArg(args, "text");
        if (!target) throw new Error("Missing required argument: target.");
        const submit = args.submit === true;
        const r = await browserController.evaluate(`
          (function(){
            var t = ${jsStr(target)};
            var el = null;
            if (t.indexOf("css:") === 0) {
              el = document.querySelector(t.slice(4));
            } else {
              var els = document.querySelectorAll("input,textarea");
              for (var i = 0; i < els.length; i++) {
                var ph = els[i].getAttribute("placeholder") || "";
                var lb = els[i].getAttribute("aria-label") || "";
                if (ph.indexOf(t) !== -1 || lb.indexOf(t) !== -1) { el = els[i]; break; }
              }
            }
            if (!el) return "NOT_FOUND";
            el.focus();
            el.value = ${jsStr(text)};
            el.dispatchEvent(new Event("input", {bubbles: true}));
            el.dispatchEvent(new Event("change", {bubbles: true}));
            ${submit ? `el.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));` : ""}
            return "TYPED";
          })()
        `);
        if (!r.ok) throw new Error(r.error || "Input failed.");
        if (r.value === "NOT_FOUND") {
          throw new Error(`No input field found for "${target}".`);
        }
        return `Typed into "${target}".`;
      },
    },
    {
      name: "browser_back",
      description: "Go back to the previous page in the browser history.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "browser",
      run: async () => {
        browserController.goBack();
        return "Went back. Use browser_snapshot to see the page.";
      },
    },
    {
      name: "browser_forward",
      description: "Go forward to the next page in the browser history.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "browser",
      run: async () => {
        browserController.goForward();
        return "Went forward. Use browser_snapshot to see the page.";
      },
    },
    {
      name: "browser_screenshot",
      description:
        "Take a screenshot of the current browser page. You SEE the image — use it when the layout, visuals, or something snapshot text can't capture matters. Needs a dev build (not Expo Go).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "browser",
      run: async () => {
        let uri: string;
        try {
          uri = await browserController.captureScreenshot();
        } catch (e) {
          throw new Error(e instanceof Error ? e.message : "Screenshot failed.");
        }
        // Marker the agent loop converts into an image_url block for vision.
        // Never fake pixels: uri is a real file from react-native-view-shot.
        return `[SCREENSHOT]\n${uri}`;
      },
    },
  ];
  return tools;
}

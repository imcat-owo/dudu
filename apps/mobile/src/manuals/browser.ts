/** Manual: browser — AI-driven web browsing. PURE — no RN imports. */
export const BROWSER_MANUAL = {
  id: "browser",
  title: "Browser: AI-driven web browsing",
  file: "src/manuals/browser.ts",
  when: "opening web pages, reading websites, clicking buttons, filling forms, or browser questions",
  body: `# Browser: AI-driven web browsing

You have a real browser (WebView) you can drive. She can see the browser view too — browsing is transparent, not hidden.

Your tools:
- browser_navigate: open a URL. Validates the address first.
- browser_snapshot: read the current page as text (title + URL + content). Call after navigating or clicking.
- browser_click: click by visible text ("Sign in") or CSS selector ("css:button.submit").
- browser_input: type into a field by placeholder/label text, or CSS selector. Set submit=true to press Enter.
- browser_back / browser_forward: history navigation.
- browser_screenshot: take a screenshot of the page — YOU SEE THE IMAGE. Use when layout, visuals, or design matters, or when snapshot text isn't enough. Needs a dev build (not Expo Go); fails honestly otherwise.

Typical flow:
1. browser_navigate to the page.
2. browser_snapshot to see what's there (fast, text).
3. browser_click / browser_input to interact.
4. browser_snapshot again to see the result — or browser_screenshot when you need to SEE it.

Rules:
- NEVER claim you opened or read a page you didn't — if a tool errors, say so.
- If the browser view isn't mounted, tools fail honestly with "not ready" — don't fake results.
- Don't use the browser for things she should do herself (logging into her accounts, purchases) — ask her first.
- Heavy pages may take a moment; snapshot after navigating, not during.
`,
};

/** Manual: open_app — "light control" （轻控制）. PURE — no RN imports. */
export const OPEN_APP_MANUAL = {
  id: "open_app",
  title: "Open another app （轻控制）",
  file: "src/manuals/openapp.ts",
  when: "she asks you to open another app, take her somewhere, or run one of her Shortcuts",
  body: `# Open another app （轻控制）

Your "light control" hand: you DECIDE, the whitelist defines the paths.
You can never invent a URL — only the fixed entries in
src/openapp/whitelist.ts exist. Unknown entry id = refuse honestly.

Two modes:
- Web entries (or inApp=true on entries with a web version): open inside
  嘟嘟's own browser. No approval needed — she never leaves the app.
- Jump entries: leave 嘟嘟 for the other app. The tool ALWAYS pops HER
  approval first (capability "open_apps"). She says no = you stay put,
  honestly.

What happens on a jump:
1. You ask her (the popup does it — allow once / always / deny).
2. She allows → the app opens. If the app isn't installed, the tool tells
   you honestly instead of pretending.
3. A watchdog notification is armed (default 5 min, she can change 1-60):
   "玩得怎么样？点我，我带你回来". Tapping it routes back to THIS dialog
   and you greet her back ("回来了？刚才那家怎么样").

Hard honesty rules （她的研究结论，不许软化）:
- You CANNOT see inside the other app (iOS sandbox). NEVER claim to know
  what happened there — no "看你被拒了", no "玩得不开心吧". Ask, don't assert.
- You CANNOT pull 嘟嘟 back to the foreground. The notification is a
  reminder SHE taps — never promise "我会自动把你带回来".
- Shortcuts ("快捷指令") is the escape hatch: she builds the shortcut
  herself, you only trigger it by name. The shortcut does the work, not you.

Entry catalogue lives in the tool description (open_app). When she wants a
new app added, that's a whitelist change — ask her which app, add the
documented scheme, never guess a scheme.`,
};

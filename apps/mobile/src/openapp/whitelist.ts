/**
 * x-callback / URL-scheme whitelist — "light control" （轻控制）.
 *
 * PURE module: no React Native / expo imports. Node-testable.
 *
 * "AI 只做决策不猜界面" (the AI decides, never guesses interfaces):
 * the AI may ONLY open the fixed action paths listed here. There is no
 * "open this arbitrary URL" — an unknown entry id is rejected, and every
 * template slot is declared with required/optional up front.
 *
 * Schemes below are the documented / long-established ones:
 * - tel:/sms:/mailto: — RFC / iOS system schemes
 * - https://maps.apple.com/ — Apple Map Links (documented)
 * - iosamap://poi — AMap URI API (documented)
 * - weixin://, alipay://, taobao://, openapp.jdmobile://, bilibili://,
 *   music://, orpheus://, qqmusic:// — the apps' long-standing schemes
 * - shortcuts://x-callback-url/run-shortcut — Apple Shortcuts (documented)
 * - bear://x-callback-url, things:///x-callback-url, drafts://x-callback-url
 *   — the canonical documented x-callback-url apps
 *
 * Honesty notes (her research, ai-control-phone-ios-20261005):
 * - Dudu CANNOT see inside the other app (iOS sandbox). Nothing here
 *   detects what happens after the jump.
 * - Dudu CANNOT pull itself back to the foreground. The only legal return
 *   path is the watchdog notification tap (see watchdog.ts).
 * - x-callback x-success is NOT wired: the app has no incoming-URL
 *   listener, so a callback URL would go nowhere. The watchdog is the
 *   return path for every entry, x-callback or not.
 */

export type OpenAppMode = "jump" | "webview";

export interface OpenAppParamDef {
  name: string;
  required: boolean;
  /** Example value, shown to the AI. */
  example: string;
}

export interface OpenAppEntry {
  /** Stable id the AI passes to the open_app tool. */
  id: string;
  /** Brand name — a proper noun, identical in every language. */
  app: string;
  /** One line for the AI: when this action is the right one. */
  useWhen: string;
  /** jump = leaves 嘟嘟 via URL scheme (needs her approval). webview = opens
   *  inside 嘟嘟's browser (no approval, she never leaves). */
  mode: OpenAppMode;
  /** URL template with {param} slots. Path slots are required; query slots
   *  (k={v}) are dropped when the value is empty. */
  url: string;
  /** https alternative opened in the in-app browser (no approval needed).
   *  Absent = this action has no web version. */
  webUrl?: string;
  params: OpenAppParamDef[];
  /** True when the template follows x-callback-url conventions. */
  xCallback?: boolean;
}

export const OPEN_APP_WHITELIST: OpenAppEntry[] = [
  {
    id: "phone-call",
    app: "电话",
    useWhen: "She asks you to call someone (a phone number she gave or confirmed).",
    mode: "jump",
    url: "tel:{phone}",
    params: [{ name: "phone", required: true, example: "13800138000" }],
  },
  {
    id: "sms-send",
    app: "信息",
    useWhen:
      "She asks you to open the Messages app for a number (message body is typed by her — the scheme can't prefill it on iOS).",
    mode: "jump",
    url: "sms:{phone}",
    params: [{ name: "phone", required: true, example: "13800138000" }],
  },
  {
    id: "mail-compose",
    app: "邮件",
    useWhen: "She asks you to compose an email (address required; subject/body optional).",
    mode: "jump",
    url: "mailto:{email}?subject={subject}&body={body}",
    params: [
      { name: "email", required: true, example: "xingxing@example.com" },
      { name: "subject", required: false, example: "周末计划" },
      { name: "body", required: false, example: "周六去看海？" },
    ],
  },
  {
    id: "apple-maps-search",
    app: "Apple 地图",
    useWhen: "She asks where something is / how to get somewhere and prefers Apple Maps.",
    mode: "jump",
    url: "https://maps.apple.com/?q={query}",
    params: [{ name: "query", required: true, example: "西湖" }],
  },
  {
    id: "apple-maps-directions",
    app: "Apple 地图导航",
    useWhen: "She asks for driving directions to a place in Apple Maps.",
    mode: "jump",
    url: "https://maps.apple.com/?daddr={destination}&dirflg=d",
    params: [{ name: "destination", required: true, example: "西湖" }],
  },
  {
    id: "amap-search",
    app: "高德地图",
    useWhen: "She asks where something is and prefers 高德地图 (better POI coverage in China).",
    mode: "jump",
    url: "iosamap://poi?sourceApplication=dudu&keywords={query}",
    params: [{ name: "query", required: true, example: "西湖" }],
  },
  {
    id: "wechat-open",
    app: "微信",
    useWhen:
      "She asks you to open 微信 (e.g. to check a chat or pay). Opens the app home — you can't deep-link into a specific chat.",
    mode: "jump",
    url: "weixin://",
    params: [],
  },
  {
    id: "alipay-open",
    app: "支付宝",
    useWhen: "She asks you to open 支付宝 (e.g. to pay). Opens the app home.",
    mode: "jump",
    url: "alipay://",
    params: [],
  },
  {
    id: "taobao-open",
    app: "淘宝",
    useWhen:
      "She asks you to open 淘宝 to shop. Prefer the in-app web version when she just wants to browse (no approval needed).",
    mode: "jump",
    url: "taobao://",
    webUrl: "https://www.taobao.com",
    params: [],
  },
  {
    id: "jd-open",
    app: "京东",
    useWhen: "She asks you to open 京东 to shop. Prefer the in-app web version for browsing.",
    mode: "jump",
    url: "openapp.jdmobile://",
    webUrl: "https://www.jd.com",
    params: [],
  },
  {
    id: "bilibili-open",
    app: "哔哩哔哩",
    useWhen: "She asks you to open 哔哩哔哩. Opens the app home.",
    mode: "jump",
    url: "bilibili://",
    webUrl: "https://www.bilibili.com",
    params: [],
  },
  {
    id: "youtube-watch",
    app: "YouTube",
    useWhen:
      "She shares a YouTube video id and wants to watch it. Always in-app — she never leaves 嘟嘟.",
    mode: "webview",
    url: "https://www.youtube.com/watch?v={videoId}",
    webUrl: "https://www.youtube.com/watch?v={videoId}",
    params: [{ name: "videoId", required: true, example: "dQw4w9WgXcQ" }],
  },
  {
    id: "apple-music-open",
    app: "Apple Music",
    useWhen: "She asks you to open Apple Music.",
    mode: "jump",
    url: "music://",
    params: [],
  },
  {
    id: "netease-music-open",
    app: "网易云音乐",
    useWhen: "She asks you to open 网易云音乐.",
    mode: "jump",
    url: "orpheus://",
    params: [],
  },
  {
    id: "qqmusic-open",
    app: "QQ音乐",
    useWhen: "She asks you to open QQ音乐.",
    mode: "jump",
    url: "qqmusic://",
    params: [],
  },
  {
    id: "shortcuts-run",
    app: "快捷指令",
    useWhen:
      "She asks you to run one of HER Shortcuts by name (she builds the shortcut herself; you only trigger it). " +
      "This is the bridge for anything without a fixed path — the shortcut does the work, not you.",
    mode: "jump",
    url: "shortcuts://x-callback-url/run-shortcut?name={name}",
    params: [{ name: "name", required: true, example: "晚安模式" }],
    xCallback: true,
  },
  {
    id: "bear-note",
    app: "Bear",
    useWhen: "She asks you to open a Bear note by title.",
    mode: "jump",
    url: "bear://x-callback-url/open-note?title={title}",
    params: [{ name: "title", required: true, example: "旅行清单" }],
    xCallback: true,
  },
  {
    id: "things-add",
    app: "Things",
    useWhen: "She asks you to add a to-do to Things (title required; notes optional).",
    mode: "jump",
    url: "things:///x-callback-url/add?title={title}&notes={notes}",
    params: [
      { name: "title", required: true, example: "买牛奶" },
      { name: "notes", required: false, example: "全脂" },
    ],
    xCallback: true,
  },
  {
    id: "drafts-create",
    app: "Drafts",
    useWhen: "She asks you to jot something down in Drafts.",
    mode: "jump",
    url: "drafts://x-callback-url/create?text={text}",
    params: [{ name: "text", required: true, example: "灵感：给嘟嘟加个晚安模式" }],
    xCallback: true,
  },
];

/** Look up a whitelist entry by id. Null = not whitelisted, never open it. */
export function lookupOpenAppEntry(id: string): OpenAppEntry | null {
  const needle = id.trim();
  if (!needle) return null;
  return OPEN_APP_WHITELIST.find((e) => e.id === needle) ?? null;
}

/**
 * Build the concrete URL from an entry template + args.
 * Path slots {name} are required and URI-encoded. Query slots (k={v})
 * are dropped when the value is empty. Throws on missing required params
 * or unknown template slots.
 */
export function buildEntryUrl(entry: OpenAppEntry, args: Record<string, unknown>): string {
  const values: Record<string, string> = {};
  for (const p of entry.params) {
    const raw = args[p.name];
    const v = typeof raw === "string" ? raw.trim() : "";
    if (p.required && !v) {
      throw new Error(`Missing required parameter "${p.name}" (e.g. ${p.example}).`);
    }
    values[p.name] = v;
  }
  const q = entry.url.indexOf("?");
  const pathTemplate = q < 0 ? entry.url : entry.url.slice(0, q);
  const path = pathTemplate.replace(/\{(\w+)\}/g, (_m, name: string) => {
    if (!(name in values))
      throw new Error(`Unknown template slot {${name}} in entry "${entry.id}".`);
    const v = values[name];
    if (!v) throw new Error(`Missing required parameter "${name}".`);
    return encodeURIComponent(v);
  });
  if (q < 0) return path;
  const kept: string[] = [];
  for (const pair of entry.url.slice(q + 1).split("&")) {
    const m = pair.match(/^([^=]+)=\{(\w+)\}$/);
    if (!m) {
      kept.push(pair);
      continue;
    }
    const v = values[m[2]];
    if (v) kept.push(`${m[1]}=${encodeURIComponent(v)}`);
  }
  return kept.length > 0 ? `${path}?${kept.join("&")}` : path;
}

/** Build the in-app web URL for an entry. Throws when the entry has no web version. */
export function buildWebUrl(entry: OpenAppEntry, args: Record<string, unknown>): string {
  if (!entry.webUrl) {
    throw new Error(
      `"${entry.app}" has no web version — it can only be opened by jumping out (needs her approval).`,
    );
  }
  return buildEntryUrl({ ...entry, url: entry.webUrl }, args);
}

/** One-line catalogue for the tool description, so the AI knows the fixed set. */
export function describeWhitelist(): string {
  return OPEN_APP_WHITELIST.map((e) => {
    const ps = e.params.map((p) => (p.required ? p.name : `${p.name}?`)).join(", ");
    const web = e.webUrl ? " (+web)" : "";
    return `- ${e.id}${web} — ${e.app}${ps ? ` (${ps})` : ""}: ${e.useWhen}`;
  }).join("\n");
}

/** URL schemes the app declares in LSApplicationQueriesSchemes (app.json),
 * so Linking.canOpenURL works honestly on iOS. */
export const QUERIED_SCHEMES = [
  "tel",
  "sms",
  "mailto",
  "weixin",
  "alipay",
  "taobao",
  "openapp.jdmobile",
  "bilibili",
  "music",
  "orpheus",
  "qqmusic",
  "iosamap",
  "shortcuts",
  "bear",
  "things",
  "drafts",
];

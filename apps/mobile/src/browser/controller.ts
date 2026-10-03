/**
 * AI Browser Controller — PURE module (no React Native imports).
 *
 * The AI drives a real WebView through this singleton. The WebView itself
 * lives in AIBrowserView.tsx, which registers its ref here on mount.
 *
 * How it works:
 * - Navigation (go/back/forward) uses the WebView ref methods directly.
 * - Page interaction (snapshot/click/input) uses injected JavaScript.
 * - injectJavaScript is fire-and-forget in react-native-webview, so we
 *   correlate results via window.ReactNativeWebView.postMessage with a
 *   unique id; the view resolves the pending promise in onMessage.
 *
 * Honest limits (do NOT fake these):
 * - If no WebView is mounted, every method throws "browser not ready".
 * - Screenshots need react-native-view-shot (native module, dev build only).
 *   In Expo Go the native module is missing — captureScreenshot throws
 *   honestly instead of faking pixels.
 */

export interface BrowserEvalResult {
  ok: boolean;
  value?: string;
  error?: string;
}

/** Minimal WebView ref surface we need. Implemented by AIBrowserView. */
export interface BrowserWebViewRef {
  injectJavaScript: (js: string) => void;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  /** Capture the WebView as a PNG file. Resolves with the file URI. */
  captureScreenshot: () => Promise<string>;
}

type PendingEval = {
  resolve: (r: BrowserEvalResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

const EVAL_TIMEOUT_MS = 15000;

class BrowserController {
  private webview: BrowserWebViewRef | null = null;
  private pending = new Map<string, PendingEval>();
  private seq = 0;
  private currentUrl: string = "";

  /** Called by AIBrowserView on mount/unmount. */
  setWebView(ref: BrowserWebViewRef | null): void {
    this.webview = ref;
  }

  /** Called by AIBrowserView's onMessage. */
  handleMessage(raw: string): void {
    let msg: { id?: string; ok?: boolean; value?: string; error?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg.id) return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    p.resolve({ ok: msg.ok !== false, value: msg.value, error: msg.error });
  }

  private requireWebView(): BrowserWebViewRef {
    if (!this.webview) {
      throw new Error("Browser is not ready — the browser view is not mounted.");
    }
    return this.webview;
  }

  /** Run JS in the page and get the result back. */
  async evaluate(js: string): Promise<BrowserEvalResult> {
    const webview = this.requireWebView();
    const id = `eval_${++this.seq}_${Date.now()}`;
    const wrapped = `(function(){try{var r=(function(){${js}})();window.ReactNativeWebView.postMessage(JSON.stringify({id:${JSON.stringify(id)},ok:true,value:String(r==null?"":r)}));}catch(e){window.ReactNativeWebView.postMessage(JSON.stringify({id:${JSON.stringify(id)},ok:false,error:String(e&&e.message||e)}));}})();`;
    return new Promise<BrowserEvalResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: "Page did not respond in time." });
      }, EVAL_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
      webview.injectJavaScript(wrapped);
    });
  }

  get url(): string {
    return this.currentUrl;
  }

  setUrl(url: string): void {
    this.currentUrl = url;
  }

  isReady(): boolean {
    return this.webview !== null;
  }

  goBack(): void {
    this.requireWebView().goBack();
  }

  goForward(): void {
    this.requireWebView().goForward();
  }

  reload(): void {
    this.requireWebView().reload();
  }

  /**
   * Capture the current page as a PNG file. Resolves with the file URI.
   * Throws honestly when the view isn't mounted or capture fails —
   * never invents pixels.
   */
  async captureScreenshot(): Promise<string> {
    return this.requireWebView().captureScreenshot();
  }
}

/** The singleton the AI tools drive. */
export const browserController = new BrowserController();

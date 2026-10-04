/**
 * Knowledge base — PDF text extraction (Phase 2).
 *
 * Uses a hidden WebView running pdf.js to extract text from PDF files.
 * React Native has no built-in PDF parser; this is the most reliable
 * approach (per research/mobile-rag-plan.md).
 *
 * PDF bytes are read on the RN side (expo-file-system, base64) and handed
 * to the WebView as data — iOS WKWebView / Android WebView block file://
 * fetches from inline HTML, so the WebView never touches the filesystem.
 *
 * pdf.js loads from CDN: a load timeout plus an RN-side watchdog make sure
 * an offline/failed load surfaces an honest error instead of hanging.
 *
 * Usage: render <PdfTextExtractor uri={...} onDone={...} onError={...} />
 * once per PDF. It extracts all page text and calls onDone with the
 * combined string, then unmounts itself.
 */

import * as FileSystem from "expo-file-system/legacy";
import { useCallback, useEffect, useRef, useState } from "react";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.mjs";
const PDFJS_WORKER_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.mjs";

/** Give up on the pdf.js CDN bundle after this long (offline → honest error). */
const PDFJS_LOAD_TIMEOUT_MS = 30_000;
/** Extraction must report progress within this window or we call it stuck. */
const EXTRACT_WATCHDOG_MS = 120_000;

function extractorHtml(pdfBase64: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<script type="module">
const PDF_B64 = ${JSON.stringify(pdfBase64)};
const PDFJS_CDN = ${JSON.stringify(PDFJS_CDN)};
const PDFJS_WORKER_CDN = ${JSON.stringify(PDFJS_WORKER_CDN)};
const PDFJS_LOAD_TIMEOUT_MS = ${PDFJS_LOAD_TIMEOUT_MS};
function post(msg) {
  window.ReactNativeWebView.postMessage(JSON.stringify(msg));
}
function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
async function loadPdfJs() {
  let timer = 0;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("pdfJsLoadTimeout")), PDFJS_LOAD_TIMEOUT_MS);
  });
  try {
    return await Promise.race([import(PDFJS_CDN), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
(async () => {
  try {
    const pdfjs = await loadPdfJs();
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
    const pdf = await pdfjs.getDocument({ data: b64ToBytes(PDF_B64) }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map((it) => it.str ?? "");
      pages.push(strings.join(" "));
      post({ type: "progress", page: i, total: pdf.numPages });
    }
    post({ type: "done", text: pages.join("\\n\\n") });
  } catch (e) {
    post({ type: "error", message: String((e && e.message) || e || "unknown") });
  }
})();
</script>
</body></html>`;
}

export interface PdfTextExtractorProps {
  /** Local file URI of the PDF (from DocumentPicker). */
  uri: string;
  onProgress?: (page: number, total: number) => void;
  onDone: (text: string) => void;
  onError: (message: string) => void;
}

/**
 * Hidden WebView that extracts PDF text. Renders nothing visible —
 * mount it, wait for onDone/onError, then unmount.
 */
export function PdfTextExtractor({ uri, onProgress, onDone, onError }: PdfTextExtractorProps) {
  const doneRef = useRef(false);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDoneRef = useRef(onDone);
  const onErrorRef = useRef(onError);
  const onProgressRef = useRef(onProgress);
  onDoneRef.current = onDone;
  onErrorRef.current = onError;
  onProgressRef.current = onProgress;
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const fail = useCallback(
    (message: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      clearWatchdog();
      onErrorRef.current(message);
    },
    [clearWatchdog],
  );

  const kickWatchdog = useCallback(() => {
    clearWatchdog();
    watchdogRef.current = setTimeout(() => fail("timeout"), EXTRACT_WATCHDOG_MS);
  }, [clearWatchdog, fail]);

  // Read the PDF bytes on the RN side — the WebView cannot fetch file:// URLs.
  useEffect(() => {
    let cancelled = false;
    doneRef.current = false;
    setPdfBase64(null);
    FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })
      .then((data) => {
        if (!cancelled) setPdfBase64(data);
      })
      .catch((e) => {
        if (!cancelled) fail(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      clearWatchdog();
    };
  }, [uri, fail, clearWatchdog]);

  const handleMessage = (e: WebViewMessageEvent) => {
    if (doneRef.current) return;
    try {
      const msg = JSON.parse(e.nativeEvent.data) as
        | { type: "progress"; page: number; total: number }
        | { type: "done"; text: string }
        | { type: "error"; message: string };
      if (msg.type === "progress") {
        kickWatchdog();
        onProgressRef.current?.(msg.page, msg.total);
      } else if (msg.type === "done") {
        doneRef.current = true;
        clearWatchdog();
        onDoneRef.current(msg.text);
      } else if (msg.type === "error") {
        fail(msg.message);
      }
    } catch {
      // ignore malformed messages
    }
  };

  if (!pdfBase64) return null;

  return (
    <WebView
      source={{ html: extractorHtml(pdfBase64) }}
      onMessage={handleMessage}
      onError={(e) => fail(String(e.nativeEvent.description || "webviewError"))}
      onHttpError={(e) => fail(`httpError:${e.nativeEvent.statusCode}`)}
      onLoadStart={kickWatchdog}
      javaScriptEnabled
      domStorageEnabled={false}
      style={{ width: 0, height: 0, opacity: 0 }}
      originWhitelist={["*"]}
    />
  );
}

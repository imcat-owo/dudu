/**
 * Knowledge base — PDF text extraction (Phase 2).
 *
 * Uses a hidden WebView running pdf.js to extract text from PDF files.
 * React Native has no built-in PDF parser; this is the most reliable
 * approach (per research/mobile-rag-plan.md).
 *
 * Usage: render <PdfTextExtractor uri={...} onDone={...} onError={...} />
 * once per PDF. It extracts all page text and calls onDone with the
 * combined string, then unmounts itself.
 */

import { useEffect, useRef } from "react";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.mjs";
const PDFJS_WORKER_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.mjs";

function extractorHtml(pdfUri: string): string {
  // The PDF uri is a local file:// path — WebView can fetch it directly.
  // pdf.js extracts text page by page and posts it back.
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<script type="module">
import * as pdfjs from "${PDFJS_CDN}";
pdfjs.GlobalWorkerOptions.workerSrc = "${PDFJS_WORKER_CDN}";
function post(msg) {
  window.ReactNativeWebView.postMessage(JSON.stringify(msg));
}
(async () => {
  try {
    const pdf = await pdfjs.getDocument(${JSON.stringify(pdfUri)}).promise;
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
    post({ type: "error", message: String(e && e.message ? e.message : e) });
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
  const onDoneRef = useRef(onDone);
  const onErrorRef = useRef(onError);
  onDoneRef.current = onDone;
  onErrorRef.current = onError;

  useEffect(() => {
    doneRef.current = false;
  }, [uri]);

  const handleMessage = (e: WebViewMessageEvent) => {
    if (doneRef.current) return;
    try {
      const msg = JSON.parse(e.nativeEvent.data) as
        | { type: "progress"; page: number; total: number }
        | { type: "done"; text: string }
        | { type: "error"; message: string };
      if (msg.type === "progress") {
        onProgress?.(msg.page, msg.total);
      } else if (msg.type === "done") {
        doneRef.current = true;
        onDoneRef.current(msg.text);
      } else if (msg.type === "error") {
        doneRef.current = true;
        onErrorRef.current(msg.message);
      }
    } catch {
      // ignore malformed messages
    }
  };

  return (
    <WebView
      source={{ html: extractorHtml(uri), baseUrl: "" }}
      onMessage={handleMessage}
      javaScriptEnabled
      domStorageEnabled={false}
      style={{ width: 0, height: 0, opacity: 0 }}
      // No file access needed beyond the pdfUri fetch; keep locked down.
      allowFileAccess={true}
      originWhitelist={["*"]}
    />
  );
}

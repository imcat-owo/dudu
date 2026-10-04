/**
 * PdfExtractBridge — hidden component that wires PDF text extraction
 * for the AI `knowledge_add_file` tool.
 *
 * The tool itself is PURE (no RN imports); PDF parsing needs a hidden
 * WebView running pdf.js (see pdf-extract.tsx), which only the UI layer
 * can mount. This bridge registers a promise-based handler with the
 * tool module and mounts <PdfTextExtractor> on demand.
 *
 * Mount once near the app root (local-app.tsx). Zero visual output.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { PdfTextExtractor } from "./pdf-extract";
import { registerPdfExtractHandler } from "./tools";

interface PendingJob {
  uri: string;
  resolve: (text: string) => void;
  reject: (err: Error) => void;
}

export function PdfExtractBridge() {
  const [job, setJob] = useState<PendingJob | null>(null);
  const jobRef = useRef<PendingJob | null>(null);
  jobRef.current = job;

  const finish = useCallback((uri: string, err: Error | null, text?: string) => {
    const pending = jobRef.current;
    if (!pending || pending.uri !== uri) return;
    setJob(null);
    if (err) pending.reject(err);
    else pending.resolve(text ?? "");
  }, []);

  useEffect(() => {
    registerPdfExtractHandler(
      (uri: string) =>
        new Promise<string>((resolve, reject) => {
          // One extraction at a time; a second call while busy fails
          // honestly instead of piling up hidden WebViews.
          if (jobRef.current) {
            reject(new Error("A PDF extraction is already running — try again in a moment."));
            return;
          }
          setJob({ uri, resolve, reject });
        }),
    );
  }, []);

  if (!job) return null;
  return (
    <PdfTextExtractor
      uri={job.uri}
      onDone={(text) => finish(job.uri, null, text)}
      onError={(message) => finish(job.uri, new Error(message))}
    />
  );
}

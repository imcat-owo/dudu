/**
 * JS global error handler (2026-10-06).
 *
 * The native crash trap catches NSExceptions before they reach JS, but if
 * a converted NSException error (or any other uncaught JS error) ever
 * surfaces in the JS thread, this handler persists it into the existing
 * crash-report ring buffer so the next launch can show it.
 *
 * Installed once from index.js before registerRootComponent. Never
 * throws; the previous handler is always chained.
 */

import { recordCrashReport } from "./crash-report";

let installed = false;

/** Install the global handler. Safe to call repeatedly. */
export function installJSGlobalHandler(): void {
  if (installed) return;
  installed = true;
  try {
    const prev = ErrorUtils.getGlobalHandler();
    ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
      void recordCrashReport(error, isFatal ? "fatal-js" : "js-global");
      if (prev) prev(error, isFatal);
    });
  } catch {
    // The handler must never break boot.
  }
}

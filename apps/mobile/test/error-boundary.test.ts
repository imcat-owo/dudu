import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "node:test";

// react-native / lucide can't load under plain tsx (Flow syntax), so stub
// the imports before the module under test is required.
const originalLoad = (Module as any)._load;
(Module as any)._load = function (request: string, ...rest: unknown[]) {
  if (request === "react-native") {
    return {
      Pressable: "Pressable",
      Text: "Text",
      View: "View",
      useColorScheme: () => "light",
    };
  }
  if (request === "lucide-react-native") {
    return { HeartCrack: "HeartCrack", RotateCcw: "RotateCcw" };
  }
  if (request === "./i18n" || request.endsWith("/i18n")) {
    return { t: (key: string) => key };
  }
  return originalLoad.call(this, request, ...rest);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ErrorBoundary } =
  require("../src/error-boundary") as typeof import("../src/error-boundary");

function makeBoundary(props: Record<string, unknown>) {
  const b = new (ErrorBoundary as any)(props);
  b.setState = (s: unknown) => {
    const patch = typeof s === "function" ? (s as any)(b.state) : s;
    b.state = { ...b.state, ...patch };
  };
  return b;
}

test("getDerivedStateFromError captures the thrown error", () => {
  const err = new Error("boom");
  const state = (ErrorBoundary as any).getDerivedStateFromError(err);
  assert.equal(state.error, err);
});

test("retry button resets the boundary to healthy", () => {
  const b = makeBoundary({ children: null });
  b.state = { error: new Error("boom") };
  b.handleRetry();
  assert.equal(b.state.error, null);
});

test("resetKey change clears a crash (tab switch recovers)", () => {
  const b = makeBoundary({ children: null, resetKey: "chat" });
  b.state = { error: new Error("boom") };
  // Same tab: error stays.
  b.componentDidUpdate({ children: null, resetKey: "chat" }, {});
  assert.ok(b.state.error instanceof Error);
  // Switched tab: boundary resets so the new tab renders.
  b.props = { children: null, resetKey: "space" };
  b.componentDidUpdate({ children: null, resetKey: "chat" }, {});
  assert.equal(b.state.error, null);
});

test("healthy boundary does not reset on unrelated updates", () => {
  const b = makeBoundary({ children: null, resetKey: "chat" });
  b.props = { children: null, resetKey: "space" };
  b.componentDidUpdate({ children: null, resetKey: "chat" }, {});
  assert.equal(b.state.error, null);
});

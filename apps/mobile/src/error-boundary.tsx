import { HeartCrack, RotateCcw } from "lucide-react-native";
import { Component, type ReactNode, useEffect, useState } from "react";
import { Pressable, Text, useColorScheme, View } from "react-native";
import { type BootMark, bootMark, readBootLog } from "./bootlog";
import { type CrashReport, readCrashReports, recordCrashReport } from "./crash-report";
import { t } from "./i18n";
import { readNativeCrashLog } from "./native-crash-log";
import { CRASH_PALETTE } from "./theme/crash-palette";
import { radii } from "./theme/radii";

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * When this value changes the boundary resets to a healthy state.
   * Pass the current tab/section so switching tabs clears a crash in
   * another tab instead of showing the fallback everywhere.
   */
  resetKey?: string | number;
  /** Screen label, used only for the accessibility label. */
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render errors below it and shows a friendly fallback instead of
 * a white screen. The fallback is deliberately provider-free (no theme
 * hooks, no images) so it still renders when a provider itself crashed.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // Record the crash (message + stack + timestamp) so a JS crash leaves
    // a trace on the device — previously this was intentionally silent.
    // Still record the boot milestone so the boot log shows where the JS
    // tree died.
    void recordCrashReport(error, this.props.label);
    void bootMark("js-crash-caught");
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private readonly handleRetry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return <CrashFallback label={this.props.label} onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}

function CrashFallback({ label, onRetry }: { label?: string; onRetry: () => void }) {
  // Deliberately NOT using the theme provider: this is the last-resort crash
  // screen — if the theme system itself is what crashed, depending on it
  // would blank the fallback too. useColorScheme() alone is safe, and the
  // palette lives in theme/crash-palette.ts as static tokens (not inline hex).
  //
  // Deliberately NOT using TText either: TText reads the font-size store,
  // so if the font system is what crashed, the fallback would white-screen
  // too. Raw react-native Text only.
  const dark = useColorScheme() === "dark";
  const p = CRASH_PALETTE[dark ? "dark" : "light"];
  // Crash-bisection (2026-10-06): show the startup milestones so a screenshot
  // of this screen tells us how far boot got before dying. Also show the
  // recorded crash report (what the error actually was).
  const [marks, setMarks] = useState<BootMark[]>([]);
  const [report, setReport] = useState<CrashReport | null>(null);
  // Native trap log (NSException + RCTLog lines written by the AppDelegate
  // trap). Identifies which native module threw at startup.
  const [nativeLog, setNativeLog] = useState<string[]>([]);
  // Occurrence counters for stable React keys on (possibly repeated) log lines.
  const nativeLogKeys = new Map<string, number>();
  useEffect(() => {
    let alive = true;
    void readBootLog().then((m) => {
      if (alive) setMarks(m.slice(-8));
    });
    void readCrashReports().then((r) => {
      if (alive) setReport(r.length > 0 ? r[r.length - 1] : null);
    });
    void readNativeCrashLog().then((lines) => {
      if (alive) setNativeLog(lines.slice(-12));
    });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel={label ? `${t("error.crashTitle")} — ${label}` : t("error.crashTitle")}
      style={{
        flex: 1,
        backgroundColor: p.bg,
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        gap: 14,
      }}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: radii.xl,
          backgroundColor: p.iconBg,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 6,
        }}
      >
        <HeartCrack size={34} strokeWidth={1.6} color={p.muted} />
      </View>
      <Text style={{ fontSize: 19, fontWeight: "600", color: p.fg, textAlign: "center" }}>
        {t("error.crashTitle")}
      </Text>
      <Text
        style={{
          fontSize: 14,
          color: p.muted,
          textAlign: "center",
          lineHeight: 21,
          maxWidth: 300,
        }}
      >
        {t("error.crashBody")}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("common.retry")}
        onPress={onRetry}
        style={({ pressed }) => ({
          marginTop: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: p.buttonBg,
          paddingHorizontal: 22,
          paddingVertical: 12,
          borderRadius: radii.xl,
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <RotateCcw size={16} color={p.buttonFg} />
        <Text style={{ fontSize: 15, fontWeight: "600", color: p.buttonFg }}>
          {t("common.retry")}
        </Text>
      </Pressable>
      {report && (
        <View style={{ marginTop: 18, maxWidth: 300 }}>
          <Text style={{ fontSize: 11, color: p.muted, textAlign: "center" }}>
            {new Date(report.t).toLocaleTimeString()}
            {report.label ? ` · ${report.label}` : ""} · {report.message}
          </Text>
        </View>
      )}
      {marks.length > 0 && (
        <View style={{ marginTop: 6, maxWidth: 300 }}>
          {marks.map((m) => (
            <Text
              key={`${m.t}-${m.name}`}
              style={{ fontSize: 11, color: p.muted, textAlign: "center" }}
            >
              {new Date(m.t).toLocaleTimeString()} · {m.name}
            </Text>
          ))}
        </View>
      )}
      {nativeLog.length > 0 && (
        <View style={{ marginTop: 10, maxWidth: 320 }}>
          <Text
            style={{
              fontSize: 11,
              fontWeight: "600",
              color: p.muted,
              textAlign: "center",
              marginBottom: 4,
            }}
          >
            {t("error.nativeLogTitle")}
          </Text>
          {nativeLog.map((line) => {
            // Log lines can repeat; key by content + occurrence count
            // (noArrayIndexKey: index alone is not a stable key).
            const n = (nativeLogKeys.get(line) ?? 0) + 1;
            nativeLogKeys.set(line, n);
            return (
              <Text
                key={`${line}#${n}`}
                style={{
                  fontSize: 9,
                  color: p.muted,
                  textAlign: "left",
                  fontFamily: "Menlo",
                }}
                numberOfLines={2}
              >
                {line}
              </Text>
            );
          })}
        </View>
      )}
    </View>
  );
}

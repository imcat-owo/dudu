import { HeartCrack, RotateCcw } from "lucide-react-native";
import { Component, type ReactNode, useEffect, useState } from "react";
import { Pressable, useColorScheme, View } from "react-native";
import { type BootMark, bootMark, readBootLog } from "./bootlog";
import { TText } from "./font";
import { t } from "./i18n";
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

  componentDidCatch(): void {
    // Intentionally silent: this codebase keeps the console clean and the
    // local-first build has no remote error reporting to send to.
    // Crash-bisection (2026-10-06): still record the milestone so the boot
    // log shows where the JS tree died.
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
  const dark = useColorScheme() === "dark";
  const p = CRASH_PALETTE[dark ? "dark" : "light"];
  // Crash-bisection (2026-10-06): show the startup milestones so a screenshot
  // of this screen tells us how far boot got before dying.
  const [marks, setMarks] = useState<BootMark[]>([]);
  useEffect(() => {
    let alive = true;
    void readBootLog().then((m) => {
      if (alive) setMarks(m.slice(-8));
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
      <TText style={{ fontSize: 19, fontWeight: "600", color: p.fg, textAlign: "center" }}>
        {t("error.crashTitle")}
      </TText>
      <TText
        style={{
          fontSize: 14,
          color: p.muted,
          textAlign: "center",
          lineHeight: 21,
          maxWidth: 300,
        }}
      >
        {t("error.crashBody")}
      </TText>
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
        <TText style={{ fontSize: 15, fontWeight: "600", color: p.buttonFg }}>
          {t("common.retry")}
        </TText>
      </Pressable>
      {marks.length > 0 && (
        <View style={{ marginTop: 18, maxWidth: 300 }}>
          {marks.map((m) => (
            <TText
              key={`${m.t}-${m.name}`}
              style={{ fontSize: 11, color: p.muted, textAlign: "center" }}
            >
              {new Date(m.t).toLocaleTimeString()} · {m.name}
            </TText>
          ))}
        </View>
      )}
    </View>
  );
}

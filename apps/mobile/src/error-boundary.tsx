import { HeartCrack, RotateCcw } from "lucide-react-native";
import { Component, type ReactNode } from "react";
import { Pressable, Text, useColorScheme, View } from "react-native";
import { t } from "./i18n";

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
  const dark = useColorScheme() === "dark";
  const bg = dark ? "#1C1C1E" : "#F6F4F1";
  const fg = dark ? "#F5F2EC" : "#2B2620";
  const muted = dark ? "#A8A29A" : "#8A8378";
  const iconBg = dark ? "#2C2C2E" : "#FFFFFF";
  const buttonBg = dark ? "#E8E2D6" : "#2B2620";
  const buttonFg = dark ? "#2B2620" : "#F6F4F1";
  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel={label ? `${t("error.crashTitle")} — ${label}` : t("error.crashTitle")}
      style={{
        flex: 1,
        backgroundColor: bg,
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
          borderRadius: 36,
          backgroundColor: iconBg,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 6,
        }}
      >
        <HeartCrack size={34} strokeWidth={1.6} color={muted} />
      </View>
      <Text style={{ fontSize: 19, fontWeight: "600", color: fg, textAlign: "center" }}>
        {t("error.crashTitle")}
      </Text>
      <Text
        style={{
          fontSize: 14,
          color: muted,
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
          backgroundColor: buttonBg,
          paddingHorizontal: 22,
          paddingVertical: 12,
          borderRadius: 24,
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <RotateCcw size={16} color={buttonFg} />
        <Text style={{ fontSize: 15, fontWeight: "600", color: buttonFg }}>
          {t("common.retry")}
        </Text>
      </Pressable>
    </View>
  );
}

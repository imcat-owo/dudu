import { t } from "./i18n";
import { radii } from "./theme/radii";
export default function BrowserConsole({ url }: { url: string }) {
  // Web-only debug console: no theme provider here, so follow the OS scheme
  // directly (the app follows the system scheme too).
  const dark =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  return (
    <iframe
      title={t("web.consoleTitle")}
      src={url}
      style={{
        height: 540,
        width: "100%",
        border: 0,
        borderRadius: radii.md,
        background: dark ? "#1C1C1E" : "#FFF",
      }}
    />
  );
}

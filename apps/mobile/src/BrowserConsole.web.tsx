import { t } from "./i18n";
import { radii } from "./theme/radii";
export default function BrowserConsole({ url }: { url: string }) {
  return (
    <iframe
      title={t("web.consoleTitle")}
      src={url}
      style={{ height: 540, width: "100%", border: 0, borderRadius: radii.md, background: "#FFF" }}
    />
  );
}

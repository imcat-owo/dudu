import { t } from "./i18n";
export default function BrowserConsole({ url }: { url: string }) {
  return (
    <iframe
      title={t("web.consoleTitle")}
      src={url}
      style={{ height: 540, width: "100%", border: 0, borderRadius: 12, background: "#FFF" }}
    />
  );
}

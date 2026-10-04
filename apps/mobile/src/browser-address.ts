import { t } from "./i18n";
export function browserAddress(value: string): string {
  const input = value.trim();
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      /\s/.test(input)
    )
      throw new Error(t("browser.invalidAddress"));
    return url.href;
  } catch {
    throw new Error(t("browser.addressHint"));
  }
}

export function browserSite(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "") || "Browser";
  } catch {
    return "Browser";
  }
}

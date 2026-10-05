/**
 * Cookie parsing + clearing JS — PURE module (no React Native imports).
 *
 * D4 cookie audit: parse document.cookie strings and generate the JS
 * that expires JS-accessible cookies. The UI lives in CookieAudit.tsx.
 */

export interface CookieItem {
  name: string;
  value: string;
}

/** Parse a document.cookie string into name/value pairs. */
export function parseCookies(raw: string): CookieItem[] {
  if (!raw.trim()) return [];
  return raw
    .split(";")
    .map((part) => {
      const idx = part.indexOf("=");
      if (idx < 0) return { name: part.trim(), value: "" };
      return { name: part.slice(0, idx).trim(), value: part.slice(idx + 1).trim() };
    })
    .filter((c) => c.name.length > 0);
}

/**
 * JS to run in the page: expire every JS-accessible cookie (path=/ and
 * host domain). Returns the remaining document.cookie string.
 * HttpOnly cookies are invisible to document.cookie and survive this.
 */
export const CLEAR_COOKIES_JS = `(function(){
  var parts = document.cookie.split(";");
  for (var i = 0; i < parts.length; i++) {
    var eq = parts[i].indexOf("=");
    var name = (eq > -1 ? parts[i].slice(0, eq) : parts[i]).trim();
    if (!name) continue;
    document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
    document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=" + location.hostname;
  }
  return document.cookie;
})()`;

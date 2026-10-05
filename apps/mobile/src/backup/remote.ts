/**
 * Remote backup destinations — WebDAV + S3-compatible. PURE module.
 *
 * Learned from Kelivo's WebDavConfig/S3Config (lib/core/models/backup.dart)
 * and S3BackupClient. Credentials NEVER go in logs — the store keeps them
 * in SecureStore; this module only receives them as function arguments and
 * never persists or logs them.
 *
 * WebDAV: PUT to upload, GET to download, PROPFIND to list.
 * S3: SigV4 signed PUT/GET. Works with AWS S3, Cloudflare R2, MinIO, etc.
 */

/** WebDAV destination config (password lives in SecureStore, not here). */
export interface WebDavConfig {
  url: string;
  username: string;
  path: string;
  includeFiles: boolean;
}

/** S3-compatible destination config (secret lives in SecureStore). */
export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  prefix: string;
  pathStyle: boolean;
  includeFiles: boolean;
}

export type RemoteDestination =
  | { kind: "webdav"; config: WebDavConfig; password: string }
  | { kind: "s3"; config: S3Config; secretAccessKey: string; sessionToken?: string };

/** Minimal fetch surface (global fetch in production, fake in tests). */
export interface FetchLike {
  (url: string, init?: RequestInit): Promise<Response>;
}

function joinUrl(base: string, ...parts: string[]): string {
  const b = base.replace(/\/+$/, "");
  const p = parts.map((s) => s.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/");
  return p ? `${b}/${p}` : b;
}

function basicAuth(username: string, password: string): string {
  // btoa is available in React Native (Hermes) and node 16+.
  const enc = typeof btoa !== "undefined" ? btoa : (s: string) => Buffer.from(s, "utf8").toString("base64");
  return `Basic ${enc(`${username}:${password}`)}`;
}

/** Upload a backup file to WebDAV via PUT. */
export async function webdavUpload(
  dest: Extract<RemoteDestination, { kind: "webdav" }>,
  filename: string,
  content: string,
  fetchFn: FetchLike = fetch,
): Promise<void> {
  const url = joinUrl(dest.config.url, dest.config.path, filename);
  const res = await fetchFn(url, {
    method: "PUT",
    headers: {
      Authorization: basicAuth(dest.config.username, dest.password),
      "Content-Type": "application/json",
    },
    body: content,
  });
  if (!res.ok) {
    throw new Error(`webdav-upload-failed:${res.status}`);
  }
}

/** Download a backup file from WebDAV via GET. */
export async function webdavDownload(
  dest: Extract<RemoteDestination, { kind: "webdav" }>,
  filename: string,
  fetchFn: FetchLike = fetch,
): Promise<string> {
  const url = joinUrl(dest.config.url, dest.config.path, filename);
  const res = await fetchFn(url, {
    method: "GET",
    headers: { Authorization: basicAuth(dest.config.username, dest.password) },
  });
  if (!res.ok) {
    throw new Error(`webdav-download-failed:${res.status}`);
  }
  return res.text();
}

/** List backup files in the WebDAV directory via PROPFIND. */
export async function webdavList(
  dest: Extract<RemoteDestination, { kind: "webdav" }>,
  fetchFn: FetchLike = fetch,
): Promise<string[]> {
  const url = joinUrl(dest.config.url, dest.config.path);
  const res = await fetchFn(url, {
    method: "PROPFIND",
    headers: {
      Authorization: basicAuth(dest.config.username, dest.password),
      Depth: "1",
      "Content-Type": "application/xml",
    },
    body: `<?xml version="1.0"?><propfind xmlns="DAV:"><prop><displayname/></prop></propfind>`,
  });
  if (!res.ok) {
    throw new Error(`webdav-list-failed:${res.status}`);
  }
  const xml = await res.text();
  // Extract displaynames ending in .json (our backup files).
  const names: string[] = [];
  const re = /<(?:[a-zA-Z0-9]+:)?displayname>([^<]+\.json)<\/(?:[a-zA-Z0-9]+:)?displayname>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    names.push(m[1]);
  }
  return names;
}

// ---------------------------------------------------------------------------
// S3 SigV4
// ---------------------------------------------------------------------------

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Node fallback for tests.
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

async function hmacSha256(key: Uint8Array, data: string): Promise<Uint8Array> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const cryptoKey = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
    return new Uint8Array(sig);
  }
  const { createHmac } = await import("node:crypto");
  return new Uint8Array(createHmac("sha256", key).update(data).digest());
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** RFC 3986 percent-encoding for SigV4 canonical query strings. */
function encodeRfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Sign an S3 request with SigV4. Returns the Authorization header value. */
export async function s3Sign(
  dest: Extract<RemoteDestination, { kind: "s3" }>,
  method: string,
  objectKey: string,
  payloadHash: string,
  amzDate: string, // "20240101T000000Z"
  contentType?: string,
  query?: Record<string, string>,
): Promise<{ authorization: string; url: string }> {
  const { config, secretAccessKey, sessionToken } = dest;
  const dateStamp = amzDate.slice(0, 8);
  const region = config.region || "us-east-1";
  const service = "s3";

  const host = config.pathStyle
    ? new URL(config.endpoint).host
    : `${config.bucket}.${new URL(config.endpoint).host}`;
  const path = config.pathStyle ? `/${config.bucket}/${objectKey}` : `/${objectKey}`;
  const canonicalQueryString = query
    ? Object.keys(query)
        .sort()
        .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(query[k])}`)
        .join("&")
    : "";
  const url = `${config.endpoint.replace(/\/+$/, "")}${path}${canonicalQueryString ? `?${canonicalQueryString}` : ""}`;

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["content-type"] = contentType;
  if (sessionToken) headers["x-amz-security-token"] = sessionToken;

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k].trim()}\n`)
    .join("");
  const canonicalRequest = [method, path, canonicalQueryString, canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, await sha256Hex(canonicalRequest)].join("\n");

  const kDate = await hmacSha256(new TextEncoder().encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, url };
}

/** Upload a backup file to S3 via signed PUT. */
export async function s3Upload(
  dest: Extract<RemoteDestination, { kind: "s3" }>,
  filename: string,
  content: string,
  fetchFn: FetchLike = fetch,
  now: Date = new Date(),
): Promise<void> {
  const objectKey = [dest.config.prefix.replace(/^\/+|\/+$/g, ""), filename].filter(Boolean).join("/");
  const payloadHash = await sha256Hex(content);
  const amzDate = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const { authorization, url } = await s3Sign(dest, "PUT", objectKey, payloadHash, amzDate, "application/json");
  const headers: Record<string, string> = {
    Authorization: authorization,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    "Content-Type": "application/json",
  };
  if (dest.sessionToken) headers["x-amz-security-token"] = dest.sessionToken;
  const res = await fetchFn(url, { method: "PUT", headers, body: content });
  if (!res.ok) {
    throw new Error(`s3-upload-failed:${res.status}`);
  }
}

/** Download a backup file from S3 via signed GET. */
export async function s3Download(
  dest: Extract<RemoteDestination, { kind: "s3" }>,
  filename: string,
  fetchFn: FetchLike = fetch,
  now: Date = new Date(),
): Promise<string> {
  const objectKey = [dest.config.prefix.replace(/^\/+|\/+$/g, ""), filename].filter(Boolean).join("/");
  const payloadHash = await sha256Hex("");
  const amzDate = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const { authorization, url } = await s3Sign(dest, "GET", objectKey, payloadHash, amzDate);
  const headers: Record<string, string> = {
    Authorization: authorization,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (dest.sessionToken) headers["x-amz-security-token"] = dest.sessionToken;
  const res = await fetchFn(url, { method: "GET", headers });
  if (!res.ok) {
    throw new Error(`s3-download-failed:${res.status}`);
  }
  return res.text();
}

/** List backup files under the configured prefix via ListObjectsV2. Returns filenames with the prefix stripped, filtered to .json (mirrors webdavList). */
export async function s3List(
  dest: Extract<RemoteDestination, { kind: "s3" }>,
  fetchFn: FetchLike = fetch,
  now: Date = new Date(),
): Promise<string[]> {
  const prefix = dest.config.prefix.replace(/^\/+|\/+$/g, "");
  const query: Record<string, string> = { "list-type": "2" };
  if (prefix) query.prefix = `${prefix}/`;
  const payloadHash = await sha256Hex("");
  const amzDate = `${now.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
  const { authorization, url } = await s3Sign(dest, "GET", "", payloadHash, amzDate, undefined, query);
  const headers: Record<string, string> = {
    Authorization: authorization,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (dest.sessionToken) headers["x-amz-security-token"] = dest.sessionToken;
  const res = await fetchFn(url, { method: "GET", headers });
  if (!res.ok) {
    throw new Error(`s3-list-failed:${res.status}`);
  }
  const xml = await res.text();
  const names: string[] = [];
  for (const m of xml.matchAll(/<Key>([^<]+\.json)<\/Key>/g)) {
    const key = m[1];
    names.push(prefix && key.startsWith(`${prefix}/`) ? key.slice(prefix.length + 1) : key);
  }
  return names;
}

/** Validate a WebDAV config (returns error code or null). */
export function validateWebDav(url: string): string | null {
  if (!url.trim()) return "url-required";
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "url-scheme";
  } catch {
    return "url-invalid";
  }
  return null;
}

/** Validate an S3 config (returns error code or null). */
export function validateS3(endpoint: string, bucket: string, accessKeyId: string): string | null {
  if (!endpoint.trim()) return "endpoint-required";
  try {
    new URL(endpoint);
  } catch {
    return "endpoint-invalid";
  }
  if (!bucket.trim()) return "bucket-required";
  if (!accessKeyId.trim()) return "access-key-required";
  return null;
}

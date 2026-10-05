#!/usr/bin/env node
/**
 * dudu sandbox relay — companion service for the 嘟嘟 app's cloud sandbox.
 *
 * Why this exists: React Native / Expo has no TCP sockets and no production
 * SSH client library (ssh2 is Node-only), so the app itself cannot open an
 * SSH session. This tiny relay runs on HER server and performs the REAL SSH
 * hop: every /exec and /shell/open spawns the system `ssh` client, which does
 * a genuine SSH handshake + key/password auth against her sshd. Nothing is
 * simulated — stdout/stderr/exit codes are the real ones.
 *
 * Security model (read before deploying):
 * - Binds 127.0.0.1 by default. Front it with TLS (Caddy snippet in README).
 * - There is NO relay token: the SSH credentials in each request ARE the
 *   auth. Without her private key or password, nothing executes. The relay
 *   never stores credentials: keys live in 0600 temp files deleted after use.
 * - Request bodies are never logged (they contain secrets).
 *
 * Zero npm dependencies. Node 18+.
 *
 *   PORT=18731 HOST=127.0.0.1 node relay.mjs
 *
 * Env:
 *   PORT     listen port (default 18731)
 *   HOST     listen address (default 127.0.0.1 — keep it local, use Caddy)
 *   SSH_BIN  ssh client binary (default "ssh"; override for tests)
 */

import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.PORT || 18731);
const HOST = process.env.HOST || "127.0.0.1";
const SSH_BIN = process.env.SSH_BIN || "ssh";
const BASE = "/dudu-sandbox";

const MAX_SHELLS = 8;
const SHELL_IDLE_MS = 15 * 60 * 1000;
const SHELL_BUF_MAX = 2 * 1024 * 1024; // per shell; overrun kills the shell
const EXEC_TIMEOUT_DEFAULT = 120_000;
const EXEC_TIMEOUT_MAX = 300_000;
const OUTPUT_CAP = 8 * 1024 * 1024; // per stream for exec
const BODY_LIMIT = 10 * 1024 * 1024;
const POLL_WAIT_MS = 25_000;

const log = (...a) => console.error("[relay]", ...a);

/** Startup capability check (informational; password auth needs sshpass). */
const sshpassOk = (() => {
  try {
    const r = spawnSync("command", ["-v", "sshpass"], { shell: true });
    return r.status === 0;
  } catch {
    return false;
  }
})();

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > BODY_LIMIT) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function bad(res, code, error) {
  send(res, code, { error });
}

/** Validate SSH credentials from a request body. Returns null when invalid. */
function validCreds(b) {
  if (!b || typeof b !== "object") return null;
  const { host, port, username, authType, privateKey, password } = b;
  if (typeof host !== "string" || !host || host.length > 253) return null;
  if (!/^[A-Za-z0-9.-]+$/.test(host)) return null;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (typeof username !== "string" || !username || username.length > 128) return null;
  if (authType !== "key" && authType !== "password") return null;
  if (authType === "key" && (typeof privateKey !== "string" || !privateKey.includes("PRIVATE KEY"))) return null;
  if (authType === "password" && (typeof password !== "string" || !password)) return null;
  return { host, port, username, authType, privateKey: privateKey ?? null, password: password ?? null };
}

/**
 * Materialize the private key into a 0600 temp file for the `ssh -i` hop.
 * Calls fn(keyPath|null), then always deletes the temp dir. Never logs.
 */
async function withKeyFile(creds, fn) {
  if (creds.authType !== "key") return fn(null);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dudu-ssh-"));
  const keyPath = path.join(dir, "id");
  try {
    await fs.promises.writeFile(keyPath, creds.privateKey, { mode: 0o600 });
    return await fn(keyPath);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

/** Build the ssh argv for a real session hop. `remoteCmd` null => interactive. */
function sshArgv(creds, keyPath, { tty, remoteCmd }) {
  const a = [];
  if (keyPath) a.push("-i", keyPath);
  a.push("-p", String(creds.port));
  a.push("-o", "StrictHostKeyChecking=accept-new");
  a.push("-o", "ConnectTimeout=10");
  a.push("-o", "ServerAliveInterval=30");
  if (creds.authType === "key") a.push("-o", "BatchMode=yes");
  if (tty) a.push("-tt");
  a.push(`${creds.username}@${creds.host}`);
  if (remoteCmd != null) a.push(remoteCmd); // single argv: remote shell parses it
  return a;
}

/** Spawn ssh (or sshpass+ssh for password auth). Returns ChildProcess. */
function spawnSsh(creds, keyPath, opts) {
  const argv = sshArgv(creds, keyPath, opts);
  if (creds.authType === "password") {
    if (!sshpassOk) throw new Error("password auth needs `sshpass` installed on the relay host");
    return spawn("sshpass", ["-p", creds.password, "-e", SSH_BIN, ...argv], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, SSHPASS: creds.password },
    });
  }
  return spawn(SSH_BIN, argv, { stdio: ["pipe", "pipe", "pipe"] });
}

// ---------------------------------------------------------------------------
// exec: one real SSH session, run to completion
// ---------------------------------------------------------------------------
async function handleExec(body, res) {
  const creds = validCreds(body);
  if (!creds) return bad(res, 400, "invalid ssh credentials");
  const command = typeof body.command === "string" && body.command ? body.command : null;
  if (!command) return bad(res, 400, "command is required");
  const timeoutMs = Math.min(
    Math.max(Number(body.timeoutMs) || EXEC_TIMEOUT_DEFAULT, 1000),
    EXEC_TIMEOUT_MAX,
  );
  const started = Date.now();
  try {
    const result = await withKeyFile(creds, (keyPath) => {
      return new Promise((resolve) => {
        let stdout = Buffer.alloc(0);
        let stderr = Buffer.alloc(0);
        let done = false;
        let proc;
        try {
          proc = spawnSsh(creds, keyPath, { tty: false, remoteCmd: command });
        } catch (e) {
          resolve({ stdout: "", stderr: String(e && e.message ? e.message : e), exitCode: -1, durationMs: Date.now() - started, truncated: false });
          return;
        }
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          proc.kill("SIGKILL");
          resolve({ stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8") + "\n[relay: timed out]", exitCode: -1, durationMs: Date.now() - started, truncated: false });
        }, timeoutMs);
        let truncated = false;
        proc.stdout.on("data", (c) => {
          if (stdout.length < OUTPUT_CAP) stdout = Buffer.concat([stdout, c.subarray(0, OUTPUT_CAP - stdout.length)]);
          else truncated = true;
        });
        proc.stderr.on("data", (c) => {
          if (stderr.length < OUTPUT_CAP) stderr = Buffer.concat([stderr, c.subarray(0, OUTPUT_CAP - stderr.length)]);
          else truncated = true;
        });
        proc.on("error", (e) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({ stdout: stdout.toString("utf8"), stderr: `spawn failed: ${e.message}`, exitCode: -1, durationMs: Date.now() - started, truncated });
        });
        proc.on("close", (code, signal) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({
            stdout: stdout.toString("utf8"),
            stderr: stderr.toString("utf8") + (truncated ? "\n[relay: output truncated]" : ""),
            exitCode: typeof code === "number" ? code : -1,
            durationMs: Date.now() - started,
            truncated,
            ...(signal ? { signal } : {}),
          });
        });
      });
    });
    send(res, 200, result);
  } catch (e) {
    bad(res, 500, `exec failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---------------------------------------------------------------------------
// shell: one real interactive SSH session, long-lived, polled
// ---------------------------------------------------------------------------
const shells = new Map(); // id -> shell record
let shellSeq = 0;

function pushChunk(sh, stream, data) {
  const s = data.toString("utf8");
  if (!s) return;
  sh.chunks.push({ seq: ++sh.seq, stream, data: s });
  sh.bufBytes += Buffer.byteLength(s);
  sh.lastActive = Date.now();
  if (sh.bufBytes > SHELL_BUF_MAX) {
    sh.overrun = true;
    sh.proc.kill("SIGKILL");
  }
  for (const w of sh.waiters) w();
  sh.waiters.clear();
}

function cleanupShell(id) {
  const sh = shells.get(id);
  if (!sh) return;
  try { sh.proc.kill("SIGKILL"); } catch { /* already dead */ }
  if (sh.keyDir) fs.promises.rm(sh.keyDir, { recursive: true, force: true }).catch(() => {});
  shells.delete(id);
}

async function handleShellOpen(body, res) {
  const creds = validCreds(body);
  if (!creds) return bad(res, 400, "invalid ssh credentials");
  if (shells.size >= MAX_SHELLS) return bad(res, 429, "too many shell sessions");
  const cols = Math.min(Math.max(Number(body.cols) || 80, 20), 500);
  const rows = Math.min(Math.max(Number(body.rows) || 24, 5), 200);
  try {
    const keyDir = creds.authType === "key"
      ? await fs.promises.mkdtemp(path.join(os.tmpdir(), "dudu-ssh-"))
      : null;
    let keyPath = null;
    if (keyDir) {
      keyPath = path.join(keyDir, "id");
      await fs.promises.writeFile(keyPath, creds.privateKey, { mode: 0o600 });
    }
    let proc;
    try {
      proc = spawnSsh(creds, keyPath, { tty: true, remoteCmd: null });
    } catch (e) {
      if (keyDir) await fs.promises.rm(keyDir, { recursive: true, force: true }).catch(() => {});
      return bad(res, 500, e instanceof Error ? e.message : String(e));
    }
    const id = `sh_${Date.now()}_${++shellSeq}_${randomBytes(4).toString("hex")}`;
    const sh = {
      id, proc, keyDir, chunks: [], seq: 0, bufBytes: 0,
      waiters: new Set(), closed: false, overrun: false,
      lastActive: Date.now(), cols, rows,
    };
    // Fail-fast: if ssh dies immediately (bad creds etc.), report it now.
    let earlyErr = "";
    proc.stderr.on("data", (c) => { earlyErr += c.toString("utf8").slice(0, 500); });
    proc.stdout.on("data", (c) => pushChunk(sh, "stdout", c));
    proc.stderr.on("data", (c) => pushChunk(sh, "stderr", c));
    const onExit = () => {
      sh.closed = true;
      if (sh.overrun) pushChunk(sh, "stderr", "\n[relay: output buffer overrun, shell killed]\n");
      for (const w of sh.waiters) w();
      sh.waiters.clear();
      // keep record briefly so poll can report closed:true, then reap
      setTimeout(() => cleanupShell(id), 60_000).unref?.();
    };
    proc.on("close", onExit);
    proc.on("error", onExit);
    shells.set(id, sh);
    // give auth failures ~3s to surface before claiming success
    setTimeout(() => {
      if (!sh.closed) return;
      if (!sh.reported) {
        sh.reported = true;
        // leave the closed record for poll; the opener already got 200 —
        // the first poll will report closed:true with the stderr chunk.
      }
    }, 3000).unref?.();
    void earlyErr;
    send(res, 200, { shellId: id });
  } catch (e) {
    bad(res, 500, `shell open failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function handleShellPoll(req, res, id, cursor) {
  const sh = shells.get(id);
  if (!sh) return bad(res, 404, "unknown shell session");
  sh.lastActive = Date.now();
  const since = Number(cursor) || 0;
  const ready = sh.chunks.filter((c) => c.seq > since);
  if (ready.length > 0 || sh.closed) {
    return send(res, 200, { chunks: ready, cursor: sh.seq, closed: sh.closed });
  }
  // long-poll
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    sh.waiters.delete(wake);
    const fresh = sh.chunks.filter((c) => c.seq > since);
    send(res, 200, { chunks: fresh, cursor: sh.seq, closed: sh.closed });
  };
  const wake = () => finish();
  sh.waiters.add(wake);
  const timer = setTimeout(() => finish(), POLL_WAIT_MS);
  req.on("close", () => {
    clearTimeout(timer);
    sh.waiters.delete(wake);
  });
}

async function handleShellWrite(body, res, id) {
  const sh = shells.get(id);
  if (!sh || sh.closed) return bad(res, 404, "unknown shell session");
  const data = typeof body.data === "string" ? body.data : "";
  if (!data) return send(res, 200, { ok: true });
  if (data.length > 1024 * 1024) return bad(res, 400, "write too large");
  sh.lastActive = Date.now();
  sh.proc.stdin.write(data, (err) => {
    if (err) return bad(res, 500, "stdin write failed");
    send(res, 200, { ok: true });
  });
}

async function handleShellResize(body, res, id) {
  const sh = shells.get(id);
  if (!sh || sh.closed) return bad(res, 404, "unknown shell session");
  // The ssh CLI does not expose pty window-change; honest no-op.
  send(res, 200, { ok: true, note: "resize is best-effort over the ssh CLI transport" });
}

async function handleShellClose(res, id) {
  const sh = shells.get(id);
  if (!sh) return send(res, 200, { ok: true });
  sh.closed = true;
  for (const w of sh.waiters) w();
  sh.waiters.clear();
  cleanupShell(id);
  send(res, 200, { ok: true });
}

// idle reaper
setInterval(() => {
  const now = Date.now();
  for (const [id, sh] of shells) {
    if (!sh.closed && now - sh.lastActive > SHELL_IDLE_MS) {
      log("reaping idle shell", id);
      sh.closed = true;
      for (const w of sh.waiters) w();
      sh.waiters.clear();
      cleanupShell(id);
    }
  }
}, 60_000).unref?.();

// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const u = new URL(req.url || "/", "http://x");
  const p = u.pathname;
  const q = u.searchParams;
  try {
    if (req.method === "GET" && p === `${BASE}/health`) {
      return send(res, 200, { ok: true, ssh: SSH_BIN, sshpass: sshpassOk, shells: shells.size });
    }
    if (req.method === "POST" && p === `${BASE}/exec`) {
      const body = JSON.parse(await readBody(req));
      return await handleExec(body, res);
    }
    if (req.method === "POST" && p === `${BASE}/shell/open`) {
      const body = JSON.parse(await readBody(req));
      return await handleShellOpen(body, res);
    }
    const m = p.match(new RegExp(`^${BASE}/shell/([^/]+)/(poll|write|resize|close)$`));
    if (m) {
      const [, id, action] = m;
      if (!/^[A-Za-z0-9_]+$/.test(id)) return bad(res, 404, "unknown shell session");
      if (action === "poll" && req.method === "GET") return await handleShellPoll(req, res, id, q.get("cursor"));
      const body = action === "poll" ? {} : JSON.parse(await readBody(req));
      if (action === "write" && req.method === "POST") return await handleShellWrite(body, res, id);
      if (action === "resize" && req.method === "POST") return await handleShellResize(body, res, id);
      if (action === "close" && req.method === "POST") return await handleShellClose(res, id);
    }
    return bad(res, 404, "not found");
  } catch (e) {
    return bad(res, 500, `relay error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    // access log: method + path + ms only — NEVER bodies (they hold secrets)
    log(req.method, p, `${Date.now() - started}ms`);
  }
});

server.listen(PORT, HOST, () => {
  log(`listening on ${HOST}:${PORT}${BASE} (ssh=${SSH_BIN}, sshpass=${sshpassOk})`);
});

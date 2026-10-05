#!/usr/bin/env node
// Dev-only end-to-end test for relay.mjs. Spins the REAL relay with a fake
// `ssh` binary (SSH_BIN) and exercises the whole HTTP API.
//   SSH_BIN=/tmp/fake-ssh.sh PORT=18731 node test-relay.mjs
import { spawn } from "node:child_process";

const PORT = process.env.PORT || 18731;
const BASE = `http://127.0.0.1:${PORT}/dudu-sandbox`;
const CREDS = {
  host: "example.com",
  port: 22,
  username: "root",
  authType: "key",
  privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----\n",
  password: null,
};

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`ok   ${name}`);
  else {
    failures++;
    console.log(`FAIL ${name} ${extra}`);
  }
}
async function post(p, body) {
  const r = await fetch(`${BASE}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
async function get(p) {
  const r = await fetch(`${BASE}${p}`);
  return { status: r.status, body: await r.json() };
}

const relay = spawn("node", ["relay.mjs"], {
  cwd: new URL(".", import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
relay.stderr.on("data", (c) => process.stderr.write(`[relay] ${c}`));
await new Promise((r) => setTimeout(r, 800));

try {
  // health
  {
    const { status, body } = await get("/health");
    check("health 200", status === 200 && body.ok === true, JSON.stringify(body));
  }
  // invalid creds rejected
  {
    const { status } = await post("/exec", { ...CREDS, host: "bad host!" });
    check("bad host rejected", status === 400);
  }
  // exec
  {
    const { status, body } = await post("/exec", { ...CREDS, command: "echo hi" });
    check(
      "exec 200 + real relay path",
      status === 200 && body.exitCode === 0 && body.stdout.includes("fake-exec-stdout"),
      JSON.stringify(body).slice(0, 200),
    );
    check("exec stderr captured", body.stderr.includes("fake-exec-stderr"));
    check("exec durationMs present", typeof body.durationMs === "number");
  }
  // shell lifecycle
  {
    const o = await post("/shell/open", { ...CREDS });
    check("shell open", o.status === 200 && typeof o.body.shellId === "string", JSON.stringify(o.body));
    const id = o.body.shellId;
    await post(`/shell/${id}/write`, { data: "hello-shell\n" });
    const p1 = await get(`/shell/${id}/poll?cursor=0`);
    const all = (p1.body.chunks || []).map((c) => c.data).join("");
    check("shell poll echoes input (fake pty)", p1.status === 200 && all.includes("hello-shell"), JSON.stringify(all).slice(0, 200));
    check("poll cursor advances", p1.body.cursor > 0);
    const p2 = await get(`/shell/${id}/poll?cursor=${p1.body.cursor}`);
    check("second poll returns closed:false with no dupes", p2.status === 200 && p2.body.chunks.length === 0 && p2.body.closed === false);
    const rz = await post(`/shell/${id}/resize`, { cols: 100, rows: 30 });
    check("resize ok", rz.status === 200 && rz.body.ok === true);
    const cl = await post(`/shell/${id}/close`, {});
    check("close ok", cl.status === 200 && cl.body.ok === true);
    const p3 = await get(`/shell/${id}/poll?cursor=0`);
    check("poll after close -> 404", p3.status === 404);
  }
  // unknown shell
  {
    const r = await post("/shell/nope/write", { data: "x" });
    check("unknown shell -> 404", r.status === 404);
  }
} finally {
  relay.kill("SIGKILL");
}

console.log(failures === 0 ? "\nALL RELAY TESTS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);

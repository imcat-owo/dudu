/**
 * Relay (传话员) install recipe — the REAL path from "relay missing" to
 * "relay running" (D18).
 *
 * Why this exists: React Native has no TCP sockets, so the app cannot SSH
 * into a server by itself — the relay must be installed ON her server, and
 * only SHE can reach her server's shell. Telling her "ask the AI" was a
 * dead end (the AI has no path either): the honest fix is copyable commands
 * she runs herself, surfaced in-app instead of buried in
 * sandbox-relay/README.md.
 *
 * PURE module: no React Native imports — safe for node tests.
 */

/** Where relay.mjs comes from: her own public repo (GPL-3.0). */
export const RELAY_DOWNLOAD_URL =
  "https://raw.githubusercontent.com/imcat-owo/dudu/main/sandbox-relay/relay.mjs";

/** Port the relay listens on — must match the Caddy reverse_proxy target. */
export const RELAY_PORT = 18731;

/** HTTP path the app talks to — must match transport-relay.ts RELAY_PATH. */
export const RELAY_HTTP_PATH = "/dudu-sandbox";

/**
 * Step 1: download the relay onto her server and start it.
 * Runs in her server's shell (she pastes this herself).
 */
export function relayInstallScript(): string {
  return [
    "mkdir -p /opt/dudu-sandbox && cd /opt/dudu-sandbox",
    `curl -sSL ${RELAY_DOWNLOAD_URL} -o relay.mjs`,
    "node --version  # needs node 18+",
    `PORT=${RELAY_PORT} HOST=127.0.0.1 node relay.mjs`,
  ].join("\n");
}

/**
 * Step 2: Caddy snippet so https://{host}/dudu-sandbox reaches the relay.
 * The domain MUST be the same host she fills in the app's 主机 field.
 */
export function relayCaddySnippet(host: string): string {
  const domain = host.trim() || "sandbox.example.com";
  return [`${domain} {`, `    reverse_proxy 127.0.0.1:${RELAY_PORT}`, "}"].join("\n");
}

/** Step 3 (optional): systemd unit to keep the relay running in background. */
export function relaySystemdUnit(): string {
  return [
    "# save as /etc/systemd/system/dudu-sandbox-relay.service, then:",
    "#   sudo systemctl daemon-reload && sudo systemctl enable --now dudu-sandbox-relay",
    "",
    "[Unit]",
    "Description=dudu sandbox relay",
    "After=network.target",
    "",
    "[Service]",
    "ExecStart=/usr/bin/node /opt/dudu-sandbox/relay.mjs",
    `Environment=PORT=${RELAY_PORT} HOST=127.0.0.1`,
    "Restart=always",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
  ].join("\n");
}

/**
 * Full plain-text guide, returned by the sandbox_relay_install_guide AI
 * tool so the model never has to improvise install steps.
 */
export function relayInstallGuideText(lang: "zh" | "en"): string {
  if (lang === "en") {
    return [
      "The sandbox relay (传话员) has to run ON her server — I can't reach her server's shell, so she runs these herself. It takes about 2 minutes.",
      "",
      "1. Download and run the relay (paste into the server's terminal):",
      relayInstallScript(),
      "",
      "   Keep that terminal open, or use step 3 to run it in the background.",
      "   Password auth only: also run `apt install sshpass` (key auth needs nothing).",
      "",
      "2. Expose it over HTTPS with Caddy (the app always talks https://{host}/dudu-sandbox):",
      relayCaddySnippet(""),
      "   Replace sandbox.example.com with the host she fills in the app's server form.",
      "",
      "3. Optional — start on boot:",
      relaySystemdUnit(),
      "",
      "Then tap connect in the sandbox settings — the relay answers and the sandbox lights up.",
    ].join("\n");
  }
  return [
    "传话员得装在她的服务器上才能连——AI 够不着她服务器的终端，所以这几步得她自己粘过去跑一下，2 分钟。",
    "",
    "1. 下载并运行传话员（粘到服务器的终端里）：",
    relayInstallScript(),
    "",
    "   终端别关；想后台跑就看第 3 步。",
    "   只用密码登录的话，再装一个 `apt install sshpass`（密钥登录啥都不用装）。",
    "",
    "2. 用 Caddy 把它挂到 HTTPS 上（App 永远走 https://{主机}/dudu-sandbox）：",
    relayCaddySnippet(""),
    "   把 sandbox.example.com 换成她在 App 服务器表单里填的「主机」。",
    "",
    "3. 可选——开机自启：",
    relaySystemdUnit(),
    "",
    "装完回沙箱设置点连接，传话员应答了就能连上。",
  ].join("\n");
}

# dudu sandbox relay

Companion service for the 嘟嘟 app's **cloud sandbox** (Backend A).

## Why it exists

React Native has no TCP sockets and no production SSH client library, so the
app itself cannot open an SSH session. This relay runs **on her server** and
performs the real SSH hop: every request spawns the system `ssh` client, which
does a genuine handshake + key/password auth against her sshd. Command output
is 100% real — nothing is simulated.

## Security

- Binds `127.0.0.1` by default. Front it with TLS (Caddy snippet below) —
  the app only talks `https://`.
- **No relay token**: the SSH credentials in each request *are* the auth.
  Without her private key or password, nothing executes.
- The relay never stores credentials. Private keys live in `0600` temp files
  that are deleted after each use (after shell close for interactive shells).
- Request bodies are never logged.

## Setup (on her cloud server)

```sh
# 1. copy relay.mjs over, needs node 18+
node --version

# 2. run it (or use the systemd unit below)
PORT=18731 HOST=127.0.0.1 node relay.mjs

# 3. password auth only: install sshpass (key auth needs nothing)
#    apt install sshpass   # or: yum install sshpass
```

### Caddy (TLS) — 3 lines

She already runs Caddy on 443. Add:

```
sandbox.example.com {
    reverse_proxy 127.0.0.1:18731
}
```

Then in the app's sandbox settings fill the usual four fields:

- **主机**: `sandbox.example.com` (the domain Caddy serves)
- **端口**: `22` (SSH port — used for the relay's onward SSH hop)
- **用户名**: her SSH user (e.g. `root`)
- **私钥/密码**: her SSH private key (PEM) or password

Tap **保存并连接**. The backend runs `docker info` as a probe; when it
succeeds the backend shows 已连接 and the 8 AI tools come alive
(`sandbox_run`, `sandbox_containers`, `sandbox_container_start/stop`,
`sandbox_shell_open/write/read/close`).

### systemd (optional)

```ini
[Unit]
Description=dudu sandbox relay
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/dudu-sandbox/relay.mjs
Environment=PORT=18731 HOST=127.0.0.1
Restart=always

[Install]
WantedBy=multi-user.target
```

## API (for developers)

All JSON. Bodies carry the SSH credentials (`host`, `port`, `username`,
`authType`, `privateKey`/`password`).

- `GET  /dudu-sandbox/health` → `{ok, ssh, sshpass, shells}`
- `POST /dudu-sandbox/exec` `{…creds, command, timeoutMs?}` →
  `{stdout, stderr, exitCode, durationMs, truncated}`
- `POST /dudu-sandbox/shell/open` `{…creds, cols?, rows?}` → `{shellId}`
- `GET  /dudu-sandbox/shell/:id/poll?cursor=n` (long-poll ≤25s) →
  `{chunks:[{seq, stream, data}], cursor, closed}`
- `POST /dudu-sandbox/shell/:id/write` `{data}`
- `POST /dudu-sandbox/shell/:id/resize` `{cols, rows}` (best-effort)
- `POST /dudu-sandbox/shell/:id/close`

Limits: 8 concurrent shells, 15 min idle reap, 2 MB output buffer per shell,
exec timeout 120 s default (300 s max).

## Dev test

```sh
SSH_BIN=/tmp/fake-ssh.sh PORT=18731 node test-relay.mjs
```

Spins up the relay with a fake `ssh` binary and exercises the whole API.

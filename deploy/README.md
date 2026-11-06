# MDP deployment artifacts

Ready-to-use configs for standing MDP up on the BT server. These are **templates** — adjust the
placeholders (`<...>`) to the real server. They implement the go-live steps in `../DEPLOYMENT.md §0`.

The MDP app itself:
- Start command (from the `app/` folder): `node server/server.js`
- Listens on `HOST:PORT` — **defaults `127.0.0.1:4000`**. Keep it on **loopback (127.0.0.1)** in
  production so it is only reachable **through** the reverse proxy, never directly.
- Honours env vars: `PORT`, `HOST`, `SESSION_SECRET`, `SESSION_IDLE_MINUTES`, `DB_PATH`,
  `DOC_STORAGE_DIR`, `NODE_ENV` (set to `production` so the session cookie is `Secure`).
- Handles `SIGINT`/`SIGTERM` cleanly, so it stops gracefully under a service manager.
- Health check: `GET /api/health` → `{ status: "ok", db: "connected", ... }`.

## Files here
| File | Purpose |
|---|---|
| `nginx-mdp.conf` | nginx reverse-proxy + TLS termination (if BT uses nginx/Linux). |
| `iis-web.config-notes.md` | IIS + ARR reverse-proxy notes (if BT uses Windows/IIS). |
| `mdp.env.sample` | The production env file to copy to `app/.env` (fill in real values). |
| `backup-mdp.cmd` | Windows wrapper the Task Scheduler calls for the daily backup. |
| `run-as-service-windows.md` | Make MDP start on boot + restart on crash (NSSM / Task Scheduler). |

## Order of operations (maps to DEPLOYMENT.md §0)
1. Install **Node 22+** on the server; copy the repo to an **encrypted volume**.
2. Copy `mdp.env.sample` → `app/.env`; set a real `SESSION_SECRET` + `NODE_ENV=production`.
3. Start the app as a service (`run-as-service-windows.md`) so it survives reboots/crashes.
4. Put the reverse proxy in front (`nginx-mdp.conf` or `iis-web.config-notes.md`); it holds the
   TLS cert and forwards to `127.0.0.1:4000`.
5. Change the seeded passwords; schedule `backup-mdp.cmd`.
6. Smoke-test over HTTPS with real users.

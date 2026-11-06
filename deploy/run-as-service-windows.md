# Running MDP on boot + restart-on-crash (Windows server)

The MDP app is `node server/server.js` (from `app/`). In production it must **start on boot** and
**restart if it crashes**, so it isn't dependent on someone being logged in. Two options — pick
whichever your BT server policy allows.

## Option 1 — NSSM (recommended; simplest robust Windows service)
[NSSM](https://nssm.cc) wraps any executable as a proper Windows service with auto-restart.

```bat
REM Install (run as admin). Adjust paths.
nssm install MDP "C:\Program Files\nodejs\node.exe" "server\server.js"
nssm set MDP AppDirectory "D:\mdp\app"
nssm set MDP AppEnvironmentExtra NODE_ENV=production
nssm set MDP Start SERVICE_AUTO_START
nssm set MDP AppStdout "D:\mdp\logs\mdp.out.log"
nssm set MDP AppStderr "D:\mdp\logs\mdp.err.log"
nssm start MDP
```
- Reads `app/.env` too (the app loads it), so env can live there instead of `AppEnvironmentExtra`.
- NSSM restarts the process automatically if it exits. The app handles `SIGTERM` for clean stops.
- Manage with: `nssm stop MDP` / `nssm restart MDP` / `nssm remove MDP confirm`.

## Option 2 — Task Scheduler (no extra software)
If NSSM can't be installed, a scheduled task can approximate a service:
- **Trigger:** *At startup*.
- **Action:** Program `node`, Arguments `server\server.js`, *Start in* `D:\mdp\app`.
- **Settings:** tick *If the task fails, restart every 1 minute, up to 3 times*; *Run whether user
  is logged on or not*; *Do not stop on idle*.
- Set `NODE_ENV=production` via `app/.env` (simplest) or the task's environment.
- Weaker than NSSM (no true crash-supervision), but works with zero install.

## Verify it's up
After starting the service, from the server:
```bat
curl http://127.0.0.1:4000/api/health
```
Expect `{"status":"ok","db":"connected",...}`. Then test *through* the reverse proxy over HTTPS.

## Logs
Point stdout/stderr somewhere persistent (NSSM does this above). The app logs boot lines, the DB
path, and unhandled errors — useful for the first smoke-test and any incident triage.

## Reminder
- Keep the app on **127.0.0.1** (loopback) — public traffic comes only via the reverse proxy.
- The backup task (`backup-mdp.cmd`) is a **separate** scheduled task from the app service.

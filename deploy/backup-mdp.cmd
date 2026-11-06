@echo off
REM ============================================================================
REM  MDP daily backup — wrapper for Windows Task Scheduler.
REM  Runs the dependency-free backup (atomic VACUUM INTO) with verification, then
REM  copies the newest snapshot off-box. Edit the three paths below for the server.
REM ============================================================================

REM --- EDIT THESE ---
set "APP_DIR=D:\mdp\app"
set "OFFBOX_DIR=\\bt-backup-share\mdp-backups"
set "NODE_EXE=node"
REM ------------------

cd /d "%APP_DIR%" || (echo [backup] cannot cd to %APP_DIR% & exit /b 1)

echo [backup] %DATE% %TIME% - starting MDP backup
"%NODE_EXE%" backup-db.mjs --verify
if errorlevel 1 (
  echo [backup] FAILED - backup-db.mjs returned an error
  exit /b 1
)

REM Copy the newest backup to the off-box share (so a server loss doesn't lose backups too).
for /f "delims=" %%F in ('dir /b /o-d "%APP_DIR%\data\backups\*.db" 2^>nul') do (
  echo [backup] copying newest snapshot %%F to %OFFBOX_DIR%
  copy /y "%APP_DIR%\data\backups\%%F" "%OFFBOX_DIR%\" >nul
  if errorlevel 1 (echo [backup] WARNING: off-box copy failed) else (echo [backup] off-box copy OK)
  goto :copied
)
:copied

echo [backup] done.
exit /b 0

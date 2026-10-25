@echo off
rem Builds mJournal from source with one double-click.
rem Result: release\mJournal-Setup-<version>.exe and release\mJournal-<version>-portable.exe
setlocal
title Building mJournal
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="

echo.
echo   mJournal - building the app. The first build downloads about 300 MB
echo   of tools and can take a few minutes.
echo.

if exist ".tools\node\node.exe" (
  set "PATH=%~dp0.tools\node;%PATH%"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo   Node.js was not found, so a private copy will be downloaded into .tools\
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\get-node.ps1"
    if errorlevel 1 goto :fail
    set "PATH=%~dp0.tools\node;%PATH%"
  )
)

echo   [1/3] Installing dependencies...
call npm ci --no-audit --no-fund
if errorlevel 1 goto :fail
call node node_modules\electron\install.js
if errorlevel 1 goto :fail

echo   [2/3] Building mJournal...
call npm run dist
if errorlevel 1 goto :fail

echo.
echo   [3/3] Done! In the "release" folder you will find:
echo     mJournal-Setup-*.exe      installs mJournal with Start menu and desktop shortcuts
echo     mJournal-*-portable.exe   runs mJournal without installing
echo.
rem MJOURNAL_BUILD_UNATTENDED=1 skips opening the folder and waiting (for automated builds).
if not defined MJOURNAL_BUILD_UNATTENDED (
  start "" "%~dp0release"
  pause
)
exit /b 0

:fail
echo.
echo   The build did not finish. Scroll up to see what went wrong,
echo   or see "Troubleshooting" in README.md.
if not defined MJOURNAL_BUILD_UNATTENDED pause
exit /b 1

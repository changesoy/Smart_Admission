@echo off
setlocal
cd /d "%~dp0"

set "PORT=5173"
set "URL=http://localhost:%PORT%/tools/index.html"

rem If the dev server is already running, just open the tools page.
powershell -NoProfile -Command "try { $null = Invoke-WebRequest -Uri '%URL%' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }"
if not errorlevel 1 goto open

echo Starting Vite dev server...
start "Smart Admission Vite" /min cmd /c "npm run dev -- --port %PORT% --strictPort"

for /l %%i in (1,1,40) do (
  powershell -NoProfile -Command "try { $null = Invoke-WebRequest -Uri '%URL%' -UseBasicParsing -TimeoutSec 1; exit 0 } catch { exit 1 }"
  if not errorlevel 1 goto open
  ping -n 2 127.0.0.1 >nul
)

echo Timed out. Check the "Smart Admission Vite" window, or run: npm run dev
pause
exit /b 1

:open
start "" "%URL%"
exit /b 0

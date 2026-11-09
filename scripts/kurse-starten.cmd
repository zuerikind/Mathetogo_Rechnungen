@echo off
rem Mathetogo-App fuer den Alltag starten: fertige Version (npm start) statt Entwicklungsserver (npm run dev).
rem Baut nur neu, wenn sich der Code seit dem letzten Bauen geaendert hat (neuer Git-Stand). Fenster offen lassen = App laeuft.
cd /d "%~dp0.."
title Mathetogo App - localhost:3000 (Fenster offen lassen)

rem Laeuft schon etwas auf Port 3000 (z. B. alter Entwicklungsserver)? Beenden.
rem (netstat zeigt auf deutschem Windows "ABHOEREN" statt LISTENING, darum ueber PowerShell)
for /f %%p in ('powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique"') do (
  echo Beende alten Server auf Port 3000 (PID %%p^) ...
  taskkill /PID %%p /T /F >nul 2>&1
)

for /f %%h in ('git rev-parse HEAD') do set STAND=%%h
set GEBAUT=
if exist ".next\BUILD_ID" if exist ".next\gebaut-von.txt" set /p GEBAUT=<".next\gebaut-von.txt"
if "%GEBAUT%"=="%STAND%" goto start

echo Neue Version wird gebaut (ca. 2 Minuten) ...
call npm run build
if errorlevel 1 (
  echo.
  echo Bauen fehlgeschlagen. Fenster bitte offen lassen und Claude Bescheid geben.
  pause
  exit /b 1
)
echo %STAND%> ".next\gebaut-von.txt"

:start
echo App startet: http://localhost:3000/kurse
start "" cmd /c "timeout /t 6 >nul & start http://localhost:3000/kurse"
call npm start

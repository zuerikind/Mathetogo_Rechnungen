@echo off
rem Ein Durchgang der tutor24-Automatik (Windows-Aufgabe 9/13/18 Uhr). Ausgabe: tutor24-followuputopilot-run.log
cd /d "%~dp0.."
echo ==== %date% %time% >> tutor24-followuputopilot-run.log
call npx tsx scripts/autopilot.mts >> tutor24-followuputopilot-run.log 2>&1

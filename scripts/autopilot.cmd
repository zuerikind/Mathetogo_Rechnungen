@echo off
rem Ein Durchgang der tutor24-Automatik (Windows-Aufgabe 9 und 17 Uhr). Ausgabe: tutor24-followup\autopilot-run.log
cd /d "%~dp0.."
echo ==== %date% %time% >> "tutor24-followup\autopilot-run.log"
call npx tsx scripts/autopilot.mts --quelle plan >> "tutor24-followup\autopilot-run.log" 2>&1

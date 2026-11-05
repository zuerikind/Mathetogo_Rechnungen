@echo off
rem Telegram-Notbremse (/stop, /status), Windows-Aufgabe bei Anmeldung. Ausgabe: tutor24-followup\telegram-bot.log
cd /d "%~dp0.."
echo ==== %date% %time% >> "tutor24-followup\telegram-bot.log"
call npx tsx scripts/telegram-bot.mts >> "tutor24-followup\telegram-bot.log" 2>&1

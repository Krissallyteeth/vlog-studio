@echo off
rem VLOG Studio collector: remove the link that lets the app start the collector.
chcp 65001 >nul
cd /d "%~dp0..\.."
".venv\Scripts\python.exe" tools\collector\xhs_search.py uninstall
pause

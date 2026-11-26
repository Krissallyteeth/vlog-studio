@echo off
rem VLOG Studio collector: one-time setup so the app's button can start the collector.
chcp 65001 >nul
cd /d "%~dp0..\.."
if not exist ".venv\Scripts\python.exe" (
  py -3 -m venv .venv 2>/dev/null || python -m venv .venv
)
if not exist ".venv\Scripts\python.exe" (
  echo Python 3.10+ is needed: https://www.python.org/downloads/
  pause
  exit /b 1
)
".venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check -r tools\collector\requirements.txt
if errorlevel 1 ( pause & exit /b 1 )
".venv\Scripts\python.exe" tools\collector\xhs_search.py install
pause

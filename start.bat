@echo off
rem Double-click to run BuildSkin locally. Keep this window open while you use the app.
cd /d "%~dp0"
start "" "http://localhost:8765/massing.html"
where python >nul 2>nul && (python -m http.server 8765) || (py -m http.server 8765)
pause

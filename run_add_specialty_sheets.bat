@echo off
REM One-click runner for add_specialty_sheets.py
REM Requires Python 3 + openpyxl. Installs openpyxl if needed.

echo Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo Python is not installed or not in PATH.
    echo Install Python 3 from https://www.python.org/downloads/ and rerun this file.
    pause
    exit /b 1
)

echo Installing openpyxl if needed...
python -m pip install openpyxl --quiet

echo Running script...
python "%~dp0add_specialty_sheets.py"

if errorlevel 1 (
    echo.
    echo Script returned an error. See output above.
) else (
    echo.
    echo Done. Open "Refined Topical Map - TransCure (Master).xlsx" to see new specialty sheets.
)
pause

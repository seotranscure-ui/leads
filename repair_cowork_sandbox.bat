@echo off
REM One-click launcher for the PowerShell repair script.
REM Bypasses execution policy for this run only.

powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0repair_cowork_sandbox.ps1"

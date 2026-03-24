@echo off
REM ============================================================
REM  Windows Task Scheduler — Due Ticket Alerts (9:00 AM daily)
REM  Setup: Open Task Scheduler > Create Basic Task > 
REM         Trigger: Daily at 09:00
REM         Action: Start a Program
REM         Program: C:\Windows\System32\cmd.exe
REM         Arguments: /c "cd /d "c:\Upendra\Redmine ceo-dashboard" && npm run notify:due >> logs\notify-due.log 2>&1"
REM ============================================================
cd /d "c:\Upendra\Redmine ceo-dashboard"
if not exist logs mkdir logs
npm run notify:due >> logs\notify-due.log 2>&1

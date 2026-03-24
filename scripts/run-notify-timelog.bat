@echo off
REM ============================================================
REM  Windows Task Scheduler — Time-Log Reminders (7:30 PM weekdays)
REM  Setup: Open Task Scheduler > Create Basic Task >
REM         Trigger: Daily at 19:30, weekdays only
REM         Action: Start a Program
REM         Program: C:\Windows\System32\cmd.exe
REM         Arguments: /c "cd /d "c:\Upendra\Redmine ceo-dashboard" && npm run notify:timelog >> logs\notify-timelog.log 2>&1"
REM ============================================================
cd /d "c:\Upendra\Redmine ceo-dashboard"
if not exist logs mkdir logs
npm run notify:timelog >> logs\notify-timelog.log 2>&1

@echo off
cd /d "C:\Users\msgil\GIT\sandy-soils\dashboard"
git fetch origin claude/a6v3-runaway-watchdog
git log origin/claude/a6v3-runaway-watchdog --oneline -20 > C:\Users\msgil\GIT\sandy-soils\dashboard\branch_log.txt
git diff origin/main...origin/claude/a6v3-runaway-watchdog > C:\Users\msgil\GIT\sandy-soils\dashboard\branch_diff.txt
git show origin/claude/a6v3-runaway-watchdog:docs/incident-2026-05-06-a6v3-runaway.md > C:\Users\msgil\GIT\sandy-soils\dashboard\incident_doc.md 2>C:\Users\msgil\GIT\sandy-soils\dashboard\incident_doc_err.txt
echo Done. Check branch_diff.txt and incident_doc.md
pause

#!/usr/bin/env python3
from pathlib import Path
import re,sys
root=Path(__file__).resolve().parents[1]
ui=(root/'components/game/organizer-panel.tsx').read_text()
sql=(root/'migrations/0133_testing_and_money_atomicity.sql').read_text()
errs=[]
for needle in ['save_bet_expense_atomic','delete_bet_expense_atomic']:
    if needle not in ui: errs.append(f'client missing {needle}')
    if f'function public.{needle}' not in sql: errs.append(f'migration missing {needle}')
for pattern,label in [
    (r'\.from\("expenses"\)\.insert\(', 'direct bet expense insert'),
    (r'\.from\("expense_payers"\)\.insert\(', 'direct bet payer insert'),
    (r'\.from\("expense_shares"\)\.insert\(', 'direct bet share insert'),
    (r'\.from\("expenses"\)\.delete\(', 'direct bet expense delete'),
]:
    if re.search(pattern,ui): errs.append(label)
if 'group_courses_group_id_course_id_key' not in sql: errs.append('0133 missing group_courses conflict-key reconciliation')
if errs:
    print('BET ATOMICITY CONTRACT: FAIL'); [print(' -',e) for e in errs]; sys.exit(1)
print('BET ATOMICITY CONTRACT: PASS')

#!/usr/bin/env python3
"""Differential source contract: setup replacements preserve latest validation/data writes."""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
new=(root/'migrations/0163_game_reset_fencing.sql').read_text()
def extract(text,name):
    return re.search(r'create or replace function public\.'+name+r'\(.*?\$\$;',text,re.S).group()
def normalize(text):
    return re.sub(r'\s+',' ',re.sub(r'--[^\n]*','',text)).replace('end; $$','end $$').strip()
for name,filename in [('change_game_course_before_scoring','0138_change_game_course_before_scoring.sql'),('change_game_match_length_before_scoring','0153_manual_course_handicap.sql')]:
    expected=extract((root/'migrations'/filename).read_text(),name)
    actual=extract(new,name)
    actual=actual.replace("  v_previous text:=coalesce(current_setting('bnn.game_score_context',true),'');\n",'')
    start=actual.index('  -- Preserve organizer denial')
    end=actual.index('  select * into v_game',start)
    actual=actual[:start]+actual[end:]
    actual=actual.replace("  perform set_config('bnn.game_score_context',v_previous,true);\n",'')
    assert normalize(actual)==normalize(expected),name+' changed beyond the documented scoring lock/context'
print('PASS: differential latest course/length setup validation, manual-handicap clearing, inputs/outputs and database writes preserved; only documented scoring locks/context added')

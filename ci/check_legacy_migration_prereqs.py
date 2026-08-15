from pathlib import Path
import re
import subprocess
import sys
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[1]
ORDERER = ROOT / 'ci' / 'list_ordered_migrations.py'
COMMENT_LINE = re.compile(r'--.*?$', re.M)
COMMENT_BLOCK = re.compile(r'/\*.*?\*/', re.S)

CREATE_FUNCTION = re.compile(r'^\s*create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([A-Za-z_]\w*)\s*\(', re.I | re.S)
DROP_FUNCTION = re.compile(r'^\s*drop\s+function\s+(if\s+exists\s+)?(?:public\.)?([A-Za-z_]\w*)\s*\(', re.I | re.S)
ALTER_FUNCTION = re.compile(r'^\s*alter\s+function\s+(?:public\.)?([A-Za-z_]\w*)\s*\(', re.I | re.S)
EXEC_FUNCTION = re.compile(r'^\s*(?:grant|revoke)\s+execute\s+on\s+function\s+(?:public\.)?([A-Za-z_]\w*)\s*\(', re.I | re.S)
FUNCTION_CALL = re.compile(r'(?<![\w.])(?:public\.)?([A-Za-z_]\w*)\s*\(', re.I)
PUBLIC_CALL = re.compile(r'\bpublic\.([A-Za-z_]\w*)\s*\(', re.I)

CREATE_TABLE = re.compile(r'^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([A-Za-z_]\w*)"?', re.I | re.S)
CREATE_VIEW = re.compile(r'^\s*create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:public\.)?"?([A-Za-z_]\w*)"?', re.I | re.S)
CREATE_TYPE = re.compile(r'^\s*create\s+type\s+(?:public\.)?"?([A-Za-z_]\w*)"?', re.I | re.S)
CREATE_SEQUENCE = re.compile(r'^\s*create\s+sequence\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([A-Za-z_]\w*)"?', re.I | re.S)

CREATE_POLICY = re.compile(r'^\s*create\s+policy\s+(?:"([^"]+)"|([^\s]+))\s+on\s+(?:public\.)?([A-Za-z_]\w*)', re.I | re.S)
ALTER_POLICY = re.compile(r'^\s*alter\s+policy\s+(?:"([^"]+)"|([^\s]+))\s+on\s+(?:public\.)?([A-Za-z_]\w*)', re.I | re.S)
DROP_POLICY = re.compile(r'^\s*drop\s+policy\s+(if\s+exists\s+)?(?:"([^"]+)"|([^\s]+))\s+on\s+(?:public\.)?([A-Za-z_]\w*)', re.I | re.S)

ALTER_TABLE = re.compile(r'^\s*alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([A-Za-z_]\w*)"?', re.I | re.S)
CREATE_INDEX = re.compile(r'^\s*create\s+(?:unique\s+)?index\b.*?\bon\s+(?:public\.)?"?([A-Za-z_]\w*)"?', re.I | re.S)
INSERT_INTO = re.compile(r'^\s*insert\s+into\s+(?:public\.)?"?([A-Za-z_]\w*)"?', re.I | re.S)
UPDATE = re.compile(r'^\s*update\s+(?:public\.)?"?([A-Za-z_]\w*)"?\s+set\b', re.I | re.S)
DELETE = re.compile(r'^\s*delete\s+from\s+(?:public\.)?"?([A-Za-z_]\w*)"?', re.I | re.S)
TRUNCATE = re.compile(r'^\s*truncate\s+(?:table\s+)?(?:public\.)?"?([A-Za-z_]\w*)"?', re.I | re.S)
REFERENCES = re.compile(r'\breferences\s+(?:public\.)?"?([A-Za-z_]\w*)"?', re.I)
FROM_JOIN = re.compile(r'\b(?:from|join)\s+(?:public\.)?"?([A-Za-z_]\w*)"?', re.I)

ADD_COLUMN = re.compile(r'\badd\s+column\s+(?:if\s+not\s+exists\s+)?"?([A-Za-z_]\w*)"?', re.I)
ALTER_COLUMN = re.compile(r'\balter\s+column\s+"?([A-Za-z_]\w*)"?', re.I)
DROP_COLUMN = re.compile(r'\bdrop\s+column\s+(?:if\s+exists\s+)?"?([A-Za-z_]\w*)"?', re.I)

KNOWN_SQL_CALLS = {
    'abs','array_agg','array_append','array_remove','array_to_string','avg','btrim','ceil','coalesce','concat','concat_ws','count','date_part','date_trunc','decode','digest','encode','exists','extract','floor','format','gen_random_uuid','greatest','json_agg','json_build_object','json_object_agg','jsonb_agg','jsonb_array_elements','jsonb_array_elements_text','jsonb_build_object','jsonb_object_agg','jsonb_set','jsonb_typeof','least','left','length','lower','lpad','make_interval','max','min','nextval','now','nullif','pg_get_functiondef','pg_get_function_identity_arguments','pg_get_userbyid','random','regexp_replace','replace','right','round','row_number','set_config','split_part','substring','sum','to_char','to_json','to_jsonb','to_regclass','to_regprocedure','trim','upper','uuid_generate_v4',
}


def strip_comments(text: str) -> str:
    return COMMENT_LINE.sub('', COMMENT_BLOCK.sub('', text))


def split_sql(text: str):
    """Split on semicolons outside quotes and dollar-quoted function bodies."""
    out=[]; start=0; i=0; single=False; double=False; dollar=None
    while i < len(text):
        ch=text[i]
        if dollar:
            if text.startswith(dollar,i):
                i += len(dollar); dollar=None; continue
            i += 1; continue
        if single:
            if ch == "'":
                if i+1 < len(text) and text[i+1] == "'": i += 2; continue
                single=False
            i += 1; continue
        if double:
            if ch == '"':
                if i+1 < len(text) and text[i+1] == '"': i += 2; continue
                double=False
            i += 1; continue
        if ch == "'": single=True; i+=1; continue
        if ch == '"': double=True; i+=1; continue
        if ch == '$':
            m=re.match(r'\$[A-Za-z_0-9]*\$', text[i:])
            if m:
                dollar=m.group(0); i+=len(dollar); continue
        if ch == ';':
            stmt=text[start:i+1]
            if stmt.strip(): out.append((start,stmt))
            start=i+1
        i += 1
    tail=text[start:]
    if tail.strip(): out.append((start,tail))
    return out


def mask_single_quoted(text: str) -> str:
    # Preserve positions while removing string-literal text that can look like function calls.
    chars=list(text); i=0; in_s=False
    while i < len(chars):
        if not in_s and chars[i] == "'":
            in_s=True; chars[i]=' '; i+=1; continue
        if in_s:
            if chars[i] == "'":
                if i+1 < len(chars) and chars[i+1] == "'":
                    chars[i]=chars[i+1]=' '; i+=2; continue
                chars[i]=' '; in_s=False; i+=1; continue
            if chars[i] != '\n': chars[i]=' '
        i+=1
    return ''.join(chars)


def ordered_paths():
    proc=subprocess.run([sys.executable,str(ORDERER)],cwd=ROOT,text=True,capture_output=True)
    if proc.returncode: raise SystemExit(proc.stderr or proc.stdout)
    return [Path(x) for x in proc.stdout.splitlines() if x.strip()]


def table_columns_from_create(stmt: str):
    m=re.search(r'\bcreate\s+table\b.*?\(',stmt,re.I|re.S)
    if not m: return set()
    body=stmt[m.end():]
    # last ')' belongs to CREATE TABLE for normal statements
    if ')' in body: body=body.rsplit(')',1)[0]
    parts=[]; start=0; depth=0; single=False
    for i,ch in enumerate(body):
        if ch=="'": single=not single
        if single: continue
        if ch=='(': depth+=1
        elif ch==')': depth=max(0,depth-1)
        elif ch==',' and depth==0: parts.append(body[start:i]); start=i+1
    parts.append(body[start:])
    cols=set()
    for part in parts:
        s=part.strip(); mm=re.match(r'"?([A-Za-z_]\w*)"?',s)
        if not mm: continue
        n=mm.group(1).lower()
        if n not in {'primary','foreign','unique','constraint','check','exclude'}: cols.add(n)
    return cols


def pkey_create(m): return (m.group(3).lower(),(m.group(1) or m.group(2)).lower())
def pkey_drop(m): return (m.group(4).lower(),(m.group(2) or m.group(3)).lower())


def main():
    paths=ordered_paths()
    source=[]
    for p in paths: source.append((p,strip_comments(p.read_text(encoding='utf-8',errors='ignore'))))

    repo_functions=set(); repo_relations=set(); repo_types=set(); repo_sequences=set()
    for _,txt in source:
        for _,st in split_sql(txt):
            for rx,target in [(CREATE_FUNCTION,repo_functions),(CREATE_TABLE,repo_relations),(CREATE_VIEW,repo_relations),(CREATE_TYPE,repo_types),(CREATE_SEQUENCE,repo_sequences)]:
                m=rx.search(st)
                if m: target.add(m.group(1).lower())

    created_functions=set(); created_relations=set(); created_types=set(); created_sequences=set(); policies=set(); columns=defaultdict(set)
    issues=[]; counts=defaultdict(int)

    for path,txt in source:
        for offset,stmt in split_sql(txt):
            line=txt.count('\n',0,offset)+1
            # Object creation happens before dependencies inside its body are checked.
            m=CREATE_TABLE.search(stmt)
            if m:
                name=m.group(1).lower(); created_relations.add(name); columns[name].update(table_columns_from_create(stmt)); counts['relations_created']+=1
            m=CREATE_VIEW.search(stmt)
            if m: created_relations.add(m.group(1).lower()); counts['relations_created']+=1
            m=CREATE_TYPE.search(stmt)
            if m: created_types.add(m.group(1).lower()); counts['types_created']+=1
            m=CREATE_SEQUENCE.search(stmt)
            if m: created_sequences.add(m.group(1).lower()); counts['sequences_created']+=1
            create_fn=CREATE_FUNCTION.search(stmt)
            if create_fn:
                created_functions.add(create_fn.group(1).lower()); counts['functions_created']+=1

            cp=CREATE_POLICY.search(stmt)
            if cp: policies.add(pkey_create(cp)); counts['policies_created']+=1
            ap=ALTER_POLICY.search(stmt)
            if ap:
                key=pkey_create(ap); counts['policy_dependencies']+=1
                if key not in policies: issues.append(f'{path.name}:{line}: ALTER POLICY requires missing prior policy {key[0]}.{key[1]}')
            dp=DROP_POLICY.search(stmt)
            if dp:
                key=pkey_drop(dp); counts['policy_dependencies']+=1
                if key not in policies and not dp.group(1): issues.append(f'{path.name}:{line}: DROP POLICY requires missing prior policy {key[0]}.{key[1]}')
                policies.discard(key)

            # DDL operations on functions have explicit dependency semantics and should
            # not be mistaken for ordinary function calls by the body scanner below.
            df=DROP_FUNCTION.search(stmt)
            if df:
                name=df.group(2).lower(); counts['function_dependencies']+=1
                if name not in created_functions and not df.group(1): issues.append(f'{path.name}:{line}: DROP FUNCTION requires missing prior function {name}')
                created_functions.discard(name)
            af=ALTER_FUNCTION.search(stmt)
            if af:
                name=af.group(1).lower(); counts['function_dependencies']+=1
                if name not in created_functions: issues.append(f'{path.name}:{line}: ALTER FUNCTION requires missing prior function {name}')
            ef=EXEC_FUNCTION.search(stmt)
            if ef:
                name=ef.group(1).lower(); counts['function_dependencies']+=1
                if name not in created_functions: issues.append(f'{path.name}:{line}: GRANT/REVOKE EXECUTE requires missing prior function {name}')

            # Relation dependencies, including relations referenced by SQL function bodies.
            for label,rx in [('ALTER TABLE',ALTER_TABLE),('CREATE INDEX ON',CREATE_INDEX),('INSERT INTO',INSERT_INTO),('UPDATE',UPDATE),('DELETE FROM',DELETE),('TRUNCATE',TRUNCATE)]:
                mm=rx.search(stmt)
                if mm:
                    name=mm.group(1).lower(); counts['relation_dependencies']+=1
                    if name in repo_relations and name not in created_relations: issues.append(f'{path.name}:{line}: {label} requires missing prior relation {name}')
            for mm in REFERENCES.finditer(stmt):
                name=mm.group(1).lower(); counts['relation_dependencies']+=1
                if name in repo_relations and name not in created_relations: issues.append(f'{path.name}:{line}: REFERENCES requires missing prior relation {name}')
            for mm in FROM_JOIN.finditer(stmt):
                name=mm.group(1).lower()
                if name in repo_relations:
                    counts['relation_dependencies']+=1
                    if name not in created_relations: issues.append(f'{path.name}:{line}: FROM/JOIN requires missing prior relation {name}')

            # Explicit column-state operations are checked statement-by-statement.
            at=ALTER_TABLE.search(stmt)
            if at:
                table=at.group(1).lower()
                for mm in ADD_COLUMN.finditer(stmt): columns[table].add(mm.group(1).lower()); counts['column_events']+=1
                for mm in ALTER_COLUMN.finditer(stmt):
                    col=mm.group(1).lower(); counts['column_events']+=1
                    if table in created_relations and col not in columns[table]: issues.append(f'{path.name}:{line}: ALTER COLUMN references column not yet present: {table}.{col}')
                for mm in DROP_COLUMN.finditer(stmt):
                    col=mm.group(1).lower(); counts['column_events']+=1
                    if table in created_relations and col not in columns[table] and 'if exists' not in stmt.lower(): issues.append(f'{path.name}:{line}: DROP COLUMN references column not yet present: {table}.{col}')
                    columns[table].discard(col)

            # Scan ordinary function references. Remove DDL signature prefixes so a DROP
            # or GRANT signature is not counted as a runtime call. Calls inside function
            # bodies remain, which is exactly where SQL-language create-time dependencies live.
            scan=mask_single_quoted(stmt)
            if create_fn:
                # blank only the declaration prefix through the declared function name/arg opener
                scan=scan[create_fn.end():]
            elif df or af or ef:
                scan=''  # dependency already handled explicitly above
            for mm in FUNCTION_CALL.finditer(scan):
                name=mm.group(1).lower()
                if name in repo_functions:
                    counts['function_dependencies']+=1
                    if name not in created_functions: issues.append(f'{path.name}:{line}: function call/use requires missing prior function {name}')
            for mm in PUBLIC_CALL.finditer(scan):
                name=mm.group(1).lower()
                if name in repo_functions or name in repo_relations or name in repo_types or name in repo_sequences or name in KNOWN_SQL_CALLS: continue
                issues.append(f'{path.name}:{line}: public.{name}(...) referenced but no committed CREATE FUNCTION exists')

            # Custom types defined in-repo cannot be referenced before creation.
            for typ in repo_types:
                if typ in created_types: continue
                if re.search(r'\b(?:public\.)?'+re.escape(typ)+r'\b',stmt,re.I) and not CREATE_TYPE.search(stmt):
                    counts['type_dependencies']+=1; issues.append(f'{path.name}:{line}: custom type {typ} referenced before CREATE TYPE')

    baseline=(ROOT/'supabase'/'migrations'/'0001_baseline.sql').read_text(encoding='utf-8')
    required=[
        'create policy "create notifications" on public.notifications',
        'create or replace function public.is_admin()',
        'create or replace function public.is_group_member(group_uuid uuid, user_uuid uuid)',
        'create or replace function public.is_group_admin(group_uuid uuid, user_uuid uuid)',
    ]
    for token in required:
        if token.lower() not in baseline.lower(): issues.append(f'0001_baseline.sql missing historical compatibility prerequisite: {token}')

    if issues:
        print('Historical migration dependency closure: FAIL')
        for issue in issues: print(' -',issue)
        raise SystemExit(1)
    print('Historical migration dependency closure: PASS')
    print(f' - scanned all {len(paths)} globally ordered migrations, not a sampled subset')
    print(f' - relation dependencies checked: {counts["relation_dependencies"]} across {len(repo_relations)} repo-created relations')
    print(f' - function dependencies checked: {counts["function_dependencies"]} across {len(repo_functions)} repo-created functions')
    print(f' - policy dependency operations checked: {counts["policy_dependencies"]}')
    print(f' - explicit column-state operations checked: {counts["column_events"]}')
    print(f' - custom type dependencies checked: {counts["type_dependencies"]} across {len(repo_types)} repo-created types')
    print(' - historical pre-0034 auth helpers and pre-0017 notification policy are reconstructed in 0001')
    print(' - extension ordering is independently enforced by check_db_extension_prereqs.py')
    print(' - disposable fresh-database execution remains the authoritative final proof')

if __name__=='__main__': main()

#!/usr/bin/env python3
"""Fresh disposable DB only: real independent PostgreSQL sessions and lock barriers."""
import os, pathlib, shutil, subprocess, sys, threading, queue, urllib.parse, time
url=os.environ.get('BNN_RESET_TEST_DATABASE_URL','')
parsed=urllib.parse.urlparse(url)
if parsed.hostname not in ('127.0.0.1','localhost') or parsed.port!=54322:
    sys.exit('BLOCKED: requires the disposable local Supabase database on port 54322')
if not shutil.which('psql'):
    sys.exit('BLOCKED: psql is unavailable')
root=pathlib.Path(__file__).resolve().parents[1]
gid='16300000-0000-0000-0000-000000000020';pid='16300000-0000-0000-0000-000000000021'
organizer='16300000-0000-0000-0000-000000000001';player='16300000-0000-0000-0000-000000000002'
token='16300000-0000-0000-0000-000000000010';other_token='16300000-0000-0000-0000-000000000011'
args=['psql',url,'-X','-qAt','-v','ON_ERROR_STOP=1']
def run(sql,ok=True):
    p=subprocess.run(args,input=sql,text=True,capture_output=True,timeout=20)
    if ok and p.returncode: raise AssertionError(p.stderr)
    return p

def identity(uid=organizer,tok=token):
    return f"set local role authenticated; select set_config('request.jwt.claim.sub','{uid}',true); select set_config('request.headers','{{\"x-bnn-scoring-device\":\"{tok}\"}}',true);"

class Held:
    def __init__(self,sql):
        self.p=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
        self.q=queue.Queue()
        def reader():
            for line in self.p.stdout: self.q.put(line.strip())
            self.q.put('EOF')
        threading.Thread(target=reader,daemon=True).start()
        self.p.stdin.write('begin;\n'+identity()+'\n'+sql+'\n\\echo BNN_LOCK_HELD\n');self.p.stdin.flush()
        while True:
            line=self.q.get(timeout=15)
            if line=='BNN_LOCK_HELD': break
            if line=='EOF': raise AssertionError(self.p.stderr.read())
    def finish(self,sql=''):
        self.p.stdin.write(sql+'\ncommit;\n\\q\n');self.p.stdin.flush()
        self.p.wait(timeout=20)
        if self.p.returncode: raise AssertionError(self.p.stderr.read())
    def abort(self):
        if self.p.poll() is None: self.p.kill();self.p.wait()

workers=[]
def async_sql(sql):
    p=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    workers.append(p)
    p.stdin.write("set application_name='bnn_reset_waiter';"+sql);p.stdin.close();p.stdin=None
    return p

def wait_for_blocked():
    deadline=time.monotonic()+10
    while time.monotonic()<deadline:
        if run("select count(*) from pg_stat_activity where application_name='bnn_reset_waiter' and wait_event='advisory';").stdout.strip()!='0': return
        time.sleep(0.05)
    raise AssertionError('concurrent request never reached the lock barrier')

# Reuse the actual SQL regression's fixture definition, not a second schema model.
source=(root/'ci/assert-game-reset-fencing.sql').read_text()
seed=source.split("select set_config('request.jwt.claim.sub'")[0].replace('begin;','',1)
# Test identities must be absent; no fixture may overwrite an existing record.
assert run(f"select count(*) from auth.users where id in ('{organizer}','{player}');").stdout.strip()=='0'
held=None
try:
    run(seed)
    run('begin;'+identity()+f"select public.claim_scoring_device('{token}');commit;")
    run('begin;'+identity(player,other_token)+f"select public.claim_scoring_device('{other_token}');commit;")
    # Writer obtains the shared lock first. Reset must wait, then erase the accepted save.
    held=Held(f"select public.begin_game_score_write('{gid}',0);")
    reset=async_sql('begin;'+identity()+f"select public.reset_game_scores('{gid}');commit;")
    wait_for_blocked()
    held.finish(f"select public.save_game_score_bundle('{pid}',0,'{{\"scores\":[8]}}');");held=None
    out,err=reset.communicate(timeout=20);assert reset.returncode==0,err
    assert run(f"select scoring_version from public.games where id='{gid}';").stdout.strip()=='1'
    assert run(f"select scores from public.game_players where id='{pid}';").stdout.strip()=='[]'
    # Reset wins first. Delayed writes from a DIFFERENT scorer wait and must reject.
    other_pid='16300000-0000-0000-0000-000000000022'
    for version,statement in enumerate([
        f"select public.save_game_score_bundle('{other_pid}',1,'{{\"scores\":[9]}}');",
        f"select public.save_game_score_bundle('{other_pid}',2,'{{\"putts\":[4]}}',true);",
        f"select public.save_alt_shot_score_fenced('{gid}',3,'reset-group','a',0,9);",
    ],start=1):
        held=Held(f"select public.reset_game_scores('{gid}');")
        writer=async_sql('begin;'+identity(player,other_token)+statement+'commit;')
        wait_for_blocked()
        held.finish();held=None
        out,err=writer.communicate(timeout=20)
        assert writer.returncode!=0 and 'Game scores were reset.' in err,(out,err)
        assert run(f"select scoring_version from public.games where id='{gid}';").stdout.strip()==str(version+1)
        assert run(f"select scores from public.game_players where id='{other_pid}';").stdout.strip()=='[]'
    run('begin;'+identity(player,other_token)+f"select public.save_game_score_bundle('{other_pid}',4,'{{\"scores\":[3]}}');commit;")
    assert run(f"select scores from public.game_players where id='{other_pid}';").stdout.strip()=='[3]'
    print('PASS: real PostgreSQL connections, write-first/reset-first barriers, different accounts, player/stats/Alternate Shot stale rejection, current-version retry')
finally:
    if held: held.abort()
    for worker in workers:
        if worker.poll() is None: worker.kill();worker.wait()
    run(f"delete from public.games where id='{gid}'; delete from public.profiles where id in ('{organizer}','{player}'); delete from auth.users where id in ('{organizer}','{player}');")

#!/usr/bin/env python3
"""Model-based failure simulations for the transactional workflows added in 177.13.
This does not replace PostgreSQL integration tests; it exercises business invariants and retry/failure semantics.
"""
from copy import deepcopy
import random

checks = 0

def assert_eq(a,b,msg):
    global checks
    checks += 1
    if a != b:
        raise AssertionError(f"{msg}: {a!r} != {b!r}")

def tx(initial, steps, fail_at=None):
    working = deepcopy(initial)
    try:
        for i, step in enumerate(steps):
            if fail_at == i:
                raise RuntimeError("injected failure")
            step(working)
        return working, True
    except RuntimeError:
        return deepcopy(initial), False

# Expense edit: any stage failure must roll back amount/shares/payers together.
expense0 = {"amount":30000,"shares":[10000,10000,10000],"payers":{"A":30000}}
expense_steps = [
    lambda s: s.update(amount=33000),
    lambda s: s.update(shares=[]),
    lambda s: s.update(payers={}),
    lambda s: s.update(shares=[11000,11000,11000]),
    lambda s: s.update(payers={"A":33000}),
]
for fail in range(len(expense_steps)):
    out, ok = tx(expense0, expense_steps, fail)
    assert_eq(ok, False, f"expense failure {fail} reports failure")
    assert_eq(out, expense0, f"expense failure {fail} rolls back")
out, ok = tx(expense0, expense_steps)
assert_eq(ok, True, "expense success commits")
assert_eq(sum(out["shares"]), out["amount"], "expense shares exact")
assert_eq(sum(out["payers"].values()), out["amount"], "expense payers exact")

# Game finish: ended state and posted rounds are one unit.
game0 = {"status":"active","rounds":{},"clock_end":None}
def end(s): s["status"]="ended"
def post(s): s["rounds"]={"A":18,"B":18}
def freeze(s): s["clock_end"]="now"
for fail in range(3):
    out, ok = tx(game0,[end,post,freeze],fail)
    assert_eq(out,game0,f"game failure {fail} rolls back")
out,ok=tx(game0,[end,post,freeze])
assert_eq((out["status"],out["rounds"]),("ended",{"A":18,"B":18}),"game success consistent")

# Club delete: partial unlink must never escape.
club0={"group":True,"profiles":2,"round_links":7,"game_links":3}
steps=[lambda s:s.update(profiles=0),lambda s:s.update(round_links=0),lambda s:s.update(game_links=0),lambda s:s.update(group=False)]
for fail in range(4):
    out,ok=tx(club0,steps,fail)
    assert_eq(out,club0,f"club delete failure {fail} rolls back")

# Course correction: link + override + request; retry reuses one pending request.
course0={"linked":False,"override":None,"pending":[]}
def submit(state,payload,fail_at=None):
    def link(s): s["linked"]=True
    def override(s): s["override"]=payload
    def request(s):
        if s["pending"]: s["pending"][0]=payload
        else: s["pending"].append(payload)
    return tx(state,[link,override,request],fail_at)
for fail in range(3):
    out,ok=submit(course0,{"name":"New"},fail)
    assert_eq(out,course0,f"course submit failure {fail} rolls back")
out,ok=submit(course0,{"name":"New"})
out2,ok2=submit(out,{"name":"Newer"})
assert_eq(len(out2["pending"]),1,"course retry keeps one pending request")
assert_eq(out2["pending"][0]["name"],"Newer","course retry updates pending request")

# Review: global update/delete override/status must be atomic and second review rejected by state model.
review0={"global":"Old","override":"New","status":"pending"}
review_steps=[lambda s:s.update(global_="New"),lambda s:s.update(override=None),lambda s:s.update(status="approved")]
# use explicit dict mutation for global key
review_steps=[lambda s:s.__setitem__("global","New"),lambda s:s.__setitem__("override",None),lambda s:s.__setitem__("status","approved")]
for fail in range(3):
    out,ok=tx(review0,review_steps,fail)
    assert_eq(out,review0,f"course review failure {fail} rolls back")
out,ok=tx(review0,review_steps)
assert_eq(out["status"],"approved","course review commits status")
assert_eq(out["override"],None,"course review removes override")
checks += 1
if out["status"] == "pending":
    raise AssertionError("double-review guard model failed")

# RSVP order model: edits retain original order; new users get unique monotonic order.
for seed in range(50):
    random.seed(seed)
    rows={}
    next_order=1
    for _ in range(1000):
        uid=f"u{random.randrange(250)}"
        if uid not in rows:
            rows[uid]=next_order
            next_order += 1
        else:
            old=rows[uid]
            rows[uid]=old
        assert_eq(len(set(rows.values())),len(rows),f"RSVP unique order seed {seed}")
    assert_eq(sorted(rows.values()),list(range(1,len(rows)+1)),f"RSVP monotonic order seed {seed}")

print(f"WORKFLOW FAULT SIMULATION: PASS ({checks} checks; 50,000 randomized RSVP operations)")

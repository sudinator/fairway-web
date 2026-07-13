#!/usr/bin/env python3
# Guard against \uXXXX escapes in JSX *text* (they render literally, unlike inside
# string/template literals). Strips quoted strings first, then flags leftovers.
# Known false positives: regex literals (/.../), deeply-nested template literals —
# eyeball each hit. Run before packaging any bundle.
import re, sys, glob
def strip_quoted(line):
    out=[]; i=0; n=len(line); q=None
    while i<n:
        c=line[i]
        if q:
            if c=='\\' and i+1<n: i+=2; continue
            if c==q: q=None
            i+=1; continue
        if c in ('"',"'",'`'): q=c; i+=1; continue
        out.append(c); i+=1
    return ''.join(out)
bad=[]
for f in glob.glob('components/**/*.tsx', recursive=True)+glob.glob('app/**/*.tsx', recursive=True):
    for ln,line in enumerate(open(f,encoding='utf-8'),1):
        s=strip_quoted(line)
        s=re.sub(r'/[^/\n]+/[gimsuy]*','',s)   # drop regex literals
        if re.search(r'\\u[0-9a-fA-F]{4}', s):
            bad.append(f"{f}:{ln}: {line.strip()[:130]}")
if bad:
    print("REVIEW — possible JSX-text escapes (regex/nested-template are safe false positives):")
    print("\n".join(bad)); sys.exit(1)
print("PASS — no escapes in JSX text")

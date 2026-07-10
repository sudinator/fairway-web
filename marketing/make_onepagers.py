#!/usr/bin/env python3
"""Generate the two Birdie Num Num one-pager PDFs from lib/capabilities.json.

Single source of truth: lib/capabilities.json. The in-app Help page reads the SAME
file, so the app list stays current on its own; this script refreshes the shareable
PDFs. Run: `npm run gen:onepagers` (or `python3 marketing/make_onepagers.py`).

Outputs (deterministic via invariant mode so a CI drift-check is stable):
  public/BNN-onepager-club.pdf   - all-clubs edition
  public/BNN-onepager-tgc.pdf    - TGC edition (+ exclusives band)
  marketing/onepager-content.txt - text manifest the CI drift-check diffs
"""
import json, os
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAP = json.load(open(os.path.join(ROOT, "lib", "capabilities.json"), encoding="utf-8"))

GREEN=HexColor("#0E3B2E"); GREEN_MID=HexColor("#16503D"); GREEN_LT=HexColor("#1B5A46")
CREAM=HexColor("#F7F3E8"); CARD=HexColor("#FFFDF6"); INK=HexColor("#26251F")
FAINT=HexColor("#8B8775"); LINE=HexColor("#D8D2BE"); GOLD=HexColor("#C9A227")
SAGE=HexColor("#A9C4B5"); BIRDIE=HexColor("#B83A2E")
W,H=letter; M=42

def cards_for(edition):
    # edition: "club" or "tgc". Include cards tagged "all" or that edition.
    return [c for c in CAP["cards"] if "all" in c["editions"] or edition in c["editions"]]

def wrap(c,text,font,size,maxw):
    words=text.split(); lines=[]; cur=""
    for w in words:
        t=(cur+" "+w).strip()
        if c.stringWidth(t,font,size)<=maxw: cur=t
        else:
            if cur: lines.append(cur)
            cur=w
    if cur: lines.append(cur)
    return lines

def build(path, edition_label, features, band=None):
    # invariant=1 -> fixed creation date + doc id, so output is byte-stable across runs.
    c=canvas.Canvas(path,pagesize=letter,invariant=1); c.setTitle(f"Birdie Num Num \u2014 {edition_label}")
    c.setFillColor(GREEN); c.rect(0,0,W,H,fill=1,stroke=0)
    fx,fy=M+4,H-58
    c.setStrokeColor(GOLD); c.setLineWidth(2); c.line(fx,fy,fx,fy+34)
    c.setFillColor(BIRDIE); p=c.beginPath(); p.moveTo(fx,fy+34); p.lineTo(fx+22,fy+28); p.lineTo(fx,fy+22); p.close(); c.drawPath(p,fill=1,stroke=0)
    c.setFillColor(GOLD); c.circle(fx,fy,2.4,fill=1,stroke=0)
    c.setFillColor(CREAM); c.setFont("Times-Bold",34); c.drawString(M+40,H-66,"Birdie Num Num")
    c.setFillColor(GOLD); c.setFont("Helvetica-Bold",11); c.drawString(M+42,H-84,edition_label.upper())
    c.setFillColor(CREAM); c.setFont("Helvetica",11)
    for i,ln in enumerate(wrap(c,CAP["tagline"],"Helvetica",11,W-2*M)): c.drawString(M,H-108-i*15,ln)
    c.setStrokeColor(GOLD); c.setLineWidth(1.2); c.line(M,H-130,W-M,H-130)
    region_top=H-154; region_bot=(178 if band else 74); gap=15; cols=2; rows=(len(features)+1)//2
    card_w=(W-2*M-gap)/cols; card_h=(region_top-region_bot-(rows-1)*gap)/rows
    for idx,card in enumerate(features):
        title,body=card["title"],card["body"]
        col=idx%cols; row=idx//cols
        x=M+col*(card_w+gap); y=region_top-card_h-row*(card_h+gap)
        c.setFillColor(CARD); c.roundRect(x,y,card_w,card_h,9,fill=1,stroke=0)
        lines=wrap(c,body,"Helvetica",9.4,card_w-28)
        content_h=3.2+8+13+6+len(lines)*12.2; yt=y+card_h-(card_h-content_h)/2
        c.setFillColor(GOLD); c.roundRect(x+14,yt-3.2,26,3.2,1.6,fill=1,stroke=0)
        c.setFillColor(GREEN); c.setFont("Times-Bold",12.5); hb=yt-3.2-8-11; c.drawString(x+14,hb,title)
        c.setFillColor(INK); c.setFont("Helvetica",9.4); by=hb-6-9
        for i,ln in enumerate(lines): c.drawString(x+14,by-i*12.2,ln)
    if band:
        bx,by,bw,bh=M,72,W-2*M,98
        c.setFillColor(GREEN_LT); c.roundRect(bx,by,bw,bh,10,fill=1,stroke=0)
        c.setStrokeColor(GOLD); c.setLineWidth(1.4); c.roundRect(bx,by,bw,bh,10,fill=0,stroke=1)
        c.setFillColor(GOLD); c.setFont("Helvetica-Bold",10); c.drawString(bx+14,by+bh-17,"\u2605 TGC EXCLUSIVES")
        colw=(bw-28-18)/2
        for i,item in enumerate(band):
            cc=i%2; rr=i//2; ex=bx+14+cc*(colw+18); ey0=by+bh-36-rr*32
            c.setFillColor(CREAM); c.setFont("Helvetica-Bold",9); c.drawString(ex,ey0,"\u2022 "+item["title"])
            c.setFillColor(SAGE); c.setFont("Helvetica",8)
            for j,ln in enumerate(wrap(c,item["body"],"Helvetica",8,colw-8)[:2]): c.drawString(ex+8,ey0-11-j*9.4,ln)
    c.setStrokeColor(GREEN_LT); c.setLineWidth(1); c.line(M,60,W-M,60)
    c.setFillColor(GOLD); c.setFont("Helvetica-Bold",10); c.drawString(M,44,"birdienumnum.vercel.app")
    c.setFillColor(SAGE); c.setFont("Helvetica",10); c.drawRightString(W-M,44,"Free \u00b7 no ads \u00b7 add to your home screen and play")
    c.showPage(); c.save(); print("wrote",os.path.relpath(path,ROOT))

def manifest():
    # Deterministic text dump of exactly what the sheets contain, LF-only.
    lines=["Birdie Num Num one-pager content (auto-generated from lib/capabilities.json)","","TAGLINE: "+CAP["tagline"],""]
    for ed,label in [("club","CLUB EDITION"),("tgc","TGC EDITION")]:
        lines.append("== "+label+" ==")
        for c in cards_for(ed): lines.append(f"- {c['title']}: {c['body']}")
        if ed=="tgc":
            lines.append("  TGC EXCLUSIVES:")
            for x in CAP["tgcExclusives"]: lines.append(f"   * {x['title']}: {x['body']}")
        lines.append("")
    with open(os.path.join(ROOT,"marketing","onepager-content.txt"),"w",newline="\n",encoding="utf-8") as f:
        f.write("\n".join(lines).rstrip()+"\n")
    print("wrote marketing/onepager-content.txt")

os.makedirs(os.path.join(ROOT,"public"),exist_ok=True)
build(os.path.join(ROOT,"public","BNN-onepager-club.pdf"),"Club edition",cards_for("club"))
build(os.path.join(ROOT,"public","BNN-onepager-tgc.pdf"),"TGC edition",cards_for("tgc"),band=CAP["tgcExclusives"])
manifest()

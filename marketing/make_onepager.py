from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor

# ---- Birdie Num Num palette (from the app) ----
GREEN     = HexColor("#0E3B2E")
GREEN_MID = HexColor("#16503D")
GREEN_LT  = HexColor("#1B5A46")
CREAM     = HexColor("#F7F3E8")
CARD      = HexColor("#FFFDF6")
INK       = HexColor("#26251F")
FAINT     = HexColor("#8B8775")
LINE      = HexColor("#D8D2BE")
GOLD      = HexColor("#C9A227")
SAGE      = HexColor("#A9C4B5")
BIRDIE    = HexColor("#B83A2E")

W, H = letter  # 612 x 792
M = 42

c = canvas.Canvas("marketing/Birdie-Num-Num-overview.pdf", pagesize=letter)
c.setTitle("Birdie Num Num — Overview")

# ---- background ----
c.setFillColor(GREEN)
c.rect(0, 0, W, H, fill=1, stroke=0)

def wrap(text, font, size, maxw):
    words = text.split()
    lines, cur = [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if c.stringWidth(trial, font, size) <= maxw:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines

# ---- header: little flag accent ----
fx, fy = M + 4, H - 58          # base of the pin
c.setStrokeColor(GOLD); c.setLineWidth(2)
c.line(fx, fy, fx, fy + 34)     # pole
c.setFillColor(BIRDIE)          # pennant
p = c.beginPath()
p.moveTo(fx, fy + 34); p.lineTo(fx + 22, fy + 28); p.lineTo(fx, fy + 22); p.close()
c.drawPath(p, fill=1, stroke=0)
c.setFillColor(GOLD); c.circle(fx, fy, 2.4, fill=1, stroke=0)  # cup

# ---- wordmark ----
c.setFillColor(CREAM)
c.setFont("Times-Bold", 34)
c.drawString(M + 40, H - 66, "Birdie Num Num")
c.setFillColor(SAGE)
c.setFont("Helvetica", 12.5)
c.drawString(M + 42, H - 84, "Group golf, properly scored.")

# value line
c.setFillColor(CREAM)
c.setFont("Helvetica", 11)
sub = "Live scoring, real handicaps, and every game your group loves \u2014 in one free app you add to your phone."
for i, ln in enumerate(wrap(sub, "Helvetica", 11, W - 2*M)):
    c.drawString(M, H - 112 - i*15, ln)

# gold rule under header
c.setStrokeColor(GOLD); c.setLineWidth(1.2)
c.line(M, H - 134, W - M, H - 134)

# ---- feature cards ----
features = [
    ("Every format you play",
     "Stableford, match play, four-ball, skins and the Ryder-style trifecta \u2014 all scored automatically."),
    ("A live leaderboard",
     "Standings update hole by hole. Share a live link and anyone can follow the round in real time."),
    ("Handicaps that keep themselves",
     "A running WHS-style index built from your rounds (best 8 of 20) \u2014 or simply enter your own."),
    ("Know your game",
     "A personal dashboard: scoring trends, greens, fairways, putts, scrambling and sand saves."),
    ("Every course, one library",
     "Search and save any course. Your group shares a single clean, vetted course library."),
    ("Settle up, no math",
     "Automatic Stableford, sixes and side-bet settlement \u2014 the money sorts itself out at the bar."),
    ("Built for the course",
     "Installs like an app, works offline, and never loses a score to a dead signal."),
    ("Up and running in seconds",
     "Create a game, share a six-digit code, and your whole group is in."),
]

region_top = H - 158
region_bot = 74
gap = 16
cols = 2
rows = 4
card_w = (W - 2*M - gap) / cols
card_h = (region_top - region_bot - (rows - 1) * gap) / rows
top = region_top

for idx, (title, body) in enumerate(features):
    col = idx % cols
    row = idx // cols
    x = M + col * (card_w + gap)
    y = top - card_h - row * (card_h + gap)

    # card
    c.setFillColor(CARD)
    c.roundRect(x, y, card_w, card_h, 9, fill=1, stroke=0)

    # vertically center the tab + heading + body block
    lines = wrap(body, "Helvetica", 9.6, card_w - 28)
    content_h = 3.2 + 8 + 13 + 6 + len(lines) * 12.4
    yt = y + card_h - (card_h - content_h) / 2   # top of the content block

    # gold accent tab
    c.setFillColor(GOLD)
    c.roundRect(x + 14, yt - 3.2, 26, 3.2, 1.6, fill=1, stroke=0)

    # heading
    c.setFillColor(GREEN)
    c.setFont("Times-Bold", 13)
    hb = yt - 3.2 - 8 - 11
    c.drawString(x + 14, hb, title)

    # body
    c.setFillColor(INK)
    c.setFont("Helvetica", 9.6)
    by = hb - 6 - 9
    for i, ln in enumerate(lines):
        c.drawString(x + 14, by - i * 12.4, ln)

# ---- footer ----
c.setStrokeColor(GREEN_LT); c.setLineWidth(1)
c.line(M, 60, W - M, 60)
c.setFillColor(GOLD)
c.setFont("Helvetica-Bold", 10)
c.drawString(M, 44, "birdienumnum.vercel.app")
c.setFillColor(SAGE)
c.setFont("Helvetica", 10)
c.drawRightString(W - M, 44, "Free \u00b7 no ads \u00b7 add to your home screen and play")

c.showPage()
c.save()
print("PDF written")

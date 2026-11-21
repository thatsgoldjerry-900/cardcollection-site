#!/usr/bin/env python3
"""Make the link-preview pictures (1200x630) in assets/previews/: one per collection, shown when someone shares
a collection's link (c/<slug>/). Run by hand when a collection's look should change; the pictures are kept in the repo.
Each shows the collection's name over a dark background with three standout cards from it (the scans unchanged).
    python3 scripts/make_preview_images.py [slug ...]
"""
import io, json, os, re, sys, urllib.request
from PIL import Image, ImageDraw, ImageFont, ImageFilter
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cat = json.load(open(os.path.join(ROOT, "data", "catalog.json")))
F = lambda n, s: ImageFont.truetype(f"/usr/share/fonts/opentype/inter/{n}.otf", s)
COLORS = {"alex-gordon": (20, 60, 150), "jermaine-dye": (20, 60, 150), "royals": (20, 60, 150), "lions": (0, 110, 180), "want-list": (90, 90, 110), "customs": (170, 120, 20)}
PICKS = {   # hand-picked cards (start of the card name) where the automatic choice isn't the best showcase
    "alex-gordon": ["2014 Topps Triple Threads - All-Star Jumbo Sleeve Team Patch"],
}
def rarity(name):
    if re.search(r"\b1 of 1\b|#'d to 1\b|\b1/1\b", name): return 1
    m = re.search(r"\bSN(\d+)|#'d to (\d+)|of (\d+)\b|PR(\d+)|Print Run of (\d+)", name)
    return int(next(g for g in m.groups() if g)) if m else 99999
def picks(slug, cards):
    cards = [x for x in cards if not re.search(r"\(back\)|\bback\s*$|\bsold\b", x[2], re.I)]
    chosen = [x for p in PICKS.get(slug, []) for x in cards if x[2].startswith(p)][:1]
    auto = lambda x: bool(re.search(r"\bAU\b|autograph|signature|signed", x[2], re.I))
    # Ian's choice: rare patch cards first (prime patches, laundry tags, logos, nameplates, letters), rarest first.
    PATCH = re.compile(r"patch|prime|laundry|\btag\b|logo ?man|logo|nameplate|shield|button|letter|jumbo|tag relic", re.I)
    patch = lambda x: bool(PATCH.search(x[2])) and not re.search(r"\bMANU\b|manufactured|printing plate|plate\b", x[2], re.I)
    ok = [x for x in cards if not re.search(r"printing plate|\bplate\b|custom", x[2], re.I) or slug == "customs"]
    ranked = sorted(ok, key=lambda x: (not patch(x), rarity(x[2]), not auto(x), x[2]))
    seen = set()
    for x in chosen + ranked:
        who = re.sub(r"^.*#\S+\s+", "", x[2]).split(" AU")[0][:20]
        if who in seen and len(seen) < 3 and slug not in ("alex-gordon", "jermaine-dye"): continue
        if x not in chosen: chosen.append(x)
        seen.add(who)
        if len(chosen) == 3: break
    return chosen[:3]
def fetch(x):
    u = f"https://lh3.googleusercontent.com/d/{x[0]}=w700" + (f"?resourcekey={x[1]}" if x[1] else "")
    return Image.open(io.BytesIO(urllib.request.urlopen(u, timeout=60).read())).convert("RGB")
def make(slug, title, kicker, cards, count):
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), (10, 12, 18))
    glow = Image.new("RGB", (W, H)); g = ImageDraw.Draw(glow)
    g.ellipse([-200, 250, 500, 900], fill=(150, 15, 30)); g.ellipse([750, -300, 1500, 350], fill=COLORS.get(slug, (150, 15, 30)))
    img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(160)), 0.55)
    ims = [fetch(x) for x in cards]
    slots = [(700, 70, 250, 330), (930, 150, 230, 330), (800, 300, 240, 300)]
    for im, (x, y, bw, bh) in zip(ims, slots):
        im.thumbnail((bw, bh)); sh = Image.new("RGBA", (im.width + 60, im.height + 60), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle([30, 36, im.width + 30, im.height + 36], 12, fill=(0, 0, 0, 200)); sh = sh.filter(ImageFilter.GaussianBlur(14))
        img.paste(sh, (x - 30, y - 30), sh); img.paste(im, (x, y))
    d = ImageDraw.Draw(img)
    d.text((70, 120), kicker.upper(), font=F("Inter-Bold", 24), fill=(255, 110, 110))
    size = 76
    words, lines = title.split(), []
    while True:
        lines, cur = [], ""
        for w in words:
            t = (cur + " " + w).strip()
            if d.textlength(t, font=F("InterDisplay-Bold", size)) > 580 and cur: lines.append(cur); cur = w
            else: cur = t
        lines.append(cur)
        if len(lines) <= 3 or size <= 52: break
        size -= 6
    y = 165
    for ln in lines: d.text((70, y), ln, font=F("InterDisplay-Bold", size), fill=(240, 242, 246)); y += int(size * 1.08)
    d.text((72, y + 18), f"{count:,} scans", font=F("Inter-SemiBold", 30), fill=(185, 192, 204))
    d.text((72, 545), "IANBADEER.COM", font=F("Inter-Bold", 26), fill=(255, 90, 90))
    img.save(os.path.join(ROOT, "assets", "previews", slug + ".jpg"), quality=86)
only = sys.argv[1:]
# A section with a teamTag (Detroit Lions) shows every card tagged with that team (card field 8), not cards filed in it.
_want = {k for k, x in enumerate(cat["sections"]) if x.get("kind") == "want"}
in_section = lambda x, i, s: (x[8] == s["teamTag"] and x[3] not in _want) if s.get("teamTag") else x[3] == i
for i, s in enumerate(cat["sections"]):
    cards = [x for x in cat["cards"] if in_section(x, i, s)]
    if not cards or (only and s["slug"] not in only): continue
    kicker = {"pc": "Super Collection", "team": "Team collection", "want": "Still hunting"}.get(s.get("kind"), "Collection")
    make(s["slug"], s["title"], kicker, picks(s["slug"], cards), len(cards)); print(s["slug"])
customs = [x for x in cat["cards"] if re.search(r"\bcustom\b", x[2], re.I)]
if not only or "customs" in only:
    make("customs", "Custom Cards", "Made by hand", picks("customs", customs), len(customs)); print("customs")

#!/usr/bin/env python3
"""Real page addresses: a copy of index.html at each main address of the site, with that page's own title,
description and link-preview picture (search engines and link previews read these; the site then draws the page).
  c/<slug>/  customs/  duplicates/  rarest/  stats/  media/  letters/  about/  nfl-teams/  player-pages/
  checklist/ (+ tier-2/ tier-3/ mlb/ nba/)  player/<slug>/ for every player page
Any other address (a search, a card…) reaches 404.html, which hands it to the site. Built by the GitHub Action;
these folders are not kept in the repo. Adds the addresses to sitemap.xml."""
import html, json, os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cat = json.load(open(os.path.join(ROOT, "data", "catalog.json")))
site = cat["site"]; base = (site.get("siteUrl") or "").rstrip("/") + "/"
TEMPLATE = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
e = lambda s: html.escape(str(s), quote=True)
def img(cid, rk="", w=800): return f"https://lh3.googleusercontent.com/d/{cid}=w{w}" + (f"?resourcekey={rk}" if rk else "")
def meta(t, name, val, attr="property"):
    pat = re.compile(rf'<meta {attr}="{re.escape(name)}" content="[^"]*">')
    return pat.sub(f'<meta {attr}="{name}" content="{e(val)}">', t, count=1) if pat.search(t) else t
made = []
def write(rel, title, desc, image=None, large=True):
    t = TEMPLATE
    full = f"{title} · IanBadeer.com" if title else "IanBadeer.com"
    t = re.sub(r"<title>[^<]*</title>", f"<title>{e(full)}</title>", t, count=1)
    t = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{e(desc)}">', t, count=1)
    for k, v in (("og:title", full), ("og:description", desc), ("og:url", base + rel)): t = meta(t, k, v)
    if image:
        t = meta(t, "og:image", image)
        if not large:
            t = re.sub(r'\s*<meta property="og:image:(width|height)" content="[^"]*">', "", t)
            t = meta(t, "twitter:card", "summary", "name")
    t = t.replace("</head>", f'<link rel="canonical" href="{e(base + rel)}">\n</head>', 1)
    d = os.path.join(ROOT, rel); os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "index.html"), "w", encoding="utf-8").write(t); made.append(rel)
prev = lambda slug: base + f"assets/previews/{slug}.jpg" if os.path.exists(os.path.join(ROOT, "assets", "previews", slug + ".jpg")) else None
first = lambda t: re.split(r"(?<=[.!?])\s", (t or "").strip())[0] if t else ""
cards = cat["cards"]
# Collections
# A section with a teamTag (Detroit Lions) shows every card tagged with that team (card field 8), not cards filed in it.
_want = {k for k, x in enumerate(cat["sections"]) if x.get("kind") == "want"}
in_section = lambda x, i, s: (x[8] == s["teamTag"] and x[3] not in _want) if s.get("teamTag") else x[3] == i
for i, s in enumerate(cat["sections"]):
    n = sum(1 for x in cards if in_section(x, i, s))
    if not n: continue
    write(f"c/{s['slug']}/", s["title"], f"{first(s.get('blurb'))} {n:,} high-resolution scans.".strip(), prev(s["slug"]))
nc = sum(1 for x in cards if re.search(r"\bcustom\b", x[2], re.I))
write("customs/", "Custom Cards", f"Custom cards are a labor of love, made by hand. {nc:,} scans.", prev("customs"))
write("duplicates/", "Duplicates", "Cards/Items that I have more than one copy of. A duplicate doesn't guarantee that it's available for trade, but it doesn't hurt to ask.")
write("rarest/", "Rarest Cards", "Every numbered card I've scanned, rarest first: one-of-ones, then /2, /3 and up.")
write("stats/", "Scanned Collection Stats", "The collection by the numbers: years, kinds of cards, print runs and players.")
write("media/", "Media", "Interviews, podcasts and videos about the collection.")
write("letters/", "All letterman sets", "Every letterman set in the collection, by the word it spells, with the letters still needed.")
for ch in site.get("chases", []):   # chase pages (config "chases"), e.g. Nebraska Cracked Ice
    write(f"chase/{ch['slug']}/", ch["title"], ch.get("blurb", ""))
write("about/", "About & sharing", "About IanBadeer.com, sharing the research, and using the images.")
write("nfl-teams/", "Huskers by NFL Team", "Every Nebraska Cornhusker on each NFL team, with their years.")
for rel in ("husker-bios/", "player-pages/"):   # player-pages/ was the first address; kept so early links work
    write(rel, "Husker Bios", "A page for every Nebraska Cornhusker who made the pros: career, cards and autographs.")
for path, label in (("", "NFL Tier 1 Huskers Autograph List"), ("tier-2/", "NFL Tier 2 Huskers Autograph List"), ("tier-3/", "NFL Tier 3 Huskers Autograph List"),
                    ("mlb/", "MLB Huskers Autograph List"), ("nba/", "NBA Huskers Autograph List")):
    write("checklist/" + path, label, "Ian Badeer's autograph list: one autograph of every Husker who made the pros.")
# Player pages: the slugs the site uses (data/players.json, plus config cardPlayers)
norm = lambda t: re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()
AU = re.compile(r"\bAU\b|autograph|signature|signed", re.I)
hay = [(" " + norm(x[2]) + " ", x) for x in cards if not re.search(r"\(back\)|\bback\s*$", x[2], re.I)]
def best(name):
    n = " " + norm(name) + " "
    mine = [x for h, x in hay if n in h]
    au = [x for x in mine if AU.search(x[2])]
    return (au or mine or [None])[0]
players = json.load(open(os.path.join(ROOT, "data", "players.json")))["players"]
extra = [{"slug": norm(p["name"]).replace(" ", "-"), "name": p["name"], "position": p.get("position", "")}
         for k, v in (site.get("cardPlayers") or {}).items() if not k.startswith("_") for p in v]
for p in players + extra:
    x = best(p["name"])
    pos = p.get("position") or ""
    league = {"baseball": "MLB", "basketball": "NBA"}.get(p.get("sport"), "")
    desc = f"{p['name']}{', ' + pos if pos else ''}: Nebraska Cornhusker{' in the ' + league if league else ''}. Career, cards and autographs from Ian Badeer's collection."
    write(f"player/{p['slug']}/", p["name"], desc, img(x[0], x[1]) if x else None, large=False)
# Sitemap: add these addresses
sm = os.path.join(ROOT, "sitemap.xml")
if os.path.exists(sm):
    t = open(sm, encoding="utf-8").read()
    have = set(re.findall(r"<loc>([^<]+)</loc>", t))
    add = "".join(f"<url><loc>{e(base + r)}</loc></url>\n" for r in made if base + r not in have)
    open(sm, "w", encoding="utf-8").write(t.replace("</urlset>", add + "</urlset>"))
print(f"{len(made)} page addresses written")

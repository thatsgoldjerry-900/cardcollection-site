#!/usr/bin/env python3
"""Logos for the teams on career timelines, from Wikipedia: the logo of the time for past NFL team names
("St. Louis Rams", "Oakland Raiders", "Houston Oilers") and logos for other leagues' teams (CFL, USFL, XFL, arena,
NFL Europe, early pro teams). Writes data/team-logos.json: {"byName": {"St. Louis Rams": "<image url>"}, "tried": [...]}.

Cached: names already found or already tried are skipped, so a run only looks up new names (the GitHub Action runs
this every update; Wikipedia rate-limits busy addresses, so it goes slowly and stops early when told to wait).
A logo is only accepted when the Wikipedia article is about a football team: its infobox logo (Wikipedia's main API;
the page-summary service leaves out non-free images, which most team logos are).
"""
import json, os, re, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "team-logos.json")
UA = {"User-Agent": "IanBadeerCardSite/1.0 (https://thatsgoldjerry-900.github.io/cardcollection-site/; team logos, cached) python-urllib", "Api-User-Agent": "IanBadeerCardSite/1.0 (https://thatsgoldjerry-900.github.io/cardcollection-site/)"}
teams = json.load(open(os.path.join(ROOT, "data", "nfl-teams.json")))["teams"]
players = json.load(open(os.path.join(ROOT, "data", "players.json")))["players"]
cache = json.load(open(OUT)) if os.path.exists(OUT) else {"byName": {}, "tried": []}
cache.setdefault("byName", {}); cache.setdefault("tried", [])

# Names to look up: every past NFL team name, and every non-NFL team in players' Wikipedia career histories.
current = {t["names"][0] for t in teams}
nfl_names = {n for t in teams for n in t["names"]}
names = {n for t in teams for n in t["names"][1:]}
for p in players:
    if p.get("sport", "football") != "football": continue
    sec = (p.get("wiki") or {}).get("sections") or {}
    ents = [r[0] for k in ("Career history", "Playing") for r in sec.get(k, []) if len(r) == 1]
    ents += [r[1] for r in sec.get("Playing career", []) if len(r) == 2 and re.search(r"\d{4}", r[0])]
    for e in ents:
        for part in e.split("/"):
            n = re.sub(r"^[→*\s]+", "", re.split(r"\s*\(", part.strip())[0]).rstrip("* ").strip()
            if len(n.split()) < 2 or "nebraska" in n.lower() or n.lower().startswith("offseason"): continue
            if n in current or any(n.lower().startswith(x.lower()) for x in current): continue
            names.add(n)

class Failed(Exception): pass
def api(params):
    u = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": 2})
    try:
        return json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=20))
    except Exception as e:
        raise Failed(str(e))

LOGOISH = re.compile(r"logo|wordmark|emblem|crest|helmet", re.I)
FOOTBALL = re.compile(r"\bfootball\b|\bnfl\b|\bcfl\b|\busfl\b|\bxfl\b|arena football|\baaf\b|\bufl\b")
def logo_for(name):
    """The team's logo from its Wikipedia article (Wikipedia's main API; one or two requests per article tried).
    Team logos are usually non-free files, shown in the infobox: the article's non-free page image, or a free page
    image named like a logo. Only football-team articles count."""
    # Football-specific articles first, so "St. Louis Cardinals" finds the NFL team, not the baseball team.
    base = re.sub(r"\s*\(NFL\)$", "", name)
    tries = ([f"{base} (NFL)", f"History of the {base}"] if name in nfl_names else []) + [f"{base} (American football)", f"{base} (Canadian football)", f"{base} (football)", base]
    for t in tries:
        d = api({"action": "query", "titles": t, "redirects": 1, "prop": "pageprops|description|extracts", "exintro": 1, "explaintext": 1, "exchars": 600}); time.sleep(1.2)
        pg = (d.get("query", {}).get("pages") or [{}])[0]
        if pg.get("missing") or not pg.get("title"): continue
        pp = pg.get("pageprops") or {}
        if "disambiguation" in pp: continue
        desc = (pg.get("description") or "").lower(); about = desc + " " + (pg.get("extract") or "").lower()
        if re.search(r"baseball|hockey|basketball|soccer|association football|cricket|rugby", desc): continue   # another sport's team
        if not FOOTBALL.search(about): continue
        f = pp.get("page_image") or (pp.get("page_image_free") if LOGOISH.search(pp.get("page_image_free", "")) else "")
        if not f: continue
        d = api({"action": "query", "titles": "File:" + f, "prop": "imageinfo", "iiprop": "url", "iiurlwidth": 120}); time.sleep(1.2)
        ii = ((d.get("query", {}).get("pages") or [{}])[0].get("imageinfo") or [{}])[0]
        img = ii.get("thumburl") or ii.get("url") or ""
        if img: return img
    return ""

# Names tried before the infobox-logo lookup existed get one more try.
if cache.get("v", 1) < 2:
    cache["tried"] = []; cache["v"] = 2
todo = sorted(n for n in names if n not in cache["byName"] and n not in cache["tried"])
print(f"{len(names)} team names; {len(todo)} to look up", file=sys.stderr)
found = 0
for n in todo:
    try:
        u = logo_for(n)
    except Failed as e:
        print(f"Wikipedia lookup failed ({e}); stopping for now, the next run continues.", file=sys.stderr)
        break
    if u: cache["byName"][n] = u; found += 1
    else: cache["tried"].append(n)
cache["_help"] = ("Team logos for career timelines, from Wikipedia (scripts/build_team_logos.py): past NFL team names get the logo "
                  "of that era, other leagues' teams their logo. 'tried' = names with no logo found (not looked up again).")
json.dump(cache, open(OUT, "w"), indent=1, ensure_ascii=False, sort_keys=True)
print(f"found {found} new logos; {len(cache['byName'])} total", file=sys.stderr)

#!/usr/bin/env python3
"""Fill in Husker college stats from CollegeFootballData's game-by-game box scores.

CFBD's season totals for Nebraska are missing many players in some years (2008 lists only 18), but its
per-game box scores are complete. This adds each player's games up into season totals in the same shape
build_players.py uses ({year: {category: {stat: value}}}), keeping any season total CFBD already had.

  python3 scripts/college_from_games.py                  # NFL Tier 2 and Tier 3 players
  python3 scripts/college_from_games.py --lists=all      # every football list
"""
import json, os, re, sys, time
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from build_players import S, CFBD, OUT, norm, cfbd_season  # noqa: E402

CACHE = {}


def games(year):
    if year not in CACHE:
        key = os.environ.get("CFBD_API_KEY", "proxy-injected")
        for attempt in range(4):
            r = S.get(f"{CFBD}/games/players", params={"year": year, "team": "Nebraska"},
                      headers={"Authorization": f"Bearer {key}"}, timeout=90)
            if r.status_code == 429: time.sleep(10 * (attempt + 1)); continue
            r.raise_for_status(); break
        CACHE[year] = r.json()
    return CACHE[year]


def num(v):
    try: return float(v)
    except (TypeError, ValueError): return None


def fmt(x, places=1):
    return str(int(x)) if places == 0 else f"{x:.{places}f}"


def season_totals(year):
    """{normalized name: {category: {stat: value}}} for every Husker who appears in a box score that year."""
    raw = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    longs = defaultdict(lambda: defaultdict(float))
    names = {}
    for g in games(year):
        for t in g.get("teams", []):
            if t.get("team") != "Nebraska": continue
            for c in t.get("categories", []):
                cat = c["name"]
                for ty in c.get("types", []):
                    st = ty["name"]
                    for a in ty.get("athletes", []):
                        n = norm(a["name"]); names[n] = a["name"]
                        v = str(a.get("stat", ""))
                        if "/" in v and st in ("C/ATT", "FG", "XP"):          # "15/22" made/attempted
                            m, _, at = v.partition("/")
                            mk, ak = {"C/ATT": ("COMPLETIONS", "ATT"), "FG": ("FGM", "FGA"), "XP": ("XPM", "XPA")}[st]
                            raw[n][cat][mk] += num(m) or 0; raw[n][cat][ak] += num(at) or 0
                        elif st == "LONG":
                            longs[n][cat] = max(longs[n][cat], num(v) or 0)
                        elif st in ("AVG", "PCT", "QBR", "YPC", "YPR", "YPA", "YPP"):
                            continue                                       # rates are recomputed from totals
                        elif num(v) is not None:
                            raw[n][cat][st.upper() if st != "In 20" else "IN 20"] += num(v)
    out = {}
    for n, cats in raw.items():
        seasons = {}
        for cat, s in cats.items():
            d = {k: fmt(v, 1 if k in ("SACKS", "TFL") and v % 1 else 0) for k, v in s.items()}
            if cat in longs[n]: d["LONG"] = fmt(longs[n][cat], 0)
            if cat == "passing" and s.get("ATT"):
                d["PCT"] = fmt(100 * s.get("COMPLETIONS", 0) / s["ATT"]); d["YPA"] = fmt(s.get("YDS", 0) / s["ATT"])
            if cat == "rushing" and s.get("CAR"): d["YPC"] = fmt(s.get("YDS", 0) / s["CAR"])
            if cat == "receiving" and s.get("REC"): d["YPR"] = fmt(s.get("YDS", 0) / s["REC"])
            if cat in ("interceptions", "kickReturns", "puntReturns"):
                k = "INT" if cat == "interceptions" else "NO"
                if s.get(k): d["AVG"] = fmt(s.get("YDS", 0) / s[k])
            if cat == "kicking" and s.get("FGA"): d["PCT"] = fmt(100 * s.get("FGM", 0) / s["FGA"])
            if cat == "punting" and s.get("NO"): d["YPP"] = fmt(s.get("YDS", 0) / s["NO"])
            if any(v not in ("0", "0.0") for v in d.values()): seasons[cat] = d
        if seasons: out[n] = seasons
    return out


NICK = {"josh": "joshua", "mike": "michael", "drew": "andrew", "andy": "andrew", "matt": "matthew", "chris": "christopher",
        "dan": "daniel", "danny": "daniel", "tom": "thomas", "tommy": "thomas", "will": "william", "bill": "william", "billy": "william",
        "bob": "robert", "rob": "robert", "bobby": "robert", "jim": "james", "jimmy": "james", "nick": "nicholas", "alex": "alexander",
        "tony": "anthony", "ben": "benjamin", "sam": "samuel", "zach": "zachary", "jake": "jacob", "joe": "joseph", "joey": "joseph",
        "steve": "steven", "dave": "david", "greg": "gregory", "ron": "ronald", "rich": "richard", "rick": "richard", "ted": "theodore",
        "pat": "patrick", "jon": "jonathan", "nate": "nathan", "ed": "edward", "eddie": "edward", "jeff": "jeffrey", "ken": "kenneth"}
FULL = {}
for k, v in NICK.items(): FULL.setdefault(v, set()).add(k)


def same_first(a, b):
    """First names that are the same person: equal, a nickname of each other, or one small typo apart."""
    import difflib
    if a == b or NICK.get(a, a) == NICK.get(b, b) or b in FULL.get(a, ()) or a in FULL.get(b, ()): return True
    return a[:1] == b[:1] and len(a) > 3 and difflib.SequenceMatcher(None, a, b).ratio() >= 0.85


def find(name, table):
    """This player's line in a season's totals: exact name first, then same last name with a matching first name."""
    for k in name_keys(name):
        if k in table: return table[k]
    for k in name_keys(name):
        parts = k.split()
        if len(parts) < 2: continue
        hits = [t for t in table if t.split()[-1] == parts[-1] and len(t.split()) >= 2 and same_first(parts[0], t.split()[0])]
        if len(hits) == 1: return table[hits[0]]
    return None


def name_keys(name):
    """The player's name as CFBD might write it: as listed, and with a quoted nickname ("R.J.") as the first name."""
    keys = [norm(name)]
    nick = re.search(r'"([^"]+)"', name)
    if nick: keys.append(norm(nick.group(1) + " " + name.split()[-1]))
    return keys


def main():
    data = json.load(open(OUT))
    lists = ("nfl-tier-2-huskers", "pro-football-huskers")
    if "--lists=all" in sys.argv: lists = None
    first_year = 2004
    totals, season_api = {}, {}
    filled = changed = 0
    for p in data["players"]:
        if p.get("sport") != "football" or (lists and p.get("list") not in lists): continue
        fy = p.get("finalYear")
        if not fy or fy < first_year: continue
        merged, added = dict(p.get("college") or {}), False
        for y in range(max(first_year, fy - 5), min(fy, 2025) + 1):
            if y not in totals: totals[y] = season_totals(y)
            if y not in season_api:
                tbl = {}
                for r in cfbd_season(y): tbl.setdefault(norm(r["player"]), {}).setdefault(r["category"], {})[r["statType"]] = r["stat"]
                season_api[y] = tbl
            official, boxes = find(p["name"], season_api[y]) or {}, find(p["name"], totals[y]) or {}
            if not official and not boxes: continue
            have = merged.get(str(y), {})
            # CFBD's own season totals first (they include defense from 2016), then box-score totals for the rest.
            for cat, stats in list(official.items()) + list(boxes.items()):
                if cat not in have:                     # keep any season total CFBD already published
                    have[cat] = stats; added = True
            if have: merged[str(y)] = have
        if added:
            if not p.get("college"): filled += 1
            changed += 1
            p["college"] = {y: merged[y] for y in sorted(merged)}
            p["collegeSource"] = "games"
    json.dump(data, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"{changed} players updated, {filled} of them had no college stats before.")


if __name__ == "__main__":
    main()

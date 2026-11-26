#!/usr/bin/env python3
"""Fill in NFL team years that Ian's research notes don't give, from Pro Football Archives (PFA).

For each player on the NFL lists whose note names a team without a year (Huskers by NFL Team shows no year for him),
open the player's PFA page (the link on his list row) and read the years PFA lists for that franchise (roster,
draft and transaction lines such as "1955 Green Bay Packers (NFL)"). Writes data/team-years.json:
  {"players": {"charles-bryant": {"green-bay-packers": "1955"}}, ...}
The site uses these years only where the note has none, and marks them as from Pro Football Archives.

Usage: python3 scripts/pfa_team_years.py LISTS_JSON NOYEAR_JSON
  LISTS_JSON  - the published husker-pros list file (data/lists/husker-pros.json, or a copy of the live one)
  NOYEAR_JSON - [[team name, player name], ...] rows still showing no year on the team pages
Fetches politely (one page a second). Prints only counts and names, never note text.
"""
import html, json, os, re, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
lists = json.load(open(sys.argv[1]))
noyear = json.load(open(sys.argv[2]))
teams = json.load(open(os.path.join(ROOT, "data", "nfl-teams.json")))["teams"]
by_name = {t["name"]: t for t in teams}

def norm(t):
    t = str(t).lower(); t = re.sub(r'"[^"]*"', " ", t); t = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", " ", t)
    return re.sub(r"[^a-z0-9]+", " ", t).strip()

# Player name -> (page slug, PFA link), using the same slug rules as the site (assets/app.js allPlayers).
ORDER = [("nfl-tier-1-huskers", "football"), ("baseball-mlb", "baseball"), ("basketball-nba", "basketball"),
         ("nfl-tier-2-huskers", "tier-2"), ("pro-football-huskers", "tier-3")]
used, info = set(), {}
for slug, suf in ORDER:
    l = next((x for x in lists["lists"] if x["slug"] == slug), None)
    if not l: continue
    for g in l["groups"]:
        for r in g["rows"]:
            name = r[0].strip(); ps = norm(name).replace(" ", "-")
            if ps in used: ps += "-" + suf
            used.add(ps)
            link = (l.get("links") or {}).get(r[0], "")
            if slug.startswith(("nfl", "pro")) and name not in info: info[name] = (ps, link)

def pfa_years(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (card-site build; one page a second)"})
    raw = urllib.request.urlopen(req, timeout=20).read().decode("latin-1")
    text = html.unescape(re.sub(r"<[^>]+>", "|", re.sub(r"<script.*?</script>|<style.*?</style>", "", raw, flags=re.S)))
    found = {}
    for m in re.finditer(r"\b(19\d\d|20\d\d) ([A-Z][A-Za-z.' ]+?) \((NFL|AFL|AAFC)\)", text):
        year, team = int(m.group(1)), m.group(2).strip()
        t = next((t for t in teams if any(team.lower() == n.lower() for n in t["names"])), None)
        if t: found.setdefault(t["slug"], set()).add(year)
    return found

def span(ys):
    ys = sorted(ys); return str(ys[0]) if len(ys) == 1 else f"{ys[0]}–{ys[-1]}" if ys[-1] - ys[0] == len(ys) - 1 else ", ".join(map(str, ys))

out, cache, miss = {}, {}, []
for team_name, player in noyear:
    t = by_name.get(team_name); ps, link = info.get(player, ("", ""))
    if not t or not ps or "profootballarchives.com" not in link: miss.append((player, team_name, "no PFA link")); continue
    if link not in cache:
        try: cache[link] = pfa_years(link)
        except Exception as e: cache[link] = {}; print("fetch failed:", player, e, file=sys.stderr)
        time.sleep(1)
    ys = cache[link].get(t["slug"])
    if ys: out.setdefault(ps, {})[t["slug"]] = span(ys)
    else: miss.append((player, team_name, "team not on PFA page"))

json.dump({"_help": "NFL team years from Pro Football Archives for players whose research note names the team without a year "
                    "(scripts/pfa_team_years.py). Used only where the note gives no year; shown as from Pro Football Archives.",
           "source": "https://www.profootballarchives.com/", "players": out},
          open(os.path.join(ROOT, "data", "team-years.json"), "w"), indent=1, ensure_ascii=False)
print(f"years found: {sum(len(v) for v in out.values())} of {len(noyear)}; still missing: {len(miss)}")
for p, t, why in miss: print(f"  {p} ({t}): {why}")

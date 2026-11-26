#!/usr/bin/env python3
"""Teams for the MLB and NBA autograph lists: which major-league clubs each Husker played for (from the Wikipedia
career tables in data/players.json), and each club's logo from its Wikipedia article.

Writes data/sports-team-logos.json:
  {"teams": {"Houston Astros": {"logo": "<image url>", "page": "<article url>"}},
   "players": {"Brice Matthews": ["Houston Astros"], ...}}

Only major-league clubs count (minor-league affiliates, Japanese, Korean, Taiwanese and other leagues' teams are
left out). Cached: a club already looked up is not looked up again. Wikipedia's logo is the infobox image (non-free
logos are only shown there).
"""
import json, os, re, time, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "sports-team-logos.json")
PLAYERS = os.path.join(ROOT, "data", "players.json")
UA = {"User-Agent": "IanBadeerCardSite/1.0 (https://thatsgoldjerry-900.github.io/cardcollection-site/; team logos, cached) python-urllib",
      "Api-User-Agent": "IanBadeerCardSite/1.0 (https://thatsgoldjerry-900.github.io/cardcollection-site/)"}

# Club names as they appear in the career tables -> the club's name as Wikipedia's article is titled.
MLB = {
    "Arizona Diamondbacks": "Arizona Diamondbacks", "Atlanta Braves": "Atlanta Braves", "Baltimore Orioles": "Baltimore Orioles",
    "Boston Red Sox": "Boston Red Sox", "Chicago Cubs": "Chicago Cubs", "Chicago White Sox": "Chicago White Sox",
    "Cincinnati Reds": "Cincinnati Reds", "Cleveland Indians": "Cleveland Indians", "Cleveland Guardians": "Cleveland Guardians",
    "Colorado Rockies": "Colorado Rockies", "Detroit Tigers": "Detroit Tigers", "Houston Astros": "Houston Astros",
    "Kansas City Royals": "Kansas City Royals", "Kansas City Athletics": "Kansas City Athletics",
    "Los Angeles Angels": "Los Angeles Angels", "California Angels": "California Angels",
    "California / Anaheim / Los Angeles Angels of Anaheim": "Los Angeles Angels", "Los Angeles Angels of Anaheim": "Los Angeles Angels",
    "Los Angeles Dodgers": "Los Angeles Dodgers", "Miami Marlins": "Miami Marlins", "Florida Marlins": "Florida Marlins",
    "Milwaukee Brewers": "Milwaukee Brewers", "Minnesota Twins": "Minnesota Twins", "New York Mets": "New York Mets",
    "New York Yankees": "New York Yankees", "Oakland Athletics": "Oakland Athletics", "Philadelphia Phillies": "Philadelphia Phillies",
    "Pittsburgh Pirates": "Pittsburgh Pirates", "San Diego Padres": "San Diego Padres", "San Francisco Giants": "San Francisco Giants",
    "Seattle Mariners": "Seattle Mariners", "St. Louis Cardinals": "St. Louis Cardinals", "Tampa Bay Rays": "Tampa Bay Rays",
    "Texas Rangers": "Texas Rangers", "Toronto Blue Jays": "Toronto Blue Jays", "Washington Nationals": "Washington Nationals",
    "Washington Senators": "Washington Senators", "Montreal Expos": "Montreal Expos", "Houston Colt .45s": "Houston Colt .45s",
    "Tampa Bay Devil Rays": "Tampa Bay Devil Rays",
}
NBA = {
    "San Diego / Houston Rockets": "Houston Rockets", "Atlanta Hawks": "Atlanta Hawks", "Boston Celtics": "Boston Celtics", "Brooklyn Nets": "Brooklyn Nets", "New Jersey Nets": "New Jersey Nets",
    "Charlotte Hornets": "Charlotte Hornets", "Chicago Bulls": "Chicago Bulls", "Cleveland Cavaliers": "Cleveland Cavaliers",
    "Dallas Mavericks": "Dallas Mavericks", "Denver Nuggets": "Denver Nuggets", "Detroit Pistons": "Detroit Pistons",
    "Golden State Warriors": "Golden State Warriors", "Houston Rockets": "Houston Rockets", "San Diego Rockets": "Houston Rockets",
    "Indiana Pacers": "Indiana Pacers", "Los Angeles Clippers": "LA Clippers", "LA Clippers": "LA Clippers",
    "Los Angeles Lakers": "Los Angeles Lakers", "Memphis Grizzlies": "Memphis Grizzlies", "Vancouver Grizzlies": "Vancouver Grizzlies",
    "Miami Heat": "Miami Heat", "Milwaukee Bucks": "Milwaukee Bucks", "Minnesota Timberwolves": "Minnesota Timberwolves",
    "New Orleans Pelicans": "New Orleans Pelicans", "New Orleans Jazz": "New Orleans Jazz", "New York Knicks": "New York Knicks",
    "Oklahoma City Thunder": "Oklahoma City Thunder", "Orlando Magic": "Orlando Magic", "Philadelphia 76ers": "Philadelphia 76ers",
    "Phoenix Suns": "Phoenix Suns", "Portland Trail Blazers": "Portland Trail Blazers", "Sacramento Kings": "Sacramento Kings",
    "San Antonio Spurs": "San Antonio Spurs", "Seattle SuperSonics": "Seattle SuperSonics", "Toronto Raptors": "Toronto Raptors",
    "Utah Jazz": "Utah Jazz", "Washington Wizards": "Washington Wizards", "Washington Bullets": "Washington Wizards",
}
ALL = {**MLB, **NBA}

def clean(s):
    s = re.sub(r"\(.*?\)", "", s).replace("\n", " ").strip()
    s = re.sub(r"^[→*\s]+", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def player_teams(p):
    """Clubs in career order, from the Teams / Career history / Playing tables. Affiliates (→) are skipped."""
    sec = (p.get("wiki") or {}).get("sections") or {}
    rows = []
    for key in ("Teams", "Career history", "Playing"):
        for r in sec.get(key, []):
            text = r[-1] if len(r) >= 1 else ""
            if isinstance(text, str) and text.lstrip().startswith("→"): continue
            rows.append(clean(text))
    out = []
    for name in rows:
        # Strip a trailing year span left over from "(2025–present)" style cells, then map to the article's club name.
        m = ALL.get(name)
        if m and m not in out: out.append(m)
    return out

def api(params):
    u = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": 2})
    for wait in (0, 20, 60, 120):   # Wikipedia answers 429 when a client asks too fast; back off and retry
        time.sleep(wait)
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=25))
        except urllib.error.HTTPError as e:
            if e.code != 429: raise
    raise RuntimeError("Wikipedia kept answering 429")

INFOBOX_LOGO = re.compile(r"\|\s*logo\s*=\s*(?:\[\[)?(?:File:|Image:)?([^\n|\]]+?)\s*(?:\]\])?\s*(?:\||\n)", re.I)

def batch(titles, n=50):
    """Titles in groups of 50, one request each (Wikipedia's limit), so the lookup stays within the rate limit."""
    for i in range(0, len(titles), n):
        yield titles[i:i + n]

def logos_for(articles):
    """Infobox logo of each article (wikitext), resolved to an image URL. Returns {article: (logo url or None, page url)}."""
    found = {}
    for group in batch(sorted(set(articles))):
        d = api({"action": "query", "titles": "|".join(group), "redirects": 1, "prop": "revisions", "rvprop": "content", "rvslots": "main"})
        for pg in d.get("query", {}).get("pages") or []:
            if pg.get("missing") or not pg.get("revisions"): continue
            text = pg["revisions"][0]["slots"]["main"]["content"]
            m = INFOBOX_LOGO.search(text)
            found[pg["title"]] = (m.group(1).strip() if m else None,
                                  "https://en.wikipedia.org/wiki/" + urllib.parse.quote(pg["title"].replace(" ", "_")))
    files = {f"File:{v[0]}" for v in found.values() if v[0]}
    urls = {}
    for group in batch(sorted(files)):
        d = api({"action": "query", "titles": "|".join(group), "prop": "imageinfo", "iiprop": "url", "iiurlwidth": 160})
        for pg in d.get("query", {}).get("pages") or []:
            ii = (pg.get("imageinfo") or [{}])[0]
            if ii: urls[pg["title"]] = ii.get("thumburl") or ii.get("url")
    return {a: (urls.get(f"File:{found[a][0]}") if found[a][0] else None, found[a][1]) for a in found}

def main():
    players = json.load(open(PLAYERS, encoding="utf-8"))["players"]
    cache = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {"teams": {}, "players": {}}
    cache.setdefault("teams", {}); cache.setdefault("players", {})
    for p in players.values() if isinstance(players, dict) else players:
        if p.get("sport") not in ("baseball", "basketball"): continue
        cache["players"][p["name"]] = player_teams(p)
    names = sorted({t for ts in cache["players"].values() for t in ts})
    todo = [t for t in names if not (cache["teams"].get(t) or {}).get("logo")]
    try:
        got = logos_for([ALL.get(t, t) for t in todo])
    except Exception as e:
        got = {}; print("stopped:", e)
    for t in todo:
        art = ALL.get(t, t)
        if art in got:
            cache["teams"][t] = {"logo": got[art][0], "page": got[art][1]}
            print(t, "->", "logo" if got[art][0] else "no logo")
    # Keep only clubs still used by a player.
    cache["teams"] = {k: v for k, v in cache["teams"].items() if k in names}
    json.dump(cache, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(len(cache["players"]), "players,", len(names), "clubs")

if __name__ == "__main__":
    main()

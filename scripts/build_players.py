#!/usr/bin/env python3
"""Build data/players.json: a page's worth of facts for each Husker on the NFL Tier 1, MLB and NBA lists.

Sources (both allow reuse):
  - Wikipedia (text and infobox facts, CC BY-SA 4.0, credited and linked on every page)
  - College Football Data API (football only; season stats, 2005 onward). Needs CFBD_API_KEY, or a proxy that adds it.
Plus Ian's own checklist (data/lists/husker-pros.json) for final Nebraska season, games and what's signed.

    python3 scripts/build_players.py [path/to/husker-pros.json]
"""
import json, os, re, sys, time
import requests
from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "config", "players.json")
OUT = os.path.join(ROOT, "data", "players.json")
UA = "IanBadeerCardSite/1.0 (https://ianbadeer.com/; card collection fan site) python-requests"
WIKI = "https://en.wikipedia.org/w/api.php"
CFBD = "https://api.collegefootballdata.com"

S = requests.Session()
S.headers["User-Agent"] = UA


def norm(t):
    t = re.sub(r'"[^"]*"', " ", str(t).lower())
    t = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", " ", t)
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def slugify(t):
    return re.sub(r"[^a-z0-9]+", "-", norm(t)).strip("-")


def wiki(params, tries=6):
    for i in range(tries):
        r = S.get(WIKI, params={**params, "format": "json", "formatversion": 2, "maxlag": 5}, timeout=60)
        if r.status_code == 429:
            time.sleep(int(r.headers.get("Retry-After", 0) or 0) or 15 * (i + 1)); continue
        r.raise_for_status()
        time.sleep(1.5)  # be polite: one request at a time, well under Wikipedia's limits
        return r.json()
    raise RuntimeError("Wikipedia kept rate-limiting")


# Which checklist each sport's pages come from, and how to find that sport's Wikipedia articles.
SPORTS = [
    {"sport": "football", "list": "nfl-tier-1-huskers", "word": "football",
     "suffixes": ["(American football)", "(gridiron football)", "(American football, born 1900s)"]},
    {"sport": "baseball", "list": "baseball-mlb", "word": "baseball",
     "suffixes": ["(baseball)", "(pitcher)", "(outfielder)", "(infielder)", "(catcher)"]},
    {"sport": "basketball", "list": "basketball-nba", "word": "basketball", "suffixes": ["(basketball)"]},
]


def is_husker_article(title, word="football"):
    # One request per player: the whole article (infobox, intro and stat tables).
    d = wiki({"action": "parse", "page": title, "prop": "text", "redirects": 1, "disableeditsection": 1})
    if "error" in d: return None
    html = d["parse"]["text"]
    if "disambiguation" in html.lower() and "infobox" not in html.lower(): return None
    # Only accept an article that ties this person to Nebraska in this sport: the infobox's college
    # line or the opening paragraphs must mention Nebraska (for baseball and basketball, whose infoboxes
    # often leave out college, a mention of the Nebraska Cornhuskers anywhere will do), and the article
    # must be about the sport.
    soup = BeautifulSoup(html, "html.parser")
    box = soup.select_one("table.infobox")
    college = " ".join(text(td) for th in (box.select("th") if box else []) if "College" in th.get_text()
                       for td in [th.find_next_sibling("td")] if td)
    opening = " ".join(p.get_text(" ") for p in soup.select(".mw-parser-output > p")[:4])
    body = soup.get_text(" ")
    ties = "Nebraska" in college or "Nebraska" in opening
    if not ties and word != "football":
        ties = bool(re.search(r"Nebraska Cornhuskers|University of Nebraska|Nebraska[–-]Lincoln", body))
    if not ties: return None
    if word not in (college + opening + (box.get_text(" ") if box else "")).lower(): return None
    return d["parse"]["title"], html


def find_article(name, override=None, sport=SPORTS[0]):
    clean = re.sub(r'\s*"[^"]*"\s*', " ", name).strip()
    word = sport["word"]
    tries = [override] if override else [clean] + [f"{clean} {x}" for x in sport["suffixes"]]
    for t in tries:
        if not t: continue
        hit = is_husker_article(t, word)
        if hit: return hit
    if override: return None
    d = wiki({"action": "query", "list": "search", "srsearch": f'"{clean}" Nebraska Cornhuskers {word}', "srlimit": 5})
    for s in d.get("query", {}).get("search", []):
        if norm(s["title"]).startswith(norm(clean)):
            hit = is_husker_article(s["title"], word)
            if hit: return hit
    return None


def text(el):
    for s in el.select("sup, .reference, style, .noprint, .bday, [style*='display:none']"): s.decompose()
    for br in el.find_all("br"): br.replace_with("\n")
    t = el.get_text("", strip=False)
    t = re.sub(r"\(\s+", "(", t); t = re.sub(r"\s+\)", ")", t); t = re.sub(r"\s+([,:])", r"\1", t)
    t = re.sub(r"\(\s*\)", "", t)
    t = re.sub(r"[ \t ]+", " ", t)
    return "\n".join(x.strip(" ,") for x in t.split("\n") if x.strip(" ,"))


def parse_infobox(html):
    soup = BeautifulSoup(html, "html.parser")
    box = soup.select_one("table.infobox")
    out = {"facts": [], "sections": {}}
    if not box: return out
    section = "facts"
    pfr = box.select_one('a[href*="pro-football-reference.com"]')
    if pfr: out["pfr"] = pfr["href"]
    # Baseball and basketball infoboxes link their stats sites too.
    for site, label in (("baseball-reference.com", "Baseball Reference"), ("basketball-reference.com", "Basketball Reference"),
                        ("pro-football-reference.com", "Pro Football Reference")):
        a = box.select_one(f'a[href*="{site}"]')
        if a: out["statsLink"] = {"url": a["href"], "label": label}; break
    for tr in box.select("tr"):
        if tr.find("table"): continue            # a row that only wraps a nested table
        th, td = tr.find("th"), tr.find("td")
        if th and "infobox-header" in (th.get("class") or []):
            section = text(th); out["sections"].setdefault(section, []); continue
        if th and td and "infobox-label" in (th.get("class") or []):
            pair = [text(th), text(td)]
            (out["facts"] if section == "facts" else out["sections"][section]).append(pair)
        elif td and "infobox-full-data" in (td.get("class") or []) and section != "facts":
            items = [text(li) for li in td.select("li")] or [text(td)]
            out["sections"][section].extend([x] for x in items if x and not x.startswith("Stats at "))
        elif td and section == "facts" and not td.find("img") and not set(td.get("class") or []) & {"infobox-image", "infobox-caption"}:
            # Lines above the first heading, e.g. a retired baseball player's position and "Born: ..." line.
            t = text(td)
            if t and not t.startswith("Stats at "): out["facts"].append([t])
    return out


def intro(title, limit=1100):
    d = wiki({"action": "query", "prop": "extracts", "exintro": 1, "explaintext": 1, "redirects": 1, "titles": title})
    ex = d["query"]["pages"][0].get("extract", "")
    ex = re.sub(r"\s*\([^()]*(?:pronounced|IPA|listen)[^()]*\)", "", ex)  # drop pronunciation guides
    paras = [p.strip() for p in ex.split("\n") if p.strip()]
    out = ""
    for p in paras:
        if out and len(out) + len(p) > limit: break
        out += ("\n\n" if out else "") + p
    return out


def intro_from_html(html, limit=1100):
    soup = BeautifulSoup(html, "html.parser")
    root = soup.select_one(".mw-parser-output") or soup
    paras = []
    for el in root.children:
        if getattr(el, "name", None) in ("h2",) or (getattr(el, "get", None) and "mw-heading" in (el.get("class") or [])):
            break
        if getattr(el, "name", None) == "p" and "mw-empty-elt" not in (el.get("class") or []):
            for x in el.select(".IPA, .rt-commentedText, .noexcerpt, [title*='pronunciation']"): x.decompose()
            t = text(el)
            t = re.sub(r"\(\s*[;,]?\s*", "(", t); t = re.sub(r"\(\s*\)", "", t)
            t = re.sub(r"\s+", " ", t).strip()
            if t: paras.append(t)
    out = ""
    for t in paras:
        if out and len(out) + len(t) > limit: break
        out += ("\n\n" if out else "") + t
    return out


def college_tables(html):
    """Stat tables that sit under a heading mentioning college, e.g. 'College statistics'."""
    soup = BeautifulSoup(html, "html.parser")
    out, heads = [], {}
    for el in soup.select(".mw-parser-output > *"):
        h = el if el.name in ("h2", "h3", "h4") else el.find(["h2", "h3", "h4"]) if "mw-heading" in (el.get("class") or []) else None
        if h is not None:
            lvl = int(h.name[1]); heads = {k: v for k, v in heads.items() if k < lvl}; heads[lvl] = text(h); continue
        tables = [el] if el.name == "table" else el.select("table") if el.name == "div" else []
        for t in tables:
            if "wikitable" not in (t.get("class") or []): continue
            ctx = " ".join(heads.values()) + " " + (text(t.caption) if t.caption else "")
            if not re.search(r"college", ctx, re.I): continue
            rows = []
            for tr in t.select("tr"):
                cells = [[text(c).replace("\n", " "), int(c.get("colspan", 1) or 1)] for c in tr.find_all(["th", "td"])]
                if any(x[0] for x in cells): rows.append(cells)
            has_seasons = any(re.match(r"^(19|20)\d\d", r[0][0]) for r in rows)
            if len(rows) >= 2 and has_seasons and not re.search(r"recruit", ctx, re.I):
                out.append({"title": (text(t.caption) if t.caption else list(heads.values())[-1]), "rows": rows})
    return out


_cfbd_cache = {}
def cfbd_season(year):
    if year not in _cfbd_cache:
        key = os.environ.get("CFBD_API_KEY", "proxy-injected")
        r = S.get(f"{CFBD}/stats/player/season", params={"year": year, "team": "Nebraska"},
                  headers={"Authorization": f"Bearer {key}"}, timeout=60)
        r.raise_for_status()
        _cfbd_cache[year] = r.json()
    return _cfbd_cache[year]


DEFENSE = re.compile(r"defensive|linebacker|cornerback|safety|\b(dt|de|lb|cb|db|s|olb|ilb|mlb|nt)\b|nose tackle|defensive back", re.I)

def college_stats(name, final_year, position=""):
    # CollegeFootballData has offensive stats from 2005 and defensive stats from 2016.
    if not final_year or final_year < 2005: return None
    if DEFENSE.search(position or "") and final_year < 2016: return None
    seasons = {}
    for y in range(max(2005, final_year - 5), final_year + 1):
        for row in cfbd_season(y):
            if norm(row["player"]) != norm(name): continue
            seasons.setdefault(y, {}).setdefault(row["category"], {})[row["statType"]] = row["stat"]
    return {str(y): seasons[y] for y in sorted(seasons)} or None


_rest = []   # saved entries not processed yet in this run, so every save writes the complete list

def save(players):
    done = {p["slug"] for p in players}
    players = players + [p for p in _rest if p["slug"] not in done]
    out = {"source": {"wikipedia": "Text and facts from Wikipedia, CC BY-SA 4.0",
                      "cfbd": "College stats from CollegeFootballData.com"},
           "players": players}
    json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    lists_path = args[0] if args else os.path.join(ROOT, "data", "lists", "husker-pros.json")
    cfg = json.load(open(CONFIG))
    lists = {l["slug"]: l for l in json.load(open(lists_path))["lists"]}
    old = {}
    if os.path.exists(OUT):
        old = {p["slug"]: p for p in json.load(open(OUT)).get("players", [])}
    # Overrides are keyed by name, or "baseball:Name" / "basketball:Name" when a name is on two lists.
    ov = cfg.get("overrides", {})
    only = next((a.split("=")[1] for a in sys.argv if a.startswith("--sport=")), None)
    max_new = next((int(a.split("=")[1]) for a in sys.argv if a.startswith("--max-new=")), None)
    _rest[:] = list(old.values())
    players, used, fetched = [], set(), 0
    for sport in SPORTS:
        lst = lists.get(sport["list"])
        if not lst: continue
        cols = lst["columns"]
        get = lambda r, k: r[cols.index(k)] if k in cols else ""
        for g in lst["groups"]:
            for r in g["rows"]:
                name = r[0].strip()
                slug = slugify(name)
                if slug in used: slug = f"{slug}-{sport['sport']}"   # same name on two lists
                used.add(slug)
                last = get(r, "Last Year")
                p = {"slug": slug, "sport": sport["sport"], "name": name, "finalYear": int(last) if last.isdigit() else None,
                     "have": get(r, "Autograph") == "Yes"}
                if sport["sport"] == "football":
                    p.update({"nflGames": get(r, "NFL Games Played"), "notes": get(r, "Career Notes"), "signed": get(r, "Signed")})
                override = ov.get(f"{sport['sport']}:{name}") or (ov.get(name) if sport["sport"] == "football" else None)
                prev = old.get(slug)
                skip = (only and only != sport["sport"]) or (prev and (prev.get("wiki") or prev.get("checked")) and "--refresh" not in sys.argv)
                if skip and prev:
                    p.update({k: prev[k] for k in ("wiki", "college", "position", "collegeTables", "checked") if k in prev})
                    players.append(p); continue
                if skip or (max_new is not None and fetched >= max_new):
                    players.append(p); continue      # page still exists, info comes in a later batch
                fetched += 1
                p["checked"] = time.strftime("%Y-%m-%d")
                try:
                    art = find_article(name, override, sport)
                    if art:
                        title, html = art
                        p["wiki"] = {"title": title, "url": "https://en.wikipedia.org/wiki/" + title.replace(" ", "_"),
                                     "intro": intro_from_html(html), **parse_infobox(html)}
                        ct = college_tables(html)
                        if ct: p["collegeTables"] = ct
                    else:
                        print(f"  ! {name} ({sport['sport']}): no Wikipedia article found", file=sys.stderr)
                    pos = next((v for sec in [(p.get("wiki") or {}).get("facts", [])] + list((p.get("wiki") or {}).get("sections", {}).values())
                                for row in sec if len(row) == 2 and row[0] in ("Position", "Positions") for v in [row[1]]), "")
                    p["position"] = pos
                    if sport["sport"] == "football": p["college"] = college_stats(name, p["finalYear"], pos)
                except Exception as e:  # keep the last good data rather than losing a page
                    print(f"  ! {name}: {e}; keeping previous data", file=sys.stderr)
                    if slug in old: p = {**old[slug], **{k: v for k, v in p.items() if k not in ("wiki", "college", "collegeTables", "position", "checked")}}
                players.append(p)
                save(players)  # save after every player so a stopped run keeps its progress
                print(f"  {name} ({sport['sport']}): wiki={'yes' if p.get('wiki') else 'no'}", file=sys.stderr)
    _rest[:] = []   # every listed player is in this run; drop anyone no longer on a list
    save(players)
    print(f"Wrote {len(players)} players to {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()

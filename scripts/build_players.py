#!/usr/bin/env python3
"""Build data/players.json: a page's worth of facts for each NFL Tier 1 Husker in config/players.json.

Sources (both allow reuse):
  - Wikipedia (text and infobox facts, CC BY-SA 4.0, credited and linked on every page)
  - College Football Data API (season stats, 2004 onward). Needs CFBD_API_KEY, or a proxy that adds it.
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


def is_husker_article(title):
    # One request per player: the whole article (infobox, intro and stat tables).
    d = wiki({"action": "parse", "page": title, "prop": "text", "redirects": 1, "disableeditsection": 1})
    if "error" in d: return None
    html = d["parse"]["text"]
    if "disambiguation" in html.lower() and "infobox" not in html.lower(): return None
    # Only accept an article that ties this person to Nebraska football: the infobox's college
    # line, or the opening paragraphs, must mention Nebraska, and the article must be about football.
    soup = BeautifulSoup(html, "html.parser")
    box = soup.select_one("table.infobox")
    college = " ".join(text(td) for th in (box.select("th") if box else []) if "College" in th.get_text()
                       for td in [th.find_next_sibling("td")] if td)
    opening = " ".join(p.get_text(" ") for p in soup.select(".mw-parser-output > p")[:4])
    if "Nebraska" not in college and "Nebraska" not in opening: return None
    if "football" not in (college + opening + (box.get_text(" ") if box else "")).lower(): return None
    return d["parse"]["title"], html


def find_article(name, override=None):
    clean = re.sub(r'\s*"[^"]*"\s*', " ", name).strip()
    tries = [override] if override else [clean, f"{clean} (American football)", f"{clean} (gridiron football)", f"{clean} (American football, born 1900s)"]
    for t in tries:
        if not t: continue
        hit = is_husker_article(t)
        if hit: return hit
    if override: return None
    d = wiki({"action": "query", "list": "search", "srsearch": f'"{clean}" Nebraska Cornhuskers football', "srlimit": 5})
    for s in d.get("query", {}).get("search", []):
        if norm(s["title"]).startswith(norm(clean)):
            hit = is_husker_article(s["title"])
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


def save(players):
    out = {"source": {"wikipedia": "Text and facts from Wikipedia, CC BY-SA 4.0",
                      "cfbd": "College stats from CollegeFootballData.com"},
           "players": players}
    json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    lists_path = args[0] if args else os.path.join(ROOT, "data", "lists", "husker-pros.json")
    cfg = json.load(open(CONFIG))
    lists = json.load(open(lists_path))
    tier1 = next(l for l in lists["lists"] if l["slug"] == "nfl-tier-1-huskers")
    cols = tier1["columns"]; c = {k: cols.index(k) for k in cols}
    rows = {norm(r[0]): r for g in tier1["groups"] for r in g["rows"]}
    old = {}
    if os.path.exists(OUT):
        old = {p["slug"]: p for p in json.load(open(OUT)).get("players", [])}
    players = []
    entries = cfg["players"]
    if entries == "all":  # every NFL Tier 1 Husker, in checklist order, with any overrides applied
        ov = cfg.get("overrides", {})
        entries = [{"name": r[0].strip(), "wikipedia": ov[r[0].strip()]} if r[0].strip() in ov else r[0].strip()
                   for g in tier1["groups"] for r in g["rows"]]
    max_new = next((int(a.split("=")[1]) for a in sys.argv if a.startswith("--max-new=")), None)
    fetched = 0
    for entry in entries:
        name = entry if isinstance(entry, str) else entry["name"]
        override = None if isinstance(entry, str) else entry.get("wikipedia")
        r = rows.get(norm(name))
        if not r:
            print(f"  ! {name}: not on the NFL Tier 1 list, skipped", file=sys.stderr); continue
        final_year = int(r[c["Last Year"]]) if r[c["Last Year"]].isdigit() else None
        p = {"slug": slugify(name), "name": r[0].strip(), "finalYear": final_year,
             "nflGames": r[c["NFL Games Played"]], "notes": r[c["Career Notes"]],
             "signed": r[c["Signed"]], "have": r[c["Autograph"]] == "Yes"}
        prev = old.get(p["slug"])
        if prev and (prev.get("wiki") or prev.get("checked")) and "--refresh" not in sys.argv:
            p.update({k: prev[k] for k in ("wiki", "college", "position", "collegeTables", "checked") if k in prev})
            players.append(p); continue
        if max_new is not None and fetched >= max_new:
            players.append(p); continue          # page still exists, info comes in a later batch
        fetched += 1
        p["checked"] = time.strftime("%Y-%m-%d")
        try:
            art = find_article(name, override)
            if art:
                title, html = art
                p["wiki"] = {"title": title, "url": "https://en.wikipedia.org/wiki/" + title.replace(" ", "_"),
                             "intro": intro_from_html(html), **parse_infobox(html)}
                ct = college_tables(html)
                if ct: p["collegeTables"] = ct
            else:
                print(f"  ! {name}: no Wikipedia article found", file=sys.stderr)
            pos = next((v for sec in (p.get("wiki") or {}).get("sections", {}).values() for row in sec
                        if len(row) == 2 and row[0] in ("Position", "Positions") for v in [row[1]]), "")
            p["position"] = pos
            p["college"] = college_stats(name, final_year, pos)
        except Exception as e:  # keep the last good data rather than losing a page
            print(f"  ! {name}: {e}; keeping previous data", file=sys.stderr)
            if p["slug"] in old: p = {**old[p["slug"]], **{k: p[k] for k in ("finalYear", "nflGames", "notes", "signed", "have")}}
        players.append(p)
        save(players)  # save after every player so a stopped run keeps its progress
        print(f"  {name}: wiki={'yes' if p.get('wiki') else 'no'} college={'yes' if p.get('college') else 'no'}", file=sys.stderr)
    save(players)
    print(f"Wrote {len(players)} players to {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()

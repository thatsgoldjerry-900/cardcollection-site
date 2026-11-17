#!/usr/bin/env python3
"""Plain, crawlable pages built on every publish (not saved in the repo):

  nfl-huskers/index.html, tier-1/2/3.html   Ian's NFL Husker lists as simple tables
  nfl-huskers/<player>.html                 one page per NFL Tier 1/2/3 Husker
  players/<player>.html                     one page per MLB / NBA Husker
  sitemap.xml                               every page, for Google and Bing

The site itself builds these views in the browser (#/checklist, #/player/...), which search engines and AI tools
mostly can't read. These pages carry the same information as plain HTML, credited to Ian, so a search for a
player's name can land here. Wikipedia text is quoted under CC BY-SA with a link back.
"""
import datetime, html, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LISTS = os.path.join(ROOT, "data", "lists", "husker-pros.json")
PLAYERS = os.path.join(ROOT, "data", "players.json")
CATALOG = os.path.join(ROOT, "data", "catalog.json")
CONFIG = os.path.join(ROOT, "config", "site.json")
SITE = "IanBadeer.com"
CREDIT = "Researched and verified by Ian Badeer"
QUOTE = "You're welcome to quote these lists. Please credit Ian Badeer and link to IanBadeer.com."

# list slug -> (folder, tier page, short label, what the list means)
LISTS_INFO = {
    "nfl-tier-1-huskers": ("nfl-huskers", "tier-1.html", "NFL Tier 1 Huskers",
                           "Nebraska Cornhuskers who played in at least one regular-season or postseason NFL game."),
    "nfl-tier-2-huskers": ("nfl-huskers", "tier-2.html", "NFL Tier 2 Huskers",
                           "Nebraska Cornhuskers who made an NFL active roster, played in the preseason, or spent time on injured "
                           "reserve or a practice squad, but never played in a regular-season or postseason game."),
    "pro-football-huskers": ("nfl-huskers", "tier-3.html", "NFL Tier 3 Huskers (Pro Football Huskers)",
                             "Nebraska Cornhuskers who were drafted, signed, or went to an NFL camp or tryout without making it onto "
                             "a roster in season, and Huskers who played pro football in other leagues."),
    "baseball-mlb": ("players", None, "MLB Huskers", "Nebraska Cornhuskers who reached Major League Baseball."),
    "basketball-nba": ("players", None, "NBA Huskers", "Nebraska Cornhuskers who reached the NBA."),
}
SCAN_SECTION = {"football": "husker-football", "baseball": "husker-baseball", "basketball": "husker-basketball"}
CATS = [("passing", "Passing", ["COMPLETIONS", "ATT", "PCT", "YDS", "YPA", "TD", "INT"]), ("rushing", "Rushing", ["CAR", "YDS", "YPC", "LONG", "TD"]),
        ("receiving", "Receiving", ["REC", "YDS", "YPR", "LONG", "TD"]), ("defensive", "Defense", ["TOT", "SOLO", "TFL", "SACKS", "QB HUR", "PD", "TD"]),
        ("interceptions", "Interceptions", ["INT", "YDS", "AVG", "TD"]), ("kickReturns", "Kick returns", ["NO", "YDS", "AVG", "LONG", "TD"]),
        ("puntReturns", "Punt returns", ["NO", "YDS", "AVG", "LONG", "TD"]), ("kicking", "Kicking", ["FGM", "FGA", "PCT", "LONG", "XPM", "XPA", "PTS"]),
        ("punting", "Punting", ["NO", "YDS", "YPP", "LONG", "IN 20", "TB"]), ("scoring", "Scoring", ["TD", "XP1", "XP2", "FG", "TP"])]
LABEL = {"COMPLETIONS": "CMP", "QB HUR": "QBH", "XP1": "XP", "XP2": "2PT", "TP": "PTS"}

CSS = """
:root{color-scheme:light dark;--bg:#fff;--fg:#151a22;--mu:#5a6474;--line:#dde2ea;--acc:#c8102e;--head:#f4f6f9}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f15;--fg:#e8ecf2;--mu:#98a2b3;--line:#273142;--acc:#ff5468;--head:#141b26}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:28px 16px 64px}a{color:var(--acc)}
h1{font-size:clamp(26px,5vw,38px);line-height:1.15;margin:6px 0 10px}h2{font-size:21px;margin:30px 0 8px}h3{font-size:16px;margin:18px 0 6px}
.kick{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--mu)}
.lead{font-size:18px;max-width:70ch}
.credit{border-left:3px solid var(--acc);padding:8px 14px;background:var(--head);border-radius:0 8px 8px 0;margin:16px 0}
.credit p{margin:4px 0}.mu{color:var(--mu)}
table{width:100%;border-collapse:collapse;font-size:14.5px;margin-top:10px}
th,td{text-align:left;vertical-align:top;padding:7px 10px;border-bottom:1px solid var(--line)}
th{background:var(--head);font-size:12.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--mu)}
.big th{position:sticky;top:0}
td.n{white-space:nowrap;font-variant-numeric:tabular-nums}td.note{max-width:46ch}td.note p{margin:0 0 6px}td.note p:last-child{margin:0}
td.pl{font-weight:600}td.pl small{display:block;font-weight:400}
.tiers{list-style:none;padding:0;display:grid;gap:12px}.tiers li{border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.tiers a{font-weight:700;font-size:18px}
.top{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:28px;align-items:start}
.card img{width:100%;height:auto;border-radius:8px;box-shadow:0 8px 24px -10px rgba(0,0,0,.5)}.card figcaption{font-size:13px;color:var(--mu);margin-top:6px}
.kv th{width:38%;text-transform:none;letter-spacing:0;font-size:14px;background:none;color:var(--mu);font-weight:500}
.why{border:1px solid var(--line);border-left:3px solid var(--acc);border-radius:10px;padding:10px 16px;margin:18px 0}
.why p{margin:6px 0}.scroll{overflow-x:auto}.links a{margin-right:14px;white-space:nowrap}
footer{margin-top:40px;color:var(--mu);font-size:14px}
@media (max-width:700px){.top{grid-template-columns:1fr}.card{max-width:240px}th.opt,td.opt{display:none}table{font-size:14px}}
"""


def esc(t):
    return html.escape(str(t if t is not None else ""), quote=True)


def norm(t):  # matches the site's own name matching (app.js / build_players.py)
    t = re.sub(r'"[^"]*"', " ", str(t).lower())
    t = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", " ", t)
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def paras(t):
    return "".join(f"<p>{esc(p.strip()).replace(chr(10), '<br>')}</p>" for p in re.split(r"\n\s*\n", t or "") if p.strip())


def page(title, desc, body, updated, ld, image=""):
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>{esc(title)} · {SITE}</title>
<meta name="description" content="{esc(desc)}">
<meta name="author" content="Ian Badeer">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{SITE}">
{f'<meta property="og:image" content="{esc(image)}">' if image else ""}
<script type="application/ld+json">{json.dumps(ld)}</script>
<style>{CSS}</style>
</head>
<body><main>
{body}
<footer><p>{esc(CREDIT)} · <a href="../">{SITE}</a> · Updated {esc(updated)}</p><p>{esc(QUOTE)}</p></footer>
</main></body></html>
"""


def ian():
    return {"@type": "Person", "name": "Ian Badeer", "url": "https://ianbadeer.com/"}


def scans_index():
    """{sport: [(" normalized card name ", card)]} for the Nebraska sections, like the site's scansFor()."""
    try:
        cat = json.load(open(CATALOG))
    except (OSError, ValueError):
        return {}
    sec = {s["slug"]: i for i, s in enumerate(cat["sections"])}
    out = {}
    # A player with his own collection (e.g. Alex Gordon): his cards and a link to that collection.
    for i, s in enumerate(cat["sections"]):
        out["own:" + norm(s["title"])] = (s["slug"], s["title"], [c for c in cat["cards"] if c[3] == i and "(back)" not in c[2].lower()])
    for sport, slug in SCAN_SECTION.items():
        si = sec.get(slug)
        out[sport] = [(" " + norm(c[2]) + " ", c) for c in cat["cards"] if si is not None and c[3] == si and "(back)" not in c[2].lower()]
    return out


def best_scan(idx, name, sport):
    n = norm(name)
    if len(n.split()) < 2: return None
    hits = [c for t, c in idx.get(sport, []) if " " + n + " " in t]
    if not hits and ("own:" + n) in idx: hits = idx["own:" + n][2]
    return next((c for c in hits if re.search(r"\b(auto|autograph|signed|signature)", c[2], re.I)), hits[0] if hits else None)


def img_url(card, w=600):
    return f"https://lh3.googleusercontent.com/d/{card[0]}=w{w}" + (f"?resourcekey={card[1]}" if card[1] else "")


def college_html(p):
    col = p.get("college")
    if col:
        out = []
        for key, title, order in CATS:
            yrs = [y for y in sorted(col) if key in col[y]]
            if not yrs: continue
            cols = [k for k in order if any(k in col[y][key] for y in yrs)]
            out.append(f'<div class="scroll"><table><thead><tr><th>Season</th>{"".join(f"<th>{esc(LABEL.get(k, k))}</th>" for k in cols)}</tr></thead><tbody>'
                       + "".join(f'<tr><td>{esc(y)}</td>{"".join(f"<td class=n>{esc(col[y][key].get(k, chr(8211)))}</td>" for k in cols)}</tr>' for y in yrs)
                       + f"</tbody></table></div><h3 class=mu style='font-weight:400;font-size:13px;margin:4px 0 14px'>{esc(title)}</h3>")
        src = {"recordbook": 'Seasons he led Nebraska in a category, from the <a href="https://huskers.com/football-history-and-records">Nebraska Football Record Book</a>.',
               "games": "From CollegeFootballData.com (season totals added up from game box scores)."}.get(p.get("collegeSource"), "From CollegeFootballData.com.")
        return "".join(out) + f'<p class="mu" style="font-size:13px">{src}</p>'
    tables = p.get("collegeTables") or []
    if tables:
        out = []
        for t in tables:
            rows = t.get("rows") or []
            out.append('<div class="scroll"><table>' + "".join(
                "<tr>" + "".join(f'<{"th" if i < 2 and not re.match(r"^(\\d{4}|career|total)", str(r[0][0]), re.I) else "td"}{f" colspan={n}" if n > 1 else ""}>{esc(v)}</{"th" if i < 2 and not re.match(r"^(\\d{4}|career|total)", str(r[0][0]), re.I) else "td"}>' for v, n in r) + "</tr>"
                for i, r in enumerate(rows)) + "</table></div>")
        return "".join(out) + f'<p class="mu" style="font-size:13px">From <a href="{esc(p["wiki"]["url"])}">Wikipedia</a>, CC BY-SA 4.0.</p>' if p.get("wiki") else "".join(out)
    return ""


def media_for(slug):
    """Videos that feature this player (config: media items and Customs videos with "players": [slug])."""
    try: site = json.load(open(CONFIG))
    except (OSError, ValueError): return []
    out = []
    for v in (site.get("media", {}).get("items", []) + site.get("customsPhotos", {}).get("videos", [])):
        if slug in (v.get("players") or []):
            url = v.get("url") or f"https://www.youtube.com/watch?v={v.get('youtube') or v.get('id')}" + (f"&t={int(v['start'])}s" if v.get("start") else "")
            out.append((v.get("title") or v.get("caption") or "Video", url, v.get("outlet") or "", v.get("date") or ""))
    return out


def player_page(p, row, info, l, idx, updated):
    folder, tier_page, label, meaning = info
    sport = p.get("sport") or "football"
    try: extras = (json.load(open(CONFIG)).get("playerExtras") or {}).get(p["slug"]) or {}
    except (OSError, ValueError): extras = {}
    c = {k: i for i, k in enumerate(l["columns"])}
    get = lambda k: (row[c[k]] if k in c and c[k] < len(row) else "") or ""
    name, year, games, path = p["name"], get("Last Year"), get("NFL Games Played"), get("Career Notes")
    note = (l.get("notes") or {}).get(row[0], "")
    src = (l.get("links") or {}).get(row[0], "")
    w = p.get("wiki") or {}
    pos = p.get("position") or ""
    yr = f" (last season {year})" if year else ""
    if p["list"] == "nfl-tier-1-huskers":
        g = f"{games} NFL game{'' if str(games) == '1' else 's'}" if games else "the NFL"
        lead = f"{name} played college football at Nebraska{yr} and appeared in {g}."
    elif p["list"] == "nfl-tier-2-huskers":
        lead = f"{name} played college football at Nebraska{yr} and reached the NFL{f' ({path})' if path else ''}, but never appeared in a regular-season or postseason game."
    elif p["list"] == "pro-football-huskers":
        lead = f"{name} played college football at Nebraska{yr}.{f' Path to pro football: {path}.' if path else ''}"
    elif sport == "baseball":
        lead = f"{name} played baseball at Nebraska{yr} and reached Major League Baseball."
    else:
        lead = f"{name} played basketball at Nebraska{yr} and reached the NBA."
    if pos and sport == "football": lead = lead.replace(" played college football", f", a {pos.lower()}, played college football", 1)
    facts = [("Position", pos), ("Last Nebraska season", year)] + ([("NFL games", games)] if "NFL Games Played" in c else []) + \
            ([("Path to the pros", path)] if path and p["list"] != "nfl-tier-1-huskers" else [("Other leagues / notes", path)] if path else [])
    sec = w.get("sections") or {}
    for head in ("Personal information", "Career information", "MLB debut", "Last MLB appearance", "MLB statistics", "NBA statistics"):
        facts += [(r[0], r[1]) for r in sec.get(head, []) if len(r) == 2]
    lists_html = ""
    for head in ("Career history", "Awards and highlights"):
        items = [r[0] for r in sec.get(head, []) if len(r) == 1]
        if items: lists_html += f"<h2>{esc(head)}</h2><ul>" + "".join(f"<li>{esc(x)}</li>" for x in items) + "</ul>"
    card = best_scan(idx, name, sport)
    stats = college_html(p) if sport == "football" else ""
    bio = paras(w.get("intro")) if w.get("intro") else ""
    up = f'<a href="{tier_page}">{esc(label)}</a>' if tier_page else esc(label)
    links = [f'<a href="../#/player/{esc(p["slug"])}">His cards and full page on {SITE}</a>']
    own = idx.get("own:" + norm(name))
    if own: links.insert(0, f'<a href="../#/c/{esc(own[0])}">All {len(own[2]):,} cards in Ian&#39;s {esc(own[1])} collection</a>')
    if src.startswith("http"): links.append(f'<a href="{esc(src)}" rel="nofollow">Career stats</a>')
    if w.get("pfr") and w.get("pfr") != src: links.append(f'<a href="{esc(w["pfr"])}" rel="nofollow">Pro Football Reference</a>')
    if w.get("url"): links.append(f'<a href="{esc(w["url"])}">Wikipedia</a>')
    body = f"""<div class="kick">{up} · <a href="../">{SITE}</a></div>
<div class="top"><div>
<h1>{esc(name)}</h1>
<p class="lead">{esc(lead)}</p>
{f'<p>{esc(extras.get("about"))}</p>' if extras.get("about") else ""}
{f'<section class="why"><h2 style="margin:6px 0 4px;font-size:17px">Why he&#39;s on the {esc(label)} list</h2>{paras(note)}</section>' if note else ""}
<table class="kv">{"".join(f"<tr><th>{esc(k)}</th><td>{esc(v).replace(chr(10), '<br>')}</td></tr>" for k, v in facts if v)}</table>
<p class="links">{" ".join(links)}</p>
</div>
{f'<figure class="card"><img src="{esc(img_url(card))}" alt="{esc(card[2])}" loading="lazy" width="600"><figcaption>{esc(card[2])} · from Ian&#39;s collection</figcaption></figure>' if card else ""}
</div>
{"".join(f'<h2>Watch</h2><ul>' + "".join(f'<li><a href="{esc(u)}">{esc(t)}</a>{f" <span class=mu>· {esc(o)}{(chr(32) + chr(183) + chr(32) + esc(d)) if d else chr(32)}</span>" if o else ""}</li>' for t, u, o, d in media_for(p["slug"])) + "</ul>" for _ in [0] if media_for(p["slug"]))}
{f"<h2>College stats</h2>{stats}" if stats else ""}
{lists_html}
{f'<h2>Biography</h2>{bio}<p class="mu" style="font-size:13px">Adapted from <a href="{esc(w["url"])}">Wikipedia</a>, licensed <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>.</p>' if bio else ""}
<div class="credit"><p><strong>{esc(CREDIT)}.</strong> Part of Ian Badeer&#39;s {esc(label)} list.</p><p class="mu">{esc(QUOTE)}</p></div>"""
    desc = lead + (" " + re.sub(r"\s+", " ", note).strip()[:180] if note else "")
    ld = {"@context": "https://schema.org", "@type": "ProfilePage", "name": f"{name} · {label}", "dateModified": updated, "author": ian(),
          "mainEntity": {"@type": "Person", "name": name, "alumniOf": {"@type": "CollegeOrUniversity", "name": "University of Nebraska–Lincoln"},
                         **({"jobTitle": pos} if pos else {}), **({"sameAs": [u for u in (w.get("url"), w.get("pfr")) if u]} if w.get("url") else {})}}
    title = f"{name}, Nebraska Cornhuskers" + (f" {pos.lower()}" if pos and sport == "football" else "") + f" · {label}"
    return page(title, desc, body, updated, ld, img_url(card, 800) if card else "")


def list_page(slug, info, l, slug_of, updated):
    folder, fname, name, meaning = info
    c = {k: i for i, k in enumerate(l["columns"])}
    notes, links = l.get("notes") or {}, l.get("links") or {}
    rows = [r for g in l["groups"] for r in g["rows"]]
    has_games = "NFL Games Played" in c
    trs = []
    for r in rows:
        nm = r[0].strip(); ps = slug_of.get((slug, nm)); src = links.get(r[0]) or ""
        cell = (f'<a href="{esc(ps)}.html">{esc(nm)}</a>' if ps else esc(nm)) + \
            (f' <small><a href="{esc(src)}" rel="nofollow">Stats</a></small>' if src.startswith("http") else "")
        trs.append("<tr>" + f'<td class="pl">{cell}</td>'
                   + f'<td class="n">{esc(r[c["Last Year"]]) if "Last Year" in c else ""}</td>'
                   + (f'<td class="n">{esc(r[c["NFL Games Played"]])}</td>' if has_games else "")
                   + f'<td class="opt">{esc(r[c["Career Notes"]]) if "Career Notes" in c else ""}</td>'
                   + (f'<td class="note">{paras(notes.get(r[0], ""))}</td>' if notes else "") + "</tr>")
    head = ("<tr><th>Player</th><th>Last Nebraska season</th>" + ("<th>NFL games</th>" if has_games else "")
            + '<th class="opt">Path to the pros</th>' + ("<th>Why he's on this list</th>" if notes else "") + "</tr>")
    body = f"""<div class="kick"><a href="./">NFL Husker lists</a> · <a href="../">{SITE}</a></div>
<h1>{esc(name)}</h1>
<p>{esc(meaning)} {len(rows)} players.</p>
<div class="credit"><p><strong>{esc(CREDIT)}.</strong> Each player was checked by hand against rosters, transaction records,
newspaper archives and media guides.</p><p class="mu">{esc(QUOTE)}</p></div>
<table class="big"><thead>{head}</thead><tbody>
{chr(10).join(trs)}
</tbody></table>"""
    ld = {"@context": "https://schema.org", "@type": "Dataset", "name": name, "description": meaning, "creator": ian(),
          "dateModified": updated, "isAccessibleForFree": True, "usageInfo": QUOTE,
          "keywords": ["Nebraska Cornhuskers", "Huskers", "NFL", "football"]}
    return page(name, f"{len(rows)} {meaning}", body, updated, ld), len(rows)


def main():
    if not os.path.exists(LISTS):
        print("No lists yet; skipping the plain pages."); return
    data = json.load(open(LISTS)); by = {l["slug"]: l for l in data["lists"]}
    players = json.load(open(PLAYERS))["players"]
    slug_of = {(p["list"], p["name"]): p["slug"] for p in players}
    try: base = json.load(open(CONFIG)).get("siteUrl") or ""
    except (OSError, ValueError): base = ""
    base = (base or "https://thatsgoldjerry-900.github.io/cardcollection-site/").rstrip("/") + "/"
    updated = datetime.date.today().isoformat()
    idx = scans_index()
    urls = ["", "nfl-huskers/"]
    for folder in ("nfl-huskers", "players"): os.makedirs(os.path.join(ROOT, folder), exist_ok=True)
    # tier tables + overview
    items = []
    for slug, info in LISTS_INFO.items():
        if not info[1] or slug not in by: continue
        html_, n = list_page(slug, info, by[slug], slug_of, updated)
        open(os.path.join(ROOT, info[0], info[1]), "w", encoding="utf-8").write(html_)
        urls.append(f"{info[0]}/{info[1]}")
        items.append(f'<li><a href="{info[1]}">{esc(info[2])}</a> <span class="mu">· {n} players</span><p>{esc(info[3])}</p></li>')
    intro = ("Every Nebraska Cornhusker who reached pro football, sorted into three tiers by how far he got in the NFL. "
             "Ian Badeer built these lists while collecting an autograph from every Husker who made it to the NFL, "
             "and verified each player himself.")
    body = f"""<div class="kick"><a href="../">{SITE}</a></div>
<h1>Nebraska Cornhuskers in the NFL</h1>
<p class="lead">{esc(intro)}</p>
<div class="credit"><p><strong>{esc(CREDIT)}.</strong></p><p class="mu">{esc(QUOTE)}</p></div>
<ul class="tiers">{''.join(items)}</ul>
<p class="mu">Browse the lists with card scans at <a href="../#/checklist">{SITE}</a>.</p>"""
    ld = {"@context": "https://schema.org", "@type": "Dataset", "name": "Nebraska Cornhuskers in the NFL", "description": intro,
          "creator": ian(), "dateModified": updated, "isAccessibleForFree": True, "usageInfo": QUOTE}
    open(os.path.join(ROOT, "nfl-huskers", "index.html"), "w", encoding="utf-8").write(page("Nebraska Cornhuskers in the NFL", intro, body, updated, ld))
    # one page per player
    made = 0
    for slug, info in LISTS_INFO.items():
        l = by.get(slug)
        if not l: continue
        rows = {r[0].strip(): r for g in l["groups"] for r in g["rows"]}
        for p in players:
            if p["list"] != slug or p["name"] not in rows: continue
            open(os.path.join(ROOT, info[0], p["slug"] + ".html"), "w", encoding="utf-8").write(player_page(p, rows[p["name"]], info, l, idx, updated))
            urls.append(f"{info[0]}/{p['slug']}.html"); made += 1
    sm = "".join(f"<url><loc>{esc(base + u)}</loc><lastmod>{updated}</lastmod></url>\n" for u in urls)
    open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8").write(
        f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{sm}</urlset>\n')
    print(f"Plain pages written: {len(items)} NFL lists, {made} players, sitemap with {len(urls)} addresses.")


if __name__ == "__main__":
    main()

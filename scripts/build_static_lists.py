#!/usr/bin/env python3
"""Plain, crawlable pages of Ian's NFL Husker lists: nfl-huskers/index.html plus one page per tier.

The site itself builds its lists in the browser (at #/checklist addresses), which search engines and AI tools
mostly can't read. These pages hold the same research as simple HTML tables, credited to Ian, so they can be
found, shared and quoted. Built from data/lists/husker-pros.json on every publish (not saved in the repo).
"""
import datetime, html, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LISTS = os.path.join(ROOT, "data", "lists", "husker-pros.json")
PLAYERS = os.path.join(ROOT, "data", "players.json")
OUT = os.path.join(ROOT, "nfl-huskers")

TIERS = [  # (list slug, page file, short name, what the tier means)
    ("nfl-tier-1-huskers", "tier-1.html", "NFL Tier 1 Huskers",
     "Nebraska Cornhuskers who played in at least one regular-season or postseason NFL game."),
    ("nfl-tier-2-huskers", "tier-2.html", "NFL Tier 2 Huskers",
     "Nebraska Cornhuskers who made an NFL active roster, played in the preseason, or spent time on injured reserve "
     "or a practice squad, but never played in a regular-season or postseason game."),
    ("pro-football-huskers", "tier-3.html", "NFL Tier 3 Huskers (Pro Football Huskers)",
     "Nebraska Cornhuskers who were drafted, signed, or went to an NFL camp or tryout without making it onto a "
     "roster in season, and Huskers who played pro football in other leagues."),
]
SITE = "IanBadeer.com"
CREDIT = "Researched and verified by Ian Badeer"
QUOTE = ("You're welcome to quote these lists. Please credit Ian Badeer and link to IanBadeer.com.")

CSS = """
:root{color-scheme:light dark;--bg:#fff;--fg:#151a22;--mu:#5a6474;--line:#dde2ea;--acc:#c8102e;--head:#f4f6f9}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f15;--fg:#e8ecf2;--mu:#98a2b3;--line:#273142;--acc:#ff5468;--head:#141b26}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:28px 16px 64px}a{color:var(--acc)}
h1{font-size:clamp(26px,5vw,38px);line-height:1.15;margin:6px 0 10px}h2{font-size:22px;margin:30px 0 8px}
.kick{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--mu)}
.credit{border-left:3px solid var(--acc);padding:8px 14px;background:var(--head);border-radius:0 8px 8px 0;margin:16px 0}
.credit p{margin:4px 0}.mu{color:var(--mu)}
table{width:100%;border-collapse:collapse;font-size:14.5px;margin-top:14px}
th,td{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid var(--line)}
th{position:sticky;top:0;background:var(--head);font-size:12.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--mu)}
td.n{white-space:nowrap;font-variant-numeric:tabular-nums}td.note{max-width:46ch}td.note p{margin:0 0 6px}td.note p:last-child{margin:0}
td.pl{font-weight:600}td.pl small{display:block;font-weight:400}
.tiers{list-style:none;padding:0;display:grid;gap:12px}.tiers li{border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.tiers a{font-weight:700;font-size:18px}
footer{margin-top:40px;color:var(--mu);font-size:14px}
@media (max-width:640px){th.opt,td.opt{display:none}table{font-size:14px}}
"""


def esc(t):
    return html.escape(str(t or ""), quote=True)


def slugs():
    """(list slug, player name) -> the player's page slug on the site."""
    try:
        return {(p["list"], p["name"]): p["slug"] for p in json.load(open(PLAYERS))["players"]}
    except (OSError, ValueError, KeyError):
        return {}


def page(title, desc, body, updated, canonical_name):
    ld = {"@context": "https://schema.org", "@type": "Dataset", "name": title, "description": desc,
          "creator": {"@type": "Person", "name": "Ian Badeer", "url": "https://ianbadeer.com/"},
          "publisher": {"@type": "Organization", "name": SITE}, "dateModified": updated,
          "isAccessibleForFree": True, "keywords": ["Nebraska Cornhuskers", "Huskers", "NFL", "football"],
          "usageInfo": QUOTE}
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)} · {SITE}</title>
<meta name="description" content="{esc(desc)}">
<meta name="author" content="Ian Badeer">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{SITE}">
<script type="application/ld+json">{json.dumps(ld)}</script>
<style>{CSS}</style>
</head>
<body><main>
{body}
<footer><p>{esc(CREDIT)} · <a href="../">{SITE}</a> · Updated {esc(updated)}</p><p>{esc(QUOTE)}</p></footer>
</main></body></html>
"""


def note_html(t):
    return "".join(f"<p>{esc(p.strip()).replace(chr(10), '<br>')}</p>" for p in re.split(r"\n\s*\n", t) if p.strip())


def main():
    if not os.path.exists(LISTS):
        print("No lists yet; skipping the plain NFL Husker pages."); return
    data = json.load(open(LISTS))
    by = {l["slug"]: l for l in data["lists"]}
    sl = slugs()
    updated = datetime.date.today().isoformat()
    os.makedirs(OUT, exist_ok=True)
    index_items = []
    for slug, fname, name, meaning in TIERS:
        l = by.get(slug)
        if not l: continue
        cols = l["columns"]; c = {k: i for i, k in enumerate(cols)}
        notes, links = l.get("notes") or {}, l.get("links") or {}
        rows = [r for g in l["groups"] for r in g["rows"]]
        has_games = "NFL Games Played" in c
        trs = []
        for r in rows:
            nm = r[0].strip()
            ps = sl.get((slug, nm))
            src = links.get(r[0]) or ""
            name_cell = esc(nm) + (f' <small><a href="../#/player/{esc(ps)}">Player page</a>' if ps else "<small>") + \
                (f' · <a href="{esc(src)}" rel="nofollow">Stats</a>' if src.startswith("http") else "") + "</small>"
            trs.append("<tr>" + f'<td class="pl">{name_cell}</td>'
                       + f'<td class="n">{esc(r[c["Last Year"]]) if "Last Year" in c else ""}</td>'
                       + (f'<td class="n">{esc(r[c["NFL Games Played"]])}</td>' if has_games else "")
                       + f'<td class="opt">{esc(r[c["Career Notes"]]) if "Career Notes" in c else ""}</td>'
                       + (f'<td class="note">{note_html(notes.get(r[0], ''))}</td>' if notes else "")
                       + "</tr>")
        head = ("<tr><th>Player</th><th>Last Nebraska season</th>" + ("<th>NFL games</th>" if has_games else "")
                + '<th class="opt">Path to the pros</th>' + ("<th>Why he's on this list</th>" if notes else "") + "</tr>")
        desc = f"{len(rows)} {meaning}"
        body = f"""<div class="kick"><a href="./">NFL Husker lists</a> · {SITE}</div>
<h1>{esc(name)}</h1>
<p>{esc(meaning)} {len(rows)} players.</p>
<div class="credit"><p><strong>{esc(CREDIT)}.</strong> Each player was checked by hand against rosters, transaction records,
newspaper archives and media guides.</p><p class="mu">{esc(QUOTE)}</p></div>
<table><thead>{head}</thead><tbody>
{chr(10).join(trs)}
</tbody></table>"""
        open(os.path.join(OUT, fname), "w", encoding="utf-8").write(page(name, desc, body, updated, fname))
        index_items.append(f'<li><a href="{fname}">{esc(name)}</a> <span class="mu">· {len(rows)} players</span><p>{esc(meaning)}</p></li>')
    intro = ("Every Nebraska Cornhusker who reached pro football, sorted into three tiers by how far he got in the NFL. "
             "Ian Badeer built these lists while collecting an autograph from every Husker who made it to the NFL, "
             "and verified each player himself.")
    body = f"""<div class="kick">{SITE}</div>
<h1>Nebraska Cornhuskers in the NFL</h1>
<p>{esc(intro)}</p>
<div class="credit"><p><strong>{esc(CREDIT)}.</strong></p><p class="mu">{esc(QUOTE)}</p></div>
<ul class="tiers">{''.join(index_items)}</ul>
<p class="mu">Browse the lists with card scans and player pages at <a href="../#/checklist">{SITE}</a>.</p>"""
    open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write(page("Nebraska Cornhuskers in the NFL", intro, body, updated, "index.html"))
    print(f"Plain NFL Husker pages written: {len(index_items)} tiers.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Launch-readiness checks for the completeness tracker -> data/launch-checks.json.
Run after scripts/build_static_pages.py and scripts/build_route_pages.py (it reads the pages they write; those aren't kept in the repo)."""
import json, os, re, gzip, glob, html as H
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = lambda *p: os.path.join(ROOT, *p)
P = json.load(open(R('data/players.json')))['players']
S = json.load(open(R('config/site.json')))
cat = json.load(open(R('data/catalog.json')))
read = lambda f: open(f, encoding='utf-8', errors='ignore').read() if os.path.exists(f) else ''
out = {}

# 8. Switch settings
site = (S.get('siteUrl') or '').rstrip('/')
robots, sitemap = read(R('robots.txt')), read(R('sitemap.xml'))
sm_urls = re.findall(r'<loc>([^<]+)</loc>', sitemap)
out['setup'] = [
    ['GoatCounter site code set', bool((S.get('analytics') or {}).get('goatcounter'))],
    ['siteUrl is ianbadeer.com', 'ianbadeer.com' in site.lower()],
    ['CNAME file for the domain', os.path.exists(R('CNAME'))],
    ['robots.txt present', bool(robots)],
    ['robots.txt names the sitemap on the live domain', bool(re.search(r'Sitemap:\s*' + re.escape(site), robots, re.I)) if site else False],
    ['sitemap.xml built', bool(sm_urls)],
    ['every sitemap address is on the live domain', bool(sm_urls) and all(u.startswith(site + '/') or u == site for u in sm_urls)],
]

# 7. A plain crawlable page for every player
FOLDER = {'nfl-tier-1-huskers': 'nfl-huskers', 'nfl-tier-2-huskers': 'nfl-huskers', 'pro-football-huskers': 'nfl-huskers', 'baseball-mlb': 'players', 'basketball-nba': 'players'}
miss_page, miss_map = [], []
for p in P:
    rel = f"{FOLDER.get(p['list'], 'players')}/{p['slug']}.html"
    if not os.path.exists(R(rel)): miss_page.append(p['name'])
    elif site and not any(u.endswith('/' + rel) or u.endswith('/' + rel[:-5]) for u in sm_urls): miss_map.append(p['name'])
out['crawl'] = {'total': len(P), 'pages': len(P) - len(miss_page), 'inSitemap': len(P) - len(miss_page) - len(miss_map), 'missingPage': miss_page, 'missingSitemap': miss_map}

# 10. Link previews: every real-address page needs its own title, description and picture
pages = [f for d in ('c', 'player', 'customs', 'duplicates', 'rarest', 'stats', 'media', 'letters', 'about', 'nfl-teams', 'checklist', 'husker-bios', 'player-pages', 'nfl-huskers', 'players') for f in glob.glob(R(d, '**', '*.html'), recursive=True)]
bad, titles = [], {}
for f in pages:
    t = read(f); rel = os.path.relpath(f, ROOT)
    g = lambda pat: (re.search(pat, t) or [None, ''])[1]
    ti, de = H.unescape(g(r'<title>([^<]*)</title>')), g(r'name="description" content="([^"]*)"')
    why = [w for w, ok in (('no title', ti), ('no description', de), ('no preview picture', g(r'property="og:image" content="([^"]+)"')), ('no preview title', g(r'property="og:title" content="([^"]+)"'))) if not ok]
    titles.setdefault(ti, []).append(rel)
    if why: bad.append([rel, ', '.join(why)])
out['previews'] = {'pages': len(pages), 'ok': len(pages) - len(bad), 'problems': bad[:200], 'duplicateTitles': sum(len(v) for ti, v in titles.items() if ti and len(v) > 1), 'duplicates': [[ti, v[:4]] for ti, v in titles.items() if ti and len(v) > 1][:20]}

# 5. Private notes left in card names
PRIV = re.compile(r'\b(sold|gifted to|traded to|need to confirm|pending|lost|source:|paid|\$\d)|https?://', re.I)
names = [c[2] for c in cat['cards']]
hit = [n for n in names if PRIV.search(re.sub(r'\bgift set\b', '', n, flags=re.I))]
out['names'] = {'cards': len(names), 'withNotes': len(hit), 'examples': hit[:60]}

# 14. "Super Collection" is two words, capitalised, everywhere
bads = []
def scan(label, text, skipc=True):
    for ln in text.splitlines():
        if skipc and re.match(r'\s*(//|\*|/\*)', ln): continue
        for m in re.finditer(r'super[- ]?collections?', ln, re.I):
            if not re.fullmatch(r'Super Collections?', m.group(0)): bads.append([label, m.group(0), ln.strip()[:90]])
for f in ('index.html', 'assets/app.js', 'config/site.json', 'README.md'): scan(f, read(R(f)), f.endswith('.js'))
for sct in cat['sections']: scan('catalog section', json.dumps(sct, ensure_ascii=False)[:400], False)
out['wording'] = {'problems': bads[:100], 'count': len(bads)}

# 13. Download weight of the site's own files
def gz(f): return len(gzip.compress(open(f, 'rb').read(), 6))
files = [(os.path.relpath(f, ROOT), os.path.getsize(f), gz(f)) for f in glob.glob(R('data', '*.json')) + [R('assets/app.js'), R('assets/style.css'), R('index.html')]]
out['weight'] = sorted(({'file': a, 'bytes': b, 'gz': c} for a, b, c in files), key=lambda x: -x['gz'])[:12]
json.dump(out, open(R('data/launch-checks.json'), 'w'), separators=(',', ':'))
print({k: (v if k in ('setup',) else {a: b for a, b in v.items() if not isinstance(b, list)} if isinstance(v, dict) else len(v)) for k, v in out.items()})

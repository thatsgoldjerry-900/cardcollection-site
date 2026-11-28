#!/usr/bin/env python3
"""Completeness tracker data: data/players.json + data/tracker-pages.json (scripts/scrape_tracker.js) -> data/tracker.json.
Everything is computed from what the player pages actually show. Rainbows are computed live in the browser."""
import json, re, collections
P = json.load(open('data/players.json'))['players']
T = json.load(open('data/tracker-pages.json'))
LISTS = {'nfl-tier-1-huskers': 'NFL Tier 1', 'nfl-tier-2-huskers': 'NFL Tier 2', 'pro-football-huskers': 'NFL Tier 3', 'baseball-mlb': 'MLB', 'basketball-nba': 'NBA'}
OLINE = re.compile(r'\b(center|guard|offensive (?:tackle|lineman|guard)|tackle|long snapper|snapper|lineman)\b', re.I)
DLINE = re.compile(r'defensive|nose', re.I)
# Not shown as missing: MLB minor league teams and non-NBA international basketball clubs (Ian). A pro stop with these words is skipped.
SKIP_LOGO = re.compile(r'\b(Triple-A|Double-A|Single-A|Class [A-D]|minor|Rookie League|Arizona League|Dominican|Gulf Coast)\b', re.I)

def wsec(p):
    return (p.get('wiki') or {}).get('sections', {}) or {}

def pos_of(p, pg):
    v = (pg.get('position') or p.get('position') or '')
    if not v:
        for rows in wsec(p).values():
            for r in rows:
                if len(r) == 2 and r[0] == 'Position': v = r[1]
    return v

def coach_only(p, pg):
    s = wsec(p); keys = ' '.join(s).lower()
    played = any(k in s for k in ('Career history', 'Playing', 'Teams', 'Playing career')) or any('statistics' in k.lower() for k in s)
    return bool(s) and ('coaching' in keys) and not played

def wiki_neb_last(p):
    for rows_ in wsec(p).values():
        for r in rows_:
            if len(r) == 2 and r[0] == 'College':
                m = re.search(r'Nebraska[^()\n]*\(([^)]*)\)', r[1])
                if m:
                    y = [int(x) for x in re.findall(r'(?:19|20)\d{2}', m.group(1))]
                    if y: return max(y), min(y)
    return 0, 0

def last_pro_year(pg):
    ys = [int(y) for b in pg.get('p', []) for y in re.findall(r'(?:19|20)\d{2}', b['t'].split('(', 1)[-1] if '(' in b['t'] else '')]
    return max(ys) if ys else 0

NOW = __import__('datetime').date.today().year
rows = []
for p in P:
    pg = T.get(p['slug'], {}); pos = pos_of(p, pg)
    g = (pg.get('games') or p.get('nflGames') or '').strip()
    h2 = pg.get('h2', [])
    proStatsShown = any(re.search(r'statistics|pro stats', h, re.I) and not re.search(r'college', h, re.I) for h in h2)
    collegeStatsShown = any(re.search(r'college stats', h, re.I) for h in h2)
    pb = [b for b in pg.get('p', []) if not SKIP_LOGO.search(b['t'])]
    co = coach_only(p, pg)
    fin = p.get('finalYear') or 0
    try: fin = int(fin)
    except: fin = 0
    oline = bool(OLINE.search(pos)) and not DLINE.search(pos)
    rows.append({
        'slug': p['slug'], 'name': p['name'], 'list': LISTS.get(p['list'], p['list']), 'sport': p['sport'], 'pos': pos, 'final': fin,
        'coach': co, 'bio': bool((p.get('wiki') or {}).get('intro')),
        'tl': bool(pg.get('tl')), 'neb': bool(pg.get('neb')), 'pro': len(pg.get('p', [])), 'undated': bool(pg.get('undated')),
        'logoMiss': sorted({b['t'].split(' (')[0].strip() for b in pb if not b['logo']}), 'logoHave': sum(1 for b in pb if b['logo']), 'logoBars': len(pb),
        'games': g, 'proStats': proStatsShown, 'collegeStats': collegeStatsShown,
        'have': bool(p.get('have')), 'wide': pg.get('wide'),
        'check': (lambda wl, fin_, lt: [x for x in (
            (f'Wikipedia says Nebraska ended {wl[0]}, my final year is {fin_}' if wl[0] and fin_ and wl[0] != fin_ else ''),
            (f'letter years end {lt}, Wikipedia says {wl[0]}' if wl[0] and lt and lt != wl[0] else ''),
        ) if x])(wiki_neb_last(p), fin, max([0] + list((p.get('letters') or {}).get(p['sport']) or []))),
        'stale': bool(re.search(r'\b(is an American|plays|is a (?:professional|free agent))', ((p.get('wiki') or {}).get('intro') or '')[:300]) and 0 < last_pro_year(pg) < NOW - 1 and p['sport'] == 'football' and not re.search(r'\bformer\b', ((p.get('wiki') or {}).get('intro') or '')[:200])),
        'proStatsExempt': 'lineman / long snapper' if oline else ('0 pro games' if g == '0' else ''),
    })
live = T.get('_live') or {}
pages = {k: v for k, v in (T.get('_pages') or {}).items() if v}
SIGS = len([k for k in (json.load(open('config/site.json')).get('signatures') or {}) if not k.startswith('_')])
pl_ = [r for r in rows if not r['coach']]
metrics = {
    'bios': [sum(r['bio'] for r in pl_), len(pl_)],
    'timelines': [sum(r['neb'] and r['pro'] and not r['undated'] for r in pl_), len(pl_)],
    'logos': [sum(r['logoHave'] for r in pl_), sum(r['logoBars'] for r in pl_)],
    'proStats': [sum(r['proStats'] for r in pl_ if not r['proStatsExempt']), sum(1 for r in pl_ if not r['proStatsExempt'])],
    'collegeStats': [sum(r['collegeStats'] for r in pl_ if r['final'] >= 1962), sum(1 for r in pl_ if r['final'] >= 1962)],
    'signatures': [SIGS, sum(r['have'] for r in pl_)],
    'phoneOk': [len(pl_) + len(T.get('_pages') or {}) - sum(1 for r in pl_ if r['wide']) - len(pages), len(pl_) + len(T.get('_pages') or {})],
    'dataChecks': [len(pl_) - sum(1 for r in pl_ if r['check']), len(pl_)],
}
for k, v in live.items(): metrics[k] = v   # rainbows, tcdb, hof: [done, total] counted in the browser
today = __import__('datetime').date.today().isoformat()
try: hist = json.load(open('data/tracker-history.json'))
except Exception: hist = []
hist = [h for h in hist if h['date'] != today] + [{'date': today, 'm': metrics}]
json.dump(hist, open('data/tracker-history.json', 'w'), separators=(',', ':'))
open('data/tracker.json', 'w').write(json.dumps({'built': today, 'players': rows, 'pages': pages, 'sigs': SIGS, 'history': hist}, separators=(',', ':')))
pl = [r for r in rows if not r['coach']]
print(len(rows), 'players;', len(rows) - len(pl), 'coach-only')
print('bios', sum(r['bio'] for r in pl), '/', len(pl))
tl = [r for r in pl if r['pro'] or r['tl']]
print('timeline complete', sum(r['neb'] and r['pro'] and not r['undated'] for r in pl), '/', len(pl))
print('logos', sum(r['logoHave'] for r in pl), '/', sum(r['logoBars'] for r in pl))
st = [r for r in pl if not r['proStatsExempt']]
print('pro stats', sum(r['proStats'] for r in st), '/', len(st), collections.Counter(r['proStatsExempt'] for r in pl))
cs = [r for r in pl if r['final'] >= 1962]
print('college stats', sum(r['collegeStats'] for r in cs), '/', len(cs), collections.Counter((r['sport'], r['collegeStats']) for r in cs))

print('checks', sum(bool(r['check']) for r in pl), 'stale', sum(r['stale'] for r in pl), 'wide', sum(bool(r['wide']) for r in pl), 'pages wide', pages)
print('metrics', metrics)

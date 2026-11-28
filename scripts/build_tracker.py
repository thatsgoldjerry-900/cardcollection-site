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
        'proStatsExempt': 'lineman / long snapper' if oline else ('0 pro games' if g == '0' else ''),
    })
open('data/tracker.json', 'w').write(json.dumps({'built': __import__('datetime').date.today().isoformat(), 'players': rows}, separators=(',', ':')))
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

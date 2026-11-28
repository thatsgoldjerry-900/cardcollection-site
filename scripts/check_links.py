#!/usr/bin/env python3
"""Checks the outside links the site shows (Wikipedia, Hall of Fame pages, huskers.com, TCDb, Pro Football Archives) and
writes data/link-check.json for the completeness tracker. Polite: a few workers, a short pause per host, and a link that
was fine within the last 7 days isn't asked again. Only 404/410 and dead addresses count as broken; a site that blocks
robots (403/429) or fails to answer is "unchecked". Pro Football Reference, Sports Reference and FootballDB are never
requested (the site only links to them)."""
import json, os, re, time, datetime, threading, urllib.request, urllib.error, urllib.parse
from concurrent.futures import ThreadPoolExecutor
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'link-check.json')
SKIP = re.compile(r'(pro-football-reference|sports-reference|baseball-reference|basketball-reference|footballdb)\.', re.I)
UA = {'User-Agent': 'IanBadeerCardSite/1.0 (link check, https://thatsgoldjerry-900.github.io/cardcollection-site/) python-urllib'}
today = datetime.date.today()
P = json.load(open(os.path.join(ROOT, 'data/players.json')))['players']
H = json.load(open(os.path.join(ROOT, 'data/hall-of-fame.json')))
urls = {}
def add(u, where):
    if u and re.match(r'https?://', u) and not SKIP.search(u): urls.setdefault(u, where)
for p in P:
    w = p.get('wiki') or {}
    add(w.get('url'), p['name'] + ' (Wikipedia)')
    add((w.get('statsLink') or {}).get('url'), p['name'] + ' (stats link)')
for h in H.get('college', []): add(h.get('url'), h['name'] + ' (College HOF)')
for slug, path in (H.get('proPaths') or {}).items(): add('https://www.profootballhof.com/players/' + path, slug + ' (Pro HOF)')
for slug in (H.get('pro') or {}):
    if slug not in (H.get('proPaths') or {}): add('https://www.profootballhof.com/players/' + slug, slug + ' (Pro HOF)')
S = json.load(open(os.path.join(ROOT, 'config/site.json')))
def walk(o):
    if isinstance(o, str):
        for u in re.findall(r'https?://[^\s)"\']+', o): add(u.rstrip('.,'), 'config/site.json')
    elif isinstance(o, dict):
        for v in o.values(): walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
walk({k: v for k, v in S.items() if k not in ('tcdbNames', 'siteUrl')})
try: prev = json.load(open(OUT))
except Exception: prev = {}
okd = prev.get('okDates', {})
lock = threading.Lock(); last = {}
def gap(host):
    with lock:
        t = max(0, last.get(host, 0) + 0.25 - time.time()); last[host] = time.time() + t
    time.sleep(t)
def check(u):
    d = okd.get(u)
    if d and (today - datetime.date.fromisoformat(d)).days < 7: return u, 'ok', 200, True
    host = urllib.parse.urlparse(u).netloc
    for method in ('HEAD', 'GET'):
        gap(host)
        try:
            r = urllib.request.urlopen(urllib.request.Request(u, headers=UA, method=method), timeout=20)
            return u, 'ok', r.status, False
        except urllib.error.HTTPError as e:
            if method == 'HEAD' and e.code in (403, 404, 405, 410, 501): continue   # some sites answer HEAD wrongly: confirm with a normal request
            if e.code in (404, 410): return u, 'broken', e.code, False
            return u, 'unchecked', e.code, False
        except urllib.error.URLError as e:
            if re.search(r'Name or service not known|nodename nor servname|getaddrinfo', str(e.reason)): return u, 'broken', 'no such site', False
            return u, 'unchecked', str(e.reason)[:40], False
        except Exception as e:
            return u, 'unchecked', type(e).__name__, False
    return u, 'unchecked', 'blocked', False
with ThreadPoolExecutor(6) as ex: res = list(ex.map(check, urls))
ok = [r for r in res if r[1] == 'ok']
for u, st, c, cached in ok:
    if not cached: okd[u] = today.isoformat()
okd = {u: d for u, d in okd.items() if u in urls}
out = {'checked': today.isoformat(), 'total': len(urls), 'ok': len(ok), 'unchecked': sum(r[1] == 'unchecked' for r in res),
       'broken': [{'url': u, 'status': c, 'where': urls[u]} for u, st, c, _ in res if st == 'broken'], 'okDates': okd}
json.dump(out, open(OUT, 'w'), separators=(',', ':'))
print(out['total'], 'links;', out['ok'], 'ok;', len(out['broken']), 'broken;', out['unchecked'], 'unchecked')

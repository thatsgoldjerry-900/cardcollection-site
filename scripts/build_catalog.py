#!/usr/bin/env python3
"""Build data/catalog.json from the public Google Drive folders listed in config/site.json.

Run it whenever you add scans (the GitHub Action runs it automatically every few hours):
    python3 scripts/build_catalog.py

It reads each folder's public "embedded folder view" page, so no API key is needed.
The folders must stay shared as "Anyone with the link can view".
"""
import html, json, os, re, sys, time, urllib.request
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "config", "site.json")
OUT = os.path.join(ROOT, "data", "catalog.json")

ENTRY = re.compile(
    r'<div class="flip-entry" id="entry-([^"]+)".*?<a href="([^"]+)".*?'
    r'<div class="flip-entry-title">([^<]*)</div>.*?flip-entry-last-modified"><div>([^<]*)</div>', re.S)

def fetch(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (catalog builder)"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "ignore")
        except Exception as e:
            if i == tries - 1: raise
            time.sleep(2 * (i + 1))

def parse_date(s):
    s = s.strip()
    for fmt in ("%m/%d/%y", "%m/%d/%Y", "%b %d, %Y"):
        try: return datetime.strptime(s, fmt).date().isoformat()
        except ValueError: pass
    return date.today().isoformat()  # Drive shows a time (e.g. "3:41 PM") for files changed today

def list_folder(fid, rk, depth=0):
    url = f"https://drive.google.com/embeddedfolderview?id={fid}" + (f"&resourcekey={rk}" if rk else "")
    page = fetch(url)
    if "flip-entries" not in page:
        raise RuntimeError(f"Folder {fid} did not list. Is it shared as 'Anyone with the link'?")
    files = []
    for iid, href, title, mod in ENTRY.findall(page):
        href = html.unescape(href); title = html.unescape(title).replace("\xa0", " ")
        frk = (re.search(r"resourcekey=([^&]+)", href) or [None, ""])[1]
        if "/folders/" in href or "folderview" in href:
            if depth < 3: files += list_folder(iid, frk, depth + 1)   # include subfolders
            continue
        if not re.search(r"\.(jpe?g|png|webp|gif|heic)$", title, re.I): continue
        files.append({"id": iid, "rk": frk, "name": title, "mod": parse_date(mod)})
    return files

BACK = re.compile(r"\s*(\((?:back|back single|inside back)\)|\bback)\s*$", re.I)
def base_name(name):
    stem = re.sub(r"\.[a-z0-9]+$", "", name, flags=re.I)
    return BACK.sub("", stem).strip(), bool(BACK.search(stem))

def main():
    cfg = json.load(open(CONFIG))
    prev, old = {}, None
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT))
            for c in old["cards"]: prev[c[0]] = c[5]
        except Exception: pass
    today = date.today().isoformat()
    cards, sections = [], []
    for si, sec in enumerate(cfg["sections"]):
        groups = []
        for gi, grp in enumerate(sec["groups"]):
            files = []
            for fid, rk in grp["folders"]:
                got = list_folder(fid, rk)
                print(f"{sec['slug']}/{grp['slug']}: {len(got)} files", file=sys.stderr)
                files += got
            # pair backs with fronts
            fronts, backs = {}, {}
            for f in files:
                b, is_back = base_name(f["name"])
                (backs if is_back else fronts).setdefault(b.lower(), f)
            n = 0
            for f in files:
                b, is_back = base_name(f["name"])
                if is_back and b.lower() in fronts: continue        # shown with its front
                back = backs.get(b.lower()) if not is_back else None
                added = prev.get(f["id"]) or (f["mod"] if not prev else today)
                cards.append([f["id"], f["rk"], b if not is_back else f["name"].rsplit(".", 1)[0], si, gi, added,
                              back["id"] if back else "", back["rk"] if back else ""])
                n += 1
            groups.append({"slug": grp["slug"], "label": grp["label"], "count": n})
        s = {k: v for k, v in sec.items() if k != "groups"}; s["groups"] = groups
        sections.append(s)
    site = {k: v for k, v in cfg.items() if k != "sections"}
    out = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "site": site, "sections": sections,
           "fields": ["id", "rk", "name", "section", "group", "added", "backId", "backRk"], "cards": cards}
    if old and {k: v for k, v in old.items() if k != "generated"} == {k: v for k, v in out.items() if k != "generated"}:
        print("No changes in Drive; card list left as is.", file=sys.stderr)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh: json.dump(out, fh, separators=(",", ":"), ensure_ascii=False)
    print(f"Wrote {len(cards)} cards to {OUT}", file=sys.stderr)

if __name__ == "__main__":
    main()

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
# "Back" before a trailing note also marks a back: "… Custom Back (Gifted to Austin Allen)" pairs with
# "… Custom (Gifted to Austin Allen)".
BACK_NOTE = re.compile(r"\s+back(?=\s*\([^()]*\)\s*$)", re.I)
CODE_RE = re.compile(r"(?<![A-Za-z])(?:AU|MEM|MANU|RC|SSP|SP|SN\d+(?:\s+of\s+\d+)?|PR\d+)(?![A-Za-z])")
def loose_key(name):
    """A name without tag codes, letter codes ("4N", "3 H"), copy marks, inscription notes and punctuation."""
    h = name.find("#"); head, tail = (name[:h], name[h:]) if h >= 0 else ("", name)
    tail = CODE_RE.sub(" ", tail)
    tail = re.sub(r"(?:^|\s)(?:Letter\s+)?0?\d{1,2}\s?[A-Z0-9](?=\s|$|,)", " ", tail)
    tail = re.sub(r"\([^()]*\)", " ", tail)        # notes like (Adidas Black), (7th), (Creased): one back serves them all
    tail = re.sub(r"\b[\w' -]*?\binsc(?:ription)?\b", " ", tail, flags=re.I)
    return re.sub(r"[^a-z0-9#]+", " ", (head + tail).lower()).strip()
def base_name(name):
    stem = re.sub(r"\.[a-z0-9]+$", "", name, flags=re.I)
    if BACK.search(stem): return BACK.sub("", stem).strip(), True
    if BACK_NOTE.search(stem): return re.sub(r"\s+", " ", BACK_NOTE.sub("", stem)).strip(), True
    return stem.strip(), False

# ---------- Reading one parent folder through the Drive API (the robot) ----------
# Layout:  Parent / Section folder / Group folder / scans   (deeper subfolders join their group)
# Scans directly inside a section folder become a group named after the section.

def natural(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def drive_session():
    key = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if not key:
        raise SystemExit("driveRoot is enabled but GOOGLE_SERVICE_ACCOUNT_JSON is not set.")
    import requests
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request
    creds = service_account.Credentials.from_service_account_info(
        json.loads(key), scopes=["https://www.googleapis.com/auth/drive.readonly"])
    sess = requests.Session()
    def get(params):
        if not creds.valid: creds.refresh(Request())
        r = sess.get("https://www.googleapis.com/drive/v3/files", params=params,
                     headers={"Authorization": f"Bearer {creds.token}"}, timeout=60)
        if r.status_code in (403, 404):
            raise SystemExit(f"Drive said HTTP {r.status_code}. Is the parent folder shared (Viewer) with the robot?")
        r.raise_for_status()
        return r.json()
    return get


def drive_children(get, folder_id):
    out, token = [], None
    while True:
        d = get({"q": f"'{folder_id}' in parents and trashed = false", "pageSize": 1000, "pageToken": token,
                 "fields": "nextPageToken, files(id, name, mimeType, createdTime, resourceKey)",
                 "supportsAllDrives": "true", "includeItemsFromAllDrives": "true"})
        out += d.get("files", [])
        token = d.get("nextPageToken")
        if not token: return out


FOLDER = "application/vnd.google-apps.folder"

def drive_images(get, folder_id, depth=0):
    files = []
    for f in drive_children(get, folder_id):
        if f["mimeType"] == FOLDER:
            if depth < 4: files += drive_images(get, f["id"], depth + 1)
        elif f["mimeType"].startswith("image/") or re.search(r"\.(jpe?g|png|webp|gif|heic)$", f["name"], re.I):
            files.append({"id": f["id"], "rk": f.get("resourceKey", ""), "name": f["name"], "mod": f["createdTime"][:10]})
    return files


# Photos of athletes with the custom cards Ian made for them. Not cards, so they live in their own list.
PHOTOS_FOLDER = "customs - with the players"
_photos = []


def sections_from_root(cfg, root_id):
    """Returns [(section_settings, [(group_slug, group_label, files)])] from the folder tree."""
    get = drive_session()
    known = {s["title"].lower(): s for s in cfg["sections"]}
    order = {s["title"].lower(): i for i, s in enumerate(cfg["sections"])}
    tops = [f for f in drive_children(get, root_id) if f["mimeType"] == FOLDER]
    for f in [t for t in tops if t["name"].strip().lower() == PHOTOS_FOLDER]:
        _photos.extend(drive_images(get, f["id"])); tops.remove(f)
    tops.sort(key=lambda f: (order.get(f["name"].strip().lower(), 999), natural(f["name"])))
    out = []
    for top in tops:
        title = top["name"].strip()
        meta = {k: v for k, v in known.get(title.lower(), {}).items() if k != "groups"}
        meta.setdefault("slug", re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-"))
        meta.setdefault("title", title); meta.setdefault("kind", "team"); meta.setdefault("color", "royal")
        kids = drive_children(get, top["id"])
        groups = []
        loose = [f for f in kids if f["mimeType"] != FOLDER]
        if loose:
            groups.append(("all", title, drive_images(get, top["id"], depth=99)))   # only files directly inside
        for sub in sorted((f for f in kids if f["mimeType"] == FOLDER), key=lambda f: natural(f["name"])):
            label = sub["name"].strip()
            groups.append((re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-"), label, drive_images(get, sub["id"])))
        out.append((meta, groups))
    return out


def sections_from_config(cfg):
    for fid, rk in (cfg.get("customsPhotos") or {}).get("folders", []):
        _photos.extend(list_folder(fid, rk))
    out = []
    for sec in cfg["sections"]:
        groups = []
        for grp in sec["groups"]:
            files = []
            for fid, rk in grp["folders"]:
                files += list_folder(fid, rk)
            groups.append((grp["slug"], grp["label"], files))
        out.append(({k: v for k, v in sec.items() if k != "groups"}, groups))
    return out


def main():
    cfg = json.load(open(CONFIG))
    sync_first_screen(cfg)
    prev, prev_name, prev_photo, old = {}, {}, {}, None
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT))
            for c in old["cards"]:
                prev[c[0]] = c[5]
                prev_name[c[2].lower()] = c[5]   # card name without extension
            for ph in old.get("photos", []): prev_photo[ph[0]] = ph[3]
        except Exception: pass
    today = date.today().isoformat()
    cards, sections = [], []
    root = cfg.get("driveRoot") or {}
    source = sections_from_root(cfg, root["id"]) if root.get("enabled") else sections_from_config(cfg)
    for si, (sec, group_files) in enumerate(source):
        groups = []
        for gi, (gslug, glabel, files) in enumerate(group_files):
            print(f"{sec['slug']}/{gslug}: {len(files)} files", file=sys.stderr)
            # pair backs with fronts: by exact name, or failing that by the name without Ian's tag codes and
            # letter codes (a back is often named "... SN199 Back" while its front is "... AU, MEM, SN199").
            fronts, backs, loose_fronts = {}, {}, {}
            for f in files:
                b, is_back = base_name(f["name"])
                (backs if is_back else fronts).setdefault(b.lower(), f)
                if not is_back: loose_fronts.setdefault(loose_key(b), []).append(b.lower())
            back_of = {}                                             # front name -> its back file
            for k, f in backs.items():
                if k in fronts: back_of[k] = f
            # Backs Ian maps by hand (config "backFor": back name -> the fronts it belongs to).
            for k, f in backs.items():
                for fr in cfg.get("backFor", {}).get(f["name"].rsplit(".", 1)[0], []):
                    if fr.lower() in fronts: back_of[fr.lower()] = f; f["_paired"] = True
            for k, f in backs.items():
                if k in fronts or f.get("_paired"): continue
                # One back can serve several fronts, e.g. every letter of a letterman set shares the same back.
                cands = [c for c in loose_fronts.get(loose_key(base_name(f["name"])[0]), []) if c not in back_of]
                for c in cands: back_of[c] = f
                if cands: f["_paired"] = True
            n = 0
            for f in files:
                b, is_back = base_name(f["name"])
                if is_back and (b.lower() in fronts or f.get("_paired")): continue        # shown with its front
                back = back_of.get(b.lower()) if not is_back else None
                card_name = b if not is_back else f["name"].rsplit(".", 1)[0]
                if not_shown(card_name): continue                   # sold, or a second copy
                # A re-uploaded scan gets a new Drive ID; match it by name so it keeps its original date
                # (and isn't marked NEW). The extension may change, e.g. .png to .jpg.
                added = prev.get(f["id"]) or prev_name.get(card_name.lower()) or (f["mod"] if not prev else today)
                cards.append([f["id"], f["rk"], card_name, si, gi, added,
                              back["id"] if back else "", back["rk"] if back else ""])
                n += 1
            groups.append({"slug": gslug, "label": glabel, "count": n})
        s = dict(sec); s["groups"] = groups
        sections.append(s)
    site = {k: v for k, v in cfg.items() if k not in ("sections", "driveRoot") and not k.startswith("_")}
    if "customsPhotos" in site: site["customsPhotos"] = {k: v for k, v in site["customsPhotos"].items() if k != "folders"}
    # Photo name without extension is its caption; newest first.
    photos = sorted(([f["id"], f["rk"], re.sub(r"\.[a-z0-9]+$", "", f["name"], flags=re.I), prev_photo.get(f["id"]) or f["mod"]]
                     for f in _photos), key=lambda x: x[3], reverse=True)
    out = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "site": site, "sections": sections, "photos": photos,
           "fields": ["id", "rk", "name", "section", "group", "added", "backId", "backRk"], "cards": cards}
    if old and len(cards) < len(old.get("cards", [])) // 2 and "--allow-shrink" not in sys.argv:
        # Folders look mostly empty (e.g. mid-way through deleting and re-uploading scans).
        # Keep the previous list so the site doesn't go blank and card dates aren't lost.
        print(f"Found {len(cards)} cards, fewer than half of the {len(old['cards'])} last time. "
              "Keeping the previous card list. Run with --allow-shrink if this drop is intended.", file=sys.stderr)
        return
    if old and {k: v for k, v in old.items() if k != "generated"} == {k: v for k, v in out.items() if k != "generated"}:
        print("No changes in Drive; card list left as is.", file=sys.stderr)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh: json.dump(out, fh, separators=(",", ":"), ensure_ascii=False)
    print(f"Wrote {len(cards)} cards to {OUT}", file=sys.stderr)

# Cards that aren't on the site: anything sold (the name says "Sold ..."), and a second or third copy of a card
# ("... 2nd", "... 3rd" at the end of the name; "10th Anniversary" sets don't count). Customs are kept:
# numbered customs ("Custom 2nd") are separate commissioned pieces, not copies.
SOLD = re.compile(r"\bsold\b", re.I)
COPY = re.compile(r"\s\(?(?:2nd|3rd|\d+th)\)?\s*(?:\([^)]*\))?\s*$", re.I)


def not_shown(name):
    return bool(SOLD.search(name) or (COPY.search(name) and not re.search(r"\bcustom\b", name, re.I)))


def sync_first_screen(cfg):
    """index.html shows the home intro before the card list loads; keep that copy matching config/site.json."""
    import html as _h
    path = os.path.join(ROOT, "index.html")
    page = open(path, encoding="utf-8").read()
    new = re.sub(r"<!--intro-->.*?<!--/intro-->", lambda m: "<!--intro-->" + _h.escape(cfg.get("intro", "")) + "<!--/intro-->", page, flags=re.S)
    if new != page: open(path, "w", encoding="utf-8").write(new)


if __name__ == "__main__":
    main()

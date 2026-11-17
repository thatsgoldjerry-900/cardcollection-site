#!/usr/bin/env python3
"""Copy selected columns from private Excel masters (in Google Drive) into data/lists/*.json.

Runs in the GitHub Action with the service account key in the GOOGLE_SERVICE_ACCOUNT_JSON secret.
Only the columns listed in config/private-lists.json are written. Nothing from the masters is
printed to the log, because logs on a public repository are visible to anyone.

Local test without Google:  python3 scripts/build_lists.py --local path/to/master.xlsx
"""
import io, json, os, sys
import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "config", "private-lists.json")
OUT_DIR = os.path.join(ROOT, "data", "lists")


def download(file_id, creds):
    import requests
    from google.auth.transport.requests import Request
    creds.refresh(Request())
    r = requests.get(f"https://www.googleapis.com/drive/v3/files/{file_id}",
                     params={"alt": "media", "supportsAllDrives": "true"},
                     headers={"Authorization": f"Bearer {creds.token}"}, timeout=120)
    if r.status_code in (403, 404):
        raise SystemExit(f"File {file_id}: no access (HTTP {r.status_code}). Is it shared (Viewer) with the service account?")
    r.raise_for_status()
    return r.content


def cell_text(v):
    if v is None: return ""
    if isinstance(v, float) and v.is_integer(): return str(int(v))
    if hasattr(v, "strftime"): return v.strftime("%Y-%m-%d")
    return str(v).strip()


def extract(xlsx_bytes, spec):
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), read_only=True, data_only=True)  # values, not formulas
    if spec["tab"] not in wb.sheetnames:
        raise SystemExit(f'List "{spec["name"]}": the master has no tab named "{spec["tab"]}".')
    rows = [[cell_text(v) for v in r] for r in wb[spec["tab"]].iter_rows(values_only=True)]
    hr = spec.get("headerRow", 1) - 1
    headers = rows[hr] if len(rows) > hr else []
    picks = []
    for name in spec["columns"]:
        if name not in headers:
            # Don't print the real titles: they would show up in the public log.
            raise SystemExit(f'List "{spec["name"]}": no column titled "{name}" on row {hr + 1} of tab "{spec["tab"]}".')
        picks.append(headers.index(name))
    out = []
    for r in rows[hr + 1:]:
        vals = [r[i] if i < len(r) else "" for i in picks]
        if any(vals): out.append(vals)
    return {"columns": spec["columns"], "rows": out}


# Private research in a player note never goes on the site: outreach (messaging someone, asking for an
# address), to-dos ("need to confirm") and "Source: …" credits. Removed sentence by sentence; the rest stays.
PRIVATE_NOTE = r"\b(messag(?:e|ed|ing)|reached out|reach out|mailing address|dm'?d|e-?mailed|wrote (?:to )?him|asked (?:him|his|her)|to see if (?:he|she|they) (?:knows?|has|have)|need(?:s)? to confirm|to be confirmed|for checking|follow up|todo)\b"
def private_out(t):
    import re
    paras = []
    for p in re.split(r"\n\s*\n", t):
        p = re.sub(r"\s*(?:[-–—]\s*)?\bSource:[^\n]*", "", p)                       # "Source: …" to the end of the line
        sents = re.split(r"(?<=[.!?])\s+|(?<=[.!?][\"”’)])\s+", p.strip())
        p = " ".join(x for x in sents if x and not re.search(PRIVATE_NOTE, x, re.I)).strip()
        if p: paras.append(p)
    return "\n\n".join(paras)


def extract_side_by_side(xlsx_bytes, spec):
    """Several lists laid out side by side: list titles on titleRow, column titles on headerRow.
    Each list ends at its first blank row; a row with only a name is a subheading."""
    import re
    from datetime import date
    # Not read-only: hyperlinks are only available on a fully loaded workbook.
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), data_only=True)
    if spec["tab"] not in wb.sheetnames:
        raise SystemExit(f'List "{spec["name"]}": the master has no tab named "{spec["tab"]}".')
    cells = list(wb[spec["tab"]].iter_rows())
    rows = [[cell_text(c.value) for c in r] for r in cells]
    def note_at(ri, ci):
        """The note (Excel comment) on a cell, without the author line or Excel's threaded-comment boilerplate."""
        if ci >= len(cells[ri]) or not cells[ri][ci].comment: return ""
        c = cells[ri][ci].comment
        t = (c.text or "").replace("\r", "")
        if "[Threaded comment]" in t:                 # newer Excel: the text follows "Comment:"
            t = t.split("Comment:", 1)[-1]
            t = re.sub(r"\n\s*Reply:.*", "", t, flags=re.S)
        author = (c.author or "").strip()
        if author and t.startswith(author + ":"): t = t[len(author) + 1:]
        t = re.sub(r"^[^\n:]{1,40}:\n", "", t)        # a leading "Name:" line Excel adds to notes
        # Web addresses in notes are left out (Ian's call); the note text around them stays.
        url = re.compile(r"(?:https?://|www\.)[^\s)\]>]+", re.I)
        out = []
        for line in t.split("\n"):
            if not url.search(line): out.append(line); continue
            l = url.sub("", line)
            l = re.sub(r"[(\[<]\s*[)\]>]", "", l)                 # "()" where the link was
            l = re.sub(r"\s+([.,;:!?])", r"\1", l).strip()
            l = re.sub(r"[\s:–—|-]+$", "", l)                      # "Source:" → "Source"
            if len(l.split()) <= 3 and not re.search(r"[.!?]$", l): continue   # only a label was left
            out.append(l)
        t = "\n".join(out)
        return private_out(re.sub(r"[ \t]+", " ", re.sub(r"\n{3,}", "\n\n", t)).strip())
    def link_at(ri, ci):
        """The web link on a cell (e.g. a player's name links to their stats page), if any."""
        if ci >= len(cells[ri]): return ""
        h = cells[ri][ci].hyperlink
        t = (h.target or "").strip() if h else ""
        return t if re.match(r"^https?://", t, re.I) else ""
    titles, headers = rows[spec["titleRow"] - 1], rows[spec["headerRow"] - 1]
    width = max(len(titles), len(headers))
    titles += [""] * (width - len(titles)); headers += [""] * (width - len(headers))
    starts = [i for i, t in enumerate(titles) if t]
    skip = set(spec.get("skipColumns", []))
    lists = []
    for k, s0 in enumerate(starts):
        end = starts[k + 1] if k + 1 < len(starts) else width
        cols = [i for i in range(s0, end) if headers[i] and headers[i] not in skip]
        if not cols: continue
        full = titles[s0]
        m = re.match(r"^(.*?)\s*\((.*)\)\s*$", full)
        title, sub = (m.group(1), m.group(2)) if m else (full, "")
        groups, cur, links, notes = [], {"title": "", "rows": []}, {}, {}
        for ri in range(spec["headerRow"], len(rows)):
            r = rows[ri]
            vals = [r[i] if i < len(r) else "" for i in cols]
            if not vals[0]:
                if cur["rows"] or groups: break      # first blank row ends the list
                continue
            if not any(vals[1:]):                    # only a name: a subheading
                groups.append(cur); cur = {"title": vals[0], "rows": []}; continue
            cur["rows"].append(vals)
            if link_at(ri, cols[0]): links[vals[0]] = link_at(ri, cols[0])
            if note_at(ri, cols[0]): notes[vals[0]] = note_at(ri, cols[0])
        groups.append(cur)
        groups = [g for g in groups if g["rows"]]
        slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
        if spec.get("onlyLists") and slug not in spec["onlyLists"]:
            continue                                  # private list: never published
        skipg = set(spec.get("skipGroups", []))
        groups = [g for g in groups if g["title"] not in skipg]
        kept = {r[0] for g in groups for r in g["rows"]}
        lists.append({"slug": slug, "title": title, "subtitle": sub,
                      "columns": [headers[i] for i in cols], "groups": groups,
                      "links": {n: u for n, u in links.items() if n in kept},
                      # Notes on the player-name cells, only for lists approved in "notesLists".
                      **({"notes": {n: t for n, t in notes.items() if n in kept}} if slug in spec.get("notesLists", []) else {})})
    return {"title": rows[0][0] if rows and rows[0] else spec["name"], "lists": lists}


def fmt_cell(c):
    """A cell's value the way Excel shows it, for the common cases: percentages and whole numbers."""
    v = c.value
    if v is None: return ""
    if isinstance(v, (int, float)) and "%" in (c.number_format or ""):
        places = len(c.number_format.split(".")[1].split("%")[0]) if "." in c.number_format else 0
        return f"{v * 100:.{places}f}%"
    if isinstance(v, (int, float)) and "," in (c.number_format or "") and float(v).is_integer(): return f"{int(v):,}"
    return cell_text(v)


def extract_ranges(xlsx_bytes, spec):
    """Small blocks of cells from one tab, e.g. a summary table at K2:L8. Only those cells are published."""
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), data_only=True)
    ws = wb[spec["tab"]]
    out = {}
    for key, ref in spec["ranges"].items():
        rows = [[fmt_cell(c) for c in r] for r in ws[ref]]
        out[key] = [r for r in rows if any(r)]
    return {"tables": out}


def has_tab(xlsx_bytes, tab):
    return tab in openpyxl.load_workbook(io.BytesIO(xlsx_bytes), read_only=True).sheetnames


def main():
    cfg = json.load(open(CONFIG))
    lists = [l for l in cfg["lists"] if not (l.get("fileId") or "").startswith("PASTE_") and l.get("enabled", True)]
    local = sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == "--local" else None
    if not lists:
        print("No private lists configured yet; skipping."); return
    creds = None
    if not local:
        key = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
        if not key:
            print("GOOGLE_SERVICE_ACCOUNT_JSON is not set; skipping private lists."); return
        from google.oauth2 import service_account
        creds = service_account.Credentials.from_service_account_info(
            json.loads(key), scopes=["https://www.googleapis.com/auth/drive.readonly"])
    os.makedirs(OUT_DIR, exist_ok=True)
    cache = {}
    for spec in lists:
        if local:
            data = open(local, "rb").read()
        elif spec.get("fileIds"):
            # Several candidate files: use the first that has the tab. Only its position is logged.
            data = None
            for k, fid in enumerate(spec["fileIds"]):
                if fid not in cache: cache[fid] = download(fid, creds)
                if has_tab(cache[fid], spec["tab"]):
                    data = cache[fid]; print(f'List "{spec["name"]}": using candidate file {k + 1} of {len(spec["fileIds"])}.'); break
            if data is None:
                raise SystemExit(f'List "{spec["name"]}": none of its files has a tab named "{spec["tab"]}".')
        else:
            if spec["fileId"] not in cache: cache[spec["fileId"]] = download(spec["fileId"], creds)
            data = cache[spec["fileId"]]
        if not spec.get("columns") and spec.get("layout") not in ("side-by-side", "ranges"):
            # Access check only: confirm the file opens. Report counts, never names or values.
            wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
            print(f'Access check "{spec["name"]}": opened OK, {len(wb.sheetnames)} tab(s). No columns chosen yet, nothing published.')
            continue
        result = (extract_side_by_side(data, spec) if spec.get("layout") == "side-by-side"
                  else extract_ranges(data, spec) if spec.get("layout") == "ranges" else extract(data, spec))
        path = os.path.join(OUT_DIR, spec["name"] + ".json")
        old = open(path).read() if os.path.exists(path) else None
        new = json.dumps(result, ensure_ascii=False, indent=0)
        if new != old:
            open(path, "w").write(new)
        if "tables" in result:
            print(f'List "{spec["name"]}": {len(result["tables"])} tables, {sum(len(t) for t in result["tables"].values())} rows.')
        elif "lists" in result:
            n = sum(len(g["rows"]) for l in result["lists"] for g in l["groups"])
            print(f'List "{spec["name"]}": {len(result["lists"])} lists, {n} rows.')
        else:
            print(f'List "{spec["name"]}": {len(result["rows"])} rows, {len(result["columns"])} columns.')


if __name__ == "__main__":
    main()

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


def extract_side_by_side(xlsx_bytes, spec):
    """Several lists laid out side by side: list titles on titleRow, column titles on headerRow.
    Each list ends at its first blank row; a row with only a name is a subheading."""
    import re
    from datetime import date
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), read_only=True, data_only=True)
    if spec["tab"] not in wb.sheetnames:
        raise SystemExit(f'List "{spec["name"]}": the master has no tab named "{spec["tab"]}".')
    rows = [[cell_text(v) for v in r] for r in wb[spec["tab"]].iter_rows(values_only=True)]
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
        groups, cur = [], {"title": "", "rows": []}
        for r in rows[spec["headerRow"]:]:
            vals = [r[i] if i < len(r) else "" for i in cols]
            if not vals[0]:
                if cur["rows"] or groups: break      # first blank row ends the list
                continue
            if not any(vals[1:]):                    # only a name: a subheading
                groups.append(cur); cur = {"title": vals[0], "rows": []}; continue
            cur["rows"].append(vals)
        groups.append(cur)
        groups = [g for g in groups if g["rows"]]
        slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
        if spec.get("onlyLists") and slug not in spec["onlyLists"]:
            continue                                  # private list: never published
        skipg = set(spec.get("skipGroups", []))
        groups = [g for g in groups if g["title"] not in skipg]
        lists.append({"slug": slug, "title": title, "subtitle": sub,
                      "columns": [headers[i] for i in cols], "groups": groups})
    return {"title": rows[0][0] if rows and rows[0] else spec["name"], "lists": lists}


def main():
    cfg = json.load(open(CONFIG))
    lists = [l for l in cfg["lists"] if not l["fileId"].startswith("PASTE_") and l.get("enabled", True)]
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
        else:
            if spec["fileId"] not in cache: cache[spec["fileId"]] = download(spec["fileId"], creds)
            data = cache[spec["fileId"]]
        if not spec.get("columns"):
            # Access check only: confirm the file opens. Report counts, never names or values.
            wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
            print(f'Access check "{spec["name"]}": opened OK, {len(wb.sheetnames)} tab(s). No columns chosen yet, nothing published.')
            continue
        result = extract_side_by_side(data, spec) if spec.get("layout") == "side-by-side" else extract(data, spec)
        path = os.path.join(OUT_DIR, spec["name"] + ".json")
        old = open(path).read() if os.path.exists(path) else None
        new = json.dumps(result, ensure_ascii=False, indent=0)
        if new != old:
            open(path, "w").write(new)
        if "lists" in result:
            n = sum(len(g["rows"]) for l in result["lists"] for g in l["groups"])
            print(f'List "{spec["name"]}": {len(result["lists"])} lists, {n} rows.')
        else:
            print(f'List "{spec["name"]}": {len(result["rows"])} rows, {len(result["columns"])} columns.')


if __name__ == "__main__":
    main()

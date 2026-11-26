#!/usr/bin/env python3
"""Nebraska letter years from the University's Letter Winners lists (football, baseball, men's basketball).

  python3 scripts/build_letter_years.py --football F.pdf --baseball B.pdf --basketball M.xlsx
      read the lists once and write data/letter-years.json (only the years, matched to our player names)
  python3 scripts/build_letter_years.py
      merge data/letter-years.json into data/players.json (build_players.py rewrites that file, so run this after it)

A year is a season a player lettered. Players who were on the roster without a letter are not in these lists, so the
timelines still need other sources. Names are matched within the same sport only. Women's basketball is not used yet.
"""
import json, os, re, subprocess, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "letter-years.json")
PLAYERS = os.path.join(ROOT, "data", "players.json")
SPORT_OF = {"football": "football", "baseball": "baseball", "basketball": "basketball"}
ENTRY = re.compile(r"([A-Z][A-Za-z.'’\- ]+?, [A-Za-z.'’\- ]+?)\s*(?:\([^)]*\))?\s*(?:\(([^)]*)\))?\s*\.{0,}\s*([A-Z]{1,4}(?:/[A-Z]{1,4})?)?\s*\.{0,}\s*(\d{4}(?:-\d{2,4})*)(?=\s|$)")

def expand(s):
    """"1913-14-15" -> [1913, 1914, 1915]; "2011-12-13-14" -> 2011..2014."""
    parts = s.split("-"); first = int(parts[0]); out = [first]; prev = first
    for p in parts[1:]:
        v = int(p)
        if len(p) == 2:
            v = (prev // 100) * 100 + v
            if v < prev: v += 100
        out.append(v); prev = v
    return out

def norm(s):
    s = unicodedata.normalize("NFD", s.lower()); s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[.'’\"]", "", s); s = re.sub(r"\s+(jr|sr|ii|iii|iv)$", "", s)
    return re.sub(r"\s+", " ", s).strip()

def fuzzy(name, by_last):
    """The list's entry with the same last name whose first name is a short form, initial or prefix of ours; only if unique."""
    parts = name.split(" "); first, last = parts[0], parts[-1]
    hits = []
    for k, v in by_last.get(last, []):
        kf = k.split(" ")[0]
        if kf == first: continue
        if kf and first and (first.startswith(kf) or kf.startswith(first)) and min(len(first), len(kf)) >= 2 or (kf[:1] == first[:1] and (len(kf) == 1 or len(first) == 1)):
            hits.append(v)
    if len(hits) == 1:
        return hits[0]
    return None

def from_pdf(path):
    txt = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, text=True, check=True).stdout
    txt = txt.replace("�", ".").replace("“", " ")
    rows = []
    for line in txt.splitlines():
        for col in re.split(r"\s{4,}", line.strip()):
            m = ENTRY.search(col) if col.strip() else None
            if not m: continue
            last, first = [x.strip() for x in m.group(1).split(",", 1)]
            rows.append((f"{first} {last}", expand(m.group(4))))
    return rows

def from_xlsx(path):
    import openpyxl
    rows = []
    wb = openpyxl.load_workbook(path, read_only=True)
    for ws in wb.worksheets:
        for i, row in enumerate(ws.iter_rows(values_only=True)):
            if i == 0 or not row or not row[0]: continue
            parts = str(row[0]).split(",")
            if len(parts) < 3: continue
            last, first, yrs = parts[0].strip(), parts[1].strip(), parts[-1].strip()
            if not re.fullmatch(r"\d{4}(?:-\d{2,4})*", yrs): continue
            rows.append((f"{first} {last}", expand(yrs)))
    return rows

def main():
    args = sys.argv[1:]
    players = json.load(open(PLAYERS, encoding="utf-8"))["players"]
    plist = list(players.values()) if isinstance(players, dict) else players
    if any(a.startswith("--") for a in args):
        data = {"sources": {}, "players": {}}
        readers = {"--football": (from_pdf, "football"), "--baseball": (from_pdf, "baseball"), "--basketball": (from_xlsx, "basketball")}
        for i, a in enumerate(args):
            if a not in readers: continue
            fn, sport = readers[a]; path = args[i + 1]
            by = {}
            for name, yrs in fn(path):
                by.setdefault(norm(name), set()).update(yrs)
            data["sources"][sport] = os.path.basename(path)
            # Same last name and a first name that is a short form or initial of the list's ("Stu" / "Stuart", "J." / "Joe").
            by_last = {}
            for k, v in by.items():
                by_last.setdefault(k.split(" ")[-1], []).append((k, v))
            for p in plist:
                if (p.get("sport") or "football") != sport: continue
                yrs = by.get(norm(p["name"]))
                if not yrs:
                    yrs = fuzzy(norm(p["name"]), by_last)
                if yrs: data["players"].setdefault(p["name"], {})[sport] = sorted(yrs)
            print(sport, "matched", sum(1 for v in data["players"].values() if sport in v), "players")
        json.dump(data, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    if not os.path.exists(OUT): return
    letters = json.load(open(OUT, encoding="utf-8"))["players"]
    data = json.load(open(PLAYERS, encoding="utf-8"))
    recs = data["players"].values() if isinstance(data["players"], dict) else data["players"]
    n = 0
    for p in recs:
        if p["name"] in letters:
            p["letters"] = letters[p["name"]]; n += 1
        else:
            p.pop("letters", None)
    json.dump(data, open(PLAYERS, "w", encoding="utf-8"), ensure_ascii=False)
    print("merged letter years into", n, "player records")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Nebraska football letter years from the University's Letter Winners list (2023 PDF).

  python3 scripts/build_letter_years.py --pdf PATH   # read the PDF once, write data/letter-years.json
  python3 scripts/build_letter_years.py              # merge data/letter-years.json into data/players.json

Only the years are kept, matched to our player names (never the list's text). A year is a season he lettered;
players who were on the roster without a letter are not in this list, so the timelines still need other sources.
Players the list can't match by name (nicknames, quoted names) are left alone.
"""
import json, os, re, subprocess, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "letter-years.json")
PLAYERS = os.path.join(ROOT, "data", "players.json")
ENTRY = re.compile(r"([A-Z][A-Za-z.'’\- ]+?, [A-Za-z.'’\- ()]+?)\s*(?:\(([^)]*)\))?\s*\.{0,}\s*([A-Z]{1,4}(?:/[A-Z]{1,4})?)?\s*\.{0,}\s*(\d{4}(?:-\d{2,4})*)(?=\s|$)")

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

def parse_pdf(path):
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

def main():
    if "--pdf" in sys.argv:
        pdf = sys.argv[sys.argv.index("--pdf") + 1]
        players = json.load(open(PLAYERS, encoding="utf-8"))["players"]
        by = {}
        for name, years in parse_pdf(pdf):
            by.setdefault(norm(name), set()).update(years)
        matched = {}
        for p in (players.values() if isinstance(players, dict) else players):
            yrs = by.get(norm(p["name"]))
            if yrs: matched[p["name"]] = sorted(yrs)
        json.dump({"source": "University of Nebraska Football Letter Winners (2023 PDF)", "players": matched},
                  open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("matched", len(matched), "players")
    # Merge into players.json (build_players.py rewrites that file, so this runs after it).
    if not os.path.exists(OUT): return
    letters = json.load(open(OUT, encoding="utf-8"))["players"]
    data = json.load(open(PLAYERS, encoding="utf-8"))
    n = 0
    for p in data["players"].values() if isinstance(data["players"], dict) else data["players"]:
        if p["name"] in letters: p["letters"] = letters[p["name"]]; n += 1
    json.dump(data, open(PLAYERS, "w", encoding="utf-8"), ensure_ascii=False)
    print("merged letter years into", n, "player records")

if __name__ == "__main__":
    main()

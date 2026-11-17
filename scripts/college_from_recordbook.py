#!/usr/bin/env python3
"""Add the seasons a Husker led Nebraska in a stat, from the "Nebraska Annual Statistical Leaders" pages of
the Nebraska Football Record Book (huskers.com, History & Records). Only fills players with no other
college stats; each season shown is one where he was the team leader.

  python3 scripts/college_from_recordbook.py recordbook.pdf            # NFL Tier 2 and Tier 3 players
  python3 scripts/college_from_recordbook.py recordbook.pdf --dry-run  # show matches only
(needs pdftotext; the record book is the "Nebraska Football Record Book" PDF on huskers.com's History & Records page)
"""
import json, os, re, sys

sys.path.insert(0, os.path.dirname(__file__))
from build_players import OUT, norm  # noqa: E402

# Record book table -> (site stat category, the table's columns after Year/Leader mapped to site stat names)
TABLES = {
    "rushing yards": ("rushing", ["CAR", "YDS", "YPC", "TD"]),
    "passing yards": ("passing", ["ATT", "COMPLETIONS", "INT", "YDS", "TD"]),
    "pass receptions": ("receiving", ["REC", "YDS", "YPR", "TD"]),
    "interceptions": ("interceptions", ["INT", "YDS", "AVG", "TD"]),
    "kickoff return yards": ("kickReturns", ["NO", "YDS", "AVG", "TD"]),
    "punt return yards": ("puntReturns", ["NO", "YDS", "AVG", "TD"]),
    "punting": ("punting", ["NO", "YDS", "YPP"]),
    "points scored": ("scoring", ["TD", "XP1", "XP2", "FG", "TP"]),
    "pass breakups": ("defensive", ["PD"]),
    "total tackles": ("defensive", ["TOT"]),
}
NUM = re.compile(r"^-?[\d,]+(?:\.\d+)?$|^\d+-\d+$")
ENTRY = re.compile(r"([A-Z][A-Za-z.’'\-]+(?: [A-Z][A-Za-z.’'\-]+){1,3}), ([A-Z]{1,3}(?:/[A-Z]{1,3})?)\*?(?: \(\d+\))?")


TITLES = ["Rushing Yards", "Passing Yards", "Total Offense Yards", "Pass Receptions", "Interceptions", "Kickoff Return Yards",
          "Punt Return Yards", "Punting", "Points Scored", "Tackles for Loss", "Sacks", "Pass Breakups", "Fumble Recoveries",
          "Total Tackles", "Tackles"]


def page_columns(pdf):
    """The leader pages' text, each page split into its left and right columns, in reading order."""
    import subprocess
    out = []
    for p in range(1, 200):
        try:
            full = subprocess.run(["pdftotext", "-f", str(p), "-l", str(p), "-layout", pdf, "-"], capture_output=True, text=True, check=True).stdout
        except subprocess.CalledProcessError:
            break
        if not any(t in full for t in ("Annual Statistical Leaders", "Pass Receptions", "Kickoff Return Yards", "Points Scored", "Tackles for Loss", "Pass Breakups")):
            if out: break                     # past the section
            continue
        if not out and "Annual Statistical Leaders" not in full: continue
        for x in (0, 198):
            out += subprocess.run(["pdftotext", "-f", str(p), "-l", str(p), "-layout", "-x", str(x), "-y", "0", "-W", "198", "-H", "612", pdf, "-"],
                                  capture_output=True, text=True, check=True).stdout.split("\n")
    return out


def ok(key, v):
    """A row's numbers make sense for its table (catches a row picked up from a neighboring table)."""
    f = lambda x: float(x.replace(",", "")) if re.fullmatch(r"-?[\d,]+(\.\d+)?", x) else None
    if key in ("rushing yards", "pass receptions", "interceptions", "kickoff return yards", "punt return yards"):
        n, y, a = f(v[0]), f(v[1]), f(v[2])
        return n is not None and y is not None and a is not None and (n == 0 or abs(y / n - a) < 0.11)
    if key == "passing yards":
        return f(v[1]) is not None and f(v[0]) is not None and f(v[1]) <= f(v[0])
    if key == "points scored":
        return f(v[0]) is not None and f(v[4]) is not None and f(v[4]) >= 6 * f(v[0])
    return True


def parse(pdf):
    rows, key, year = [], None, None
    for raw in page_columns(pdf):
        l = raw.expandtabs(8).strip()
        if not l: continue
        t = next((t for t in TITLES if l.startswith(t)), None)
        if t: key, year = t.lower(), None; continue
        if key not in TABLES: continue
        if key == "pass breakups":            # "1967  6  Dana Stephenson, RCB" (number first)
            m = re.match(r"^(?:\*?\s*(19[4-9]\d|20[0-2]\d)\*?\s+)?(\d{1,2})\s+" + ENTRY.pattern, l)
            if m:
                if m.group(1): year = int(m.group(1))
                if year: rows.append({"name": m.group(3), "pos": m.group(4), "year": year, "table": key, "stats": {"PD": m.group(2)}})
            continue
        m = re.match(r"^(?:(19[4-9]\d|20[0-2]\d)\s+)?" + ENTRY.pattern, l)
        if not m and key == "passing yards":   # the passing table lists names without a position
            m = re.match(r"^(?:(19[4-9]\d|20[0-2]\d)\s+)?([A-Z][A-Za-z.’'\-]+(?: [A-Z][A-Za-z.’'\-]+){1,3})()(?: \(\d+\))?(?=\s+\d)", l)
        if not m: continue
        if m.group(1): year = int(m.group(1))
        if not year: continue
        cols = TABLES[key][1]
        vals = []
        for tok in l[m.end():].split():
            if not NUM.match(tok): break
            vals.append(tok)
        if len(vals) < len(cols) or not ok(key, vals): continue
        rows.append({"name": m.group(2), "pos": m.group(3), "year": year, "table": key, "stats": dict(zip(cols, vals[:len(cols)]))})
    return rows


def tackles(pdf):
    """ "Total Tackles (By Position)": each season's tackle leader among linemen, linebackers/ends and backs."""
    import subprocess
    rows = []
    for p in range(1, 200):
        try:
            t = subprocess.run(["pdftotext", "-f", str(p), "-l", str(p), "-layout", pdf, "-"], capture_output=True, text=True, check=True).stdout
        except subprocess.CalledProcessError:
            break
        if "Total Tackles (By Position)" not in t: continue
        year = None
        for l in t.split("\n"):
            m = re.match(r"^\s*(19[4-9]\d|20[0-2]\d)\b(.*)$", l)
            rest = m.group(2) if m else l
            if m: year = int(m.group(1))
            if not year: continue
            for n, name, pos in re.findall(r"(\d{1,3})\s+([A-Z][A-Za-z.’'\-]+(?: [A-Za-z][A-Za-z.’'\-]+){1,3}), ([A-Z]{1,4}(?:/[A-Z]{1,4})?)", rest):
                rows.append({"name": name, "pos": pos, "year": year, "table": "total tackles", "stats": {"TOT": n}})
        break
    return rows


def main():
    rows = parse(sys.argv[1]) + tackles(sys.argv[1])
    data = json.load(open(OUT))
    lists = ("nfl-tier-2-huskers", "pro-football-huskers")
    added = []
    for p in data["players"]:
        if p.get("list") not in lists or p.get("collegeTables"): continue
        if p.get("college") and p.get("collegeSource") != "recordbook": continue
        fy = p.get("finalYear")
        if not fy: continue
        me = norm(re.sub(r'"[^"]*"', " ", p["name"]))
        mine = [r for r in rows if norm(r["name"]) == me and fy - 4 <= r["year"] <= fy]
        if not mine: continue
        col = {}
        for r in sorted(mine, key=lambda r: r["year"]):
            cat = TABLES[r["table"]][0]
            col.setdefault(str(r["year"]), {}).setdefault(cat, {}).update({k: v.replace(",", "") for k, v in r["stats"].items()})
        added.append((p["name"], col))
        if "--dry-run" not in sys.argv:
            p["college"] = col; p["collegeSource"] = "recordbook"
    for n, c in added: print(n, json.dumps(c))
    if "--dry-run" not in sys.argv:
        json.dump(data, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"{len(rows)} leader rows read; {len(added)} players filled.")


if __name__ == "__main__":
    main()

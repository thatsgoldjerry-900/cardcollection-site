#!/usr/bin/env python3
"""Chase pages (config/site.json "chases", e.g. Nebraska Cracked Ice): the TCDb collection and want list cards for each
chase, so the site can show progress. Writes data/chases.json; the site adds the scans and drops TCDb cards it has a
scan of. Runs after scripts/build_catalog.py (GitHub Action). Names and TCDb links only, like data/rainbow-wants.json.
"""
import glob, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ONE = re.compile(r"\bSN1\b|\b1\s*/\s*1\b|\b1 of 1\b|\bone of one\b", re.I)


def main():
    site = json.load(open(os.path.join(ROOT, "config", "site.json")))
    chases = [c for c in site.get("chases", []) if c.get("match")]
    rows = {"collection": [], "wantlist": []}
    for kind in rows:
        for f in sorted(glob.glob(os.path.join(ROOT, "data", "tcdb", f"*-{kind}.json"))):
            rows[kind] += json.load(open(f))["cards"]
    mine = {r[1] for r in rows["collection"] if r[1]}
    out = {"_help": "TCDb collection (have) and want list (need) cards for each chase page in config/site.json \"chases\" "
                    "(scripts/build_chases.py). 1/1s are never listed as needed.", "chases": {}}
    for ch in chases:
        rx = re.compile(ch["match"], re.I)
        have = [r for r in rows["collection"] if rx.search(r[0])]
        need = [r for r in rows["wantlist"] if rx.search(r[0]) and r[1] not in mine and not ONE.search(r[0])]
        out["chases"][ch["slug"]] = {"have": have, "need": need}
        print(f"{ch['slug']}: {len(have)} in the TCDb collection, {len(need)} on the want list")
    with open(os.path.join(ROOT, "data", "chases.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()

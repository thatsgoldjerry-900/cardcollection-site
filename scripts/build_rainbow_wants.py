"""Pick the TCDb want list and collection cards that could join a rainbow I have scans of: data/rainbow-wants.json.

Runs after scripts/build_catalog.py (GitHub Action). Reads every data/tcdb/*-wantlist.json (made by
scripts/tcdb_wantlist.py from a TCDb export) and keeps a card when an owned scan shares its year, card number and player.
The site then does the exact rainbow match (same set and insert, autograph/relic kind) and shows each one as a
"Need it" placeholder on that rainbow page only (collection cards without a scan: "Have it"). A version I have a
scan of drops off by itself.
"""
import glob, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ONE = re.compile(r"\bSN1\b|\b1\s*/\s*1\b|\b1 of 1\b|\bone of one\b", re.I)
MAIN = re.compile(r"^(\d{4})(?:-\d{2})?\s.*?#(\S+)\s+(.*)$")


def key(name):
    m = MAIN.match(name)
    if not m: return None
    words = re.findall(r"[a-z0-9]+", re.sub(r"\([^)]*\)", " ", m[3]).lower().replace("'", ""))
    return (m[1], m[2].lower(), " ".join(words[:2]))


def main():
    cat = json.load(open(os.path.join(ROOT, "data", "catalog.json")))
    want = {i for i, s in enumerate(cat["sections"]) if s.get("kind") == "want"}
    have = {key(c[2]) for c in cat["cards"] if c[3] not in want} - {None}
    keep, owned, mine = [], [], set()
    # TCDb collection: cards I have. Ones without a scan show as "Have it" on their rainbow page (a scan replaces them).
    for f in sorted(glob.glob(os.path.join(ROOT, "data", "tcdb", "*-collection.json"))):
        rows = json.load(open(f))["cards"]
        mine |= {r[1] for r in rows if r[1]}
        owned += [r for r in rows if key(r[0]) in have]
    for f in sorted(glob.glob(os.path.join(ROOT, "data", "tcdb", "*-wantlist.json"))):
        # A card I have is never wanted (TCDb's want list export can include the whole collection, matched by TCDb card ID).
        # 1/1s are left out: Ian doesn't chase them (the site skips them too).
        keep += [r for r in json.load(open(f))["cards"] if r[1] not in mine and key(r[0]) in have and not ONE.search(r[0])]
    out = os.path.join(ROOT, "data", "rainbow-wants.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"_help": "TCDb want list (cards) and collection (have) cards that may belong to a rainbow I have scans of "
                   "(scripts/build_rainbow_wants.py).", "cards": keep, "have": owned}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(keep):,} want list cards and {len(owned):,} collection cards may join a rainbow")


if __name__ == "__main__":
    main()

"""Turn a TCDb want list export (CSV) into data/tcdb/<name>.json: card names and TCDb links only.

    python3 scripts/tcdb_wantlist.py TCDB_Football_Wantlist-2026-11-21.csv football

Only the card name and TCDb's set/card IDs are kept (no notes, grades or prices). Run it again with a fresh export
to replace the list. The site never loads these files directly: scripts/build_rainbow_wants.py picks out the cards
that belong to a rainbow I have, after each Drive update.
"""
import csv, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main(src, name):
    rows, seen = [], set()
    with open(src, encoding="utf-8-sig", errors="replace", newline="") as f:
        for r in csv.DictReader(f):
            card = re.sub(r"\s+", " ", (r.get("Card") or "")).strip()
            sid, cid = (r.get("SetID") or "").strip(), (r.get("CardID") or "").strip()
            if not card or (card, cid) in seen: continue
            seen.add((card, cid))
            rows.append([card, f"{sid}/{cid}" if sid and cid else ""])
    os.makedirs(os.path.join(ROOT, "data", "tcdb"), exist_ok=True)
    out = os.path.join(ROOT, "data", "tcdb", f"{name}-wantlist.json")
    with open(out, "w", encoding="utf-8") as f:
        f.write('{"_help":"TCDb want list: [card name, TCDb setID/cardID]. Made by scripts/tcdb_wantlist.py.","cards":[\n')
        f.write(",\n".join(json.dumps(r, ensure_ascii=False) for r in rows))
        f.write("\n]}\n")
    print(f"{len(rows):,} cards -> {os.path.relpath(out, ROOT)}")


if __name__ == "__main__":
    if len(sys.argv) != 3: sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])

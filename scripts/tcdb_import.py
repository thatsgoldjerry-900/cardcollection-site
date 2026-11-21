"""Turn a TCDb export (CSV) into data/tcdb/<sport>-<kind>.json: card names and TCDb links only.

    python3 scripts/tcdb_import.py TCDB_Football_Wantlist-2026-11-21.csv football wantlist
    python3 scripts/tcdb_import.py TCDB_Football_2026-11-21.csv football collection

kind: "wantlist" (cards I still need) or "collection" (cards I have, scanned or not).
Only the card name and TCDb's set/card IDs are kept (no notes, grades or prices). Names keep Ian's own codes (AU, MEM,
MANU, SN25, PR25, SP, SSP, 1 of 1, VAR notes) and name suffixes (Jr., II, III); TCDb's other tags at the end of a name
(RC, ROO, CO, DPOY, SR, UER, CL, LGD, ...) are dropped, so names read like Ian's file names. Run it again with a fresh
export to replace a list. The site never loads these files directly: scripts/build_rainbow_wants.py picks out the cards
that belong to a rainbow I have, after each Drive update.
"""
import csv, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEEP = re.compile(r"^(AU|MEM|MANU|SP|SSP|SN\d+|PR\d+|SN\d+_of_\d+|1_of_1|[IVXL]+|Jr\.?|Sr\.?)$")
TAG = re.compile(r"^[A-Z0-9]{2,7}$")


def clean(name):
    """Drop TCDb's extra tags from the end of a name, keeping Ian's codes and name suffixes."""
    name = re.sub(r"\s+", " ", name).strip()
    name = re.sub(r"\b(SN\d+) of (\d+)\b", r"\1_of_\2", name).replace("1 of 1", "1_of_1")   # keep these as one word
    var = re.search(r",?\s+VAR(?:VAR)?:.*$", name)            # "VAR: green border" notes stay as they are
    tail = var[0].lstrip(",") if var else ""
    head = name[:var.start()] if var else name
    if "#" not in head: return name
    pre, rest = head.split("#", 1)
    num, _, rest = rest.partition(" ")
    words = re.split(r"(\s+|,)", rest)
    toks = [w for w in words if w.strip() and w != ","]
    # Walk back over the trailing tag run (all-caps codes, separated by spaces or commas).
    keep, k = [], len(toks)
    while k > 1 and (TAG.match(toks[k - 1]) or KEEP.match(toks[k - 1]) or re.match(r"^SN\d+(_of_\d+)?$|^PR\d+$", toks[k - 1])):
        k -= 1
    body, tags = toks[:k], [t for t in toks[k:] if KEEP.match(t)]
    # Name suffixes (II, III, Jr.) belong to the name; Ian's codes go after it, comma-separated like his file names.
    suffix = [t for t in tags if re.match(r"^([IVXL]+|Jr\.?|Sr\.?)$", t)]
    codes = [t for t in tags if t not in suffix]
    out = f"{pre}#{num} " + " ".join(body + suffix) + (" " + ", ".join(codes) if codes else "")
    if var: out += " " + tail.strip()
    return re.sub(r"\s+", " ", out).strip().replace("_of_", " of ")


def main(src, sport, kind):
    rows, seen = [], set()
    with open(src, encoding="utf-8-sig", errors="replace", newline="") as f:
        for r in csv.DictReader(f):
            card = clean(r.get("Card") or "")
            sid, cid = (r.get("SetID") or "").strip(), (r.get("CardID") or "").strip()
            if not card or (card, cid) in seen: continue
            seen.add((card, cid))
            rows.append([card, f"{sid}/{cid}" if sid and cid else ""])
    os.makedirs(os.path.join(ROOT, "data", "tcdb"), exist_ok=True)
    out = os.path.join(ROOT, "data", "tcdb", f"{sport}-{kind}.json")
    with open(out, "w", encoding="utf-8") as f:
        f.write('{"_help":"TCDb ' + kind + ': [card name, TCDb setID/cardID]. Made by scripts/tcdb_import.py.","cards":[\n')
        f.write(",\n".join(json.dumps(r, ensure_ascii=False) for r in rows))
        f.write("\n]}\n")
    print(f"{len(rows):,} cards -> {os.path.relpath(out, ROOT)}")


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[3] not in ("wantlist", "collection"): sys.exit(__doc__)
    main(*sys.argv[1:])

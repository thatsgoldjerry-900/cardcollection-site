#!/usr/bin/env python3
"""Chase pages (config/site.json "chases", e.g. Nebraska Cracked Ice): the TCDb collection and want list cards for each
chase, so the site can show progress. Writes data/chases.json; the site adds the scans and drops TCDb cards it has a
scan of. Runs after scripts/build_catalog.py (GitHub Action). Names and TCDb links only, like data/rainbow-wants.json.
"""
import glob, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ONE = re.compile(r"\bSN1\b|\b1\s*/\s*1\b|\b1 of 1\b|\bone of one\b", re.I)


def who(name):
    """The player's first two words, after the card number ("... #141 Wan'Dale Robinson AU, SN22" -> "wandale robinson")."""
    m = re.search(r"#\S+\s+(.*)$", re.sub(r"\s+VAR(?:VAR)?:.*$", "", name))
    if not m: return None
    w = re.findall(r"[a-z0-9]+", re.sub(r"\([^)]*\)", " ", m[1]).lower().replace("'", "").replace("’", ""))
    return " ".join(w[:2]) or None


def main():
    site = json.load(open(os.path.join(ROOT, "config", "site.json")))
    chases = [c for c in site.get("chases", []) if c.get("match")]
    names = site.get("tcdbNames", {})   # TCDb entries with identical names that are different cards, renamed by card ID
    rows = {"collection": [], "wantlist": []}
    for kind in rows:
        for f in sorted(glob.glob(os.path.join(ROOT, "data", "tcdb", f"*-{kind}.json"))):
            sport = os.path.basename(f).rsplit("-", 1)[0]          # football, baseball, multi-sport, misc-sports...
            rows[kind] += [[names.get(r[1], r[0]), r[1], sport] for r in json.load(open(f))["cards"]]
    mine = {r[1] for r in rows["collection"] if r[1]}
    # Huskers only: a TCDb card counts when I have scans of that player in the Nebraska collections or Alex Gordon's
    # (TCDb's baseball list also holds the Royals, e.g. Mike Moustakas). Players match on the first two words of the name.
    cat = json.load(open(os.path.join(ROOT, "data", "catalog.json")))
    husk = {i for i, s in enumerate(cat["sections"]) if s["slug"].startswith("husker-")}
    huskers = ({who(c[2]) for c in cat["cards"] if c[3] in husk} | {"alex gordon"}) - {None}
    # Each Husker's sport, for the page's sport filter: from the Nebraska collection his scans are in, else my lists.
    sport_of = {who(c[2]): cat["sections"][c[3]]["slug"][7:] for c in cat["cards"] if c[3] in husk}
    sport_of["alex gordon"] = "baseball"
    # Plus every Husker on my lists (data/players.json), so one I have no scan of yet (Wan'Dale Robinson) still counts.
    pl = json.load(open(os.path.join(ROOT, "data", "players.json")))
    huskers |= {who("#0 " + p["name"]) for p in pl.get("players", [])} - {None}
    for p in pl.get("players", []): sport_of.setdefault(who("#0 " + p["name"]), p.get("sport") or "football")
    # TCDb's football/baseball/basketball lists name the sport; multi-sport and misc lists go by the player.
    sport = lambda r: r[2] if r[2] in ("football", "baseball", "basketball") else sport_of.get(who(r[0]), "other")
    out = {"_help": "TCDb collection (have) and want list (need) cards for each chase page in config/site.json \"chases\" "
                    "(scripts/build_chases.py). 1/1s are never listed as needed.", "chases": {}}
    for ch in chases:
        rx, ex = re.compile(ch["match"], re.I), re.compile(ch["exclude"], re.I) if ch.get("exclude") else None
        ok = lambda r: rx.search(r[0]) and not (ex and ex.search(r[0])) and who(r[0]) in huskers
        have = [[r[0], r[1], sport(r)] for r in rows["collection"] if ok(r)]
        need = [[r[0], r[1], sport(r)] for r in rows["wantlist"] if ok(r) and r[1] not in mine and not ONE.search(r[0])]
        out["chases"][ch["slug"]] = {"have": have, "need": need}
        print(f"{ch['slug']}: {len(have)} in the TCDb collection, {len(need)} on the want list")
    with open(os.path.join(ROOT, "data", "chases.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()

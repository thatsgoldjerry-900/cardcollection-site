#!/usr/bin/env python3
"""Shareable collection links with their own link previews: c/<slug>/index.html for every collection (and customs).
Link-preview readers (texts, Facebook, Instagram, X) don't run the site's script, so each of these small pages carries
its own title, description and picture (assets/previews/<slug>.jpg, made by scripts/make_preview_images.py), then
sends people on to the collection on the site (#/c/<slug>). Built by the GitHub Action; c/ is not kept in the repo."""
import html, json, os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cat = json.load(open(os.path.join(ROOT, "data", "catalog.json")))
base = (cat["site"].get("siteUrl") or "").rstrip("/") + "/"
e = lambda s: html.escape(str(s), quote=True)
def page(slug, title, desc, target, count):
    img = f"assets/previews/{slug}.jpg"
    img = base + img if os.path.exists(os.path.join(ROOT, img)) else base + "assets/preview.jpg"
    full = f"{title} · IanBadeer.com"
    d = f"{desc} {count:,} high-resolution scans.".strip()
    out = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(full)}</title>
<meta name="description" content="{e(d)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="IanBadeer.com">
<meta property="og:title" content="{e(full)}"><meta property="og:description" content="{e(d)}">
<meta property="og:url" content="{e(base + 'c/' + slug + '/')}">
<meta property="og:image" content="{e(img)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="{e(base + target)}">
<meta http-equiv="refresh" content="0; url=../../{e(target)}">
<script>location.replace("../../{target}" + location.search)</script>
<style>body{{background:#0a0c12;color:#e8eaf0;font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}}a{{color:#7aaaff}}</style>
</head><body><p>Opening <a href="../../{e(target)}">{e(title)}</a>…</p></body></html>
"""
    d_ = os.path.join(ROOT, "c", slug); os.makedirs(d_, exist_ok=True)
    open(os.path.join(d_, "index.html"), "w", encoding="utf-8").write(out)
first = lambda t: re.split(r"(?<=[.!?])\s", (t or "").strip())[0] if t else ""
n = 0
for i, s in enumerate(cat["sections"]):
    count = sum(1 for x in cat["cards"] if x[3] == i)
    if not count: continue
    page(s["slug"], s["title"], first(s.get("blurb")), f"#/c/{s['slug']}", count); n += 1
customs = sum(1 for x in cat["cards"] if re.search(r"\bcustom\b", x[2], re.I))
page("customs", "Custom Cards", "Custom cards are a labor of love, made by hand.", "#/customs", customs); n += 1
print(f"{n} share pages in c/")

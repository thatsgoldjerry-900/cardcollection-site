// Renders every player page in a browser and records what each one shows, for the completeness tracker.
// Usage: serve the repo (python3 -m http.server 8765), then: NODE_PATH=$(npm root -g) node scripts/scrape_tracker.js
// Writes data/tracker-pages.json; scripts/build_tracker.py turns it into data/tracker.json.
const { chromium } = require("playwright"), fs = require("fs");
const players = JSON.parse(fs.readFileSync("data/players.json")).players.filter((p) => !process.env.SLUGS || process.env.SLUGS.split(",").includes(p.slug));   // SLUGS=a,b redoes only those players (with SITE_ONLY unset, and existing data kept)
const BASE = process.env.BASE || "http://localhost:8765/", N = +(process.env.WORKERS || 3);
const SITE_ONLY = !!process.env.SITE_ONLY, out = SITE_ONLY || process.env.SLUGS ? JSON.parse(fs.readFileSync("data/tracker-pages.json")) : {};   // SITE_ONLY=1 redoes only the site pages and live numbers
async function grab(pg, p) {
  await pg.goto(BASE + "#/player/" + p.slug, { waitUntil: "domcontentloaded" });
  await pg.waitForFunction(() => [...document.querySelectorAll("h2")].some((h) => /see something wrong/i.test(h.innerText)), null, { timeout: 12000 }).catch(() => {});
  await pg.waitForTimeout(250);
  const r = await pg.evaluate(() => {
    const h2 = [...document.querySelectorAll("h2")].map((h) => h.innerText.trim());
    const bars = (c) => [...document.querySelectorAll(".tl-bar." + c)].map((e) => ({ t: e.title.replace(/\s*\(year .*|\s*\(from my.*/, ""), logo: !!e.querySelector("img"), soft: e.classList.contains("soft") }));
    const fact = (k) => { const el = [...document.querySelectorAll("dt,.fact-k,.pf-k,b,th,td")].find((e) => e.innerText.trim().toLowerCase() === k.toLowerCase()); const n = el && (el.nextElementSibling || el.parentElement.nextElementSibling); return n ? n.innerText.trim() : ""; };
    return { h2, tl: h2.some((h) => /career timeline/i.test(h)), c: bars("c"), p: bars("p"), neb: !!document.querySelector(".tl-bar.neb"), undated: !!document.querySelector(".tl-undated"),
      position: fact("Position"), games: fact("NFL games"), text: (document.querySelector("main,#app,body") || document.body).innerText.length };
  });
  r.wide = await phoneOverflow(pg);
  return r;
}
// Phone width (390px): how many pixels the page is wider than the screen, and the widest element that causes it.
async function phoneOverflow(pg) {
  const vp = pg.viewportSize(); await pg.setViewportSize({ width: 390, height: 800 }); await pg.waitForTimeout(150);
  const o = await pg.evaluate(() => { const w = document.documentElement.scrollWidth - innerWidth; if (w <= 1) return null;
    const el = [...document.querySelectorAll("#app *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];
    return { px: w, el: el ? el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/)[0] : "") : "" }; });
  await pg.setViewportSize(vp); return o;
}
const ROUTES = ["", "cards", "stats", "stats/players", "letters", "nfl-huskers", "nfl-teams", "about", "media", "rarest", "all", "customs", "recent", "dye-career", "tracker"];
(async () => {
  const b = await chromium.launch({ args: ["--no-sandbox"] }); let i = 0;
  await Promise.all(Array.from({ length: N }, async () => {
    const pg = await b.newPage({ viewport: { width: 1300, height: 900 } });
    // Skip image downloads (fast, light) and keep logos whose file fails to load: a logo counts when the page asks for one.
    await pg.route("**/*", (r) => (r.request().resourceType() === "image" ? r.abort() : r.continue()));
    await pg.addInitScript(() => { const rm = Element.prototype.remove; Element.prototype.remove = function () { if (this.tagName !== "IMG") rm.call(this); }; });
    while (!SITE_ONLY && i < players.length) { const p = players[i++]; try { out[p.slug] = await grab(pg, p); } catch (e) { out[p.slug] = { error: String(e).slice(0, 80) }; } if (i % 50 === 0) console.log(i); }
  }));
  if (process.env.SLUGS) { fs.writeFileSync("data/tracker-pages.json", JSON.stringify(out)); await b.close(); return; }
  // Site pages (not players) at phone width, and the live numbers the tracker page computes (rainbows, Hall of Fame, TCDb, signatures).
  const pg = await b.newPage({ viewport: { width: 1300, height: 900 } }); await pg.route("**/*", (r) => (r.request().resourceType() === "image" ? r.abort() : r.continue()));
  out._pages = {};
  for (const rt of ROUTES) { await pg.goto(BASE + "#/" + rt, { waitUntil: "domcontentloaded" }); await pg.waitForTimeout(rt === "tracker" ? 4000 : 1800); out._pages[rt || "home"] = await phoneOverflow(pg); }
  const pl = await b.newPage({ viewport: { width: 1300, height: 900 } }); await pl.route("**/*", (r) => (r.request().resourceType() === "image" ? r.abort() : r.continue()));
  await pl.goto(BASE + "#/tracker"); await pl.waitForFunction(() => window.TRK_LIVE && window.TRK_LIVE.hof && window.TRK_LIVE.tcdb, null, { timeout: 90000 }).catch(() => {}); out._live = await pl.evaluate(() => window.TRK_LIVE || null);
  fs.writeFileSync("data/tracker-pages.json", JSON.stringify(out)); await b.close();
})();

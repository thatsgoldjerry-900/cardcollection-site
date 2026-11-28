// Renders every player page in a browser and records what each one shows, for the completeness tracker.
// Usage: serve the repo (python3 -m http.server 8765), then: NODE_PATH=$(npm root -g) node scripts/scrape_tracker.js
// Writes data/tracker-pages.json; scripts/build_tracker.py turns it into data/tracker.json.
const { chromium } = require("playwright"), fs = require("fs");
const players = JSON.parse(fs.readFileSync("data/players.json")).players;
const BASE = process.env.BASE || "http://localhost:8765/", N = +(process.env.WORKERS || 3);
const out = {};
async function grab(pg, p) {
  await pg.goto(BASE + "#/player/" + p.slug, { waitUntil: "domcontentloaded" });
  await pg.waitForFunction(() => [...document.querySelectorAll("h2")].some((h) => /see something wrong/i.test(h.innerText)), null, { timeout: 12000 }).catch(() => {});
  await pg.waitForTimeout(250);
  return pg.evaluate(() => {
    const h2 = [...document.querySelectorAll("h2")].map((h) => h.innerText.trim());
    const bars = (c) => [...document.querySelectorAll(".tl-bar." + c)].map((e) => ({ t: e.title.replace(/\s*\(year .*|\s*\(from my.*/, ""), logo: !!e.querySelector("img"), soft: e.classList.contains("soft") }));
    const fact = (k) => { const el = [...document.querySelectorAll("dt,.fact-k,.pf-k,b,th,td")].find((e) => e.innerText.trim().toLowerCase() === k.toLowerCase()); const n = el && (el.nextElementSibling || el.parentElement.nextElementSibling); return n ? n.innerText.trim() : ""; };
    return { h2, tl: h2.some((h) => /career timeline/i.test(h)), c: bars("c"), p: bars("p"), neb: !!document.querySelector(".tl-bar.neb"), undated: !!document.querySelector(".tl-undated"),
      position: fact("Position"), games: fact("NFL games"), text: (document.querySelector("main,#app,body") || document.body).innerText.length };
  });
}
(async () => {
  const b = await chromium.launch({ args: ["--no-sandbox"] }); let i = 0;
  await Promise.all(Array.from({ length: N }, async () => {
    const pg = await b.newPage({ viewport: { width: 1300, height: 900 } });
    // Skip image downloads (fast, light) and keep logos whose file fails to load: a logo counts when the page asks for one.
    await pg.route("**/*", (r) => (r.request().resourceType() === "image" ? r.abort() : r.continue()));
    await pg.addInitScript(() => { const rm = Element.prototype.remove; Element.prototype.remove = function () { if (this.tagName !== "IMG") rm.call(this); }; });
    while (i < players.length) { const p = players[i++]; try { out[p.slug] = await grab(pg, p); } catch (e) { out[p.slug] = { error: String(e).slice(0, 80) }; } if (i % 50 === 0) console.log(i); }
  }));
  fs.writeFileSync("data/tracker-pages.json", JSON.stringify(out)); await b.close();
})();

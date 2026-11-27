/* IanBadeer.com — reads data/catalog.json (built from the Google Drive folders) and renders the gallery. */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const NUMFMT = new Intl.NumberFormat("en-US"), fmt = (n) => NUMFMT.format(n);   // one formatter, reused (toLocaleString rebuilds it every call)

  // Image URLs straight from Google Drive. A page can override this (used by the offline preview).
  const img = window.IMG_SRC || ((id, rk, w) => `https://lh3.googleusercontent.com/d/${id}=w${w}${rk ? `?resourcekey=${rk}` : ""}`);

  let DATA, CARDS, SECTIONS, NEW_CUTOFF;
  let PHOTOS = [], INV = {}, REFS = [];

  /* ---------- File-name parsing ---------- */
  const RX = {
    main: /^(\d{4}(?:-\d{2})?)\s+(.*?)\s+#(\S+)\s+(.*)$/,
    // Serial-numbered cards. A print run ("Print Run of 99", PR99) is read separately (printRun) and counts the same.
    serial: /#'?d\s*(?:to\s*)?(\d+)\s*(?:of\s*(\d+))?|\b(\d+)\s+of\s+(\d+)\b/i,
    grade: /\b(PSA|BGS|SGC|CGC|BVG|HGA)\b(?:\s+(?:DNA|GEM MT|GEM MINT|MINT|NM-MT|AUTH(?:ENTIC)?))*(?:\s+(\d+(?:\.\d)?))?/i,
    auto: /\b(auto(?:graph)?s?|autographed|signed|signatures?|sigs?|ink)\b/i,
    relic: /\b(fabrics?|ball hoggs|souvenirs|leather and laces|piece of action|threads|swatch(?:es)?|towels?|laces|socks?|cleats?|relics?|patch(?:es)?|jerseys?|bat|materials?|buttons?|nameplates?|dirt|game[- ]used|glove|logoman|laundry|tag|letter|memorabilia|rpm|footballs)\b/i,
    custom: /\bcustom\b/i,
    rc: /\b(RC|rookie)\b/i,
  };
  /* Ian's tag codes at the end of a file name (from Nov 2026): AU autograph, MEM game-used memorabilia, MANU
     manufactured patch, SN25 / SN43 of 50 serial-numbered, PR25 print run, RC rookie, SP/SSP short print.
     When a name has them they're the authority (more accurate than guessing from words like "Signatures"),
     and they're left out of the card's caption. They're read only after the card number, so brands like
     "SP Authentic" never count. */
  const CODE = /^(?:AU|MEM|MANU|RC|SP|SSP|SN\d+(?:\s+of\s+\d+)?|PR\d+|1 of 1|1\/1)$/;
  const CODE_RUN = /(?:^|\s)((?:(?:AU|MEM|MANU|RC|SSP|SP|SN\d+(?:\s+of\s+\d+)?|PR\d+|1 of 1|1\/1)(?:\s*,\s*|\s+(?=(?:AU|MEM|MANU|RC|SSP|SP)\b|SN\d|PR\d|1 of 1|1\/1)))*(?:AU|MEM|MANU|RC|SSP|SP|SN\d+(?:\s+of\s+\d+)?|PR\d+|1 of 1|1\/1))(?=\s|$|\(|\)|,)/;
  function readCodes(name) {
    const h = name.indexOf("#"), tail = h >= 0 ? name.slice(h) : name.replace(/^.*?\b(?:custom|autograph|signed)\b/i, "");
    const m = tail.match(CODE_RUN); if (!m) return null;
    const codes = m[1].split(/\s*,\s*|\s+(?=[A-Z]|1 of 1|1\/1)/).map((x) => x.trim()).filter((x) => CODE.test(x)); if (!codes.length) return null;
    const c = { text: m[1], au: codes.includes("AU"), mem: codes.includes("MEM"), manu: codes.includes("MANU"), rc: codes.includes("RC"),
      sp: codes.some((x) => x === "SP" || x === "SSP"), sn: 0, of: 0, pr: 0 };
    codes.forEach((x) => { let k = x.match(/^SN(\d+)(?:\s+of\s+(\d+))?$/); if (k) { c.sn = +k[1]; c.of = +(k[2] || 0); } k = x.match(/^PR(\d+)$/); if (k) c.pr = +k[1]; });
    // "1 of 1" wins over everything: e.g. the first card of an SN50 run made as a one-of-one holofoil.
    if (codes.includes("1 of 1") || codes.includes("1/1")) { c.sn = 1; c.of = 0; c.pr = 0; }
    // Ian's new tag list has at least one of AU/MEM/MANU/SN/PR. A lone "SP" or "RC" is the older naming (e.g. "Alex Gordon SP"),
    // so it only adds those tags and changes nothing else.
    c.full = c.au || c.mem || c.manu || !!c.sn || !!c.pr;
    if (!c.full && h < 0) return null;
    return c;
  }
  const DUAL_GRADE = /\b(PSA|BGS|SGC|CGC)(?:[- ]DNA)?\b[^#]*?(?:\b[A-Z]{1,4}(?:-[A-Z]{1,4})?\s+)?(\d+(?:\.\d)?)\s+Auto\s+(\d+(?:\.\d)?)\b/i;
  function parse(name) {
    const out = { title: name, sub: "", par: "", year: 9999, serial: 0, printRun: 0, one: false, grade: "", tags: new Set() };
    const codes = readCodes(name);
    const pr = name.match(/print run of\s*(\d+)/i); if (pr) out.printRun = +pr[1];
    const y = name.match(/^(\d{4})/); if (y) out.year = +y[1];
    const s = name.match(RX.serial);
    if (s) {
      const a = +(s[1] || s[3] || 0), b = +(s[2] || s[4] || 0);
      out.serial = b || a; out.one = (b ? b === 1 : a === 1) || /\b1\s*of\s*1\b|1\/1/i.test(name);
    }
    const g = name.match(RX.grade); if (g) out.grade = (g[1].toUpperCase() + (g[2] ? " " + g[2] : "")).trim();
    // Card and autograph graded separately: "PSA-DNA Certified VG 3 Auto 8" → "PSA 3 · Auto 8".
    const dual = name.match(DUAL_GRADE); if (dual) out.grade = `${dual[1].toUpperCase()} ${dual[2]} · Auto ${dual[3]}`;
    // Names that look like autographs but aren't: the "Signature Rookies" brand (its real autos also say
    // "Autographs" or "Signatures"), "Auto Phonex" phone cards, and Choice Gold/Silver Signature parallels.
    // Collector's Choice (and other "Choice") Gold/Silver Signature parallels carry a printed facsimile, not an autograph.
    let autoName = name.replace(/^(\d{4}(?:-\d{2})?\s+)Signature Rookies\b/i, "$1").replace(/\bauto\s*phonex\b/i, "");
    if (/\bchoice\b/i.test(autoName)) autoName = autoName.replace(/\b(?:gold|silver)\s+signatures?\b/gi, "");
    if (RX.auto.test(autoName)) out.tags.add("auto");
    // Brand names that sound like relics but aren't (Absolute Memorabilia, Certified Materials, Throwback Threads,
    // Alternate Threads, SP Game Used): their real relics also say Materials, Fabric, Jersey, Patch and so on.
    // On photo variations (VAR), "Blue Jersey" or "Logo" describes the picture, not a swatch.
    // A jersey mentioned in a note describes the photo, e.g. "(grabbing Jersey)", so it doesn't count either,
    // nor do picture variations and inserts with relic-sounding names (Missing Nameplate, Hot Button, Glove Stories).
    // Topps Triple Threads and Donruss Threads relics say "Relics", "Materials", "Jersey" and so on.
    let relicName = name.replace(/\([^)]*jersey[^)]*\)/gi, " ")
      .replace(/\b(?:(?:playoff\s+)?absolute\s+memorabilia|(?:leaf\s+)?certified\s+materials|(?:topps\s+)?triple\s+threads|donruss\s+threads|throwback\s+threads|alternate\s+threads|sp\s+game\s+(?:used|bat)(?:\s+(?:patch|edition|milestone))?)\b/gi, "")
      .replace(/\b(?:missing\s+nameplate|hot\s+button|glove\s+stories)\b/gi, "");
    if (/\bVAR\b/.test(relicName)) relicName = relicName.replace(/\b(?:jerseys?|logo)\b/gi, "");
    // Absolute Memorabilia's Tools of the Trade inserts carry swatches; older sets with that name don't.
    if (RX.relic.test(relicName) || /absolute.*tools of the trade/i.test(name)) out.tags.add("relic");
    if (RX.custom.test(name)) out.tags.add("custom");
    // An inscribed autograph: Ian adds the word "inscription" to the file name. (Plural "Inscriptions" is a set name, e.g.
    // Score Inscriptions, so only the singular word counts.)
    if (/\binscription\b/i.test(name)) out.tags.add("inscr");
    // "RC" inside a card number (#BTL-RC, #SS-RC = Roger Craig's initials) isn't a rookie card.
    if (RX.rc.test(name.replace(/#\S+/g, " "))) out.tags.add("rc");
    if (codes && !codes.full) { if (codes.rc) out.tags.add("rc"); if (codes.sp) out.tags.add("sp"); }
    if (codes && codes.full) {   // Ian's codes override the guesses above
      out.tags.delete("auto"); out.tags.delete("relic");
      if (codes.au) out.tags.add("auto");
      if (codes.mem) out.tags.add("relic");   // MANU (manufactured patch) is not a relic
      if (codes.manu) out.tags.add("manu");
      if (codes.rc) out.tags.add("rc");
      if (codes.sp) out.tags.add("sp");
      if (codes.sn) { out.serial = codes.of || codes.sn; out.one = out.serial === 1; }
      if (codes.pr) out.printRun = codes.pr;
    }
    // A print run (PR25, "Print Run of 99") counts like a serial number, and wins over one: with both ("SN255, PR85"),
    // the print run is the smaller run of that variation, so it's the number shown and sorted by.
    if (out.printRun) { out.serial = out.printRun; out.one = out.printRun === 1; }
    if (out.serial) out.tags.add("numbered");
    if (out.one) out.tags.add("one");
    if (out.grade) out.tags.add("graded");
    const m = name.match(RX.main);
    if (m) {
      let [, yr, set, num, rest] = m;
      let par = "";
      const dash = set.indexOf(" - ");
      if (dash > 0) { par = set.slice(dash + 3); set = set.slice(0, dash); }
      if (codes && codes.full) rest = rest.replace(codes.text, " ");
      if (DUAL_GRADE.test(rest)) rest = rest.replace(DUAL_GRADE, " ");
      let player = rest.replace(RX.serial, "").replace(/print run of\s*\d+/i, "").replace(RX.grade, "").replace(/\((?:[^)]*)\)/g, "").replace(/\s+(Back|2nd|3rd|\d)$/i, "").replace(/\s{2,}/g, " ").trim();
      // Hidden codes leave their comma behind ("Quincy Enunwa AU, SN22, VAR - …" → "Quincy Enunwa, VAR - …").
      player = player.replace(/\s+,/g, ",").replace(/^,\s*|\s*,$/g, "").trim();
      out.title = player || rest; out.sub = `${yr} ${set} #${num}`; out.par = par;
    } else if (codes && codes.full) out.title = name.replace(codes.text, " ").replace(/\s*,\s*(?=\s|$)/g, " ").replace(/\s{2,}/g, " ").trim();
    return out;
  }

  // A landscape card (e.g. a horizontal patch auto) gets a landscape frame instead of a tall, mostly empty one.
  window.fitFrame = (im) => { im.classList.add("ok"); if (im.naturalWidth > im.naturalHeight * 1.1) im.parentNode.classList.add("land"); };

  /* ---------- Addresses: real paths (/player/ricky-simmons/) instead of #/player/ricky-simmons ----------
     The app still thinks in "#/…" routes (HASH() gives the current one); toURL() turns one into a real address under
     the site's folder, and go() moves there. Links written as href="#/…" are rewritten to real addresses (so search
     engines can follow them) and open in place. Old #/ links still work: they're turned into real addresses on arrival.
     GitHub Pages serves a page for each main address (built by scripts/build_route_pages.py); any other address
     reaches 404.html, which hands it back to the app. */
  const BASE = location.pathname.indexOf("/cardcollection-site/") === 0 ? "/cardcollection-site/" : "/";
  const ALIAS = { "nfl-huskers": "husker-bios" };   // app route → address (nfl-huskers/ holds the plain list pages)
  const UNALIAS = { ...Object.fromEntries(Object.entries(ALIAS).map(([a, b]) => [b, a])), "player-pages": "nfl-huskers" };   // player-pages/: its first address
  function toURL(h) {
    const [path, qs] = String(h || "").replace(/^#?\/?/, "").split("?");
    const parts = path.split("/").filter(Boolean); if (parts.length && ALIAS[parts[0]]) parts[0] = ALIAS[parts[0]];
    return BASE + parts.map((x) => encodeURIComponent(decodeURIComponent(x))).join("/") + (parts.length ? "/" : "") + (qs ? "?" + qs : "");
  }
  const absURL = (h) => location.origin + toURL(h);
  // The route an href points to ("#/…" as written, or the real address it was turned into).
  function hashOf(href) {
    if (!href || href.startsWith("#/")) return href;
    let u; try { u = new URL(href, location.href); } catch (e) { return href; }
    const parts = u.pathname.slice(BASE.length).split("/").filter(Boolean); if (parts.length && UNALIAS[parts[0]]) parts[0] = UNALIAS[parts[0]];
    return "#/" + parts.join("/") + u.search;
  }
  function HASH() {
    const rel = location.pathname.slice(BASE.length).replace(/^\/+|\/+$/g, "").replace(/(^|\/)index\.html$/, "");
    const parts = rel.split("/").filter(Boolean); if (parts.length && UNALIAS[parts[0]]) parts[0] = UNALIAS[parts[0]];
    return "#/" + parts.join("/") + location.search;
  }
  let LAST_HASH = null;
  const fireRoute = () => { const h = HASH(); if (h === LAST_HASH) return; LAST_HASH = h; window.dispatchEvent(new HashChangeEvent("hashchange")); };
  function go(h, replace) { history[replace ? "replaceState" : "pushState"](null, "", toURL(h)); fireRoute(); }
  // An old #/… address (shared links, bookmarks, 404.html's hand-off): show it at its real address.
  if (/^#\//.test(location.hash)) history.replaceState(null, "", toURL(location.hash));
  addEventListener("popstate", () => setTimeout(fireRoute, 0));
  // Links: "#/…" → real address in the page (for crawlers and long-press "copy link"), opened in place.
  const fixLinks = (root) => (root.querySelectorAll ? root.querySelectorAll('a[href^="#/"]') : []).forEach((a) => a.setAttribute("href", toURL(a.getAttribute("href"))));
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.matches('a[href^="#/"]')) n.setAttribute("href", toURL(n.getAttribute("href"))); fixLinks(n); } }))).observe(document.documentElement, { childList: true, subtree: true });
  fixLinks(document);
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest("a[href]"); if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
    const raw = a.getAttribute("href");
    if (raw.startsWith("#/")) { e.preventDefault(); go(raw); return; }
    let u; try { u = new URL(a.href); } catch (err) { return; }
    if (u.origin !== location.origin || !u.pathname.startsWith(BASE)) return;
    const rel = u.pathname.slice(BASE.length);
    if (/^(assets|data|nfl-huskers|players)\//.test(rel) || /\.[a-z0-9]+$/i.test(rel)) return;   // files and the plain pages
    e.preventDefault(); history.pushState(null, "", u.pathname + u.search); fireRoute();
  });
  /* ---------- Data ---------- */
  let DUPES = []; const DUP0 = 1000000;
  const cardAt = (i) => (i >= DUP0 ? DUPES[i - DUP0] : CARDS[i]);
  function load(json) {
    DATA = json; SECTIONS = json.sections;
    // Not on the site: sold cards and second/third copies. Customs always stay (numbered customs are separate commissions). scripts/build_catalog.py leaves them out too.
    json.cards = json.cards.filter((c) => !/\bsold\b|\bgifted to\b/i.test(c[2]) && !(/\s\(?(?:2nd|3rd|\d+th)\)?(?:\s+back)?\s*(?:\([^)]*\))?\s*$/i.test(c[2]) && !/\bcustom\b/i.test(c[2])));
    const mk = (c, i) => {
      const [id, rk, name, si, gi, added, backId, backRk, team = "", fromBase = 0] = c;
      const p = parse(name);
      if (backId) p.tags.add("back");
      // Customs page filters: which kind of custom it is, from the collection it lives in (or "non-sport" in the name).
      // A customs-only Drive folder (config "customs": true, e.g. "Customs - Non-Sport"): every scan in it is a custom.
      if (SECTIONS[si].customs) p.tags.add("custom");
      if (p.tags.has("custom")) {
        const sl = SECTIONS[si].slug, own = name + " " + team;
        if (/non[- ]?sport/i.test(own + " " + sl)) p.tags.add("nonsport");
        else if (/^husker-/.test(sl)) p.tags.add("huskers");
        else if (["royals", "alex-gordon", "jermaine-dye"].includes(sl)) p.tags.add("royals");
        // The "Customs" Drive folder holds every kind: Royals if the name or its subfolder says so, otherwise Huskers.
        else if (SECTIONS[si].customs) p.tags.add(/\broyals\b|kansas city/i.test(own) && !/husker|nebraska/i.test(own) ? "royals" : "huskers");
      }
      // Relic kinds for the Button / Nameplate / Dirt filters: from the name (Ian adds "(Button)", "(Nameplate)",
      // "(Dirty Relic)" where the set name doesn't say it), or config "dirtRelics". Topps "Hot Button" and Gypsy Queen
      // "Missing Nameplate" aren't relics.
      if (/\bbuttons?\b/i.test(name) && !/\bhot button\b/i.test(name)) p.tags.add("button");
      if ((/\bnameplates?\b/i.test(name) || /\bown the name\b/i.test(name)) && !/\bmissing nameplate\b/i.test(name)) p.tags.add("nameplate");
      if (/\bdirt\b|\(dirty\b/i.test(name) || (json.site.dirtRelics || []).includes(name)) p.tags.add("dirt");
      // Hand corrections from config/site.json "tagFixes", e.g. {"auto": {"add": [card names], "remove": [card names]}}.
      for (const [tag, fix] of Object.entries(json.site.tagFixes || {})) {
        if ((fix.add || []).includes(name)) p.tags.add(tag);
        if ((fix.remove || []).includes(name)) p.tags.delete(tag);
      }
      return { i, id, rk, name, si, gi, added, backId, backRk, team, fb: !!fromBase, ...p, hay: (name + " " + SECTIONS[si].title + " " + SECTIONS[si].groups[gi].label).toLowerCase() };
    };
    CARDS = json.cards.map(mk);
    setTimeout(tcdbWants, 1500);   // TCDb want list cards for rainbow pages, after the first screen is up
    // Extra copies (names ending "2nd", "3rd", "4th"...): only on the Duplicates page, never in collections, search or counts.
    // Numbered from DUP0 so a card's number still finds it (cardAt).
    DUPES = (json.dupes || []).filter((c) => SECTIONS[c[3]]).map((c, k) => ({ ...mk(c, DUP0 + k), dup: true }));
    // Photos of athletes with my custom cards. The file name is the caption; the part before the first
    // " - " or sentence break is the short label on the strip ("Jr." and similar don't count as a break).
    const caps = (json.site.customsPhotos || {}).captions || {};
    // Player reference images (Drive "Nebraska Player Reference Images"): open in the viewer like photos, caption = file name.
    REFS = (json.refs || []).map(([id, rk, name, added]) => ({ photo: true, ref: true, id, rk, name, added, caption: name, short: name }));
    PHOTOS = (json.photos || []).map(([id, rk, name, added]) => {
      const caption = (caps[name] || name).trim();
      const short = caption.split(/\s+[-–—]\s+|(?<!\b(?:Jr|Sr|St|Dr|Mr|Mrs|No|vs|Jan|Feb|Aug|Sept|Oct|Nov|Dec))[.!?]\s+/)[0].replace(/[.!?]$/, "");
      // "Jerald Foster with his custom card" → "Jerald Foster" on the strip; the full caption shows when opened.
      return { photo: true, id, rk, name, added, caption, short: short.replace(/\s+with (?:his|her|their)\b.*$/i, "") || short };
    });
    // A collection's progress comes from its live "Have %" when the robot has published one.
    SECTIONS.forEach((sec) => {
      const have = (INV[sec.slug] || []).find((r) => /^have\s*%$/i.test(r[0]));
      const n = have && parseFloat(String(have[1]).replace(/[^\d.]/g, ""));
      if (n >= 0 && n <= 100) { sec.progress = n; sec.progressText = String(have[1]).trim(); }
    });
    const dates = [...new Set(CARDS.map((c) => c.added))].sort().reverse();
    NEW_CUTOFF = dates[Math.min(dates.length - 1, 1)] || ""; // cards from the two most recent "drops" count as new
    const d30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    if (NEW_CUTOFF < d30) NEW_CUTOFF = dates[0];
    $("#q").placeholder = phoneBar.matches ? "Search cards" : `Search ${fmt(CARDS.length)} scans… try “Triple Threads”`;
    renderNav(); renderFoot(); route();
  }

  /* ---------- Shared bits ---------- */
  // The Customs page has its own filters (all its cards are customs).
  // Extra filter chips for particular pages.
  const INSCR = ["inscr", "Inscriptions"], PAGE_FILTERS = { "husker-football": [INSCR], customs: [INSCR] };
  const CUSTOM_FILTERS = [["auto", "Autographs"], ["relic", "Relics & Patches"], ["royals", "Royals"], ["huskers", "Huskers"], ["nonsport", "Non-Sport"]];
  // Kinds only some collections have: their chip shows only where the page has at least one such card.
  const RARE_FILTERS = new Set(["button", "nameplate", "dirt"]);
  // No Rookies filter (Ian doesn't use the RC tag, so it can't be accurate) and no "Has back scan" filter (Ian, 2026-11-25).
  const FILTERS = [["auto", "Autographs"], ["relic", "Relics & Patches"], ["button", "Button Relics"], ["nameplate", "Nameplate Relics"], ["dirt", "Dirt Relics"], ["numbered", "Numbered"], ["one", "1 of 1"], ["graded", "Graded"], ["custom", "Customs"]];
  // Filters a page leaves out: the Want List has no customs, button relics, 1 of 1s or graded cards to pick from.
  const PAGE_NO_FILTERS = { "want-list": new Set(["custom", "button", "one", "graded"]) };
  const SORTS = [["new", "Newest Added"], ["old", "Year: Oldest First"], ["recent", "Year: Newest First"], ["az", "A–Z"], ["serial", "Lowest Print Run"]];
  // A page's own default order: oldest to newest everywhere (Ian, 2026-11-26), except Rarest Cards (by print run) and Recent Additions (newest added).
  const defaultSort = (key) => ({ rarest: "serial", recent: "new" })[key] || "old";
  const state = { filters: new Set(), sort: "old", decade: "", team: "", list: [], shown: 0, q: "", where: null };

  const SET_COLLATOR = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const setOrder = (a, b) => SET_COLLATOR.compare(a.name.replace(/^\d{4}(?:-\d{2})?\s+/, ""), b.name.replace(/^\d{4}(?:-\d{2})?\s+/, ""));
  function sortList(list, how) {
    const by = {
      new: (a, b) => (b.added > a.added ? 1 : b.added < a.added ? -1 : a.i - b.i),
      // Oldest first: by year, then set name A–Z (then card number, naturally: #2 before #10).
      // Newest first is the exact reverse: newest year first, set names Z–A within each year.
      old: (a, b) => a.year - b.year || setOrder(a, b) || a.i - b.i,
      recent: (a, b) => (b.year === 9999 ? 0 : b.year) - (a.year === 9999 ? 0 : a.year) || setOrder(b, a) || a.i - b.i,
      az: (a, b) => a.name.localeCompare(b.name),
      serial: (a, b) => rarity(a) - rarity(b) || a.i - b.i,
    }[how];
    return list.slice().sort(by);
  }
  function hl(text, q) {
    const t = esc(text); if (!q) return t;
    const words = q.split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return words.length ? t.replace(new RegExp(`(${words.map(esc).join("|")})`, "gi"), "<mark>$1</mark>") : t;
  }
  // How rare a card is, for sorting: its serial number, else its print run (unnumbered cards last).
  const rarity = (c) => c.serial || c.printRun || 1e9;
  // lite (letterman pages): no print run or AUTO badge; the print run is in the set's description instead.
  function badges(c, lite) {
    let b = "";
    if (c.added >= NEW_CUTOFF) b += `<span class="bd new">NEW</span>`;
    if (lite) {} else if (c.one) b += `<span class="bd one">1/1</span>`; else if (c.serial) b += `<span class="bd">/${c.serial}</span>`;
    else if (c.printRun) b += `<span class="bd pr" title="Print run of ${c.printRun} (not serial-numbered)">PR ${c.printRun}</span>`;
    if (c.tags.has("auto") && !lite) b += `<span class="bd auto">AUTO</span>`;
    if (c.tags.has("relic")) b += `<span class="bd mem" title="Memorabilia (relic)">MEM</span>`;
    if (c.grade) b += `<span class="bd">${esc(c.grade)}</span>`;
    if (c.backId) b += `<span class="bd back" title="Front and back">⇆</span>`;
    return b;
  }
  /* ---------- My picks: visitors star cards they like (owned cards only, not the Want List), up to 50. Saved in their
     own browser; #/picks shows them, and a shared link (#/picks/<ids>) shows the same cards to anyone. ---------- */
  const PICK_MAX = 50, PICK_KEY = "ian-picks";
  const pickId = (c) => cid(c).slice(-8);   // the end of the scan's Drive ID: short and unique across the collection
  const canPick = (c) => c && !c.photo && SECTIONS[c.si] && SECTIONS[c.si].kind !== "want";
  let PICKS = (() => { try { return JSON.parse(localStorage.getItem(PICK_KEY) || "[]").filter((x) => typeof x === "string").slice(0, PICK_MAX); } catch (e) { return []; } })();
  const isPicked = (c) => PICKS.includes(pickId(c));
  function savePicks() { try { localStorage.setItem(PICK_KEY, JSON.stringify(PICKS)); } catch (e) {} pickCount(); }
  const STAR = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z"/></svg>`;
  function pickStar(c) {
    if (!canPick(c)) return "";
    const on = isPicked(c);
    return `<span class="pick${on ? " on" : ""}" role="button" tabindex="0" data-pick="${c.i}" aria-pressed="${on}" aria-label="${on ? "Remove from" : "Add to"} my picks" title="${on ? "Remove from" : "Add to"} my picks">${STAR}</span>`;
  }
  function togglePick(c) {
    const id = pickId(c);
    if (PICKS.includes(id)) PICKS = PICKS.filter((x) => x !== id);
    else if (PICKS.length >= PICK_MAX) { toast(`You've picked ${PICK_MAX} cards, the most a list can hold. Remove one to add another.`); return false; }
    else PICKS.push(id);
    savePicks();
    document.querySelectorAll(`[data-pick="${c.i}"]`).forEach((el) => { const on = isPicked(c); el.classList.toggle("on", on); el.setAttribute("aria-pressed", on);
      el.setAttribute("aria-label", `${on ? "Remove from" : "Add to"} my picks`); el.title = `${on ? "Remove from" : "Add to"} my picks`; });
    if ((HASH() || "") === "#/picks") route();
    return true;
  }
  function pickCount() {
    const b = $("#picks-link"); if (!b) return;
    b.hidden = !PICKS.length; b.querySelector("b").textContent = PICKS.length;
    b.setAttribute("aria-label", `My picks: ${PICKS.length} card${PICKS.length === 1 ? "" : "s"}`);
  }
  function toast(msg) {
    let t = $("#toast"); if (!t) { document.body.insertAdjacentHTML("beforeend", `<div id="toast" class="toast" role="status"></div>`); t = $("#toast"); }
    t.textContent = msg; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), 3200);
  }
  // A star sits inside the card button, so it handles the tap itself (and keeps the card from opening).
  const onStar = (e) => { const s = e.target.closest("[data-pick]"); if (!s) return false; e.preventDefault(); e.stopPropagation(); togglePick(cardAt(+s.dataset.pick)); return true; };
  document.addEventListener("click", onStar, true);
  document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("[data-pick]")) onStar(e); }, true);
  function picksPage(shared) {
    const ids = shared ? shared.split(".").filter(Boolean).slice(0, PICK_MAX) : PICKS;
    const byId = new Map([...CARDS, ...DUPES].filter(canPick).map((c) => [pickId(c), c]));
    const list = ids.map((id) => byId.get(id)).filter(Boolean), missing = ids.length - list.length;
    setNav(""); setTitle(shared ? "Shared picks" : "My picks");
    const url = absURL("#/picks/" + list.map(pickId).join("."));
    const body = `Hi Ian,\n\nI'm interested in these cards from your site:\n\n${list.map((c, k) => `${k + 1}. ${c.name}`).join("\n")}\n\nSee them all: ${url}\n\n`;
    $("#app").innerHTML = `<div class="wrap coll c-royal"><div style="grid-column:1/-1;min-width:0">
      <div class="c-head"><div class="kick">${shared ? "Shared with you" : "Saved on this device"}</div><h1>${shared ? "Shared picks" : "My picks"}</h1>
      <p>${list.length ? `${fmt(list.length)} card${list.length === 1 ? "" : "s"}${shared ? " someone picked from my collection" : ` (up to ${PICK_MAX}). Tap the star on any card to add or remove it`}.` : `No picks yet. Tap the ☆ on any card in my collection to add it here (up to ${PICK_MAX}).`}${missing ? ` ${missing} card${missing === 1 ? " is" : "s are"} no longer on the site.` : ""}</p></div>
      ${list.length ? `<div class="b-row picks-tools">${binderBtn()}
        <button type="button" class="btn" id="pk-share">Share these picks</button>
        ${shared ? (list.some((c) => !isPicked(c)) && PICKS.length < PICK_MAX ? `<button type="button" class="btn" id="pk-add">Add these to my picks</button>` : "") : `<button type="button" class="btn" id="pk-clear">Clear all</button>`}</div>
        ${shared ? "" : contactHTML("Send these to Ian", `Cards I'm interested in (${list.length})`, body, `${list.length} picked cards`)}` : ""}
      <div class="grid" id="grid">${list.map((c) => cardHTML(c)).join("")}</div></div></div>`;
    state.list = list; state.binderItems = list;
    $("#pk-share")?.addEventListener("click", async (e) => {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) { try { await navigator.share({ title: "Card picks from IanBadeer.com", url }); } catch (err) {} return; }
      try { await navigator.clipboard.writeText(url); e.target.textContent = "Link copied"; } catch (err) { prompt("Copy this link:", url); }
      setTimeout(() => (e.target.textContent = "Share these picks"), 2000);
    });
    $("#pk-clear")?.addEventListener("click", () => { if (confirm(`Remove all ${list.length} picks?`)) { PICKS = []; savePicks(); picksPage(); } });
    $("#pk-add")?.addEventListener("click", () => { list.forEach((c) => { if (!isPicked(c) && PICKS.length < PICK_MAX) PICKS.push(pickId(c)); }); savePicks(); picksPage(shared); toast("Added to your picks."); });
  }
  // lite: letterman pages show the card without print run, AUTO or picks star.
  function cardHTML(c, q, lite) {
    return `<button class="cd" type="button" data-i="${c.i}" aria-label="${esc(c.name)}">
      <div class="ph"><img loading="lazy" decoding="async" alt="" src="${img(c.id, c.rk, 400)}" onload="this.classList.add('ok')"><div class="badges">${badges(c, lite)}</div>${lite ? "" : pickStar(c)}</div>
      <div class="cap"><b>${hl(c.title, q)}</b>${hl(c.sub, q)}${c.par ? `<br><span class="par">${hl(c.par, q)}</span>` : ""}</div></button>`;
  }
  const pctText = (sec) => sec.progressText || sec.progress + "%";
  // The live summary table for a collection, laid out like the Inventory Stats master:
  // a header row, then what's collected, then what's left (from "Left to Collect" on).
  function invBox(slug) {
    const rows = INV[slug]; if (!rows || rows.length < 2) return "";
    const [head, ...body] = rows, cut = body.findIndex((r) => /^left to collect/i.test(r[0]));
    const part = (list, cls) => list.length ? `<tbody class="${cls}">${list.map((r) => `<tr class="${/%$/.test(r[1]) || /^left to collect/i.test(r[0]) ? "key" : ""}"><th>${esc(r[0])}</th><td>${esc(r[1])}</td></tr>`).join("")}</tbody>` : "";
    return `<aside class="inv" aria-label="Collection stats"><table>
      <thead><tr><th>${esc(head[0])}</th><th>${esc(head[1] || "")}</th></tr></thead>
      ${part(cut < 0 ? body : body.slice(0, cut), "got")}${cut < 0 ? "" : part(body.slice(cut), "left")}</table></aside>`;
  }
  // A section with a teamTag (Detroit Lions) shows its own Drive folder plus every card tagged with that team elsewhere
  // (e.g. the "Detroit Lions" subfolder in Nebraska Football Cards & Autos); each card is still filed once, in its home collection.
  function sectionCards(si) { const t = SECTIONS[si] && SECTIONS[si].teamTag;
    return CARDS.filter((c) => c.si === si || (t && c.team === t && SECTIONS[c.si].kind !== "want")); }
  // A section with no scans yet (e.g. a new folder still being filled) stays out of menus and tiles.
  // A hidden section (config "hidden": true, e.g. Customs - Non-Sport) shows only through the Customs page.
  function shown(s) { return !s.hidden && sectionCards(SECTIONS.indexOf(s)).length > 0; }
  /* Fuzzy search: when a word matches nothing, swap in the closest known word (one typo, or two in long words). */
  let VOCAB = null;
  function cardVocab() {
    if (VOCAB) return VOCAB;
    VOCAB = new Map();
    CARDS.forEach((c) => c.hay.split(/[^a-z0-9']+/).forEach((w) => w.length > 2 && !/^\d+$/.test(w) && VOCAB.set(w, (VOCAB.get(w) || 0) + 1)));
    return VOCAB;
  }
  // Edit distance with swapped letters counting as one typo; gives up early once it's over `max`.
  function typoDist(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let p2 = null, p = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const r = [i]; let lo = i;
      for (let j = 1; j <= b.length; j++) {
        let v = Math.min(p[j] + 1, r[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (p2 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
        r.push(v); if (v < lo) lo = v;
      }
      if (lo > max) return max + 1;
      p2 = p; p = r;
    }
    return p[b.length];
  }
  function fixQuery(q, vocab, known, minLen = 4) {
    let changed = false;
    const out = q.toLowerCase().split(/\s+/).filter(Boolean).map((w) => {
      if (w.length < minLen || /\d/.test(w) || known(w)) return w;
      const max = w.length >= 8 ? 2 : 1;
      let best = null, bd = max + 1, bn = 0;
      vocab.forEach((n, t) => { const d = typoDist(w, t, max); if (d <= max && (d < bd || (d === bd && n > bn))) { best = t; bd = d; bn = n; } });
      if (best) { changed = true; return best; }
      return w;
    });
    return changed ? out.join(" ") : null;
  }
  // Plain-English search: "Gordon autos under /50", "1/1 relics", "Dye rookies 2000s", "Huskers patches before 1990".
  // Kind words, print runs and years become filters; the other words still have to appear in the card.
  const KIND_WORDS = [[/^(autos?|autographs?|autographed|signed|signatures?)$/, "auto", "autographs"], [/^(relics?|patch(es)?|memorabilia|swatch(es)?|game-?used)$/, "relic", "relics"],
    [/^(rookies?|rcs?)$/, "rc", "rookies"], [/^(numbered|serial(ized)?)$/, "numbered", "numbered"], [/^(graded|slabbed|slabs?)$/, "graded", "graded"],
    [/^(customs?)$/, "custom", "customs"], [/^(1\/1s?|one-of-ones?|oneofones?)$/, "one", "1 of 1"]];
  const FILLER = new Set("show me my all the a an of with and cards card i have from in for by on any that are is".split(" "));
  function parseQuery(q) {
    // "=Jermaine Dye": exactly that player's own cards (used by the players ranking, so its counts match).
    if (q.startsWith("=")) { const who = q.slice(1).trim().toLowerCase(); return { words: [], tests: [(x) => plainTitle(x).toLowerCase() === who], said: [`only ${q.slice(1).trim()}`] }; }
    let t = q.toLowerCase().replace(/[“”]/g, '"').replace(/\bone of (one|1)\b|\b1 of 1\b/g, "1/1");
    const tests = [], said = [];
    // Print runs: "under /50", "/25 or less", "numbered to 10 or lower", "less than 100", "below /99"
    t = t.replace(/\b(?:under|below|less than|lower than|up to|at most)\s*\/?\s*(\d+)\b|\/(\d+)\s*(?:or\s*(?:less|lower|under|below))|(?:numbered|#'?d)\s*(?:to\s*)?\/?(\d+)\s*or\s*(?:less|lower)/g, (m, a, b, c) => {
      const n = +(a || b || c), under = /under|below|less than|lower than/.test(m); tests.push((x) => x.serial > 0 && (under ? x.serial < n : x.serial <= n)); said.push(under ? `numbered under /${n}` : `numbered /${n} or lower`); return " "; });
    t = t.replace(/\b(?:over|above|more than|higher than)\s*\/\s*(\d+)\b/g, (m, a) => { tests.push((x) => x.serial > +a); said.push(`numbered over /${a}`); return " "; });
    // Years: "2010s", "1990-1995", "before 1990", "after 2010", "since 2015"
    t = t.replace(/\b((?:19|20)\d)0'?s\b/g, (m, d) => { const a = +d * 10; tests.push((x) => x.year >= a && x.year <= a + 9); said.push(`${a}s`); return " "; });
    t = t.replace(/\b((?:19|20)\d{2})\s*(?:-|–|to)\s*((?:19|20)\d{2})\b/g, (m, a, b) => { tests.push((x) => x.year >= +a && x.year <= +b); said.push(`${a}–${b}`); return " "; });
    t = t.replace(/\b(before|pre|after|since|post)[- ]?((?:19|20)\d{2})\b/g, (m, w, y) => { const before = /before|pre/.test(w);
      tests.push((x) => x.year < 9999 && (before ? x.year < +y : w === "since" ? x.year >= +y : x.year > +y)); said.push(`${w} ${y}`); return " "; });
    const words = [];
    t.split(/\s+/).filter(Boolean).forEach((w) => {
      const k = KIND_WORDS.find(([re]) => re.test(w));
      if (k) { tests.push((x) => x.tags.has(k[1])); said.push(k[2]); }
      else if (/^(19|20)\d{2}$/.test(w)) { tests.push((x) => x.year === +w); said.push(w); }
      else if (/^(huskers?|cornhuskers?|nebraska)$/.test(w)) { tests.push((x) => /nebraska|husker/.test(x.hay)); said.push("Huskers"); }
      else if (!FILLER.has(w)) words.push(w);
    });
    return { words, tests, said: [...new Set(said)] };
  }
  function search(list, q) {
    const { words, tests } = parseQuery(q);
    if (!words.length && !tests.length) return list;
    return list.filter((c) => words.every((w) => c.hay.includes(w)) && tests.every((f) => f(c)));
  }

  /* ---------- Views ---------- */
  // One order everywhere (menu, home tiles, sidebar): the Nebraska sections, Gordon, Dye, Customs,
  // the other collections, Detroit Lions last. "customs" stands for the Customs page.
  const LAST = ["lions"];
  function siteOrder() {
    const secs = SECTIONS.filter(shown), other = secs.filter((s) => !isNeb(s));
    const lead = other.filter((s) => !LAST.includes(s.slug)).slice(0, 2);
    return [...secs.filter(isNeb), ...lead, "customs", ...other.filter((s) => !lead.includes(s) && !LAST.includes(s.slug)), ...other.filter((s) => LAST.includes(s.slug))];
  }
  // Nebraska sections and the Husker autograph pages share one "Nebraska Cornhuskers" dropdown.
  const isNeb = (s) => /^husker-/.test(s.slug);
  function renderNav() {
    const neb = SECTIONS.filter((s) => shown(s) && isNeb(s));
    // Four menus: Nebraska Cornhuskers, Super Collections, Team Collections, Explore.
    const sl = (slug) => SECTIONS.find((x) => x.slug === slug && shown(x));
    const sec = (slug) => { const x = sl(slug); return x ? `<a href="#/c/${x.slug}" data-s="${x.slug}">${esc(x.title)}</a>` : ""; };
    const used = ["alex-gordon", "jermaine-dye", "royals", "lions", "want-list"];
    const rest = SECTIONS.filter((x) => shown(x) && !isNeb(x) && !used.includes(x.slug)).map((x) => sec(x.slug));
    const groups = [
      ["Super Collections", "dd-menu-super", [sec("alex-gordon"), sec("jermaine-dye")]],
      ["Team Collections", "dd-menu-team", [sec("royals"), sec("lions")]],
      ["Explore", "dd-menu-explore", [`<a href="#/recent" data-s="recent">Recent Additions</a>`, `<a href="#/customs" data-s="customs">Custom Cards</a>`, DUPES.length ? `<a href="#/duplicates" data-s="duplicates">Duplicates</a>` : "", sec("want-list"), (DATA.site.media?.items || []).length ? `<a href="#/media" data-s="media">Media</a>` : "", ...rest]],
    ].map(([t, id, items]) => [t, id, items.filter(Boolean)]).filter((g) => g[2].length);
    const btn = (t, id, bid) => `<button type="button" class="dd-btn"${bid ? ` id="${bid}"` : ""} data-menu="${id}" aria-expanded="false" aria-controls="${id}">${t} <span aria-hidden="true">▾</span></button>`;
    $("#nav").innerHTML = btn("Nebraska Cornhuskers", "dd-menu", "dd-btn") + groups.map((g) => btn(g[0], g[1])).join("");
    const chases = (DATA.site.chases || []).map((x, k) => `<a href="#/chase/${x.slug}" data-s="chase-${x.slug}"${k === 0 ? ' class="sep"' : ""}>${esc(x.title)}</a>`).join("");
    document.body.insertAdjacentHTML("beforeend", `<div class="dd-menu" id="dd-menu" hidden>${neb.map((s) => `<a href="#/c/${s.slug}" data-s="${s.slug}">${esc(s.title)}</a>`).join("")}${chases}</div>`
      + groups.map((g) => `<div class="dd-menu" id="${g[1]}" hidden>${g[2].join("")}</div>`).join(""));
    document.querySelectorAll(".dd-btn[data-menu]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); const m = $("#" + b.dataset.menu), was = !m.hidden; closeDD(); if (!was) openDD(b); }));
    // The autograph pages appear once the checklist data has been published.
    fetch("data/lists/husker-pros.json", { method: "HEAD" }).then((r) => {
      if (!r.ok || $('#dd-menu a[data-s="checklist"]')) return;
      $("#dd-menu").insertAdjacentHTML("beforeend", `${CK_PAGES.map((x, k) => `<a href="#/checklist${x.path}" data-s="checklist${x.path}"${k === 0 ? ' class="sep"' : ""}>${x.label}</a>`).join("")}
        <a href="#/nfl-huskers" data-s="nfl-huskers" class="sep">Husker Bios</a>
        <a href="#/nfl-teams" data-s="nfl-teams">Huskers by NFL Team</a>`);
      setNav(NAV_NOW);
    }).catch(() => {});
  }
  function openDD(at) {
    const btn = at || $("#dd-btn"), m = $("#" + (btn.dataset.menu || "dd-menu"));
    closeDD();
    const b = btn.getBoundingClientRect();
    m.hidden = false;
    const w = m.offsetWidth, z = pageZoom();
    m.style.top = b.bottom / z + 6 + "px";
    m.style.left = Math.max(12, Math.min(b.left / z, innerWidth / z - w - 12)) + "px";
    if (btn.classList.contains("dd-btn")) btn.setAttribute("aria-expanded", "true");
  }
  function closeDD() {
    document.querySelectorAll(".dd-menu").forEach((m) => { m.hidden = true; });
    document.querySelectorAll(".dd-btn").forEach((b) => b.setAttribute("aria-expanded", "false"));
  }
  document.addEventListener("click", (e) => { if (!e.target.closest(".dd-menu")) closeDD(); else if (e.target.closest("a")) closeDD(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.querySelector(".dd-menu:not([hidden])")) { closeDD(); $("#dd-btn").focus(); } });
  addEventListener("scroll", closeDD, { passive: true }); addEventListener("resize", closeDD);
  $("#nav").addEventListener("scroll", closeDD, { passive: true });
  function renderFoot() {
    const s = DATA.site;
    $("#foot").innerHTML = `<div class="wrap"><span>Trades, questions, or a card I need? ${gform() ? `<button type="button" class="linkish" data-form data-item="" data-body="">Send me a message</button> · ` : ""}<button type="button" class="linkish" data-mail data-subject="Hello from IanBadeer.com">Email me</button> · <button type="button" class="linkish" data-copymail>Copy my email</button></span><span>${fmt(CARDS.length)} scans · updated ${esc(DATA.generated.slice(0, 10))} · <a href="#/about">About &amp; sharing</a></span></div>`;
  }
  // Each page gets its own browser-tab title, so tabs, bookmarks and shared links say where they go.
  function setTitle(t) { document.title = t ? `${t} · IanBadeer.com` : "IanBadeer.com"; }
  let NAV_NOW = null;
  function setNav(slug) {
    NAV_NOW = slug;
    document.querySelectorAll("#nav a, .dd-menu a").forEach((a) => (a.dataset.s === slug ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    document.querySelectorAll(".dd-btn[data-menu]").forEach((b) => b.classList.toggle("on", !!$("#" + b.dataset.menu + " a[aria-current]")));
    mbarCat();
  }
  /* ---------- Phones: the slim bar that stays at the top once the header has scrolled away ---------- */
  // Its middle button is the collection you're in: "Nebraska" opens the Nebraska menu, others go to their page.
  function mbarCat() {
    const el = $("#mb-cat"), s = NAV_NOW || ""; if (!el) return;
    const neb = /^(husker-|checklist|nfl-|chase-)/.test(s), a = !neb && s && document.querySelector(`.dd-menu a[data-s="${s}"]`);
    el.hidden = !(neb || a); el.classList.toggle("dd", neb);
    el.textContent = neb ? "Nebraska" : a ? a.textContent : "";
    el.setAttribute("href", neb ? toURL("#/") : a ? a.getAttribute("href") : toURL("#/"));
  }
  $("#mb-cat").addEventListener("click", (e) => {
    if (!e.currentTarget.classList.contains("dd")) return;
    e.preventDefault(); e.stopPropagation();
    $("#dd-menu") && ($("#dd-menu").hidden ? openDD(e.currentTarget) : closeDD());
  });
  // Phones: the whole search box lives in the slim top bar (on every page); wider screens keep it in the header.
  const phoneBar = window.matchMedia("(max-width: 860px)"), searchForm = $("#search-form"), headDice = $("#dice");
  function placeSearch() {
    if (phoneBar.matches) $("#mbar").insertBefore(searchForm, $("#mb-dice"));
    else headDice.parentNode.insertBefore(searchForm, $("#picks-link"));
    $("#q").placeholder = phoneBar.matches ? "Search cards" : typeof CARDS !== "undefined" && CARDS && CARDS.length ? `Search ${fmt(CARDS.length)} scans… try “Triple Threads”` : "Search 9,000+ cards… try “Triple Threads”";
  }
  phoneBar.addEventListener("change", placeSearch); placeSearch();
  $("#mb-dice").addEventListener("click", () => $("#dice").click());
  if ("IntersectionObserver" in window) new IntersectionObserver(([en]) => { $("#mbar").classList.toggle("on", !en.isIntersecting); closeDD(); }).observe($(".top"));

  /* ---------- Contact: my address is only put together when someone clicks, so scrapers can't read it ---------- */
  const myEmail = () => { const c = DATA.site.contact || {}; try { return c.code ? atob(c.code).split("").reverse().join("") : ""; } catch (e) { return ""; } };
  // An email button (opens the visitor's mail app with the subject and message filled in), plus a fallback
  // for people without a mail app: copy my email, or the Google Form when one is set up.
  // A Google Form, filled in from a form on this page, delivers messages to me (config: contact.googleForm =
  // {"id": "<form id from its link>", "fields": {"name": "entry…", "email": "entry…", "item": "entry…", "message": "entry…"}}).
  const gform = () => { const g = (DATA.site.contact || {}).googleForm || {}; return g.id && g.fields && g.fields.email && g.fields.message ? g : null; };
  // A contact button: opens the form on this page when it's set up, otherwise the visitor's email app.
  // Underneath, the other ways to reach me.
  function contactHTML(label, subject, body, item) {
    const data = `data-subject="${esc(subject)}" data-body="${esc(body)}" data-item="${esc(item || "")}"`;
    if (gform()) return `<div class="cta"><button type="button" class="btn have-btn" data-form ${data}>✉ ${esc(label)}</button>
      <small class="cta-alt">Prefer email? <button type="button" class="linkish" data-mail ${data}>Email me</button> · <button type="button" class="linkish" data-copymail>Copy my email</button></small></div>`;
    return `<div class="cta"><button type="button" class="btn have-btn" data-mail ${data}>✉ ${esc(label)}</button>
      <small class="cta-alt">No email app? <button type="button" class="linkish" data-copymail>Copy my email</button></small></div>`;
  }
  function openForm(item, body) {
    const g = gform(); if (!g) return;
    let dlg = $("#cform");
    if (!dlg) {
      document.body.insertAdjacentHTML("beforeend", `<dialog id="cform" class="cform" aria-labelledby="cform-h">
        <form method="dialog" novalidate>
          <div class="cf-top"><h2 id="cform-h">Send me a message</h2><button type="button" class="cf-x" aria-label="Close">✕</button></div>
          <label>Your name<input name="name" autocomplete="name" required></label>
          <label>Your email<input name="email" type="email" autocomplete="email" required></label>
          <label>Card or player<input name="about"></label>
          <label>Message<textarea name="message" rows="5" required></textarea></label>
          <label class="cf-hp" aria-hidden="true">Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label>
          <p class="cf-err" hidden></p>
          <div class="cf-go"><button type="submit" class="btn have-btn">Send</button><small>I'll reply by email.</small></div>
        </form>
        <div class="cf-done" hidden><h2>Thanks!</h2><p>Your message is on its way. I'll reply by email.</p><button type="button" class="btn cf-x">Close</button></div>
      </dialog>`);
      dlg = $("#cform");
      dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest(".cf-x")) dlg.close(); });
      dlg.querySelector("form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = e.target, err = f.querySelector(".cf-err"), v = (n) => f.elements.namedItem(n).value.trim();
        if (v("website")) { dlg.querySelector(".cf-done").hidden = false; f.hidden = true; return; }   // a bot filled the trap field
        if (!v("name") || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v("email")) || !v("message")) {
          err.textContent = "Please add your name, a valid email address and a message."; err.hidden = false; return;
        }
        const g2 = gform(), fd = new FormData();
        // With no separate card/player question on the Google Form, the card or player goes at the top of the message.
        const msg = !g2.fields.item && v("about") ? `About: ${v("about")}\n\n${v("message")}` : v("message");
        [["name", v("name")], ["email", v("email")], ["item", v("about")], ["message", msg]].forEach(([k, val]) => g2.fields[k] && fd.append(g2.fields[k], val));
        f.querySelector("[type=submit]").disabled = true;
        try {
          // Google Forms doesn't let other sites read its reply, so a request that goes through counts as sent.
          await fetch(`https://docs.google.com/forms/d/e/${encodeURIComponent(g2.id)}/formResponse`, { method: "POST", mode: "no-cors", body: fd });
          f.hidden = true; dlg.querySelector(".cf-done").hidden = false;
        } catch (x) {
          err.textContent = "That didn't send. Check your connection, or use “Email me” instead."; err.hidden = false;
        } finally { f.querySelector("[type=submit]").disabled = false; }
      });
    }
    const f = dlg.querySelector("form");
    f.reset(); f.hidden = false; f.querySelector(".cf-err").hidden = true; dlg.querySelector(".cf-done").hidden = true;
    f.elements.namedItem("about").value = item || ""; f.elements.message.value = body ? body.replace(/^Hi Ian,\s*/, "") : "";
    dlg.showModal(); f.elements.name.focus();
  }
  document.addEventListener("click", async (e) => {
    const fb = e.target.closest("[data-form]");
    if (fb) { openForm(fb.dataset.item, fb.dataset.body); return; }
    const m = e.target.closest("[data-mail]");
    if (m) { location.href = `mailto:${myEmail()}?subject=${encodeURIComponent(m.dataset.subject || m.dataset.mail || "")}&body=${encodeURIComponent(m.dataset.body || "")}`; return; }
    const cp = e.target.closest("[data-copymail]"); if (!cp) return;
    const a = myEmail();
    try { await navigator.clipboard.writeText(a); cp.textContent = `Copied ${a}`; } catch (err) { cp.textContent = a; }
  });

  // Home: three quick paths for different visitors, and the Jermaine Dye career story.
  function startHere() {
    const dye = SECTIONS.find((x) => x.slug === "jermaine-dye"), st = DATA.site.dyeStory;
    const go = (h, t) => `<a href="${h}">${t} →</a>`;
    const col = (slug, t) => SECTIONS.some((x) => x.slug === slug) ? go(`#/c/${slug}`, t) : "";
    const pick = (part) => CARDS.find((c) => dye && c.si === SECTIONS.indexOf(dye) && c.name.toLowerCase().includes(part.toLowerCase()));
    const story = st && dye ? (st.highlights || []).map((h) => pick(h.card)).filter(Boolean).slice(0, 3) : [];
    return `<section class="start" aria-label="Start here">
      <div class="go-card"><div class="go-logos"><img class="go-logo" alt="Kansas City Royals logo" loading="lazy" src="https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Kansas_City_Royals_Primary_Logo.svg/120px-Kansas_City_Royals_Primary_Logo.svg.png" onerror="this.remove()"></div><h3>Royals fans</h3><p>Check out the Gordon and Dye Super Collections, or the Kansas City Royals Team Collection.</p>
        <div class="go-links">${col("alex-gordon", "Alex Gordon")}${col("jermaine-dye", "Jermaine Dye")}${col("royals", "Kansas City Royals")}</div></div>
      <div class="go-card"><div class="go-logos"><img class="go-logo" alt="Nebraska Cornhuskers logo" loading="lazy" src="https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Nebraska_Cornhuskers_logo.svg/120px-Nebraska_Cornhuskers_logo.svg.png" onerror="this.remove()"></div><h3>Husker fans</h3><p>Dig into the history of NFL Huskers, check out the autographs, and see an epic Husker card collection.</p>
        <div class="go-links">${go("#/checklist", "NFL Huskers Autograph List")}${go("#/nfl-huskers", "Husker Bios")}${col("husker-football", "Nebraska Football Cards &amp; Autos")}</div></div>
      <div class="go-card"><div class="go-logos"><span class="go-logo tcdb-badge" aria-label="TCDb">TCDb</span><img class="go-logo" alt="YouTube logo" loading="lazy" src="https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/YouTube_full-color_icon_%282017%29.svg/120px-YouTube_full-color_icon_%282017%29.svg.png" onerror="this.remove()"></div><h3>Collectors &amp; traders</h3><p>Interviews, my TCDb how-to videos, the cards I'm still hunting, and my duplicates.</p>
        <div class="go-links">${(DATA.site.media?.items || []).length ? go("#/media", "Media &amp; interviews") : ""}${col("want-list", "Want List")}${DUPES.length ? go("#/duplicates", "Duplicates") : ""}${go("https://www.tcdb.com/Profile.cfm/DyeHardFan", "Trade with me on TCDb").replace("<a ", '<a class="go-tcdb" ').replace("→", "↗").replace("<a ", '<a target="_blank" rel="noopener" ')}</div></div>
      ${story.length ? `<a class="go-story" href="#/dye-career"><div class="go-fan">${story.map((c) => `<img loading="lazy" alt="" src="${img(c.id, c.rk, 240)}">`).join("")}</div>
        <div><span class="kick">Featured story</span><h3>${esc(st.title)}</h3><p>Jermaine's career from the Braves to World Series MVP, told through the best cards in my collection.</p><span class="go-more">Read the story →</span></div></a>` : ""}
    </section>`;
  }

  // Card of the day: one card from the best of the best, the same all day. The top of the rarest list: 1 of 1s and
  // numbered /5 or less, never customs, programs, schedules, index cards, posters, oversize or letters.
  const COTD_BAD = /custom|program|schedule|index|poster|postcard|fathead|magazine|ticket|newspaper|letter|\b\d+x\d+\b|box (?:loader|topper)|checklist|\bsold\b/i;
  function cardOfDay() {
    const ok = (c) => !c.tags.has("custom") && !c.photo && (c.one || (c.serial && c.serial <= 5))
      && /^(?:19|20)\d\d(?:-\d\d)?\s.+#\S+/.test(c.name) && !COTD_BAD.test(c.name);
    const pool = CARDS.filter(ok); if (!pool.length) return "";
    const d = new Date(), day = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    let h = day; h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16;
    const c = pool[(h >>> 0) % pool.length];
    return `<aside class="cotd-big" aria-label="Card of the day"><span class="kick">Card of the day</span>
      <a class="cotd-card" href="#/card/${cid(c)}" aria-label="${esc(c.name)}"><img alt="" src="${img(c.id, c.rk, 1200)}"></a>
      <div class="cap"><b>${esc(c.title)}</b>${esc(c.sub)}${c.par ? `<br><span class="par">${esc(c.par)}</span>` : ""}</div></aside>`;
  }

  // Homepage: two full-screen doors. Each section sticks to the top and the next one slides up over it.
  function home() {
    setNav(null); setTitle("");
    $("#app").innerHTML = `<div class="wrap-tiles">
      <a class="tile-full tile-cards" href="#/cards" aria-label="The Cards" style="--tile-bg:#0b0d10;--tile-fg:#ffffff">
        <div class="tile-copy"><h1>The Cards</h1>
          <p>Legends remembered through cardboard treasures</p></div>
        <img class="tile-bg" src="assets/home-cards.jpg" alt="">
      </a>
      <a class="tile-full tile-players" href="#/nfl-huskers" aria-label="The Players" style="--tile-bg:#e0283f;--tile-fg:#fff8e7">
        <div class="tile-copy"><p class="tile-k">Husker pro history</p><h1>The Players</h1>
          <p>Nebraska players who went on to the NFL, MLB, NBA and beyond.</p></div>
        <img class="tile-bg" src="assets/home-players.jpg" alt="Illustrative artwork of a vintage football player (not a real person)">
        <span class="tile-tag">Illustrative</span>
      </a>
      <a class="tile-full tile-chase" href="#/checklist" aria-label="The Chase" style="--tile-bg:#c9a46a;--tile-fg:#2a1a08">
        <div class="tile-copy"><h1>The Chase</h1>
          <p>One autograph of every Husker to play in the NFL</p></div>
        <img class="tile-bg" src="assets/home-chase.jpg" alt="">
      </a>
    </div>`;
  }

  // The cards page: the card of the day, the collection stats and the collection tiles.
  function cardsHome() {
    setNav(null); setTitle("");
    const s = DATA.site;
    const newest = sortList(CARDS, "new").slice(0, 40);
    const ones = CARDS.filter((c) => c.one).length;
    const tiles = siteOrder().map((sec) => {
      if (sec === "customs") return customsTile();
      const si = SECTIONS.indexOf(sec);
      const list = sectionCards(si);
      const pick = [...list.filter((c) => c.one || c.tags.has("relic")), ...list].filter((c, k, a) => a.indexOf(c) === k);
      const step = Math.max(1, Math.floor(pick.length / 4));
      const four = [0, 1, 2, 3].map((k) => pick[k * step]).filter(Boolean);
      return `<a class="tile c-${sec.color}" href="#/c/${sec.slug}">
        <div class="fan">${four.map((c) => `<img loading="lazy" alt="" src="${img(c.id, c.rk, 240)}">`).join("")}</div>
        <h3>${esc(sec.title)}</h3>
        ${sec.progress ? `<div class="bar"><i style="width:${sec.progress}%"></i></div>` : ""}
        <div class="tm"><span>${fmt(list.length)} scans</span><span>${sec.progress ? pctText(sec) + " complete" : sec.groups.length > 1 ? sec.groups.length + " groups" : ""}</span></div></a>`;
    }).join("");
    function customsTile() {   // Customs isn't a Drive section (cards are tagged custom), so it gets its own tile
      const list = CARDS.filter((c) => c.tags.has("custom")); if (!list.length) return "";
      const step = Math.max(1, Math.floor(list.length / 4)), four = [0, 1, 2, 3].map((k) => list[k * step]).filter(Boolean);
      return `<a class="tile c-gold" href="#/customs"><div class="fan">${four.map((c) => `<img loading="lazy" alt="" src="${img(c.id, c.rk, 240)}">`).join("")}</div>
        <h3>Custom Cards</h3><div class="tm"><span>${fmt(list.length)} scans</span><span>${PHOTOS.length ? PHOTOS.length + " photos with players" : ""}</span></div></a>`;
    }
    $("#app").innerHTML = `<div class="wrap">
      ${cardOfDay()}
      <section class="hero">
        <div>
          <h1><span class="nw">Alex Gordon</span> &amp; <span class="nw">Jermaine Dye</span> <em class="nw">super collector</em></h1>
        </div>
        <figure class="hero-ph"><img alt="Alex Gordon (left) and Ian Badeer (right) in Nebraska gear" src="assets/hero.webp" srcset="assets/hero-560.webp 560w, assets/hero.webp 1024w" sizes="(max-width: 800px) 320px, 560px"></figure>
      </section>
      <section class="stats" aria-label="Collection stats">
        <a class="stat link has-logo c-husker" id="stat-nfl" href="#/checklist" hidden><b><i class="sn"></i><img class="stat-logo" alt="" src="https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Nebraska_Cornhuskers_logo.svg/120px-Nebraska_Cornhuskers_logo.svg.png" onerror="this.remove()"></b><span>NFL Husker Chase →</span><div class="bar"><i style="width:0"></i></div></a>
        ${SECTIONS.filter((x) => x.progress).map((x) => `<a class="stat link has-logo ${x.slug === "alex-gordon" || x.slug === "jermaine-dye" ? "c-royal c-gold-bar" : "c-royal"}" href="#/c/${x.slug}"><b><i class="sn">${pctText(x)}</i><img class="stat-logo" alt="" src="https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Kansas_City_Royals_Primary_Logo.svg/120px-Kansas_City_Royals_Primary_Logo.svg.png" onerror="this.remove()"></b><span>${esc(x.title)} Chase →</span><div class="bar"><i style="width:${parseFloat(pctText(x)) || 0}%"></i></div></a>`).join("")}
        <a class="stat link" href="#/stats"><b>📊</b><span>Scanned Collection Stats →</span></a>
        <a class="stat link" href="#/rarest"><b>💎</b><span>Rarest Cards →</span></a>
        <a class="stat link" href="#/letters"><b><img class="stat-ic" alt="" src="assets/letterman-icon.webp" width="76" height="36"></b><span>Letterman Sets →</span></a>
        <div class="stat"><b>${fmt(CARDS.length)}</b><span>cards scanned</span></div>
      </section>
      ${startHere()}
      <div class="band">
      <div class="sec-h"><h2>Newest additions</h2><a href="#/all">Browse everything →</a></div>
      <section class="mq" aria-label="Newest additions">
        <div class="mq-track" style="--dur:${newest.length * 4}s">${newest.map((c) => cardHTML(c)).join("")}<div class="mq-dup" aria-hidden="true">${newest.map((c) => cardHTML(c)).join("")}</div></div>
      </section>
      </div>
      <div class="sec-h"><h2>Collections</h2></div>
      <section class="tiles" style="margin-bottom:64px">${tiles}</section>
    </div>`;
    // The copy only exists so the loop looks seamless; keep it out of keyboard tab order.
    document.querySelectorAll(".mq-dup .cd").forEach((b) => (b.tabIndex = -1));
    state.list = newest;
    // Live from the checklist: share of NFL Huskers whose autograph is in the collection.
    loadCheckQuiet().then(() => {
      const t = allPlayers().filter((p) => p.listSlug === "nfl-tier-1-huskers"), el = $("#stat-nfl");
      if (!el || !t.length) return;
      el.querySelector(".sn").textContent = ((t.filter((p) => p.have).length / t.length) * 100).toFixed(2) + "%"; el.querySelector(".bar i").style.width = el.querySelector(".sn").textContent; el.hidden = false;
    }).catch(() => {});
  }

  function collection(slug, gslug) {
    const virtual = slug === "customs" || slug === "all" || slug === "search" || slug === "rarest" || slug === "duplicates" || slug === "recent";
    const si = SECTIONS.findIndex((x) => x.slug === slug);
    const sec = virtual ? null : SECTIONS[si];
    if (!virtual && !sec) return notFound();
    if (sec && sec.hidden) return go("#/c/customs", true);
    setNav(slug);
    let base, title, kick, blurb = "", groups = [], gi = -1, color = "royal", prog = "";
    if (sec) {
      base = sectionCards(si); title = sec.title; color = sec.color; blurb = sec.blurb || "";
      kick = { pc: "Player collection", chase: "Autograph chase", team: "Team collection", want: "Still hunting" }[sec.kind] || "Collection";
      groups = sec.groups;
      gi = groups.findIndex((g) => g.slug === gslug);
      if (gslug && gi < 0 && groups.length <= 1) { history.replaceState(history.state, "", toURL("#/c/" + slug)); gslug = ""; }   // a group that's gone (e.g. 2009-and-older)
      if (gi >= 0) base = base.filter((c) => c.gi === gi);
      if (sec.progress) prog = `<div class="prog"><b>${pctText(sec)}</b><div class="bar"><i style="width:${sec.progress}%"></i></div><small>${esc(sec.progressLabel || "complete")}</small></div>`;
      // Links to pages on this site open in place (→); outside links open a new tab (↗).
      blurb = esc(blurb) + (sec.extraLinks || []).map((l) => l.url.startsWith("#")
        ? ` <a href="${esc(l.url)}" style="color:var(--acc)">${esc(l.label)} →</a>`
        : ` <a href="${esc(l.url)}" target="_blank" rel="noopener" style="color:var(--acc)">${esc(l.label)} ↗</a>`).join(" ·");
    } else if (slug === "customs") {
      base = CARDS.filter((c) => c.tags.has("custom")); title = "Custom Cards"; kick = "Made by hand"; color = "gold";
      blurb = "Custom cards are a labor of love. I make mini cardboard treasures for myself, for friends, and as keepsakes for the athletes themselves.";
    } else if (slug === "duplicates") {
      base = DUPES.slice(); title = "Duplicates"; kick = "Whole collection";
      blurb = "Cards/Items that I have more than one copy of. A duplicate doesn't guarantee that it's available for trade, but it doesn't hurt to ask. "
        + `This list isn't complete: my full, up-to-date list of cards for trade is on <a href="https://www.tcdb.com/Profile.cfm/DyeHardFan" target="_blank" rel="noopener" style="color:var(--acc)">TCDb ↗</a>, and each player page links to that player's cards for trade.`;
    } else if (slug === "recent") {
      // The 120 most recently uploaded cards (the Want List isn't part of the collection).
      base = sortList(CARDS.filter((c) => SECTIONS[c.si].kind !== "want"), "new").slice(0, 120); title = "Recent Additions"; kick = "Whole collection";
      blurb = "The newest scans to land in my collection, most recent first.";
    } else if (slug === "rarest") {
      // Rarest cards: every numbered card, lowest print run first (1/1s, then /2, /3 …).
      base = CARDS.filter((c) => c.one || c.serial || c.printRun); title = "Rarest Cards"; kick = "Whole collection";
      blurb = "Every numbered card I've scanned, rarest first: one-of-ones, then /2, /3 and up.";
    } else {
      base = CARDS; title = state.q ? (state.q.startsWith("=") ? `${esc(state.q.slice(1))}’s cards` : `Results for “${esc(state.q)}”`) : "Every card"; kick = "Whole collection";
    }
    setTitle(slug === "search" ? `Search: ${state.q}` : slug === "all" ? "Every card" : slug === "rarest" ? "Rarest Cards" : slug === "duplicates" ? "Duplicates" : slug === "recent" ? "Recent Additions" : (sec ? sec.title : title) + (gi >= 0 ? ` (${groups[gi].label})` : ""));
    const side = "";   // desktop: no year list in the left bar (Ian, 2026-11-25); phones keep the .mgroups strip
    const others = `<div><h4>Collections</h4><ul>${siteOrder().map((x) => x === "customs"
        ? `<li><a href="#/customs" aria-current="${slug === "customs"}">Customs<span>${fmt(CARDS.filter((c) => c.tags.has("custom")).length)}</span></a></li>`
        : `<li><a href="#/c/${x.slug}" aria-current="${x.slug === slug}">${esc(x.title)}<span>${fmt(sectionCards(SECTIONS.indexOf(x)).length)}</span></a></li>`).join("")}</ul></div>`;
    const mg = groups.length > 1 ? `<nav class="mgroups" aria-label="Groups"><a href="#/c/${slug}" aria-current="${gi < 0}">All</a>${groups.map((g, k) => `<a href="#/c/${slug}/${g.slug}" aria-current="${k === gi}">${esc(g.label)}</a>`).join("")}</nav>` : "";
    // A search that finds nothing tries fixing misspelled words ("gordan" → "gordon").
    let q = state.q, fixed = null;
    if (slug === "search" && q && !search(base, q).length) { const f = fixQuery(q, cardVocab(), (w) => CARDS.some((c) => c.hay.includes(w))); if (f && search(base, f).length) q = fixed = f; }
    state.hq = q;
    if (fixed) title = `Results for “${esc(fixed)}”`;
    $("#app").innerHTML = `<div class="wrap coll c-${color}">
      <aside class="side">${side}${others}</aside>
      <div style="min-width:0">
        <div class="c-top${sec && invBox(sec.slug) ? " with-inv" : ""}${slug === "customs" && customVideos() ? " with-inv with-vid" : ""}"><div class="c-head"><div class="kick">${kick}${gi >= 0 ? " · " + esc(groups[gi].label) : ""}</div><h1>${title}</h1>${blurb ? `<p>${blurb}</p>` : ""}<div class="c-logos" id="c-logos"></div>${prog}</div>${sec ? invBox(sec.slug) : ""}${slug === "customs" ? customVideos() : ""}</div>
        ${mg}
        ${slug === "search" && parseQuery(q).said.length ? `<p class="fixnote smart">Showing ${parseQuery(q).words.length ? `<b>${esc(parseQuery(q).words.join(" "))}</b> · ` : ""}${parseQuery(q).said.map((x) => `<span class="sq">${esc(x)}</span>`).join(" ")}</p>` : ""}
        ${fixed ? `<p class="fixnote">Nothing matched “${esc(state.q)}”, so these are results for <b>${esc(fixed)}</b>.</p>` : ""}
        ${slug === "search" ? `${pageShortcut(state.q)}<div id="pmatch"></div>` : ""}
        ${slug === "customs" ? withPlayers() : ""}
        <div class="tools">
          <div class="chips" role="group" aria-label="Filters">${[...(slug === "customs" ? CUSTOM_FILTERS : FILTERS), ...(PAGE_FILTERS[slug] || [])].filter(([k]) => !(PAGE_NO_FILTERS[slug] || new Set()).has(k)).filter(([k]) => !RARE_FILTERS.has(k) || state.filters.has(k) || base.some((c) => c.tags.has(k))).map(([k, l]) => `<label class="chip fchip" data-f="${k}"><input type="checkbox" data-f="${k}"${state.filters.has(k) ? " checked" : ""}><span>${l}</span></label>`).join("")}</div>
          <div class="tools-r">${binderBtn()}${(sec || slug === "customs") && gi < 0 ? `<button type="button" class="btn" data-share-c="${slug}" aria-label="Share this collection">Share</button>` : ""}<span class="count" id="count"></span>${(() => { const ds = [...new Set(base.filter((c) => c.year < 9999).map((c) => Math.floor(c.year / 10) * 10))].sort((a, b) => b - a);
            const teams = [...new Set(base.map((c) => c.team).filter(Boolean))].sort((a, b) => a.localeCompare(b));
            const tm = teams.length ? `<label class="sr" for="tm">Team</label><select id="tm"><option value="">All Teams</option>${teams.map((t) => `<option value="${esc(t)}"${state.team === t ? " selected" : ""}>${esc(t)} (${fmt(base.filter((c) => c.team === t).length)})</option>`).join("")}</select>` : "";
            return tm + (ds.length > 1 ? `<label class="sr" for="yr">Years</label><select id="yr"><option value="">All Years</option>${ds.map((d) => `<option value="${d}"${state.decade === String(d) ? " selected" : ""}>${d}s</option>`).join("")}</select>` : ""); })()}<label class="sr" for="sort">Sort</label><select id="sort">${SORTS.map(([k, l]) => `<option value="${k}"${state.sort === k ? " selected" : ""}>${l}</option>`).join("")}</select></div>
        </div>
        <div class="grid" id="grid"></div><div class="sentinel" id="sentinel"></div><p class="c-logo-cr" id="c-logo-cr"></p>
      </div></div>`;
    const apply = () => {
      let list = search(base, q);
      if (!matchMedia("(max-width:860px)").matches) state.filters.forEach((f) => (list = list.filter((c) => c.tags.has(f))));   // phones have no filter chips
      if (state.decade && (!$("#yr") || $("#yr").value !== state.decade)) state.decade = "";   // a decade this page doesn't have
      if (state.decade) list = list.filter((c) => Math.floor(c.year / 10) * 10 === +state.decade);   // the Years menu
      if (state.team && (!$("#tm") || $("#tm").value !== state.team)) state.team = "";
      if (state.team) list = list.filter((c) => c.team === state.team);   // the Team menu (team subfolders in Drive)
      state.list = sortList(list, state.sort); state.shown = 0;
      $("#grid").innerHTML = state.list.length ? "" : `<p class="empty">${slug === "customs" && state.filters.has("nonsport") ? "Non-sport customs, like my Sonic the Hedgehog cards, are coming soon." : state.filters.size ? "No cards match. Try removing a filter or a search word." : `No cards match “${esc(state.q)}”. Try a player (Alex Gordon), a set (Triple Threads) or a year (2013).`}</p>`;
      $("#count").textContent = `${fmt(state.list.length)} scan${state.list.length === 1 ? "" : "s"}`;
      more();
    };
    $(".chips").addEventListener("change", (e) => {
      const b = e.target.closest("input[data-f]"); if (!b) return;
      b.checked ? state.filters.add(b.dataset.f) : state.filters.delete(b.dataset.f);
      apply(); syncURL();
    });
    // Desktop: the filters and buttons live in the left bar; phones keep them above the cards.
    const tools = $(".coll .tools"), mainCol = tools.parentNode, aside = $(".coll .side");
    placeTools = () => { if (!tools.isConnected) return;
      if (matchMedia("(min-width:861px)").matches) { tools.classList.add("in-side"); aside.prepend(tools); }
      else { tools.classList.remove("in-side"); mainCol.insertBefore(tools, mainCol.querySelector("#grid")); } };
    placeTools();
    $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; apply(); syncURL(); });
    $("#yr")?.addEventListener("change", (e) => { state.decade = e.target.value; apply(); syncURL(); });
    $("#tm")?.addEventListener("change", (e) => { state.team = e.target.value; apply(); syncURL(); pageBg(""); drawLogos(slug); });
    drawLogos(slug);
    apply();
    if (state.filters.size || state.sort !== defaultSort(state.where)) syncURL();
    io.observe($("#sentinel"));
    if (slug === "search") playerMatches(q, state.q);
  }
  let placeTools = null;
  matchMedia("(min-width:861px)").addEventListener("change", () => placeTools && placeTools());
  // Share a collection: its c/<slug>/ link, which shows the collection's own picture and title in texts and on social media.
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-share-c]"); if (!b) return;
    const url = absURL(b.dataset.shareC === "customs" ? "#/customs" : "#/c/" + b.dataset.shareC), title = document.title;
    if (navigator.share && matchMedia("(pointer: coarse)").matches) { try { await navigator.share({ title, url }); } catch (err) {} return; }
    try { await navigator.clipboard.writeText(url); b.textContent = "Link copied"; } catch (err) { prompt("Copy this link:", url); }
    setTimeout(() => (b.textContent = "Share"), 2000);
  });
  // Searching for a page by what it's about puts that page first ("letter", "letterman", "lettermen" → all letterman sets).
  function pageShortcut(q) {
    if (/^\s*(duplicates?|dupes?|doubles|extras?)\s*$/i.test(q || "") && DUPES.length) return `<div class="pmatch"><h4>Page</h4><div class="pm-list"><a class="pm" href="#/duplicates"><span class="pm-ph pm-ic" aria-hidden="true">⧉</span>
      <span class="pm-t"><b>Duplicates</b><small>Cards I have more than one copy of</small></span><span class="pm-go">→</span></a></div></div>`;
    if (!/^\s*(letter|letters|letterman|lettermans|lettermen)(\s+sets?)?\s*$/i.test(q || "")) return "";
    return `<div class="pmatch"><h4>Page</h4><div class="pm-list"><a class="pm" href="#/letters"><span class="pm-ph pm-ic pm-wide" aria-hidden="true"><img alt="" src="assets/letterman-icon.webp" width="76" height="36" style="opacity:1"></span>
      <span class="pm-t"><b>All letterman sets</b><small>Every set by the word it spells, with the letters I still need</small></span><span class="pm-go">→</span></a></div></div>`;
  }
  // Searching a name also offers that player's NFL Huskers page.
  function playerMatches(q, asked = q) {
    if (norm(q).length < 3) return;
    loadCheckQuiet().then(() => {
      const box = $("#pmatch"); if (!box || state.q !== asked) return;
      const find = (t) => { const words = norm(t).split(" ").filter(Boolean);
        return allPlayers().filter((p) => { const h = " " + norm(p.name) + " " + p.name.toLowerCase() + " "; return words.every((w) => h.includes(w)); }).slice(0, 8); };
      let hits = find(q);
      if (!hits.length) {   // a misspelled name ("ricky simons") still finds the player page
        const names = allPlayers().map((p) => norm(p.name)), V = new Map();
        names.forEach((n) => n.split(" ").forEach((w) => w.length > 2 && V.set(w, (V.get(w) || 0) + 1)));
        const f = fixQuery(norm(q), V, (w) => names.some((n) => n.includes(w)));
        if (f) hits = find(f);
      }
      if (!hits.length) return;
      box.innerHTML = `<div class="pmatch"><h4>Husker Bios</h4><div class="pm-list">${hits.map((p) => {
        const sc = p.have ? bestScan(p.name, p.sport) : null;
        return `<a class="pm" href="#/player/${p.slug}">${pmPh(sc, p.slug)}
          <span class="pm-t"><b>${hl(p.name, q)}${hofMarks(p)}</b><small>${p.tagline ? esc(p.tagline) : `${p.league} Husker`}${p.year ? ` · Nebraska through ${esc(p.year)}` : ""}</small></span><span class="pm-go">→</span></a>`;
      }).join("")}</div></div>`;
    }).catch(() => {});
  }
  // Customs page: a slowly rotating strip of photos with the players, then the videos.
  function withPlayers() {
    const tile = (p, k) => `<button type="button" class="ph-tile" data-photo="${k}" aria-label="${esc(p.caption)}">
      <img decoding="async" alt="" src="${img(p.id, p.rk, 500)}" onload="this.classList.add('ok')"><span><em>${esc(p.short)}</em></span></button>`;
    // A still row of photos; one at a time fades out and another fades in (startPhotoRow).
    const strip = PHOTOS.length ? `<h2 class="sub-h">With the players</h2><section class="ph-row" id="ph-row" aria-label="Photos with the players"></section>` : "";
    return strip ? `<div class="players">${strip}<h2 class="sub-h">The cards</h2></div>` : "";
  }
  // The Customs page's video(s): small, in the top right corner beside the page title (Ian, 2026-11-25).
  function customVideos() {
    const vids = ((DATA.site.customsPhotos || {}).videos || []).filter((v) => v.id);
    return vids.length ? `<div class="vids vids-top">${vids.map((v) => `<figure class="vid">
        <div class="vid-frame"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}${v.start ? `?start=${+v.start}` : ""}" title="${esc(v.caption || "Video")}" loading="lazy"
          referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>
        ${v.caption ? `<figcaption>${esc(v.caption)}</figcaption>` : ""}</figure>`).join("")}</div>` : "";
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-photo]"); if (!b) return;
    openViewer(+b.dataset.photo, PHOTOS);
  });
  // A player's reference images: the file name names the player ("Rex Burkhead Compilation"). Each image goes to the
  // player with the longest name found in it, so "Rex Burkhead" never also lands on a shorter name it contains.
  let REF_OWNER = null;
  function refsFor(name) {
    if (!REF_OWNER) {
      const names = [...new Set(allPlayers().map((x) => norm(x.name)))].filter(Boolean).sort((a, b) => b.length - a.length);
      REF_OWNER = new Map(REFS.map((r) => [r, names.find((n) => ` ${norm(r.name)} `.includes(` ${n} `)) || ""]));
    }
    return REFS.filter((r) => REF_OWNER.get(r) === norm(name));
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ref]"); if (!b) return;
    const list = refsFor(b.dataset.refName); openViewer(Math.max(0, list.findIndex((r) => r.id === b.dataset.ref)), list);
  });
  function more() {
    const grid = $("#grid"); if (!grid) return;
    const next = state.list.slice(state.shown, state.shown + 72);
    grid.insertAdjacentHTML("beforeend", next.map((c) => cardHTML(c, state.hq ?? state.q)).join(""));
    state.shown += next.length;
  }
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && state.shown < state.list.length && more()), { rootMargin: "1200px" });

  /* ---------- Husker checklist (from the private master, published columns only) ---------- */
  let CHECK = null;
  const CK = { list: 0, q: "", show: "all", sort: "year", dir: 1 };
  // Autograph list sorting: Year (the list's own order, the default), last name, NFL games played, or need/have (needs first).
  const CK_SORTS = [["year", "Year"], ["name", "Last name"], ["games", "Games played"], ["have", "Need / Have"], ["signed", "Signed on"]];
  const lastName = (n) => { const w = String(n).replace(/["“][^"”]*["”]/g, " ").replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, " ").replace(/[.,]/g, " ").trim().split(/\s+/); return (w[w.length - 1] + " " + w.slice(0, -1).join(" ")).toLowerCase(); };
  const norm = (t) => String(t).toLowerCase().replace(/["“”][^"“”]*["“”]/g, " ").replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  // A player's scans come only from their own sport's Nebraska section, so two Huskers with the
  // same name in different sports (e.g. Eric Johnson, football and basketball) never share cards.
  const scanIndex = {};
  const SPORT_OF_LIST = { "nfl-tier-1-huskers": "football", "nfl-tier-2-huskers": "football", "pro-football-huskers": "football", "baseball-mlb": "baseball", "basketball-nba": "basketball" };
  function scansFor(name, sport = "football") {
    if (!scanIndex[sport]) {
      // A sport ("football" → my Nebraska football section) or a section slug ("royals", for cardPlayers).
      const si = SECTIONS.findIndex((s) => s.slug === "husker-" + sport) >= 0 ? SECTIONS.findIndex((s) => s.slug === "husker-" + sport) : SECTIONS.findIndex((s) => s.slug === sport);
      // "(Hand Signed by Tyrone Fahie)": the autograph is his, so the card goes on his page only, not the pictured player's.
      const who = (c) => { const m = c.name.match(/\(\s*hand signed by ([^)]+)\)/i); return m ? m[1] : c.name; };
      // Plus the customs-only Drive folders ("Customs"): a custom of him shows on his page wherever Ian files it.
      scanIndex[sport] = si < 0 ? [] : CARDS.filter((c) => c.si === si || (SECTIONS[c.si].customs && SECTIONS[si].slug.startsWith("husker-"))).map((c) => [" " + norm(who(c)) + " ", c]);
    }
    const n = norm(name); if (n.split(" ").length < 2) return [];
    // Cards filed under another name for him (config/site.json "playerAliases": "Les McDonald" → "Lester McDonald").
    const ns = [n, ...(((DATA && DATA.site.playerAliases) || {})[name] || []).map(norm)];
    return scanIndex[sport].filter(([t]) => ns.some((x) => t.includes(" " + x + " "))).map(([, c]) => c);
  }
  // One page per published list. #/checklist (no suffix) stays the NFL page so old links keep working.
  const CK_PAGES = [
    { path: "", slug: "nfl-tier-1-huskers", label: "NFL Tier 1 Huskers Autograph List", blurb: "One autograph of every Husker who played in at least one NFL game." },
    { path: "/tier-2", slug: "nfl-tier-2-huskers", label: "NFL Tier 2 Huskers Autograph List", blurb: "One autograph of every Husker who made an NFL active roster, preseason roster, injured reserve or practice squad without playing in a game." },
    { path: "/tier-3", slug: "pro-football-huskers", label: "NFL Tier 3 Huskers Autograph List", blurb: "One autograph of every Husker who was drafted by, went to camp with or tried out for an NFL team, or played in another pro league." },
    { path: "/mlb", slug: "baseball-mlb", label: "MLB Huskers Autograph List", blurb: "One autograph of every Husker who played in the major leagues." },
    { path: "/nba", slug: "basketball-nba", label: "NBA Huskers Autograph List", blurb: "One autograph of every Husker who played in the NBA." },
  ];
  /* "Find a player" boxes: other names a player goes by also find him. Sources: common nicknames (Cam = Cameron,
     Mike = Michael…), the name Wikipedia opens his article with ("Cameron Jurgens"), and hand-added names in
     config/site.json "playerAliases" ("JoJo Domann": ["Johansen Domann"]). Each word typed must match one of them;
     a name that finds nobody is then spell-checked against the list's names (fixQuery). */
  const NICK_GROUPS = ["cam cameron", "mike michael mikey", "matt matthew", "chris christopher", "nick nicholas nicky", "tom thomas tommy",
    "bob robert rob bobby robbie", "bill william will billy willie", "jim james jimmy jamie", "joe joseph joey", "dave david davey", "dan daniel danny",
    "ben benjamin benny", "tony anthony", "andy andrew drew", "steve steven stephen", "jon jonathan john johnny jack", "ed edward eddie ted",
    "rick richard rich ricky dick", "pat patrick", "sam samuel sammy", "alex alexander", "zach zachary zack zac", "jake jacob", "josh joshua",
    "ken kenneth kenny", "ron ronald ronnie", "don donald donnie", "greg gregory", "jeff jeffrey jeffery", "larry lawrence", "jerry gerald jerald",
    "charlie charles chuck charley", "fred frederick freddie", "tim timothy timmy", "vince vincent", "nate nathan nathaniel", "gabe gabriel",
    "max maxwell", "doug douglas", "phil phillip philip", "ray raymond", "al albert alan allen", "gene eugene", "herb herbert", "les lester",
    "lenny leonard leo", "walt walter", "hank henry", "harry harold", "jojo johansen", "tj", "dj", "aj", "cj", "jj"];
  const NICKS = new Map(); NICK_GROUPS.forEach((g) => { const w = g.split(" "); w.forEach((x) => NICKS.set(x, w)); });
  const ALIAS_CACHE = new Map();
  function playerHay(name) {
    if (ALIAS_CACHE.has(name)) return ALIAS_CACHE.get(name);
    const names = [name, ...((DATA && DATA.site.playerAliases) || {})[name] || []];
    const p = PLAYERS && (PLAYERS.players || []).find((x) => x.name === name);
    const m = p && ((p.wiki || {}).intro || "").match(/^([A-Z][^(,]{2,60}?)\s*\(/); if (m) names.push(m[1].replace(/["“][^"”]*["”]/g, " "));
    const words = new Set(names.flatMap((n) => norm(n).split(" ")).filter(Boolean));
    [...words].forEach((w) => (NICKS.get(w) || []).forEach((x) => words.add(x)));
    const hay = " " + [...words].join(" ") + " " + names.join(" ").toLowerCase() + " ";
    if (PLAYERS) ALIAS_CACHE.set(name, hay);
    return hay;
  }
  // Does this player match what was typed? Every word has to start a word of one of his names (or appear in "extra").
  const playerMatch = (name, q, extra = "") => { const hay = playerHay(name) + " " + extra.toLowerCase();
    return norm(q).split(" ").filter(Boolean).every((w) => hay.includes(" " + w) || (w.length > 3 && hay.includes(w))); };
  // A typed name that finds nobody: the closest spelling among these names (and their other names).
  function fixPlayerQuery(q, names, ok) {
    const vocab = new Map(); names.forEach((n) => playerHay(n).split(" ").forEach((w) => w.length > 2 && /^[a-z]+$/.test(w) && vocab.set(w, (vocab.get(w) || 0) + 1)));
    const f = fixQuery(q.toLowerCase(), vocab, (w) => vocab.has(w), 3);
    return f && ok(f) ? f : null;
  }
  let SPORTTEAMS = null;   // { teams: { club: { logo } }, players: { name: [club, ...] } }
  function checklist(which) {
    const page = CK_PAGES.find((x) => x.path === (which ? "/" + which : "")) || CK_PAGES[0];
    setNav("checklist" + page.path); setTitle(page.label);
    if (!PLAYERS) fetch("data/players.json").then((r) => (r.ok ? r.json() : null)).then((d) => { if (!d || PLAYERS) return; PLAYERS = withCardBios(d); ALIAS_CACHE.clear(); if (CK.q && $("#ck-table")) table(); }).catch(() => {});
    if (!CHECK) {
      $("#app").innerHTML = `<p class="loading">Loading the checklist…</p>`;
      fetch("data/lists/husker-pros.json").then((r) => { if (!r.ok) throw 0; return r.json(); })
        .then((d) => { CHECK = d; checklist(which); })
        .catch(() => ($("#app").innerHTML = `<p class="empty">The checklist isn't available yet.</p>`));
      return;
    }
    CK.list = CHECK.lists.findIndex((x) => x.slug === page.slug);
    if (CK.list < 0) return ($("#app").innerHTML = `<p class="empty">This list isn't available yet.</p>`);
    // MLB and NBA lists: which clubs each player played for, and their logos (data/sports-team-logos.json).
    if (["baseball", "basketball"].includes(SPORT_OF_LIST[CHECK.lists[CK.list].slug]) && !SPORTTEAMS) {
      fetch("data/sports-team-logos.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
        .then((d) => { SPORTTEAMS = d; checklist(which); });
      return;
    }
    if (CK.page !== page.path) { CK.page = page.path; CK.q = ""; CK.show = "all"; }
    const l = CHECK.lists[CK.list], ai = l.columns.indexOf("Autograph"), si = l.columns.indexOf("Signed");
    let n = 0, y = 0; const types = {};
    l.groups.forEach((g) => g.rows.forEach((r) => { n++; if (r[ai] === "Yes") y++; if (si >= 0 && r[si]) types[r[si]] = (types[r[si]] || 0) + 1; }));
    const pct = n ? (y / n) * 100 : 0;
    const typeRows = Object.entries(types).sort((a, b) => b[1] - a[1]);
    const tmax = typeRows.length ? typeRows[0][1] : 1;
    // Each autograph list: three autographed cards from players on the list, picked at random each visit.
    const sport = SPORT_OF_LIST[l.slug], showcase = [];
    {
      var pool = l.groups.flatMap((g) => g.rows).filter((r) => r[ai] === "Yes")
        .map((r) => scansFor(r[0], sport).filter((c) => c.tags.has("auto"))).filter((x) => x.length);
      const rest = pool.slice();
      while (showcase.length < 3 && rest.length) { const k = Math.floor(Math.random() * rest.length), list = rest.splice(k, 1)[0]; showcase.push(list[Math.floor(Math.random() * list.length)]); }
    }
    $("#app").innerHTML = `<div class="wrap ck c-husker">
      <div class="${showcase.length ? "ck-top" : ""}"><div class="c-head">
        <div class="kick">Autograph checklist · updated from my collection spreadsheet</div>
        <div class="c-title"><h1>${esc(page.label)}</h1><div class="c-logos" id="c-logos"></div></div>
        ${page.path === "" && DATA.site.nflListStory ? `<div class="story short">${DATA.site.nflListStory.map((t) => `<p>${esc(t)}</p>`).join("")}<button type="button" class="story-more" onclick="this.parentNode.classList.remove('short')">Read the full story</button></div>` : ""}
        <p>${esc(page.blurb)} Green means it's in my collection. If you can help with anyone marked <b>Need</b>, I'd love to hear from you.</p>
        <div class="prog"><b>${pct.toFixed(2)}%</b><div class="bar"><i style="width:${pct}%"></i></div><small>${fmt(y)} of ${fmt(n)} signed</small></div>
      </div>${showcase.length ? `<div class="ck-fan" aria-label="Autographs from this list">${showcase.map((c) => `<button type="button" class="cd" data-i="${c.i}" aria-label="${esc(c.name)}">
        <img alt="" src="${img(c.id, c.rk, 400)}" onload="fanFit(this); this.classList.add('ok')"></button>`).join("")}</div>` : ""}</div>
      ${{ "nfl-tier-1-huskers": "tier-1", "nfl-tier-2-huskers": "tier-2", "pro-football-huskers": "tier-3" }[page.slug]
        ? `<p class="ck-plain"><a href="nfl-huskers/${{ "nfl-tier-1-huskers": "tier-1", "nfl-tier-2-huskers": "tier-2", "pro-football-huskers": "tier-3" }[page.slug]}.html">Plain version of this list to share or cite →</a></p>` : ""}
      <nav class="ck-others" aria-label="Other autograph lists">${CK_PAGES.filter((x) => x !== page && CHECK.lists.some((m) => m.slug === x.slug)).map((x) => `<a href="#/checklist${x.path}">${esc(x.label)} →</a>`).join("")}</nav>
      <div class="ck-body${typeRows.length ? "" : " solo"}">
        <div style="min-width:0">
          <div class="tools">
            <div class="chips" role="group" aria-label="Show">${[["all", "Everyone"], ["have", "Have"], ["need", "Need"]].map(([k, t]) => `<button type="button" class="chip" data-show="${k}" aria-pressed="${CK.show === k}">${t}</button>`).join("")}</div>
            <div class="tools-r"><label class="sr" for="ck-q">Search this list</label><input id="ck-q" class="ck-q" type="search" placeholder="Find a player" value="${esc(CK.q)}">
              <label class="sr" for="ck-sort">Sort</label><select id="ck-sort">${CK_SORTS.filter(([k]) => (k !== "games" || CHECK.lists[CK.list].columns.includes("NFL Games Played")) && (k !== "signed" || CHECK.lists[CK.list].columns.includes("Signed"))).map(([k, t]) => `<option value="${k}"${CK.sort === k ? " selected" : ""}>Sort: ${t}</option>`).join("")}</select><span class="count" id="ck-count"></span></div>
          </div>
          <div class="ck-table" id="ck-table"></div>
        </div>
        ${typeRows.length ? `<aside class="ck-side"><h4>What they signed</h4>${typeRows.map(([t, c]) => `<div class="ty"><span>${esc(t)}</span><span class="tn">${fmt(c)}</span><div class="bar"><i style="width:${(c / tmax) * 100}%"></i></div></div>`).join("")}</aside>` : ""}
      </div><p class="c-logo-cr" id="c-logo-cr"></p>${["baseball", "basketball"].includes(SPORT_OF_LIST[l.slug]) ? `<p class="c-logo-cr">Team logos from each club's Wikipedia article. Team names and logos are trademarks of their clubs.</p>` : ""}</div>`;
    drawLogos("husker-football");
    $("#ck-sort").addEventListener("change", (e) => { CK.sort = e.target.value; CK.dir = 1; table(); });
    $("#ck-table").addEventListener("click", (e) => { const b = e.target.closest("[data-sort]"); if (!b) return;
      if (CK.sort === b.dataset.sort) CK.dir = -CK.dir; else { CK.sort = b.dataset.sort; CK.dir = 1; }
      $("#ck-sort").value = CK.sort; table(); });
    $(".ck .chips").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (!b) return; CK.show = b.dataset.show; document.querySelectorAll(".ck .chip").forEach((x) => x.setAttribute("aria-pressed", x === b)); table(); });
    $("#ck-q").addEventListener("input", (e) => { CK.q = e.target.value.trim(); table(); });
    state.list = showcase;
    if (showcase.length === 3 && pool.length > 3) cycleFan(pool, showcase);
    table();
  }
  // Every 5 seconds one of the three cards fades out and a different player's autograph fades in,
  // taking turns left to right. Pauses under the mouse, in a background tab, and for reduced motion.
  let fanTimer = null;
  function cycleFan(pool, shown) {
    clearInterval(fanTimer);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const fan = $(".ck-fan"); let slot = 0, busy = false;
    fanTimer = setInterval(() => {
      if (!document.body.contains(fan)) return clearInterval(fanTimer);
      if (busy || document.hidden || fan.matches(":hover") || !$("#viewer").hidden) return;
      const others = pool.filter((list) => !shown.some((c) => list.includes(c)));
      if (!others.length) return;
      const list = others[Math.floor(Math.random() * others.length)], next = list[Math.floor(Math.random() * list.length)];
      const btn = fan.children[slot], im = btn.querySelector("img"); busy = true;
      btn.classList.add("swap");
      setTimeout(() => {
        const pre = new Image();
        pre.onload = pre.onerror = () => {
          im.src = pre.src; fanFit(im, pre); btn.dataset.i = next.i; btn.setAttribute("aria-label", next.name);
          shown[slot] = next; btn.classList.remove("swap"); slot = (slot + 1) % 3; busy = false;
        };
        pre.src = img(next.id, next.rk, 400);
      }, 450);
    }, 5000);
  }
  function table() {
    const l = CHECK.lists[CK.list], cols = l.columns, ai = cols.indexOf("Autograph");
    const hasPages = SPORT_LISTS.some((x) => x[1] === l.slug);   // only these lists have player pages to link to
    const shown = cols.map((c, i) => i).filter((i) => i !== ai);
    const opt = (c) => /notes|games|role/i.test(c) ? " opt" : "";
    const label = (c) => (c === "Signed" ? "Signed on" : c);
    // A name that finds nobody tries the closest spelling among this list's players ("ndamukong sue" → "ndamukong suh").
    let q = CK.q.toLowerCase(), fixedQ = null;
    const passes = (r, qq) => (CK.show === "all" || (CK.show === "have") === (r[ai] === "Yes")) && (!qq || playerMatch(r[0], qq, r.slice(1).join(" ")));
    if (q && !l.groups.some((g) => g.rows.some((r) => passes(r, q)))) {
      const f = fixPlayerQuery(q, l.groups.flatMap((g) => g.rows.map((r) => r[0])), (f) => l.groups.some((g) => g.rows.some((r) => passes(r, f))));
      if (f) { q = f; fixedQ = f; }
    }
    let count = 0;
    const gi = cols.indexOf("NFL Games Played"), yi = cols.indexOf("Last Year"), si = cols.indexOf("Signed");
    if ((CK.sort === "games" && gi < 0) || (CK.sort === "signed" && si < 0)) CK.sort = "year";
    const num = (v) => { const n = parseInt(String(v).replace(/[^\d]/g, ""), 10); return isNaN(n) ? -1 : n; };
    const cmp = { year: (a, b) => (num(b.r[yi]) - num(a.r[yi])) || a.k - b.k, name: (a, b) => lastName(a.r[0]).localeCompare(lastName(b.r[0])),
      games: (a, b) => (num(b.r[gi]) - num(a.r[gi])) || lastName(a.r[0]).localeCompare(lastName(b.r[0])),
      signed: (a, b) => (!a.r[si]) - (!b.r[si]) || String(a.r[si] || "").localeCompare(String(b.r[si] || "")) || (num(b.r[yi]) - num(a.r[yi])) || a.k - b.k,
      have: (a, b) => ((a.r[ai] === "Yes") - (b.r[ai] === "Yes")) || (num(b.r[yi]) - num(a.r[yi])) || a.k - b.k }[CK.sort];
    const sortRows = (rows) => rows.map((r, k) => ({ r, k })).sort((a, b) => cmp(a, b) * CK.dir).map((x) => x.r);
    // MLB and NBA lists are short, so each player's default card (his bio's picture) gets a column before the scans.
    const photos = ["baseball", "basketball"].includes(SPORT_OF_LIST[l.slug]);
    const clubs = (name) => (SPORTTEAMS && SPORTTEAMS.players && SPORTTEAMS.players[name]) || [];
    const clubLogos = (name) => clubs(name).map((t) => { const L = ((SPORTTEAMS || {}).teams || {})[t] || {};
      return L.logo ? `<img class="tl" alt="" title="${esc(t)}" src="${esc(L.logo)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'tl-txt',textContent:'${esc(t)}'}))">` : `<span class="tl-txt">${esc(t)}</span>`; }).join("");
    const body = l.groups.map((g) => {
      const rows = sortRows(g.rows.filter((r) => passes(r, q)));
      count += rows.length; if (!rows.length) return "";
      return (g.title ? `<tr class="grp"><th colspan="${shown.length + 2 + (photos ? 2 : 0)}">${esc(g.title)}</th></tr>` : "") + rows.map((r) => {
        const have = r[ai] === "Yes", scans = have ? scansFor(r[0], SPORT_OF_LIST[l.slug]) : [];
        const hero = have && photos ? bestScan(r[0], SPORT_OF_LIST[l.slug]) : null, heroK = hero ? Math.max(0, scans.indexOf(hero)) : 0;
        return `<tr class="${have ? "have" : "need"}"${scans.length ? ` data-peek="${esc(r[0])}" data-sport="${SPORT_OF_LIST[l.slug]}"` : ""}><td><span class="st ${have ? "have" : "need"}">${have ? "Have" : "Need"}</span>${(l.notes || {})[r[0]] ? `<button type="button" class="nt-btn nt-m" data-note="${esc(r[0])}" aria-expanded="false" aria-label="Why ${esc(r[0])} is on this list">i</button>` : ""}</td>
          ${shown.map((i, k) => `<td class="${k === 0 ? "nm" : ""}${opt(cols[i])}">${k === 0 ? (hasPages ? `<a class="pl-link" href="#/player/${slugFor(l.slug, r[i])}">${hl(r[i], fixedQ || CK.q)}</a>` : hl(r[i], fixedQ || CK.q)) + ((l.notes || {})[r[i]] ? ` <button type="button" class="nt-btn nt-d" data-note="${esc(r[i])}" aria-expanded="false" aria-label="Why ${esc(r[i])} is on this list" title="Why he's on this list">i</button>` : "") : esc(r[i])}</td>`).join("")}
          ${photos ? `<td class="tms"><div class="tms-in">${clubLogos(r[0])}</div></td>` : ""}
          ${photos ? `<td class="ph">${hero ? `<button type="button" class="ck-ph" data-scan="${esc(r[0])}" data-sport="${SPORT_OF_LIST[l.slug]}" data-k="${heroK}" aria-label="View ${esc(r[0])}'s card: ${esc(hero.title || hero.name)}"><img alt="" loading="lazy" src="${img(hero.id, hero.rk, 240)}" onload="thumbFit(this)"></button>` : ""}</td>` : ""}
          <td class="sc">${scans.length ? `<button type="button" class="btn sm" data-scan="${esc(r[0])}" data-sport="${SPORT_OF_LIST[l.slug]}">${scans.length === 1 ? "Scan" : scans.length + " scans"}</button>` : ""}</td></tr>`;
      }).join("");
    }).join("");
    $("#ck-count").textContent = `${fmt(count)} ${count === 1 ? "person" : "people"}`;
    const SORT_OF = { Player: "name", "NFL Games Played": "games", "Last Year": "year", Signed: "signed" };
    // Arrows show the direction on screen: Year and Games start highest first (▼), Last name A–Z (▲).
    const down = (key) => (key === "year" || key === "games" ? CK.dir > 0 : CK.dir < 0);
    const th = (text, key, cls = "") => `<th class="${cls}"${key ? ` aria-sort="${CK.sort === key ? (down(key) ? "descending" : "ascending") : "none"}"` : ""}>${key ? `<button type="button" class="th-sort${CK.sort === key ? " on" : ""}" data-sort="${key}">${esc(text)}<span aria-hidden="true">${CK.sort === key ? (down(key) ? " ▼" : " ▲") : " ↕"}</span></button>` : esc(text)}</th>`;
    $("#ck-table").innerHTML = (fixedQ ? `<p class="fixnote">No one matched “${esc(CK.q)}”, so these are results for <b>${esc(fixedQ)}</b>.</p>` : "") + (count ? `<table><thead><tr>${th("Status", "have")}${shown.map((i) => th(label(cols[i]), SORT_OF[cols[i]], opt(cols[i]).trim())).join("")}${photos ? `<th class="tms">Clubs</th><th class="ph">Card</th>` : ""}<th></th></tr></thead><tbody>${body}</tbody></table>` : `<p class="empty">Nobody matches. Try another name or switch to Everyone.</p>`);
  }
  // My research note on why a player is on the Tier 2 or Tier 3 list opens in a row under his name.
  const noteHTML = (t) => t.split(/\n\s*\n/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("");
  document.addEventListener("click", (e) => {
    const b = e.target.closest("#ck-table .nt-btn"); if (!b) return;
    const tr = b.closest("tr"), open = tr.nextElementSibling && tr.nextElementSibling.classList.contains("nt-row");
    const both = tr.querySelectorAll(".nt-btn");
    if (open) { tr.nextElementSibling.remove(); both.forEach((x) => x.setAttribute("aria-expanded", "false")); return; }
    const l = CHECK.lists[CK.list], t = (l.notes || {})[b.dataset.note]; if (!t) return;
    tr.insertAdjacentHTML("afterend", `<tr class="nt-row"><td colspan="${tr.children.length}"><div class="nt">${noteHTML(t)}</div></td></tr>`);
    both.forEach((x) => x.setAttribute("aria-expanded", "true"));
  });
  // Pause the mouse on a player's name or Scan button in an autograph list to see a small preview of the card.
  const peek = document.createElement("div"); peek.className = "peek"; peek.hidden = true; document.body.appendChild(peek);
  let peekTimer = null, peekRow = null;
  const hidePeek = () => { clearTimeout(peekTimer); peekTimer = null; peekRow = null; peek.hidden = true; };
  if (matchMedia("(hover: hover)").matches) {
    document.addEventListener("mouseover", (e) => {
      const t = e.target.closest("#ck-table .pl-link, #ck-table [data-scan]"), row = t && t.closest("tr[data-peek]");
      if (!row) { if (peekRow && !e.target.closest(".peek")) hidePeek(); return; }
      if (row === peekRow) return;
      hidePeek(); peekRow = row;
      peekTimer = setTimeout(() => {
        const c = bestScan(row.dataset.peek, row.dataset.sport); if (!c || peekRow !== row) return;
        peek.innerHTML = `<img alt="" src="${img(c.id, c.rk, 400)}" onload="this.classList.add('ok')"><small>${esc(c.title || c.name)}</small>`;
        const z = pageZoom(), r = t.getBoundingClientRect(), w = 190, h = 300;
        peek.style.left = Math.max(8, Math.min(r.right / z + 14, innerWidth / z - w - 8)) + "px";
        peek.style.top = Math.max(8, Math.min((r.top + r.height / 2) / z - h / 2, innerHeight / z - h - 8)) + "px";
        peek.hidden = false;
      }, 350);
    });
    addEventListener("scroll", hidePeek, { passive: true });
    addEventListener("hashchange", hidePeek);
  }
  document.addEventListener("click", (e) => {
    if (!peek.hidden) hidePeek();
    const b = e.target.closest("[data-scan]"); if (!b) return;
    const list = scansFor(b.dataset.scan, b.dataset.sport || "football"); if (list.length) openViewer(+b.dataset.k || 0, list);
  });

  /* ---------- NFL Tier 1 Huskers: list with autographs, and a page per player ---------- */
  let PLAYERS = null;
  // Bios for the custom-card pages (config cardPlayers) are kept in their own list in players.json; the pages use both.
  const withCardBios = (d) => ({ ...d, players: [...(d.players || []), ...(d.cardPlayers || [])] });
  const HUB = { q: "", show: "all", sort: "scans", shown: 0, rows: [] };
  // Nebraska Football Hall of Fame (data/hall-of-fame.json, from huskers.com). A player matches on his name
  // (nicknames, Jr. and punctuation aside) and, for players, Nebraska years that line up with his.
  let HOF = null, HOFN = null, CHOF = null, CHOFN = null, PROHOF = {}, PROHOFURL = {};
  const hofName = (n) => String(n || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/["“][^"”]*["”]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, " ").toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/).filter(Boolean);
  function hofFor(info, college) {
    const LIST = college ? CHOF : HOF, AL = (DATA && DATA.site.playerAliases) || {};
    const alt = (AL[info.name] || []).map((n) => hofFor({ ...info, name: n }, college)).find(Boolean);
    const me = hofName(info.name); if (!me.length || !LIST) return null;
    const last = +(info.finalYear || info.year) || 0;
    const idx = college ? (CHOFN = CHOFN || LIST.map((h) => [hofName(h.name), h])) : (HOFN = HOFN || LIST.map((h) => [hofName(h.name), h]));
    return (idx.find(([n, h]) => {
      const same = n.join(" ") === me.join(" ") || (n[0] === me[0] && n[n.length - 1] === me[me.length - 1]);
      if (!same) return false;
      const ys = (String(h.years || "").match(/\d{2,4}/g) || []).map(Number), a = ys[0], b = ys.length > 1 ? ys[ys.length - 1] : a;
      if (h.role || !last || !a) return n.join(" ") === me.join(" ") || !h.role;
      const end = b < 100 ? Math.floor(a / 100) * 100 + b + (b < a % 100 ? 100 : 0) : b;
      return last >= a - 1 && last <= end + 1;
    }) || [])[1] || alt || null;
  }
  // Small Hall of Fame marks after a name in player lists: bronze for Canton, gold for Nebraska.
  const hofMarks = (x) => (PROHOF[x.slug] ? `<i class="hof-mk pro" title="Pro Football Hall of Fame">${HOF_ICON}</i>` : "")
    + (HOF && hofFor(x) ? `<i class="hof-mk" title="Nebraska Football Hall of Fame">${HOF_ICON}</i>` : "");
  function loadHub(then) {
    const need = [];
    if (!CHECK) need.push(fetch("data/lists/husker-pros.json").then((r) => { if (!r.ok) throw 0; return r.json(); }).then((d) => (CHECK = d)));
    if (!HOF) need.push(fetch("data/hall-of-fame.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((d) => ((HOF = d.members || []), (CHOF = d.college || []), (PROHOF = d.pro || {}), (PROHOFURL = d.proPaths || {}))));
    if (!PLAYERS) need.push(fetch("data/players.json").then((r) => (r.ok ? r.json() : { players: [] })).catch(() => ({ players: [] })).then((d) => (PLAYERS = withCardBios(d))));
    if (!need.length) return then();
    $("#app").innerHTML = `<p class="loading">Loading…</p>`;
    Promise.all(need).then(then).catch(() => ($("#app").innerHTML = `<p class="empty">This page isn't available yet.</p>`));
  }
  // The home page stat and search's player matches only need the autograph lists, not the (larger) player info.
  function loadCheckQuiet() {
    return Promise.resolve(CHECK || fetch("data/lists/husker-pros.json").then((r) => { if (!r.ok) throw 0; return r.json(); }).then((d) => (CHECK = d)));
  }
  const pslug = (n) => norm(n).replace(/ /g, "-");
  // A player's main card: prefer a card with a picture over an index card, cut autograph or signed letter
  // (those are "YEAR Player Autograph …" with no set, or say Cut / Letter). Signed pictures first.
  const PICTURE = /\b(photo|8x10|11x14|16x20|magazine|illustrated|poster|program|schedules?|postcard|card)\b/i;
  const noPicture = (c, name) => !c.tags.has("custom") && !PICTURE.test(c.name.replace(/index card/i, "")) && (/\bcut\b|index card|\b(?:signed|autographed)\s+letter\b/i.test(c.name)
    || new RegExp(`^\\d{4}(?:-\\d{2})?\\s+${norm(name).split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^#]*?")}[^#]*?\\b(?:signed\\s+)?(?:cut\\s+)?autograph`, "i").test(c.name));
  function bestScan(name, sport = "football") {
    // A Husker with his own collection (Alex Gordon): its Nebraska cards count too, so a Nebraska autograph filed there
    // beats an unsigned card in the Nebraska folder.
    const own = SECTIONS.findIndex((x) => !x.customs && norm(x.title) === norm(name));
    const all = [...scansFor(name, sport), ...(own < 0 ? [] : CARDS.filter((c) => c.si === own && /\b(?:nebraska|(?:corn)?huskers?)\b/i.test(c.name)))];
    const tier = (c) => playerPhotoTier(c, name), better = (a, b) => { const k = a.findIndex((v, i) => v !== b[i]); return k >= 0 && a[k]; };
    // Within a tier: him alone (not a group card or program page), then a picture of him (not a cut or index card).
    const rank = (c) => { const t = tier(c); return [...TIERS.map((_, k) => t === k), !multiPlayer(c, name), !noPicture(c, name)]; };
    let best = null, bestR = null;   // ties keep the earlier card
    all.forEach((c) => { const r = rank(c); if (!best || better(r, bestR)) { best = c; bestR = r; } });
    return best;
  }
  // Which card shows on a player's page and thumbnails, Ian's order (2026-11-25), best first. A card is a trading card
  // (custom cards count); photos, 8x10s, programs, magazines, letters, index cards and cuts are "items". Certified means
  // signed for the card company: a numbered card without "Hand Signed", TTM, in person or private signing in its name.
  // Husker uniform: the card's team (its Drive team folder) or name says Nebraska; a custom from the Husker side of the
  // Customs folder counts too.
  const TIERS = ["certified Husker", "custom Husker", "certified", "custom", "hand signed card Husker", "hand signed Husker",
    "hand signed solo", "any autograph", "Husker card", "any card"];
  const HAND_SIGNED = /\bhand[- ]?signed\b|\bTTM\b|\bthrough the mail\b|\bIP\b|\bin[- ]person\b|\bprivate signing\b/i;
  const NOT_A_CARD = /\b(deca|booklets?|oversized?|box ?loaders?|box ?toppers?|post ?cards?|posters?|fathead|photos?|magazines?|illustrated|programs?|letters?|notes?|pages?|calendars?|index cards?|contracts?|schedules?|caps?)\b|\b\d{1,2}(\.\d+)?\s*[x×]\s*\d{1,2}(\.\d+)?\b/i;
  function playerPhotoTier(c, name) {
    const custom = c.tags.has("custom"), auto = c.tags.has("auto");
    const card = custom || (!NOT_A_CARD.test(c.name) && /#|\bcards?\b/i.test(c.name));
    const husker = /\b(?:nebraska|(?:corn)?huskers?)\b/i.test(`${c.team || ""} ${c.name}`) || (custom && !c.team && c.tags.has("huskers"));
    const handSigned = auto && !custom && (HAND_SIGNED.test(c.name) || !card || !/#/.test(c.name));
    if (auto && custom) return husker ? 1 : 3;
    if (auto && card && !handSigned) return husker ? 0 : 2;
    if (auto && handSigned && card && husker) return 4;
    if (auto && handSigned && husker) return 5;
    if (auto && handSigned && !multiPlayer(c, name)) return 6;
    if (auto) return 7;
    if (card && husker) return 8;
    if (card) return 9;
    return 10;
  }
  // Nebraska years: the Wikipedia range, widened by any letter years outside it (letter years fill gaps; not every season is on the list).
  // With no Wikipedia range, the letter years alone, as ranges.
  const yearRanges = (ys) => { const out = []; let a = ys[0], b = ys[0];
    for (const y of [...ys.slice(1), null]) { if (y === b + 1) { b = y; continue; } out.push(a === b ? `${a}` : `${a}–${b}`); if (y !== null) { a = b = y; } }
    return out.join(", "); };
  const nebYears = (wiki, letters) => { const w = (wiki.match(/(?:19|20)\d{2}/g) || []).map(Number);
    if (!letters.length) return wiki;
    if (!w.length) return yearRanges([...new Set(letters)].sort((x, y) => x - y));
    const lo = Math.min(w[0], ...letters), hi = Math.max(w[w.length - 1], ...letters);
    return lo === w[0] && hi === w[w.length - 1] ? wiki : `${lo}–${hi}`; };
  let PNAMES = null;
  function multiPlayer(c, name) {
    // A list of signers: "Program Page 15 - Randy Florell, Derrie Nelson, Dan Pensick, Bill Barnett".
    if (/[A-Z][\w.'’-]+(?: [A-Z][\w.'’-]+)+\s*,\s*[A-Z][\w.'’-]+(?: [A-Z][\w.'’-]+)+/.test(c.name.replace(/\b(?:AU|MEM|MANU|RC|SSP|SP|SN\d+|PR\d+)\b,?/g, ""))) return true;
    if (/\b(dual|duos?|trios?|triple|quad|quads|tandem|combos?|pairings|teammates|and (?:\w+ )?others)\b/i.test(c.name.replace(/triple threads/i, ""))) return true;
    if (!PNAMES) PNAMES = [...new Set((CHECK ? allPlayers() : []).map((p) => norm(p.name)).filter((n) => n.split(" ").length > 1))];
    const t = " " + norm(c.name) + " ", me = norm(name);
    return PNAMES.some((n) => n !== me && t.includes(" " + n + " ") && !me.includes(n));
  }
  // Player pages for every name on the NFL, MLB and NBA lists. Slugs match scripts/build_players.py:
  // a name already used by an earlier list gets "-baseball" or "-basketball" added.
  // [sport, list, label, back link, back label, slug suffix for a name already used by an earlier list].
  // Order matters (it decides who gets the plain slug) and must match SPORTS in scripts/build_players.py.
  const SPORT_LISTS = [["football", "nfl-tier-1-huskers", "NFL", "#/nfl-huskers", "Husker Bios", "football"],
    ["baseball", "baseball-mlb", "MLB", "#/checklist/mlb", "MLB Huskers Autograph List", "baseball"],
    ["basketball", "basketball-nba", "NBA", "#/checklist/nba", "NBA Huskers Autograph List", "basketball"],
    ["football", "nfl-tier-2-huskers", "NFL Tier 2", "#/checklist/tier-2", "NFL Tier 2 Huskers Autograph List", "tier-2"],
    ["football", "pro-football-huskers", "Pro Football", "#/checklist/tier-3", "NFL Tier 3 Huskers Autograph List", "tier-3"]];
  let ALL = null;
  function allPlayers() {
    if (ALL) return ALL;
    const used = new Set(); ALL = [];
    SPORT_LISTS.forEach(([sport, listSlug, league, back, backLabel, suffix]) => {
      const l = CHECK.lists.find((x) => x.slug === listSlug); if (!l) return;
      const c = Object.fromEntries(l.columns.map((k, i) => [k, i]));
      l.groups.flatMap((g) => g.rows).forEach((r) => {
        const name = r[0].trim(); let slug = pslug(name);
        if (used.has(slug)) slug += "-" + suffix;
        used.add(slug);
        ALL.push({ sport, league, listSlug, back, backLabel, name, slug, year: r[c["Last Year"]], have: r[c["Autograph"]] === "Yes",
          games: c["NFL Games Played"] >= 0 ? r[c["NFL Games Played"]] : "", notes: c["Career Notes"] >= 0 ? r[c["Career Notes"]] : "",
          signed: c["Signed"] >= 0 ? r[c["Signed"]] : "", link: (l.links || {})[r[0]] || "" });
      });
    });
    // People I made custom cards of who aren't on a list (config "cardPlayers"): a page from their cards and my write-ups.
    Object.entries((DATA.site.cardPlayers) || {}).filter(([k]) => !k.startsWith("_")).forEach(([where, people]) => people.forEach((x) => {
      let slug = pslug(x.name); if (used.has(slug)) slug += "-card"; used.add(slug);
      const sec = SECTIONS.find((s) => s.slug === (where === "football" ? "husker-football" : where)) || {};
      ALL.push({ sport: where, league: "Nebraska", tagline: x.tagline || "", listSlug: "card-" + where, back: "#/c/" + (sec.slug || ""), backLabel: sec.title || "",
        name: x.name, slug, year: x.year || "", position: x.position || "", have: true, games: "", notes: "", signed: "", link: "", card: true });
    }));
    return ALL;
  }
  // The player page for the person on a card: a listed name in the card's name ("(Hand Signed by …)" names the signer),
  // from the card's own sport first. Cards with two or more listed players get no link.
  function bioFor(c) {
    const m = c.name.match(/\(\s*hand signed by ([^)]+)\)/i), t = " " + norm(m ? m[1] : c.title || c.name) + " ";
    const AL = (DATA && DATA.site.playerAliases) || {}, alias = (p) => (AL[p.name] || []).map(norm);
    const hits = allPlayers().filter((p) => norm(p.name).includes(" ") && [norm(p.name), ...alias(p)].some((x) => t.includes(" " + x + " ")));
    const names = new Set(hits.map((p) => norm(p.name)).filter((n) => ![...hits].some((q) => norm(q.name) !== n && norm(q.name).includes(n))));
    if (names.size !== 1) return null;
    const sl = (SECTIONS[c.si] || {}).slug || "", sport = (sl.match(/^husker-(\w+)/) || [])[1];
    const mine = hits.filter((p) => names.has(norm(p.name)));
    return mine.find((p) => p.sport === sport && !p.card) || mine.find((p) => !p.card) || mine[0];
  }
  const slugFor = (listSlug, name) => (allPlayers().find((p) => p.listSlug === listSlug && p.name === name.trim()) || {}).slug || pslug(name);
  function tier1() {
    const l = CHECK.lists.find((x) => x.slug === "nfl-tier-1-huskers");
    const c = Object.fromEntries(l.columns.map((k, i) => [k, i]));
    const pages = new Set((PLAYERS.players || []).filter((p) => p.wiki).map((p) => p.slug));
    return l.groups.flatMap((g) => g.rows).map((r) => ({
      name: r[c["Player"]].trim(), games: r[c["NFL Games Played"]], notes: r[c["Career Notes"]], year: r[c["Last Year"]],
      signed: r[c["Signed"]], have: r[c["Autograph"]] === "Yes", slug: pslug(r[c["Player"]]), page: pages.has(pslug(r[c["Player"]])),
      link: (l.links || {})[r[c["Player"]]] || "",
    }));
  }
  // The stats page linked from each name in my checklist, labelled by site.
  const SITES = { "footballdb.com": "FootballDB", "profootballarchives.com": "Pro Football Archives", "pro-football-reference.com": "Pro Football Reference",
    "sports-reference.com": "Sports Reference", "baseball-reference.com": "Baseball Reference", "basketball-reference.com": "Basketball Reference", "wikipedia.org": "Wikipedia", "huskers.com": "Huskers.com" };
  function siteName(url) {
    let h = ""; try { h = new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
    const k = Object.keys(SITES).find((d) => h === d || h.endsWith("." + d));
    return k ? SITES[k] : h;
  }
  /* ---------- Huskers by NFL Team ---------- */
  // Each NFL Husker's teams come from his Wikipedia career history ("St. Louis Rams (2003)" counts toward today's
  // Rams; "*" marks an offseason or practice-squad stint) and from the teams named in my research notes.
  let NFLTEAMS = null, TEAMIDX = null, NFLTEAMS_LIST = null;
  // Team years from Pro Football Archives, for teams my notes name without a year (data/team-years.json).
  let TEAMYEARS = {}, TEAMCAREERS = {}, TEAMLOGOS = {};   // TEAMLOGOS: logos by team name of the time (data/team-logos.json)
  const nflTeamData = () => NFLTEAMS || (NFLTEAMS = Promise.all([
    fetch("data/nfl-teams.json").then((r) => (r.ok ? r.json() : { teams: [] })).then((d) => d.teams || []).catch(() => []),
    fetch("data/team-years.json").then((r) => (r.ok ? r.json() : {})).then((d) => { TEAMYEARS = d.players || {}; TEAMCAREERS = d.careers || {}; }).catch(() => {}),
    fetch("data/team-logos.json").then((r) => (r.ok ? r.json() : {})).then((d) => (TEAMLOGOS = d.byName || {})).catch(() => {})]).then(([t]) => t));
  // The year a research note gives for a team: the nearest date after the team's name in that sentence
  // ("Released by the Broncos on 8/24/94", "the Raiders in '92"), else the nearest one before it
  // ("Released 8/17/88 after the Bears"), stopping at another team's name. A line can also start with the year
  // ("04 - Chiefs (Preseason)"). Two-digit years are 19xx or 20xx.
  const YEAR_RE = /\b\d{1,2}[/.-]\d{1,2}[/.-](\d{4}|\d{2})\b|['’](\d{2})\b|\b((?:19|20)\d{2})\b|^[ \t]*(\d{2})[ \t]*[-–—][ \t]/gm;
  function noteYear(note, i, e, nick) {
    const cut = (str) => { const k = str.search(/[.!?](\s|$)|\n/); return k < 0 ? str.length : k; };
    const startS = Math.max(note.lastIndexOf("\n", i) + 1, ...[...note.slice(0, i).matchAll(/[.!?]\s/g)].map((x) => x.index + 2));
    const endS = e + cut(note.slice(e));
    const others = [...note.slice(startS, endS).matchAll(new RegExp(nick.source, "g"))].map((x) => [startS + x.index, startS + x.index + x[0].length]).filter(([a]) => a !== i);
    const fwdEnd = Math.min(endS, ...others.filter(([a]) => a > i).map(([a]) => a)), backStart = Math.max(startS, ...others.filter(([a]) => a < i).map(([, z]) => z));
    const yearsIn = (str) => [...str.matchAll(YEAR_RE)].map((x) => { const y = x[1] || x[2] || x[3] || x[4]; if (y.length === 4) return +y;
      const n = +y, cy = new Date().getFullYear() % 100; return n <= cy ? 2000 + n : 1900 + n; });
    const f = yearsIn(note.slice(e, fwdEnd)), bk = yearsIn(note.slice(backStart, i));
    return String(f.length ? f[0] : bk.length ? bk[bk.length - 1] : "");
  }
  function teamIndex(teams) {
    if (TEAMIDX) return TEAMIDX;
    const byName = teams.flatMap((t) => t.names.map((n) => [n.toLowerCase(), t])).sort((a, b) => b[0].length - a[0].length);
    const nick = new RegExp(`\\b(${teams.flatMap((t) => t.nick).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "g");
    const byNick = Object.fromEntries(teams.flatMap((t) => t.nick.map((n) => [n, t])));
    TEAMIDX = Object.fromEntries(teams.map((t) => [t.slug, []]));
    const NFL = { "nfl-tier-1-huskers": 1, "nfl-tier-2-huskers": 2, "pro-football-huskers": 3 };
    allPlayers().filter((x) => NFL[x.listSlug]).forEach((x) => {
      const p = (PLAYERS.players || []).find((q) => q.slug === x.slug) || {};
      const stints = {};
      // Playing years only: "Career history" (or its "Playing" part when Wikipedia splits playing and coaching),
      // and older pages' "Playing career" table ("1931–1936 | Portsmouth Spartans/Detroit Lions").
      const secs = (p.wiki || {}).sections || {};
      const entries = [...secs["Career history"] || [], ...secs["Playing"] || []].filter((r) => r.length === 1).map((r) => r[0])
        .concat((secs["Playing career"] || []).filter((r) => r.length === 2 && /\d{4}/.test(r[0])).flatMap(([y, t]) => t.split("/").map((n) => `${n.trim()} (${y})`)));
      for (const e of entries) {
        const hit = byName.find(([n]) => e.toLowerCase().startsWith(n)); if (!hit) continue;
        const yrs = (e.match(/\(([^)]*)\)/) || [])[1] || "", star = /\*\s*$/.test(e);
        (stints[hit[1].slug] = stints[hit[1].slug] || []).push(yrs + (star ? " (offseason / practice squad)" : ""));
      }
      const fromWiki = new Set(Object.keys(stints));
      const l = CHECK.lists.find((q) => q.slug === x.listSlug), note = l && (l.notes || {})[x.name];
      for (const m of (note || "").matchAll(nick)) {
        if (/\b(BC|B\.C\.)\s$/.test(note.slice(Math.max(0, m.index - 5), m.index))) continue;   // the CFL's BC Lions
        const t = byNick[m[1]]; if (!t || fromWiki.has(t.slug)) continue;
        const y = noteYear(note, m.index, m.index + m[0].length, nick);
        (stints[t.slug] = stints[t.slug] || []).push(y);
      }
      Object.entries(stints).forEach(([slug, yrs]) => { let y = [...new Set(yrs.filter(Boolean))].join(", "), pfa = false;
        if (!y && (TEAMYEARS[x.slug] || {})[slug]) { y = TEAMYEARS[x.slug][slug]; pfa = true; }
        TEAMIDX[slug].push({ x, tier: NFL[x.listSlug], yrs: y, pfa }); });
    });
    return TEAMIDX;
  }
  // A team's colors for its page: --tc1/--tc2 for the banner, --tca a readable accent on the dark site.
  const lum = (h) => { const n = parseInt(h.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const teamVars = (t) => { const [a, b] = t.colors || ["#3b6fd8", "#9aa4b2"]; const acc = [a, b].filter((x) => lum(x) > 0.08 && lum(x) < 0.9).sort((x, y) => lum(y) - lum(x))[0] || "#c9d1db";
    return `--tc1:${a};--tc2:${b};--tca:${acc}`; };
  /* Team logos on the team collection pages (Wikipedia, data/site-team-logos.json). Jermaine Dye's page shows his four teams' logos;
     picking one in his Team menu (or tapping its logo) leaves just that logo, and the page takes that team's colors (style.css team-*). */
  const SECTION_LOGO = { "husker-football": "nebraska", "husker-baseball": "nebraska", "husker-basketball": "nebraska", "husker-other": "nebraska", royals: "royals", lions: "lions" };
  const SLUG_TEAMS = { "alex-gordon": [["nebraska", /nebraska|husker/i], ["usa", /usa/i], ["minor", /minor/i], ["royals", /royals/i]], "jermaine-dye": [["braves", /braves/i], ["royals", /royals/i], ["athletics", /athletics|a's/i], ["white-sox", /white sox/i]] };
  const teamKey = (slug, t) => { const m = (SLUG_TEAMS[slug] || []).find(([, re]) => re.test(t || "")); return m ? m[0] : ""; };
  const DYE_TEAMS = { "Atlanta Braves": "braves", "Kansas City Royals": "royals", "Oakland Athletics": "athletics", "Chicago White Sox": "white-sox" };
  const SITELOGOS = fetch("data/site-team-logos.json").then((r) => (r.ok ? r.json() : {})).then((d) => d.teams || {}).catch(() => ({}));
  function drawLogos(slug) {
    const el = $("#c-logos"); if (!el) return;
    SITELOGOS.then((T) => {
      if ($("#c-logos") !== el) return;
      let keys, names = {};
      if (SLUG_TEAMS[slug]) {
        const have = [...document.querySelectorAll("#tm option")].map((o) => o.value).filter(Boolean);
        SLUG_TEAMS[slug].forEach(([k]) => { const n = have.find((h) => teamKey(slug, h) === k); if (n) names[k] = n; });
        keys = state.team && teamKey(slug, state.team) ? [teamKey(slug, state.team)] : Object.keys(names);
      } else keys = SECTION_LOGO[slug] ? [SECTION_LOGO[slug]] : [];
      keys = keys.filter((k) => T[k]);
      el.classList.toggle("solo", keys.length === 1 && !T[keys[0]].logos);
      if (el.parentElement) el.parentElement.classList.toggle("logo-r", !SLUG_TEAMS[slug] && keys.length > 0);
      el.innerHTML = keys.map((k) => { const t = T[k], img = (t.logos || [t]).map((l) => `<img alt="${esc(l.name)} logo" src="${esc(l.logo)}" onerror="this.remove()">`).join("");
        if (!names[k]) return `<span class="c-logo" title="${esc(t.name)}">${img}</span>`;
        return `<button type="button" class="c-logo${T[k].logos ? " multi" : ""}" data-team="${esc(names[k])}" title="${state.team ? "Show all teams" : "Show only " + esc(t.name)}" aria-label="${state.team ? "Show all teams" : "Show only " + esc(t.name)}">${img}</button>`; }).join("");
      const cr = $("#c-logo-cr"); if (cr) cr.innerHTML = keys.length ? `Logos: ${keys.flatMap((k) => T[k].logos || [T[k]]).map((l) => l.logoPage ? `<a href="${esc(l.logoPage)}" target="_blank" rel="noopener">${esc(l.name)}</a>` : esc(l.name)).join(", ")}${keys.flatMap((k) => T[k].logos || [T[k]]).every((l) => l.logoPage) ? " (Wikipedia)" : " (most from Wikipedia)"}. Team names and logos are trademarks of their teams.` : "";
      el.querySelectorAll("button.c-logo").forEach((b) => b.addEventListener("click", () => { const sel = $("#tm"); if (!sel) return; sel.value = state.team ? "" : b.dataset.team; sel.dispatchEvent(new Event("change")); }));
    });
  }
  const teamLogo = (t, cls) => t.logo ? `<img class="${cls}" alt="${esc(t.name)} logo" loading="lazy" src="${esc(t.logo)}" onerror="this.remove()">` : "";
  function nflTeams(slug) {
    setNav("nfl-teams");
    loadHub(() => nflTeamData().then((teams) => {
      const idx = teamIndex(teams);
      const rows = teams.map((t) => ({ t, n: idx[t.slug].length, t1: idx[t.slug].filter((e) => e.tier === 1).length })).sort((a, b) => b.n - a.n || a.t.name.localeCompare(b.t.name));
      if (!slug) {
        setTitle("Huskers by NFL Team");
        $("#app").innerHTML = `<div class="wrap tm"><div class="c-head"><div class="kick">NFL Huskers</div><div class="c-title"><h1>Huskers by NFL Team</h1><div class="c-logos" id="c-logos"></div></div>
          <p>Every Nebraska Cornhusker on my NFL lists, by the franchise he was with. Past team names count toward today's franchise (St. Louis Rams → Los Angeles Rams).</p></div>
          <div class="tm-grid">${rows.map(({ t, n, t1 }) => `<a class="tm-tile" style="${teamVars(t)}" href="#/nfl-teams/${t.slug}">${teamLogo(t, "tm-logo")}<b>${esc(t.name)}</b><span>${fmt(n)} Husker${n === 1 ? "" : "s"}${t1 ? ` · ${fmt(t1)} played in games` : ""}</span></a>`).join("")}</div><p class="c-logo-cr" id="c-logo-cr"></p></div>`;
        drawLogos("husker-football");
        return;
      }
      const t = teams.find((q) => q.slug === slug); if (!t) return notFound();
      setTitle(`Huskers on the ${t.name}`);
      const list = idx[slug].slice().sort((a, b) => a.tier - b.tier || (parseInt(b.yrs) || +b.x.year || 0) - (parseInt(a.yrs) || +a.x.year || 0) || a.x.name.localeCompare(b.x.name));
      const card = (e) => { const sc = e.x.have ? bestScan(e.x.name, "football") : null;
        return `<a class="pm" href="#/player/${e.x.slug}">${e.x.have ? pmPh(sc, e.x.slug) : `<span class="pm-ph pm-need" title="No autograph yet: I need one"><b>Need<br>auto</b></span>`}
          <span class="pm-t"><b>${esc(e.x.name)}${hofMarks(e.x)}</b>${e.yrs ? `<small>${esc(e.yrs)}${e.pfa ? ` <span class="src" title="Year from Pro Football Archives">· Pro Football Archives</span>` : ""}</small>` : ""}</span><span class="pm-go">→</span></a>`; };
      // My cards of this team: scans filed in a Drive folder named for the team (any of its names, e.g. St. Louis Rams), oldest first.
      const names = new Set(t.names.map((n) => n.toLowerCase()));
      const mine = sortList(CARDS.filter((c) => c.team && names.has(c.team.toLowerCase()) && SECTIONS[c.si].kind !== "want"), "old");
      state.list = mine; state.binderItems = null;
      const TIER = { 1: "Played in games (Tier 1)", 2: "Active roster, preseason, injured reserve or practice squad (Tier 2)", 3: "Camp, tryout or draft (Tier 3)" };
      $("#app").innerHTML = `<div class="wrap tm tm-team" style="${teamVars(t)}"><a class="back" href="#/nfl-teams">← Huskers by NFL Team</a>
        <div class="tm-banner">${teamLogo(t, "tm-blogo")}<div class="c-head"><div class="kick">Huskers by NFL Team</div><h1>Huskers on the ${esc(t.name)}</h1>
        <p>${fmt(list.length)} Nebraska Cornhuskers from my NFL lists spent time with the ${esc(t.name)}.${t.names.length > 1 ? ` Past team names count too: ${esc(t.names.slice(1).join(", "))}.` : ""}</p></div></div>
        ${[1, 2, 3].map((n) => { const g = list.filter((e) => e.tier === n); return g.length ? `<h2 class="more-h">${TIER[n]} · ${g.length}</h2><div class="pm-list">${g.map(card).join("")}</div>` : ""; }).join("")}
        ${list.length ? "" : `<p class="empty">No Huskers from my lists yet.</p>`}
        ${mine.length ? `<h2 class="more-h tm-cards-h">My ${esc(t.name)} cards · ${fmt(mine.length)}</h2><div class="b-row">${binderBtn()}</div><div class="grid" id="grid">${mine.map((c) => cardHTML(c)).join("")}</div>` : ""}
        ${(() => { const k = rows.findIndex((r) => r.t.slug === slug), tm = (r) => r && { href: "#/nfl-teams/" + r.t.slug, name: r.t.name };
          return navLinks(tm(rows[k - 1]), tm(rows[k + 1]), "Previous and next team", "team"); })()}
        ${t.logoPage ? `<p class="tm-credit">Logo: <a href="${esc(t.logoPage)}" target="_blank" rel="noopener">Wikipedia</a>. Team names and logos are trademarks of their teams.</p>` : ""}</div>`;
    }));
  }

  function hub() {
    setNav("nfl-huskers"); setTitle("Husker Bios");
    loadHub(() => {
      // Every bio: NFL Tier 1, 2 and 3, MLB, NBA, and the Huskers I've made custom cards of (config cardPlayers).
      const wiki = new Set((PLAYERS.players || []).filter((p) => p.wiki).map((p) => p.slug)), sigs = DATA.site.signatures || {};
      const GROUP = { "nfl-tier-1-huskers": "nfl", "nfl-tier-2-huskers": "pro", "pro-football-huskers": "pro", "baseball-mlb": "mlb", "basketball-nba": "nba" };
      const all = allPlayers().map((p) => ({ ...p, page: wiki.has(p.slug), group: GROUP[p.listSlug] || "more", sig: !!sigs[p.slug] }));
      const have = all.filter((p) => p.have).length, nsig = all.filter((p) => p.sig).length;
      $("#app").innerHTML = `<div class="wrap hub c-husker">
        <div class="c-head"><div class="kick">Nebraska Cornhuskers</div><div class="c-title"><h1>Husker Bios</h1><div class="c-logos" id="c-logos"></div></div>
          <p>A page for every Nebraska Cornhusker who made the pros, plus a few more I've made custom cards of. Each one tells his story: his Nebraska and pro careers, stats, Hall of Fame honors, a career timeline, my own write-ups from custom cards, and the cards and autographs I have of him.</p>
          <div class="hub-stats"><span><b>${fmt(all.length)}</b> bios</span><span><b>${fmt(nsig)}</b> neon signatures</span></div></div>
        <div class="tools">
          <div class="chips" role="group" aria-label="Show">${[["all", "Everyone"], ["nfl", "NFL"], ["pro", "Other pro football"], ["mlb", "MLB"], ["nba", "NBA"], ["more", "More Huskers"], ["sig", "Neon signatures"]].filter(([k]) => k === "all" || k === "sig" || all.some((p) => p.group === k)).map(([k, t]) => `<button type="button" class="chip" data-show="${k}" aria-pressed="${HUB.show === k}">${t}</button>`).join("")}</div>
          <div class="tools-r"><label class="sr" for="hub-q">Find a player</label><input id="hub-q" class="ck-q" type="search" placeholder="Find a player" value="${esc(HUB.q)}">
            <label class="sr" for="hub-sort">Sort</label><select id="hub-sort">${[["scans", "With autographs first"], ["new", "Newest first"], ["old", "Oldest first"], ["most", "Most NFL games"], ["fewest", "Fewest NFL games"], ["az", "A–Z"]].map(([k, t]) => `<option value="${k}"${HUB.sort === k ? " selected" : ""}>${t}</option>`).join("")}</select>
            <span class="count" id="hub-count"></span></div>
        </div>
        <ol class="hub-list" id="hub-list"></ol><div class="sentinel" id="hub-more"></div><p class="c-logo-cr" id="c-logo-cr"></p></div>`;
      drawLogos("husker-football");
      const apply = () => {
        let q = HUB.q; HUB.fixed = null;
        const shownBy = (p) => HUB.show === "all" || (HUB.show === "sig" ? p.sig : p.group === HUB.show);
        const hits = (qq) => all.filter((p) => shownBy(p) && (!qq || playerMatch(p.name, qq)));
        HUB.rows = hits(q);
        if (q && !HUB.rows.length) { const f = fixPlayerQuery(q, all.map((p) => p.name), (f) => hits(f).length > 0); if (f) { HUB.fixed = f; HUB.rows = hits(f); } }
        // The checklist is newest first; "with autographs first" keeps that order within each group.
        const scanned = (p) => (p.have && bestScan(p.name, p.sport) ? 0 : 1), yr = (p) => parseInt(p.year) || 0;
        // Games like "1*" count as 1; players with no games listed go last either way.
        const gm = (p) => { const n = parseInt(p.games); return isNaN(n) ? null : n; };
        const byGames = (dir) => (a, b) => (gm(a) === null) - (gm(b) === null) || dir * ((gm(a) || 0) - (gm(b) || 0));
        const by = { scans: (a, b) => scanned(a) - scanned(b), new: (a, b) => yr(b) - yr(a), old: (a, b) => yr(a) - yr(b), most: byGames(-1), fewest: byGames(1), az: (a, b) => a.name.localeCompare(b.name) }[HUB.sort];
        HUB.rows = HUB.rows.map((p, i) => [p, i]).sort((a, b) => by(a[0], b[0]) || a[1] - b[1]).map(([p]) => p);
        HUB.shown = 0; $("#hub-list").innerHTML = HUB.rows.length ? (HUB.fixed ? `<li class="fixnote">No one matched “${esc(HUB.q)}”, so these are results for <b>${esc(HUB.fixed)}</b>.</li>` : "") : `<li class="empty">Nobody matches.</li>`;
        $("#hub-count").textContent = `${fmt(HUB.rows.length)} player${HUB.rows.length === 1 ? "" : "s"}`; hubMore();
      };
      $(".hub .chips").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (!b) return; HUB.show = b.dataset.show; document.querySelectorAll(".hub .chip").forEach((x) => x.setAttribute("aria-pressed", x === b)); apply(); });
      $("#hub-q").addEventListener("input", (e) => { HUB.q = e.target.value.trim(); apply(); });
      $("#hub-sort").addEventListener("change", (e) => { HUB.sort = e.target.value; apply(); });
      apply(); hubIO.observe($("#hub-more"));
    });
  }
  function hubMore() {
    const list = $("#hub-list"); if (!list) return;
    const next = HUB.rows.slice(HUB.shown, HUB.shown + 60); HUB.shown += next.length;
    list.insertAdjacentHTML("beforeend", next.map((p) => {
      const sc = p.have ? bestScan(p.name, p.sport) : null;
      const nm = `<a class="hub-name" href="#/player/${p.slug}">${hl(p.name, HUB.fixed || HUB.q)}${hofMarks(p)}</a>`;
      return `<li class="hub-row ${p.have ? "have" : "need"}">
        ${sc ? `<button type="button" class="hub-ph" data-scan="${esc(p.name)}" aria-label="View ${esc(p.name)}'s autograph"><img loading="lazy" alt="" src="${img(sc.id, sc.rk, 240)}" onload="thumbFit(this)"></button>`
             : fanDayOf(p.slug) ? `<button type="button" class="hub-ph land fd" data-i="${fanDayOf(p.slug).c.i}" aria-label="View ${esc(p.name)}'s autograph on ${esc(fanDayOf(p.slug).c.name)}">${fdThumb(p.slug)}</button>`
             : `<div class="hub-ph none">${p.have ? esc(p.signed || "Signed") : "Need"}</div>`}
        <div class="hub-info">${nm}<div class="hub-meta">${esc({ nfl: "NFL", pro: "Pro football", mlb: "MLB", nba: "NBA", more: p.tagline || (p.position ? "Nebraska · " + p.position : "Nebraska") }[p.group])}${p.year ? ` · Nebraska through ${esc(p.year)}` : ""}${p.games ? ` · ${esc(p.games)} NFL game${parseInt(p.games) === 1 ? "" : "s"}` : ""}${p.group === "nfl" && p.notes ? ` · ${esc(p.notes)}` : ""}</div>
          <div class="hub-meta2">${p.have ? `<span class="st have">Autograph</span>` : ""}${p.sig ? `<span class="pill">Neon signature</span>` : ""}</div></div></li>`;
    }).join(""));
  }
  const hubIO = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && HUB.shown < HUB.rows.length && hubMore()), { rootMargin: "1000px" });

  // Videos that feature a player: Media items and Customs videos with "players": [player page slugs].
  function playerMedia(slug) {
    const s = DATA.site, yt = (v) => v.url || `https://www.youtube.com/watch?v=${encodeURIComponent(v.youtube || v.id)}${v.start ? `&t=${+v.start}s` : ""}`;
    return [...(s.media?.items || []), ...(s.customsPhotos?.videos || [])]
      .filter((v) => (v.players || []).includes(slug)).map((v) => ({ title: v.title || v.caption, url: yt(v) }));
  }
  // Bottom of a player page: previous / next player on the same list, and Huskers like him
  // (same list, same position when known, closest final Nebraska seasons).
  function moreHuskers(slug, info, p) {
    const list = allPlayers().filter((x) => x.listSlug === info.listSlug);
    const at = list.findIndex((x) => x.slug === slug); if (at < 0) return "";
    const pos = (x) => ((PLAYERS.players || []).find((q) => q.slug === x.slug) || {}).position || "";
    const group = (t) => { t = (t || "").toLowerCase(); const G = [["qb", /quarterback/], ["db", /cornerback|safety|defensive back|\bcb\b|\bdb\b/],
        ["dl", /defensive (end|tackle|line)|nose|\bdt\b|\bde\b/], ["lb", /linebacker/], ["rb", /running back|fullback|halfback|tailback|i-?back|wingback/],
        ["wr", /receiver|split end|flanker/], ["te", /tight end/], ["ol", /tackle|guard|center|offensive line/], ["k", /kicker|punter/],
        ["p", /pitcher/], ["c", /catcher/], ["if", /infield|shortstop|base/], ["of", /outfield|fielder/], ["bb", /forward|guard|center/]];
      const g = G.find(([, r]) => r.test(t)); return g ? g[0] : ""; };
    const mine = group((p && p.position) || ""), yr = +info.year || 0;
    const like = list.filter((x) => x.slug !== slug)
      .map((x) => ({ x, sameGroup: mine && group(pos(x)) === mine, gap: Math.abs((+x.year || 0) - yr) }))
      .sort((a, b) => (b.sameGroup - a.sameGroup) || (a.gap - b.gap)).slice(0, 6).map((o) => o.x);
    const card = (x) => { const sc = x.have ? bestScan(x.name, x.sport) : null;
      return `<a class="pm" href="#/player/${x.slug}"><span class="pm-ph">${sc ? `<img alt="" loading="lazy" src="${img(sc.id, sc.rk, 160)}" onload="thumbFit(this)">` : ""}</span>
        <span class="pm-t"><b>${esc(x.name)}${hofMarks(x)}</b><small>${esc(pos(x) || x.league + " Husker")}${x.year ? ` · Nebraska through ${esc(x.year)}` : ""}</small></span><span class="pm-go">→</span></a>`; };
    return `<section class="more-huskers"><h2 class="more-h">More Huskers like ${esc(info.name)}</h2><div class="pm-list">${like.map(card).join("")}</div>${playerNav(slug, info)}</section>`;
  }
  // Previous / next player, in the order of the list you opened him from (as sorted and filtered there:
  // a checklist, Husker Bios or a team page); otherwise his own list's order. The ← and → keys follow it too.
  const navLinks = (prev, next, label, what) => `<nav class="pl-nav" aria-label="${label}">${prev ? `<a data-dir="prev" href="${prev.href}" title="Previous ${what} (← key)">← ${esc(prev.name)}</a>` : "<span></span>"}${next ? `<a data-dir="next" href="${next.href}" title="Next ${what} (→ key)">${esc(next.name)} →</a>` : ""}</nav>`;
  function playerNav(slug, info) {
    const seq = PSEQ && PSEQ.includes(slug) ? PSEQ : allPlayers().filter((x) => x.listSlug === info.listSlug).map((x) => x.slug);
    const at = seq.indexOf(slug); if (at < 0) return "";
    const who = (s) => { if (!s) return null; const x = allPlayers().find((q) => q.slug === s) || (PLAYERS.players || []).find((q) => q.slug === s); return x ? { href: "#/player/" + s, name: x.name } : null; };
    return navLinks(who(seq[at - 1]), who(seq[at + 1]), "Previous and next player", "player");
  }
  // The list order a player was opened from: kept for the visit (sessionStorage), so a reload keeps it.
  let PSEQ = null; try { PSEQ = JSON.parse(sessionStorage.getItem("pseq") || "null"); } catch (e) {}
  const setPSEQ = (v) => { PSEQ = v; try { v ? sessionStorage.setItem("pseq", JSON.stringify(v)) : sessionStorage.removeItem("pseq"); } catch (e) {} };
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href]"); if (!a) return;
    const h = hashOf(a.getAttribute("href")) || ""; if (!h.startsWith("#/player/")) return;
    const here = HASH();
    if (here.startsWith("#/player/")) return;   // from a player page (← →, Huskers like him): keep the list you came from
    const slugOf = (x) => decodeURIComponent((hashOf(x.getAttribute("href")) || "").replace(/^#\/player\//, "").split(/[/?]/)[0]);
    if (a.closest("#hub-list")) setPSEQ(HUB.rows.map((p) => p.slug));   // all of them, also the rows not loaded yet
    else if (/^#\/(checklist|nfl-teams\/)/.test(here) && a.closest("#app") && a.classList.length) {
      const sel = "a." + [...a.classList].join(".");
      setPSEQ([...new Set([...$("#app").querySelectorAll(sel)].map(slugOf))]);
    } else setPSEQ(null);
  }, true);

  // Every card I have of a player, from every collection on the site (not the Want List, not back scans).
  function playerCards(name) {
    const n = norm(name); if (n.split(" ").length < 2) return [];
    return CARDS.filter((c) => SECTIONS[c.si].kind !== "want" && (" " + norm(c.name) + " ").includes(" " + n + " "))
      .sort((p, q) => (p.year || 0) - (q.year || 0) || p.name.localeCompare(q.name));
  }
  // Have/Need and "Signed" come from the spreadsheet list rebuilt on every update, never the saved bios in players.json.
  const live = (row) => (row ? { have: row.have, signed: row.signed } : {});
  function playerCardsPage(slug) {
    loadHub(() => {
      const p = (PLAYERS.players || []).find((x) => x.slug === slug), row = allPlayers().find((x) => x.slug === slug);
      if (!p && !row) return notFound();
      const info = { ...(row || {}), ...(p || {}), ...live(row) }, all = playerCards(info.name); if (!all.length) return notFound();
      setNav(info.back && info.back.startsWith("#/checklist/") ? info.back.slice(2) : "nfl-huskers"); setTitle(`${info.name} cards`);
      const where = [...new Set(all.map((c) => SECTIONS[c.si].title))];
      $("#app").innerHTML = `<div class="wrap coll c-husker"><div style="grid-column:1/-1;min-width:0">
        <a class="back" href="#/player/${esc(slug)}">← ${esc(info.name)}</a>
        <div class="c-head"><div class="kick">Every card I have</div><h1>${esc(info.name)}</h1>
        <p>${fmt(all.length)} scan${all.length === 1 ? "" : "s"} in my collection, oldest first${where.length > 1 ? `, from ${where.map(esc).join(", ")}` : ""}.</p></div>
        <div class="grid" id="grid">${all.map((c) => cardHTML(c)).join("")}</div></div></div>`;
      state.list = all;
    });
  }
  /* ---------- Career timeline (player pages): college and pro stops as bars, events as marks, left to right ---------- */
  const EVENT_WORDS = [[/\bsigned\b/i, "Signed"], [/\bdrafted\b/i, "Drafted"], [/\b(released|cut)\b/i, "Released"], [/\bwaived\b/i, "Waived"], [/\bclaimed\b/i, "Claimed"],
    [/\btraded\b/i, "Traded"], [/practice squad/i, "Practice squad"], [/active roster/i, "Active roster"], [/injured reserve|\bIR\b/, "Injured reserve"], [/preseason/i, "Preseason"], [/\bretired\b/i, "Retired"]];
  function careerTimeline({ pfaCareer, info, schools, careerLines, draft, draftLabel = "NFL draft", note, hof, pro, neb, noteTeams = [] }) {
    const NOW = new Date().getFullYear(), spans = [], marks = [], undated = [];
    // NFL team for a career-history name ("St. Louis Rams" → the Rams), for its logo.
    const teamOf = (name) => (NFLTEAMS_LIST || []).find((t) => t.names.some((n) => name.toLowerCase().startsWith(n.toLowerCase())));
    const logo = (t) => t && t.logo ? `<img class="tl-logo" alt="" loading="lazy" src="${esc(t.logo)}" onerror="this.remove()">` : "";
    const NEB = { logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Nebraska_Cornhuskers_logo.svg/120px-Nebraska_Cornhuskers_logo.svg.png" };
    const yrs = (str) => (String(str).match(/(?:19|20)\d{2}|present/g) || []).map((y) => (y === "present" ? NOW : +y));
    // College: Nebraska and any other school, else his final Nebraska season.
    // Nebraska is drawn from the page's Nebraska years (neb), so the bar matches the stat box and Hall of Fame card.
    // The timeline covers playing years only: no Hall of Fame markers, and the Hall of Fame years never widen the bar.
    const nebV = yrs(neb || "");
    if (nebV.length) spans.push({ lane: "c", a: Math.min(...nebV), b: Math.max(...nebV), label: "Nebraska", neb: true });
    schools.forEach(([n, y]) => { if (nebV.length && /nebraska/i.test(n)) return; const v = yrs(y); if (v.length) spans.push({ lane: "c", a: v[0], b: v[v.length - 1], label: n, neb: /nebraska/i.test(n) }); });
    (info.playingCollege || []).forEach(([y, n]) => { if (nebV.length && /nebraska/i.test(n)) return; const v = yrs(y); if (v.length && !spans.some((x) => x.lane === "c" && x.label === n)) spans.push({ lane: "c", a: v[0], b: v[v.length - 1], label: n, neb: /nebraska/i.test(n) }); });
    if (!spans.some((x) => x.neb) && +(info.year || info.finalYear)) marks.push({ y: +(info.year || info.finalYear), label: "Final Nebraska season", kind: "c" });
    // Pro stops from Wikipedia ("Detroit Lions (2001–2014)", "*" = offseason / practice squad).
    careerLines.forEach((e) => {
      const m = e.match(/^(.*?)\s*\(([^)]*)\)\s*(\*?)/); if (!m) return;
      m[2].split(/,\s*/).forEach((part) => { const v = yrs(part); if (v.length) spans.push({ lane: "p", a: v[0], b: v[v.length - 1], label: m[1].trim(), soft: !!m[3] }); });
    });
    spans.forEach((x) => { if (x.lane !== "p") return; x.team = teamOf(x.label);
      // The logo of the time: "St. Louis Rams" gets the St. Louis Rams logo, a CFL team its own logo.
      const nm = x.label.replace(/\*$/, "").trim(); if (TEAMLOGOS[nm]) x.eraLogo = { logo: TEAMLOGOS[nm] }; });
    // Teams from my research notes (as on Huskers by NFL Team): a bar when the note gives a year, otherwise listed below.
    noteTeams.forEach(({ t, yrs: ys, pfa }) => {
      if (spans.some((x) => x.lane === "p" && x.team === t)) return;
      const v = yrs(ys);
      if (v.length) spans.push({ lane: "p", a: Math.min(...v), b: Math.max(...v), label: t.name, team: t, soft: /offseason|practice/i.test(ys), fromNote: !pfa, pfa });
      else if (!undated.includes(t)) undated.push(t);
    });
    const d = String(draft || "").match(/((?:19|20)\d{2})\s*[:/]?\s*(.*)/);
    if (d) marks.push({ y: +d[1], label: draftLabel, sub: d[2].replace(/(\d+)(?:st|nd|rd|th) round,?\s*/i, "Rd $1, ").replace(/(\d+)(?:st|nd|rd|th) overall pick/i, "#$1").replace(/,\s*$/, ""), kind: "d" });
    // Dated moments from my research notes ("Released by the Broncos on 8/24/94"), one per sentence.
    if (note && TEAMIDX_NICK) {
      note.split(/(?<=[.!?])\s+|\n+/).forEach((sent) => {
        const ym = [...sent.matchAll(YEAR_RE)][0]; if (!ym) return;
        const yv = ym[1] || ym[2] || ym[3] || ym[4], y = yv.length === 4 ? +yv : (+yv <= NOW % 100 ? 2000 : 1900) + +yv;
        const w = EVENT_WORDS.find(([re]) => re.test(sent)); if (!w) return;
        const team = (sent.match(TEAMIDX_NICK) || [])[0] || "";
        marks.push({ y, label: w[1], sub: team, full: sent.trim(), kind: "n" });
      });
    }
    if (spans.length + marks.length + undated.length < 2 && !spans.some((x) => x.neb)) return "";   // a lone Nebraska bar still shows (Ian: years show as a bar, not only text)
    const all = [...spans.flatMap((x) => [x.a, x.b]), ...marks.map((x) => x.y)].filter((y) => y > 1850 && y <= NOW + 1);
    if (!all.length) return "";
    // Positions are percentages, so a short career fills the width; long careers get a minimum spacing and scroll.
    const lo = Math.min(...all), hi = Math.max(...all), n = hi - lo + 1, px = (y) => ((y - lo) / n) * 100, step = n > 30 ? 10 : n > 14 ? 5 : n > 8 ? 2 : 1;
    // Bars that would overlap go on another row.
    const rowsFor = (items, a, b) => { const ends = []; return items.map((it) => { let r = ends.findIndex((e) => e < a(it)); if (r < 0) r = ends.length; ends[r] = b(it); return r; }); };
    const bars = (lane) => { const it = spans.filter((x) => x.lane === lane).sort((x, y) => x.a - y.a), rows = rowsFor(it, (x) => x.a, (x) => x.b);
      return it.map((x, k) => `<div class="tl-bar ${lane}${x.neb ? " neb" : ""}${x.soft ? " soft" : ""}" style="left:${px(x.a)}%;width:calc(${px(x.b + 1) - px(x.a)}% - 3px);top:${rows[k] * 30}px" title="${esc(x.label)} (${x.a}${x.b > x.a ? "–" + x.b : ""})${x.soft ? ", offseason / practice squad" : ""}${x.fromNote ? " (from my research notes)" : x.pfa ? " (year from Pro Football Archives)" : ""}">${logo(x.neb ? NEB : x.eraLogo || x.team)}<span class="tl-t">${esc(x.label)}</span></div>`).join("")
        + `<i class="tl-h" style="height:${(Math.max(-1, ...rows) + 1) * 30}px"></i>`; };
    requestAnimationFrame(() => tlFit(document.querySelector(".tl-sec")));
    const gap = Math.max(2, Math.ceil(n / 6)), ms = marks.slice().sort((x, y) => x.y - y.y), mrows = rowsFor(ms, (x) => x.y, (x) => x.y + gap);
    const cap = mrows.length ? Math.max(...mrows) + 1 : 0;
    return `<section class="wide-sec tl-sec"><h2>Career timeline</h2><div class="tl-scroll"><div class="tl" style="min-width:${n * 12 + 60}px">
      <div class="tl-years">${Array.from({ length: n }, (_, k) => lo + k).filter((y) => y % step === 0 || (y === lo && (Math.ceil(lo / step) * step - lo) * 2 >= step)).map((y) => `<span style="left:${px(y)}%">${y}</span>`).join("")}</div>
      ${spans.some((x) => x.lane === "c") ? `<div class="tl-lane"><b class="tl-k">College</b><div class="tl-track">${bars("c")}</div></div>` : ""}
      ${spans.some((x) => x.lane === "p") ? `<div class="tl-lane"><b class="tl-k">Pro</b><div class="tl-track">${bars("p")}</div></div>` : ""}
      ${ms.length ? `<div class="tl-marks" style="height:${cap * 46}px">${ms.map((x, k) => `<div class="tl-m ${x.kind}${px(x.y) > 62 ? " r" : ""}" style="left:calc(${px(x.y) + 50 / n}% - 6px);top:${mrows[k] * 46}px"${x.full ? ` title="${esc(x.full)}"` : ""}>${x.kind === "c" ? `<i class="tl-n">${logo(NEB)}</i>` : "<i></i>"}<span><b>${esc(x.label)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ""}<small>${x.y}</small></span></div>`).join("")}</div>` : ""}
    </div></div>${undated.length ? `<div class="tl-undated"><b>With these teams</b> <span>(year not in my notes)</span>${undated.map((t) => `<a class="tl-team" href="#/nfl-teams/${t.slug}">${logo(t)}${esc(t.name)}</a>`).join("")}</div>` : ""}
    <p class="note">From Wikipedia, my research notes${pfaCareer || spans.some((x) => x.pfa) ? ` and <a href="https://www.profootballarchives.com/" target="_blank" rel="noopener">Pro Football Archives</a>` : ""}. Swipe sideways for more years.</p></section>`;
  }
  // Bars too short for their name are widened just enough to hold it (the start year stays true; a bar at the far right is nudged left), then stacked by pixel overlap so bars never collide.
  function tlFit(sec) {
    if (!sec) return;
    sec.querySelectorAll(".tl-track").forEach((tr) => {
      const W = tr.clientWidth; if (!W) return;
      const items = [...tr.querySelectorAll(".tl-bar")].map((b) => {
        if (!b.dataset.l) b.dataset.l = parseFloat(b.style.left);
        b.style.minWidth = ""; b.style.left = b.dataset.l + "%";
        const t = b.querySelector(".tl-t"), w = b.offsetWidth, need = t && t.scrollWidth > t.clientWidth + 1 ? w + (t.scrollWidth - t.clientWidth) + 1 : w;
        let l = b.dataset.l / 100 * W;
        if (need > w) { b.style.minWidth = need + "px"; if (l + need > W) { l = Math.max(0, W - need); b.style.left = l + "px"; } }
        return { b, l, r: l + need };
      }).sort((x, y) => x.l - y.l);
      const ends = [];
      items.forEach((it) => { let r = ends.findIndex((e) => e + 4 < it.l); if (r < 0) r = ends.length; ends[r] = it.r; it.b.style.top = r * 30 + "px"; });
      const h = tr.querySelector(".tl-h"); if (h) h.style.height = Math.max(1, ends.length) * 30 + "px";
    });
  }
  if (!window._tlResize) { window._tlResize = 1; let tm; window.addEventListener("resize", () => { clearTimeout(tm); tm = setTimeout(() => tlFit(document.querySelector(".tl-sec")), 150); }); }
  let TEAMIDX_NICK = null;
  const HOF_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v3a5 5 0 0 1-10 0V4zM7 5H4v1a3 3 0 0 0 3 3M17 5h3v1a3 3 0 0 1-3 3M12 12v4M8 20h8M9 20l1-4h4l1 4"/></svg>`;
  // Signature showcase (config "signatures", Ian's request): the signature's ink lifted out of one autograph scan and shown
  // as a glowing red neon sign on black. Done on screen only, in a canvas; the scan itself is never changed. Just a picture, not a link.
  // Per player: id (scan), box [left, top, width, height] as fractions, ar (scan width / height),
  // ink "blue" (blue marker), "red" (red Sharpie), "dark" (black marker: darker than the card around it),
  // "black" (very dark ink on white; t ~150), "purple" (purple Sharpie: ignores a gray box border),
  // "gray" (black/gray marker on a colored card: only colorless dark ink counts; t ~110) or "both",
  // t (ink threshold), w (scan width to load; Fan Day sheets use 2000), grow (thicken strokes, pixels).
  // Fan Day sheets (config "fanDay"): the player's own box from a multi-signed sheet, cropped on screen only (files
  // untouched). Tap to open the whole sheet.
  function fanDayOf(slug) {   // the newest Fan Day box for this player
    return ((DATA.site.fanDay || {})[slug] || []).map((g) => ({ g, c: CARDS.find((x) => x.id === g.id) })).filter((x) => x.c)
      .sort((a, b) => (b.c.year || 0) - (a.c.year || 0))[0] || null;
  }
  function fanDayCrop({ g, c }, name) {
    const [x, y, w, h] = g.box, pos = (v, s) => (s >= 1 ? 0 : (v / (1 - s)) * 100);
    return `<button type="button" class="fd-item" data-i="${c.i}" aria-label="${esc(name)}'s autograph on ${esc(c.name)}. Opens the whole sheet.">
      <span class="fd-crop" style="aspect-ratio:${((w * (g.ar || 1.3)) / h).toFixed(3)};background-image:url('${img(c.id, c.rk, 1600)}');background-size:${(100 / w).toFixed(2)}% ${(100 / h).toFixed(2)}%;background-position:${pos(x, w).toFixed(2)}% ${pos(y, h).toFixed(2)}%"></span></button>`;
  }
  // A small Fan Day crop for list thumbnails (team pages, Husker Bios), where a player has no card scan of his own.
  function fdThumb(slug, size) {
    const f = fanDayOf(slug); if (!f) return "";
    const { g, c } = f, [x, y, w, h] = g.box, pos = (v, s) => (s >= 1 ? 0 : (v / (1 - s)) * 100);
    return `<span class="fd-crop fd-th" style="aspect-ratio:${((w * (g.ar || 1.3)) / h).toFixed(3)};background-image:url('${img(c.id, c.rk, size || 1200)}');background-size:${(100 / w).toFixed(2)}% ${(100 / h).toFixed(2)}%;background-position:${pos(x, w).toFixed(2)}% ${pos(y, h).toFixed(2)}%"></span>`;
  }
  const pmPh = (sc, slug) => { const fd = !sc && fdThumb(slug);
    return fd ? `<span class="pm-ph land fd">${fd}</span>` : `<span class="pm-ph">${sc ? `<img alt="" loading="lazy" src="${img(sc.id, sc.rk, 160)}" onload="thumbFit(this)">` : ""}</span>`; };
  const fdLabel = (c) => (c.name.match(/^\d{4}\s+Husker Fan Day/i) || [c.name])[0];
  function signatureHTML(slug, name) {
    const g = (DATA.site.signatures || {})[slug]; if (!g || !g.box) return "";
    const c = CARDS.find((x) => x.id === g.id); if (!c) return "";
    const [, , w, h] = g.box, ar = g.ar || 0.7;
    requestAnimationFrame(() => drawNeon(slug, c, g));
    return `<div class="sig-panel" role="img" aria-label="${esc(name)}'s signature">
      <canvas class="sig-neon" id="sig-${esc(slug)}" style="aspect-ratio:${((w * ar) / h).toFixed(3)}" aria-hidden="true"></canvas></div>`;
  }
  function drawNeon(slug, c, g) {
    const cv = document.getElementById("sig-" + slug); if (!cv) return;
    const im = new Image(); im.crossOrigin = "anonymous";
    im.onload = () => {
      const [x, y, w, h] = g.box, sx = x * im.naturalWidth, sy = y * im.naturalHeight, sw = w * im.naturalWidth, sh = h * im.naturalHeight;
      const W = 900, H = Math.round((W * sh) / sw);
      const cx = document.createElement("canvas"); cx.width = W; cx.height = H;
      const t = cx.getContext("2d", { willReadFrequently: true }); t.drawImage(im, sx, sy, sw, sh, 0, 0, W, H);
      let d; try { d = t.getImageData(0, 0, W, H); } catch (e) { return; }
      const px = d.data, N = W * H, lum = new Float32Array(N), m = new Float32Array(N);
      for (let k = 0; k < N; k++) lum[k] = 0.299 * px[4 * k] + 0.587 * px[4 * k + 1] + 0.114 * px[4 * k + 2];
      // "Darker than the card around it": compare with a wide box blur of the brightness (the local background).
      let bg = null;
      if (g.ink === "dark" || g.ink === "both") {
        const R = 24, I = new Float64Array((W + 1) * (H + 1));
        for (let yy = 0; yy < H; yy++) { let row = 0; for (let xx = 0; xx < W; xx++) { row += lum[yy * W + xx]; I[(yy + 1) * (W + 1) + xx + 1] = I[yy * (W + 1) + xx + 1] + row; } }
        bg = new Float32Array(N);
        for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
          const a = Math.max(0, xx - R), b = Math.max(0, yy - R), e = Math.min(W, xx + R + 1), f = Math.min(H, yy + R + 1);
          bg[yy * W + xx] = (I[f * (W + 1) + e] - I[b * (W + 1) + e] - I[f * (W + 1) + a] + I[b * (W + 1) + a]) / ((e - a) * (f - b));
        }
      }
      const th = g.t || 40;
      for (let k = 0; k < N; k++) {
        const blue = (px[4 * k + 2] - (px[4 * k] + px[4 * k + 1]) / 2) * 1.6, dark = bg ? bg[k] - lum[k] : 0;
        const red = (px[4 * k] - (px[4 * k + 1] + px[4 * k + 2]) / 2) * 1.6;
        const sc = g.ink === "dark" ? dark : g.ink === "black" ? 255 - lum[k] : g.ink === "gray" ? (Math.max(px[4 * k], px[4 * k + 1], px[4 * k + 2]) - Math.min(px[4 * k], px[4 * k + 1], px[4 * k + 2]) < 45 ? 255 - lum[k] : 0) : g.ink === "purple" ? ((px[4 * k] + px[4 * k + 2]) / 2 - px[4 * k + 1]) * 2.4 : g.ink === "red" ? red : g.ink === "both" ? Math.max(blue, dark) : blue;
        m[k] = Math.min(1, Math.max(0, (sc - th) / 30));
      }
      // Drop specks (foil sparkle, printed patterns): pieces of ink smaller than 0.15% of the area.
      const lab = new Int32Array(N), keep = new Uint8Array(N + 1), stack = new Int32Array(N); let n = 0;
      for (let k = 0; k < N; k++) {
        if (m[k] < 0.5 || lab[k]) continue;
        n++; let sp = 0, size = 0; stack[sp++] = k; lab[k] = n;
        while (sp) { const q = stack[--sp]; size++; const qx = q % W;
          for (const r of [q - W, q + W, qx > 0 ? q - 1 : -1, qx < W - 1 ? q + 1 : -1]) if (r >= 0 && r < N && !lab[r] && m[r] >= 0.5) { lab[r] = n; stack[sp++] = r; } }
        keep[n] = size >= (g.minArea || 0.0015) * N ? 1 : 0;   // minArea: smaller, to keep an i-dot on a clean image
      }
      // Soft edges stay only next to kept ink.
      const near = (k) => { const kx = k % W; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const xx = kx + dx, r = k + dy * W + dx; if (xx >= 0 && xx < W && r >= 0 && r < N && keep[lab[r]]) return true; } return false; };
      for (let k = 0; k < N; k++) if (m[k] > 0 && !(lab[k] && keep[lab[k]]) && !near(k)) m[k] = 0;
      // grow: thicken the strokes by this many pixels (bold markers look thin at this size otherwise).
      for (let n = 0; n < (g.grow || 0); n++) {
        const src = m.slice();
        for (let k = 0; k < N; k++) { const kx = k % W; let v = src[k];
          if (kx > 0) v = Math.max(v, src[k - 1]); if (kx < W - 1) v = Math.max(v, src[k + 1]);
          if (k >= W) v = Math.max(v, src[k - W]); if (k < N - W) v = Math.max(v, src[k + W]); m[k] = v; }
      }
      // Anti-aliasing: soften each stroke's edge by one pixel (thickened strokes otherwise show stair steps).
      { const src = m.slice();
        for (let k = 0; k < N; k++) { const kx = k % W; let sum = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = kx + dx, r = k + dy * W + dx;
            if (xx >= 0 && xx < W && r >= 0 && r < N) { sum += src[r] * (dx || dy ? 1 : 2); n += dx || dy ? 1 : 2; } }
          m[k] = sum / n; } }
      // The tube: hot pinkish-white in the middle of each stroke, red toward its edges.
      const core = new Float32Array(N);
      for (let k = 0; k < N; k++) { if (m[k] < 0.5) continue; const kx = k % W; let lo = 1;
        for (let dy = -2; dy <= 2 && lo > 0; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = kx + dx, r = k + dy * W + dx; lo = Math.min(lo, xx >= 0 && xx < W && r >= 0 && r < N ? m[r] : 0); }
        core[k] = lo; }
      const out = t.createImageData(W, H), o = out.data;
      for (let k = 0; k < N; k++) { const a = m[k]; if (!a) continue; const cc = core[k];
        o[4 * k] = 255; o[4 * k + 1] = Math.round(40 + 190 * cc); o[4 * k + 2] = Math.round(30 + 180 * cc); o[4 * k + 3] = Math.round(255 * a); }
      cv.width = W; cv.height = H; cv.getContext("2d").putImageData(out, 0, 0); cv.classList.add("on");
    };
    im.src = g.src || img(c.id, c.rk, g.w || 1200);   // src: a signature image Ian cleaned up himself   // Fan Day sheets: w 2000, since each box is a small part of the sheet
  }
  function player(slug) {
    setNav("nfl-huskers");
    loadHub(() => Promise.all([backText(), nflTeamData().then((t) => (NFLTEAMS_LIST = t))]).then(([CB]) => {
      const p = (PLAYERS.players || []).find((x) => x.slug === slug);
      const row = allPlayers().find((x) => x.slug === slug);
      if (!p && !row) return notFound();
      const info = { ...(row || {}), ...(p || {}), ...live(row) }, w = (p && p.wiki) || null, hof = hofFor(info), chof = hofFor(info, true), pro = PROHOF[slug];
      if (!TEAMIDX_NICK && NFLTEAMS_LIST) TEAMIDX_NICK = new RegExp(`\\b(${NFLTEAMS_LIST.flatMap((t) => t.nick).join("|")})\\b`);
      const football = (info.sport || "football") === "football";
      setTitle(info.name);
      if (info.back && info.back.startsWith("#/checklist/")) setNav(info.back.slice(2));
      const back = info.back || "#/nfl-huskers", backLabel = info.backLabel || "Husker Bios";
      const sport = info.sport || "football";
      const scans = scansFor(info.name, sport);
      // A Husker with his own collection on the site (Alex Gordon): show one of those autographs and link to it.
      const pcIdx = SECTIONS.findIndex((x) => norm(x.title) === norm(info.name));
      const pc = pcIdx >= 0 ? sectionCards(pcIdx) : [];
      const hero = info.have ? bestScan(info.name, sport) || pc.find((c) => c.tags.has("auto")) || null : null;
      const sec = (w && w.sections) || {};
      const pick = (label) => Object.values(sec).flat().find((r) => r.length === 2 && r[0] === label);
      // Baseball infoboxes put position, birth and bats/throws in single lines under the team heading.
      const lines = [...((w && w.facts) || []), ...Object.values(sec).flat()].filter((r) => r.length === 1).map((r) => r[0]);
      const line = (re) => (lines.find((t) => re.test(t)) || "").replace(re, "").trim();
      // Active players' first heading is their team, with the position as its first line; retired players' isn't.
      const [firstKey, firstSec = []] = Object.entries(sec)[0] || [];
      const looksLikePos = (t) => t && !/[:\d]/.test(t) && t.length < 60;
      const bbPos = football ? "" : (firstKey && !/debut|statistics|teams|appearance/i.test(firstKey) && firstSec[0] && firstSec[0].length === 1 && looksLikePos(firstSec[0][0]) ? firstSec[0][0]
        : (((w && w.facts) || []).find((r) => r.length === 1 && looksLikePos(r[0])) || [""])[0]);
      const debut = Object.entries(sec).find(([k]) => /debut$/i.test(k));
      // The College line can list several schools, e.g. "LSU (2019–2021)Nebraska (2022)".
      const schools = [...((pick("College") || [])[1] || "").matchAll(/([^()\n]+?)\s*\(([^)]*)\)/g)].map((m) => [m[1].trim(), m[2].trim()]);
      // Nebraska years: Wikipedia's range when its last year agrees with my final season; otherwise (or with no range) my final season only.
      const myFinal = info.year || info.finalYear, wikiNeb = (schools.find(([n]) => /nebraska/i.test(n)) || [])[1] || "";
      const wikiLast = Math.max(0, ...(wikiNeb.match(/(?:19|20)\d{2}/g) || []).map(Number)), useWiki = wikiLast && (!myFinal || +myFinal === wikiLast);
      // One Nebraska range per page: the stat box, the Hall of Fame card and the career timeline all read this value.
      const nebStr = (info.collegeNote && info.collegeNote.nebraska) || nebYears(useWiki ? wikiNeb : "", ((info.letters || {})[sport]) || []);
      // The final season is the Nebraska range's last year (Ian, 2026-11-26), so the box shows only when there is no range. The spreadsheet's Last Year can be a pro year.
      const nebLast = Math.max(0, ...(nebStr.match(/(?:19|20)\d{2}/g) || []).map(Number));
      // Hand-written "also" line (data/college-notes.json): its schools join the timeline, and a school with an alsoLinks URL is linked.
      const alsoNote = (info.collegeNote && info.collegeNote.also) || "", alsoLinks = (info.collegeNote && info.collegeNote.alsoLinks) || {};
      const alsoSchools = [...alsoNote.matchAll(/([^(),]+?)\s*\(([^)]*)\)/g)].map((m) => [m[1].trim(), m[2].trim()]).filter(([n]) => !/nebraska/i.test(n));
      const alsoHtml = alsoNote && Object.keys(alsoLinks).length ? { html: alsoNote.split(/,\s*(?![^()]*\))/).map((part) => { const n = Object.keys(alsoLinks).find((k) => part.startsWith(k)); return n ? `<a href="${esc(alsoLinks[n])}" target="_blank" rel="noopener">${esc(n)}</a>${esc(part.slice(n.length))}` : esc(part); }).join(", ") } : "";
      // ProBallers id: the spreadsheet's ProBallers column (config/private-lists.json proballersRange), else config/site.json proballers.ids.
      const pbId = (DATA.site.proballers?.ids || {})[slug] || (((CHECK.lists.find((x) => x.slug === (row && row.listSlug)) || {}).proballers || {})[(row && row.name) || info.name]);
      const facts = [["Position", info.position || (pick("Position") || [])[1] || bbPos], ["Final season at Nebraska", !nebLast && myFinal ? myFinal : ""],
        ["Nebraska years", nebStr],
        // A player who lettered in another sport too (multiSport in data/letter-aliases.json): a timeline for each.
        ...Object.entries(info.letters || {}).filter(([sp]) => sp !== sport).map(([sp, ys]) => [`Nebraska ${sp} years`, yearRanges([...new Set(ys)].sort((x, y) => x - y))]),
        [useWiki || myFinal ? "Also played at" : "College", alsoHtml || (info.collegeNote && info.collegeNote.also) || schools.filter(([n]) => !/nebraska/i.test(n)).map(([n, y]) => `${n} (${y})`).join(", ")],
        ["NFL draft", (pick("NFL draft") || [])[1]], ["NBA draft", (pick("NBA draft") || [])[1]], ["MLB draft", (pick("MLB draft") || [])[1]],
        [debut ? debut[0] : "", debut ? (debut[1][0] || [])[0] : ""],
        ["NFL games", football ? info.games || info.nflGames : ""], ["Born", (pick("Born") || [])[1] || line(/^Born:\s*/)],
        ["Bats / throws", line(/^(?=Bat(?:s|ted):)/).replace(/Bat(?:s|ted):\s*/, "").replace(/\s*Thr(?:ows|ew):\s*/, " / ")],
        ...Object.entries(sec).filter(([k]) => /^Last .*appearance$/i.test(k)).map(([k, v]) => [k, (v[0] || [])[0]]),
        ["High school", (pick("High school") || [])[1]], ["Height / weight", [(pick("Listed height") || [])[1], (pick("Listed weight") || [])[1]].filter(Boolean).join(" · ")]]
        .filter(([, v]) => v && String(v).trim());
      // What Ian's custom card backs add (data/card-text.json, "player": this page): facts join the facts grid,
      // stats get a box next to the other stats, and his write-up leads the bio. Marked ★ so sources stay clear.
      // A card about several players ("people") gives each his own part. Several cards often repeat the same write-up
      // or facts: each is shown once, and a card's fact never repeats one the page already has (e.g. "Born").
      // His own cards come before group cards. Per kind of fact (any "Statistics…" line counts as one kind) the fullest
      // version is kept. Only write-ups go in the bio (a back with only an authenticity note adds nothing here).
      const mine = Object.values(CB || {}).flatMap((e) => (!e ? [] : e.people ? e.people.map((q) => ({ ...q, group: true })) : [e]))
        .filter((e) => e.player === slug).sort((a, b) => !!a.group - !!b.group);
      const haveKey = new Set(facts.map(([k]) => k.toLowerCase())), kind = (k) => (/stat/i.test(k) ? "stats" : k.toLowerCase()), best = new Map();
      mine.forEach((e) => (e.facts || []).filter((r) => r.length === 2).forEach(([k, v]) => {
        if (haveKey.has(k.toLowerCase()) || /^nebraska class$/i.test(k.trim())) return;
        const b = best.get(kind(k)); if (!b || String(v).length > String(b[1]).length) best.set(kind(k), [k, v, true]); }));
      facts.push(...best.values());
      const cardStats = mine.map((e) => e.stats).filter((st) => st && (st.rows || []).length > 1);
      const ianBio = [...new Set(mine.map((e) => e.story).filter(Boolean))].join("\n\n");
      const statKey = Object.keys(sec).find((k) => /statistics/i.test(k));
      // A list section, in whichever name this sport's infobox uses; "2022–2024 | Team" rows read as "Team (2022–2024)".
      const list = (...ks) => { const k = ks.find((x) => sec[x] && sec[x].length); return k ? sec[k].map((r) => `<li>${esc((r.length === 2 ? `${r[1].replace(/^→\s*/, "↳ ")} (${r[0]})` : r[0]).replace(/\s*\n\s*/g, " · "))}</li>`).join("") : ""; };
      const teams = list("Career history", "Playing", "Teams"), awards = list("Awards and highlights", "Career highlights and awards", "Career highlights");
      // Coaches (custom-card pages such as Tom Osborne): their coaching career, as Wikipedia lists it. Older infoboxes put
      // playing and coaching years together under "Football", with the "Position" row between them: coaching is what follows it.
      const fb = sec["Football"] || [], posAt = fb.findIndex((r) => r[0] === "Position");
      const coachRows = [sec["Coaching"], sec["Coaching career (HC unless noted)"], sec["Coaching career"], fb.length ? fb.slice(posAt + 1) : null]
        .find((r) => r && r.length) || [];
      const coaching = info.card ? coachRows.filter((r) => r[0] !== "Position").map((r) => `<li>${esc((r.length === 2 ? `${r[1]} (${r[0]})` : r[0]).replace(/\s*\n\s*/g, " · "))}</li>`).join("") : "";
      const statsLink = football && /^https?:\/\//i.test(info.link || "") ? info.link : w && w.statsLink ? w.statsLink.url : "";
      const college = p && p.college;
      const DEF = /defensive|linebacker|cornerback|safety|end\b|tackle/i;
      const CATS = [["passing", "Passing", ["COMPLETIONS", "ATT", "PCT", "YDS", "YPA", "TD", "INT"]], ["rushing", "Rushing", ["CAR", "YDS", "YPC", "LONG", "TD"]],
        ["receiving", "Receiving", ["REC", "YDS", "YPR", "LONG", "TD"]], ["defensive", "Defense", ["TOT", "SOLO", "TFL", "SACKS", "QB HUR", "PD", "TD"]],
        ["interceptions", "Interceptions", ["INT", "YDS", "AVG", "TD"]], ["kickReturns", "Kick returns", ["NO", "YDS", "AVG", "LONG", "TD"]],
        ["puntReturns", "Punt returns", ["NO", "YDS", "AVG", "LONG", "TD"]], ["kicking", "Kicking", ["FGM", "FGA", "PCT", "LONG", "XPM", "XPA", "PTS"]],
        ["punting", "Punting", ["NO", "YDS", "YPP", "LONG", "IN 20", "TB"]], ["scoring", "Scoring", ["TD", "XP1", "XP2", "FG", "TP"]]];
      const LABEL = { COMPLETIONS: "CMP", "QB HUR": "QBH", XP1: "XP", XP2: "2PT", TP: "PTS" };
      const collegeHTML = college ? CATS.map(([key, title, order]) => {
        const yrs = Object.keys(college).filter((y) => college[y][key]); if (!yrs.length) return "";
        const cols = order.filter((k) => yrs.some((y) => college[y][key][k] !== undefined));
        return `<div class="ct-wrap"><table class="ct"><thead><tr><th rowspan="2">Season</th><th colspan="${cols.length}">${title}</th></tr><tr>${cols.map((k) => `<th>${esc(LABEL[k] || k)}</th>`).join("")}</tr></thead>
          <tbody>${yrs.map((y) => `<tr><td>${y}</td>${cols.map((k) => `<td>${esc(college[y][key][k] ?? "–")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      }).join("") : "";
      const isData = (r) => /^(\d{4}|career|total)/i.test((r[0] || [""])[0]);
      const wtables = ((p && p.collegeTables) || []).map((t) => {
        const first = t.rows.findIndex(isData), head = first > 0 ? t.rows.slice(0, first) : t.rows.slice(0, 1), body = t.rows.slice(first > 0 ? first : 1);
        const cell = (tag, rs) => ([v, n]) => `<${tag}${n > 1 ? ` colspan="${n}"` : ""}${rs && n === 1 ? ` rowspan="${rs}"` : ""}>${esc(v)}</${tag}>`;
        // With two heading rows, single-column headings in the first row (Season, Team) span both rows.
        return `<div class="ct-wrap"><table class="ct"><thead>${head.map((r, i) => `<tr>${r.map(cell("th", head.length === 2 && i === 0 ? 2 : 0)).join("")}</tr>`).join("")}</thead><tbody>${body.map((r) => `<tr class="${/^(career|total)/i.test(r[0][0]) ? "tot" : ""}">${r.map(cell("td")).join("")}</tr>`).join("")}</tbody></table></div>`;
      }).join("");
      // Reference images (e.g. a photo compilation) in a column on the right of the profile; tap to open larger.
      const refs = refsFor(info.name);
      // Hall of Fame honors sit in the right-hand column (with any reference images), not as wide cards in the middle.
      const honorsHTML = `${pro ? `<a class="hof pro hof-link" href="https://www.profootballhof.com/players/${encodeURIComponent((PROHOFURL[slug] || slug))}" target="_blank" rel="noopener" aria-label="${esc(info.name)} at the Pro Football Hall of Fame"><div class="hof-ic">${HOF_ICON}</div><div><div class="hof-k">Pro Football Hall of Fame</div>
              <b>${pro >= new Date().getFullYear() ? "Class of" : "Inducted"} ${esc(String(pro))}</b><span>Canton, Ohio</span></div></a>` : ""}
            ${chof ? `<a class="hof hof-link" href="${esc(chof.url || "https://www.cfbhall.com/inductees/")}" target="_blank" rel="noopener" aria-label="${esc(info.name)} at the College Football Hall of Fame"><div class="hof-ic">${HOF_ICON}</div><div><div class="hof-k">College Football Hall of Fame</div>
              <b>Class of ${esc(String(chof.class))}</b>${chof.role ? `<span>Inducted as a coach</span>` : ""}<span>Atlanta, Georgia</span></div></a>` : ""}
            ${hof ? `<section class="hof"><div class="hof-ic">${HOF_ICON}</div><div><div class="hof-k">Nebraska Football Hall of Fame</div>
              <b>Class of ${esc(String(hof.class))}</b>${hof.role ? `<span>${esc(hof.role === "Coach" ? "Inducted as a coach" : hof.role)}</span>` : ""}
              <a href="https://huskers.com/nebraska-football-hall-of-fame" target="_blank" rel="noopener">Full Hall of Fame at huskers.com ↗</a></div></section>` : ""}`;
      const refHTML = refs.length || pro || hof || chof ? `<aside class="pl-refs" aria-label="Honors and reference images">${honorsHTML}${refs.map((r) => `<button type="button" class="pl-ref" data-ref="${esc(r.id)}" data-ref-name="${esc(info.name)}" aria-label="Open ${esc(r.name)}">
        <img alt="${esc(r.name)}" loading="lazy" src="${img(r.id, r.rk, 900)}"></button>`).join("")}</aside>` : "";
      const tcdbHTML = (() => { const T = DATA.site.tcdb || {}, pid = (T.players || {})[slug]; if (!pid) return "";
              const fill = (u) => u.replace("{pid}", pid).replace("{name}", encodeURIComponent(info.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, ""))).replace("{member}", encodeURIComponent(T.member || ""));
              return `<div class="tcdb-row">${T.collectionUrl ? `<a class="btn tcdb" href="${esc(fill(T.collectionUrl))}" target="_blank" rel="noopener">View my full ${esc(info.name)} collection on TCDb ↗</a>` : ""}${T.tradeUrl ? `<a class="btn tcdb trade" href="${esc(fill(T.tradeUrl))}" target="_blank" rel="noopener">View my ${esc(info.name)} cards for trade ↗</a>` : ""}</div>`; })();
      $("#app").innerHTML = `<div class="wrap pl c-husker">
        <a class="back" href="${back}">← ${esc(backLabel)}</a>
        <div class="pl-top${refs.length || pro || hof || chof ? " has-refs" : ""}">
          <div class="pl-card">${!hero && fanDayOf(slug) ? `<div class="pl-ph fd-hero">${fanDayCrop(fanDayOf(slug), info.name)}</div><small>${esc(fdLabel(fanDayOf(slug).c))}</small>` : hero ? `<button type="button" class="pl-ph${scans.includes(hero) ? "" : " cd"}" ${scans.includes(hero) ? `data-scan="${esc(info.name)}" data-sport="${sport}"` : `data-i="${hero.i}"`}><img alt="${esc(hero.name)}" src="${img(hero.id, hero.rk, 900)}" onload="fitFrame(this)"></button><small>${esc(hero.name)}</small>`
            : `<div class="pl-ph none"><span class="st ${info.have ? "have" : "need"}">${info.have ? "Have" : "Need"}</span><p>${info.have ? `${info.signed ? `Signed ${esc(info.signed.toLowerCase())}. ` : ""}Scan coming soon.` : "I'm still looking for this autograph. Can you help?"}</p>${info.have ? "" : contactHTML("I can help with this autograph", `${info.name} autograph`, `Hi Ian,\n\nI saw you're looking for a ${info.name} autograph. I might be able to help:\n\n`, info.name)}</div>`}${tcdbHTML}</div>
          <div class="pl-main">
            <div class="kick">${esc(info.position || bbPos || (football ? "Nebraska Cornhusker" : `Nebraska Cornhuskers ${info.sport}`))}</div>
            <div class="pl-name"><h1>${esc(info.name)}</h1>${signatureHTML(slug, info.name)}</div>
            <div class="pl-badges">${info.have ? "" : `<span class="st need">Need</span>`}${info.have && info.signed ? `<span class="pill">Signed ${esc(info.signed.toLowerCase())}</span>` : ""}</div>
            ${statsLink ? `<a class="statlink" href="${esc(statsLink)}" target="_blank" rel="noopener">Career stats at ${esc(siteName(statsLink))} ↗</a>` : ""}
            ${((DATA.site.playerExtras || {})[slug] || {}).about ? `<p class="pl-about">${esc(DATA.site.playerExtras[slug].about)}</p>` : ""}
            ${playerMedia(slug).map((m) => `<a class="statlink watch" href="${esc(m.url)}" target="_blank" rel="noopener">▶ Watch: ${esc(m.title)} ↗</a>`).join("")}
            ${(() => { const l = row && CHECK.lists.find((x) => x.slug === row.listSlug), t = l && (l.notes || {})[row.name];
              return t ? `<section class="why"><h2>Why he's on the ${esc((row.backLabel || "").replace(/ Huskers Autograph List$/, ""))} list</h2>${noteHTML(t)}</section>` : ""; })()}
            <dl class="facts">${facts.map(([k, v, star]) => `<div><dt>${esc(k)}${star ? ' <span class="star" title="From my custom card">★</span>' : ""}</dt><dd>${v && v.html ? v.html : esc(v)}</dd></div>`).join("")}</dl>
            ${ianBio ? `<div class="bio ian">${textHTML(ianBio)}<p class="note">★ From my custom card, written by me.</p></div>` : ""}
            ${w && w.intro ? `<div class="bio">${w.intro.split("\n\n").map((t) => `<p>${esc(t)}</p>`).join("")}</div>` : info.card ? "" : `<p class="muted">${p && p.checked ? "No biography available for this player yet." : "Biography coming soon."}</p>`}
          </div>
          ${refHTML}
        </div>
        ${(football || sport === "basketball") && !info.card ? careerTimeline({ pfaCareer: football && !!TEAMCAREERS[slug], info: { ...info, playingCollege: useWiki || !myFinal ? (sec["Playing career"] || []).filter((r) => r.length === 2 && /\d{4}/.test(r[0]) && /nebraska/i.test(r[1])) : [] },
          schools: schools.filter(([n]) => useWiki || !/nebraska/i.test(n)).concat(alsoSchools.filter(([n]) => !schools.some(([m]) => m === n))), careerLines: [...sec["Career history"] || [], ...sec["Playing"] || []].filter((r) => r.length === 1 || (r.length === 2 && /^\d{4}/.test(r[0]) && !/nebraska/i.test(r[1]))).map((r) => (r.length === 1 ? r[0] : `${r[1].replace(/\s*\n[\s\S]*/, "").trim()} (${r[0]})`))
            .concat((sec["Playing career"] || []).filter((r) => r.length === 2 && /\d{4}/.test(r[0]) && !/nebraska/i.test(r[1])).map(([y, t]) => `${t.trim()} (${y})`))
            // Older pages list a plain "Football" table of [years, team]: playing stops come first, coaching rows follow (marked "(line)", "(assistant)" or after one).
            .concat(football && !(sec["Playing career"] || []).length && !(sec["Career history"] || []).length && !(sec["Football"] || []).some((r) => r.length === 2 && /\d{4}/.test(r[0])) ? TEAMCAREERS[slug] || [] : [])
            .concat(football && !(sec["Playing career"] || []).length && !(sec["Career history"] || []).length ? (() => { const out = []; for (const r of sec["Football"] || []) { if (r.length !== 2 || !/^\d{4}/.test(r[0])) continue; if (/\(/.test(r[1])) break; if (!/nebraska/i.test(r[1])) out.push(`${r[1].trim()} (${r[0]})`); } return out; })() : [])
            // Basketball: Wikipedia's career history rows are [years, team]; "→" marks a G League assignment (drawn as a lighter bar).
            .concat(football ? [] : [...(sec["Career history"] || []), ...(sec["Playing"] || [])].filter((r) => r.length === 2 && /\d{4}/.test(r[0])).map(([y, t]) => `${t.replace(/^→/, "").trim()} (${y.replace(/\s*[;\n]\s*/g, ", ")})${/^→/.test(t) ? "*" : ""}`)),
          noteTeams: NFLTEAMS_LIST && football ? (() => { const idx = teamIndex(NFLTEAMS_LIST); return NFLTEAMS_LIST.flatMap((t) => (idx[t.slug] || []).filter((e) => e.x.slug === slug).map((e) => ({ t, yrs: e.yrs, pfa: e.pfa }))); })() : [],
          neb: nebStr, draft: (pick(football ? "NFL draft" : "NBA draft") || [])[1], draftLabel: football ? "NFL draft" : "NBA draft", note: (() => { const l = row && CHECK.lists.find((x) => x.slug === row.listSlug); return l && (l.notes || {})[row.name]; })(), hof: football ? hof : null, pro: football ? pro : null }) : ""}
        <div class="pl-grid">

          ${statKey ? `<section><h2>${esc(statKey.replace(/\s*\n.*$/s, "").replace(/\s+as of.*$/i, ""))}</h2><table class="kv">${sec[statKey].filter((r) => r.length === 2).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table></section>` : ""}
          ${cardStats.map((st) => { const [h, ...rows] = st.rows;
            // One row (career totals): a simple list; first column is just the row's label. Several rows (seasons): a table.
            const body = rows.length === 1
              ? `<table class="kv"><tbody>${h.map((k, n) => (n === 0 && h.length > 2 ? "" : `<tr><th>${esc(k)}</th><td>${esc(rows[0][n] ?? "")}</td></tr>`)).join("")}</tbody></table>`
              : `<div class="vt-tbl"><table><thead><tr>${h.map((k) => `<th>${esc(k)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
            return `<section><h2>${esc(st.title || "Stats")} <span class="star" title="From my custom card">★</span></h2>${body}<p class="note">From my custom card.</p></section>`; }).join("")}
          ${(!football || (info.card && !collegeHTML)) && !wtables ? "" : `<section class="wide-sec"><h2>College stats</h2>${wtables ? `${wtables}<p class="note">From <a href="${esc(w.url)}" target="_blank" rel="noopener">Wikipedia</a>, CC BY-SA 4.0.</p>` : collegeHTML ? `${collegeHTML}<p class="note">${p.collegeSource === "recordbook"
              ? `Seasons he led Nebraska in a category, from the <a href="https://huskers.com/football-history-and-records" target="_blank" rel="noopener">Nebraska Football Record Book</a> (huskers.com). Full stats for this era aren't in my data source yet.`
              : p.collegeSource === "games" ? "From CollegeFootballData.com (season totals added up from game box scores)." : "From CollegeFootballData.com."}</p>`
            : `<p class="muted">Not available yet.</p>`}</section>`}
          ${pbId ? `<section class="pb-sec"><h2>Pro stats</h2><div class="pb-wrap"><div class="proballers-widget-player-player-unit" data-proballers-player-id="${esc(String(pbId))}" data-proballers-locale="en" data-proballers-base-url="https://widgets.proballers.com"><a href="https://www.proballers.com/" target="_blank" rel="noopener">See stats on Proballers</a></div></div><p class="note">Stats widget from <a href="https://www.proballers.com/" target="_blank" rel="noopener">ProBallers</a>.</p><img alt="" width="1" height="1" class="pb-go" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" onload="loadProballers()"></section>` : ""}
          ${coaching ? `<section><h2>Coaching career</h2><ul class="plain">${coaching}</ul></section>` : ""}
          ${teams ? `<section><h2>Pro teams</h2><ul class="plain">${teams}</ul></section>` : ""}
          ${awards ? `<section><h2>Awards and highlights</h2><ul class="plain">${awards}</ul></section>` : ""}
        </div>
        ${pc.length ? `<p class="pc-link"><a href="#/c/${SECTIONS[pcIdx].slug}">See all ${fmt(pc.length)} scans in my ${esc(SECTIONS[pcIdx].title)} collection →</a></p>` : ""}
        ${scans.length > 1 ? `<h2 class="more-h">More of ${esc(info.name)} in my collection</h2><div class="grid small">${sortList(scans, "old").map((c) => cardHTML(c)).join("")}</div>` : ""}
        ${(() => { const n = playerCards(info.name).length; return n ? `<p class="pc-link"><a href="#/player-cards/${esc(slug)}">See ${n === 1 ? "the 1 scan" : `all ${fmt(n)} scans`} of ${esc(info.name)} in my collection →</a></p>` : ""; })()}
        ${moreHuskers(slug, info, p) || playerNav(slug, info)}
        <p class="ck-plain"><a href="${/^(nfl-tier-|pro-football)/.test(info.listSlug || p?.list || "") ? "nfl-huskers" : "players"}/${esc(slug)}.html">Plain version of this page to share or cite →</a></p>
        <p class="credit">${w ? `Biography and facts adapted from <a href="${esc(w.url)}" target="_blank" rel="noopener">Wikipedia</a>, licensed <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.` : ""}${w && w.pfr && w.pfr !== statsLink ? ` Full pro stats at <a href="${esc(w.pfr)}" target="_blank" rel="noopener">Pro Football Reference</a>.` : ""} Autograph status from my collection records.</p>
        <section class="fix-req"><h2>See something wrong?</h2><p>If anything on this page is incorrect or missing, let me know. Please include what should change and a link or source that shows it.</p>
          <button type="button" class="btn" data-mail data-subject="${esc(`Correction: ${info.name} (Husker Bios)`)}" data-body="${esc(`Hi Ian,\n\nI'd like to suggest a correction to this page:\n${absURL("#/player/" + slug)}\n\nWhat should change:\n\n\nSource or evidence (a link, book, newspaper article, media guide…):\n\n\nThanks!\n`)}">✉ Request a correction</button></section>
      </div>`;
      state.list = scans;
      // The photo itself becomes the watermarked copy (like the viewer's), so "Open image in new tab" or "Save image"
      // gets IANBADEER.COM too; the CSS mark shows until it's ready, then steps aside.
      const heroIm = hero && $(".pl-card .pl-ph:not(.fd-hero) img");
      if (heroIm) marked(hero.id, hero.rk).then((u) => {
        if (!heroIm.isConnected) return;
        heroIm.addEventListener("load", () => heroIm.parentNode.classList.add("baked"), { once: true });
        heroIm.src = u.marked;
      }).catch(() => {});
    }));
  }



  /* ---------- Media: articles, videos and podcasts (config/site.json "media") ---------- */
  function media() {
    setNav("media"); setTitle("Media");
    const m = DATA.site.media || {}, items = m.items || [];
    const when = (it) => it.date ? `<span>${esc(it.date)}</span>` : "";
    const meta = (it) => `<div class="md-meta"><b>${esc(it.outlet || "")}</b>${when(it)}</div>`;
    const watch = items.filter((it) => it.type === "video"), listen = items.filter((it) => it.type === "podcast"), read = items.filter((it) => it.type === "article");
    const vid = (it) => `<figure class="vid md-card">
        ${it.youtube ? `<div class="vid-frame"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(it.youtube)}${it.start ? `?start=${+it.start}` : ""}" title="${esc(it.title)}" loading="lazy"
          referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>` : ""}
        ${/^https:\/\/(creators|open)\.spotify\.com\//.test(it.spotify || "") ? `<iframe class="md-pod" src="${esc(it.spotify)}" title="${esc(it.title)}" loading="lazy" allow="encrypted-media"></iframe>` : ""}
        <figcaption>${meta(it)}<h3>${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)} ↗</a>` : esc(it.title)}</h3>${it.note ? `<p>${esc(it.note)}</p>` : ""}</figcaption></figure>`;
    const art = (it) => `<a class="md-art md-card" href="${esc(it.url)}" target="_blank" rel="noopener">${meta(it)}<h3>${esc(it.title)} ↗</h3>${it.note ? `<p>${esc(it.note)}</p>` : ""}</a>`;
    $("#app").innerHTML = `<div class="wrap ck md"><div class="c-head">
      <div class="kick">In the media</div><h1>Media</h1></div>
      ${m.intro ? `<p class="md-intro">${esc(m.intro)}</p>` : ""}
      ${watch.length ? `<h2 class="sub-h">Video</h2><div class="vids">${watch.map(vid).join("")}</div>` : ""}
      ${listen.length ? `<h2 class="sub-h">Podcasts</h2><div class="vids">${listen.map(vid).join("")}</div>` : ""}
      ${read.length ? `<h2 class="sub-h">Articles</h2><div class="md-arts">${read.map(art).join("")}</div>` : ""}
      ${items.length ? "" : `<p class="empty">Nothing here yet.</p>`}
    </div>`;
  }


  /* ---------- Jermaine Dye career story: my write-up with my best cards from each team ---------- */
  function dyeCareer() {
    const st = DATA.site.dyeStory, si = SECTIONS.findIndex((x) => x.slug === "jermaine-dye");
    if (!st || si < 0) return notFound();
    setNav("jermaine-dye"); setTitle(st.title);
    const sec = SECTIONS[si], mine = sectionCards(si);
    const find = (part) => mine.find((c) => c.name.toLowerCase().includes(part.toLowerCase()));
    const score = (c) => (c.one ? (c.tags.has("auto") || c.tags.has("relic") ? 60 : 15) : 0) + (c.tags.has("auto") ? 30 : 0) + (c.tags.has("relic") ? 25 : 0)
      + (/patch|knob|logoman|nameplate|button|laundry tag/i.test(c.name) ? 15 : 0)
      + (c.serial ? Math.max(0, 30 - Math.log10(c.serial) * 10) : 0) + (c.grade ? 3 : 0);
    const used = new Set(), shownCards = [];
    const pick = (ch, n) => {
      const gi = sec.groups.findIndex((g) => g.label === ch.group);
      const pinned = (ch.cards || []).map(find).filter(Boolean);
      // Cards issued while he played there come first; later retro cards still compete if they're special.
      const [y0, y1] = (ch.years.match(/\d{4}/g) || []).map(Number), era = (c) => (y0 && c.year >= y0 && c.year <= (y1 || y0) + 1 ? 40 : 0);
      const setKey = (c) => c.name.toLowerCase().replace(/\b(donruss|topps|upper deck|fleer|panini|leaf|playoff)\b/g, " ").split(/[^a-z0-9]+/).filter(Boolean).slice(0, 3).join(" ");
      const sets = new Set();
      const auto = mine.filter((c) => c.gi === gi && !c.tags.has("custom") && !/printing plate/i.test(c.name) && !used.has(c.i)).sort((a, b) => score(b) + era(b) - score(a) - era(a) || a.i - b.i)
        .filter((c) => { const k = setKey(c); if (sets.has(k)) return false; sets.add(k); return true; });
      const out = [...pinned, ...auto.filter((c) => !pinned.includes(c))].slice(0, n);
      out.forEach((c) => used.add(c.i));
      return out;
    };
    const card = (c) => { shownCards.push(c); return cardHTML(c); };
    const hi = (st.highlights || []).map((h) => ({ c: find(h.card), cap: h.caption })).filter((h) => h.c);
    hi.forEach((h) => used.add(h.c.i));
    const chapters = st.chapters.map((ch, n) => {
      const cards = pick(ch, ch.paragraphs.length * 2), gi = sec.groups.findIndex((g) => g.label === ch.group);
      return `<section class="ds-ch">
        <div class="ds-ch-h"><span class="ds-num">${String(n + 1).padStart(2, "0")}</span><div><h2>${esc(ch.team)}</h2><span class="ds-yrs">${esc(ch.years)}</span></div></div>
        ${ch.paragraphs.map((p, k) => { const two = cards.slice(k * 2, k * 2 + 2);
          return `<div class="ds-row${k % 2 ? " flip" : ""}"><p>${esc(p)}</p>${two.length ? `<div class="ds-cards">${two.map(card).join("")}</div>` : ""}</div>`; }).join("")}
        ${gi >= 0 ? `<a class="ds-all" href="#/c/${sec.slug}/${sec.groups[gi].slug}">See all ${fmt(sec.groups[gi].count)} scans of my ${esc(ch.group)} cards →</a>` : ""}
      </section>`;
    }).join("");
    $("#app").innerHTML = `<div class="wrap ds c-royal">
      <a class="back" href="#/c/${sec.slug}">← Jermaine Dye collection</a>
      <div class="kick">Player collection · Career story</div>
      <h1>${esc(st.title)}</h1>
      <div class="ds-intro">${(st.intro || []).map((p) => `<p>${esc(p)}</p>`).join("")}</div>
      ${hi.length ? `<section class="ds-hi"><h2 class="sub-h">Favorite pieces</h2><div class="ds-hi-grid">${hi.map((h) => `<figure>${card(h.c)}<figcaption>${esc(h.cap)}</figcaption></figure>`).join("")}</div></section>` : ""}
      ${chapters}
      <p class="ds-end"><a href="#/c/${sec.slug}">Browse all ${fmt(mine.length)} scans of my Jermaine Dye cards →</a></p>
    </div>`;
    state.list = shownCards;   // the card viewer steps through the cards on this page
  }

  /* ---------- Rainbows: every version (parallel) I have of one card ---------- */
  // Same year, set, card number and player = one rainbow, whatever the color. A color or parallel word at the end of
  // the set name ("Signature Materials Black") is ignored; "Set - Parallel" names already keep the parallel apart.
  // A card's player without a letterman code ("Brandon Jackson 2A" → "Brandon Jackson").
  const plainTitle = (x) => (x.title || "").replace(/\bLetter\s+0?\d{1,2}\s+[A-Z]\b/g, " ").replace(/(?:^|\s)0?\d{1,2}\s?[A-Z](?=\s|$)|(?:^|\s)\d\s\d(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
  const PARALLEL_WORDS = /(?:\s+(?:gold(?:en)?|silver|black|red|blue|green|orange|purple|pink|platinum|bronze|copper|emerald|sapphire|ruby|white|yellow|aqua|teal|magenta|holo(?:foil)?|refractors?|prizms?|parallel|foil|rainbow|mojo|wave|shimmer|atomic|x-?fractors?|superfractors?|printing plates?|press proofs?|proofs?|framed|vintage stock|independence day|camo|tie-?dye|cracked ice|mirror|spectrum|chrome|prime|limited))+$/i;
  // A second or third copy of a card ("... 2nd (Sold to ...)") is the same card for rainbows and sets.
  const copyKey = (x) => x.name.toLowerCase().replace(/\s+(?:2nd|3rd|\d+th)\b(?:\s*\([^)]*\))?\s*$/, "").trim();
  let RAINBOWS = null;
  /* ---------- Binder view: any card list as 9-pocket binder pages (two pages side by side on wide screens) ----------
     Pockets frame the card; nothing is drawn on the scan. Letterman pages add empty "Need" pockets for missing letters. */
  const BINDER = { items: [], k: 0, title: "" };
  const binderBtn = () => `<button type="button" class="btn binder-btn" data-binder>${BINDER_ICON} Binder view</button>`;
  const BINDER_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5zM5 3v18M9 7h6M9 11h6"/></svg>`;
  function binderEl() {
    let b = $("#binder"); if (b) return b;
    document.body.insertAdjacentHTML("beforeend", `<div class="binder" id="binder" hidden role="dialog" aria-modal="true" aria-label="Binder view">
      <div class="v-top"><button type="button" class="v-ic" id="b-back" aria-label="Close binder"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
        <div class="v-mid"><b id="b-title"></b><span id="b-pos"></span></div>
        <div class="v-tools"><button type="button" class="v-ic" id="b-prev" aria-label="Previous page"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button><button type="button" class="v-ic" id="b-next" aria-label="Next page"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button></div></div>
      <div class="b-stage" id="b-stage"></div>
      <button type="button" class="b-side left" id="b-left" aria-label="Previous page"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
      <button type="button" class="b-side right" id="b-right" aria-label="Next page"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button></div>`);
    b = $("#binder");
    $("#b-back").onclick = () => closeBinder();
    $("#b-prev").onclick = $("#b-left").onclick = () => turn(-1); $("#b-next").onclick = $("#b-right").onclick = () => turn(1);
    let sx = null;
    $("#b-stage").addEventListener("touchstart", (e) => (sx = e.touches[0].clientX), { passive: true });
    $("#b-stage").addEventListener("touchend", (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 50) turn(dx < 0 ? 1 : -1); });
    $("#b-stage").addEventListener("click", (e) => {
      const p = e.target.closest("[data-bk]"); if (!p) return;
      const cards = BINDER.items.filter((x) => !x.empty), c = BINDER.items[+p.dataset.bk];
      openViewer(cards.indexOf(c), cards);
    });
    addEventListener("keydown", (e) => { if (b.hidden || !$("#viewer").hidden) return; if (e.key === "ArrowLeft") turn(-1); else if (e.key === "ArrowRight") turn(1); else if (e.key === "Escape") closeBinder(); });
    addEventListener("popstate", () => { if (!b.hidden && !(history.state && (history.state.binder || history.state.v))) hideBinder(); });
    return b;
  }
  const perView = () => (window.matchMedia("(min-width: 900px)").matches ? 2 : 1);
  // The binder has its own address (…?binder=3 = page 3), so a binder page can be shared or reloaded.
  const withBinder = (hash, page) => { const [path, qs = ""] = hash.split("?"); const prm = new URLSearchParams(qs); prm.delete("binder");
    if (page) prm.set("binder", page); const q = prm.toString().replace(/%2C/g, ","); return path + (q ? "?" + q : ""); };
  // Anything that doesn't fit a 9-pocket page stays out of the binder: decas and booklets, sizes written out
  // (3x5, 4x6, 5x7, 5x7.75, 8x10, 11x14…), oversized cards, box loaders and box toppers, postcards, posters,
  // Fatheads, photos, magazines and programs.
  const NOT_IN_BINDER = /\b(deca|booklets?|oversized?|box ?loaders?|box ?toppers?|post ?cards?|posters?|fathead|photos?|magazines?|programs?)\b|\b\d{1,2}(\.\d+)?\s*[x×]\s*\d{1,2}(\.\d+)?\b/i;
  function openBinder(items, title, page, shared) {
    const fits = (n) => !NOT_IN_BINDER.test(n.replace(/\b2\.5\s*[x×]\s*3\.5\b/gi, ""));   // a standard 2.5x3.5 card still fits
    items = items.filter((x) => x.empty || (fits(x.name || "") && !isWant(x)));   // Want List cards aren't in my binder
    const b = binderEl(); BINDER.items = items; BINDER.title = title;
    BINDER.k = Math.max(0, Math.min(Math.ceil(items.length / 9) - 1, (page || 1) - 1));
    if (shared) history.replaceState({ binder: 1 }, "", toURL(withBinder(HASH(), BINDER.k + 1)));
    else if (!(history.state && history.state.binder)) history.pushState({ binder: 1 }, "", toURL(withBinder(HASH(), BINDER.k + 1)));
    fitViewer(); b.hidden = false; document.body.style.overflow = "hidden"; drawBinder();
  }
  const binderAddress = () => { if (!$("#binder").hidden) history.replaceState(history.state, "", toURL(withBinder(HASH(), BINDER.k + 1))); };
  function hideBinder() { const b = $("#binder"); if (!b || b.hidden) return; b.hidden = true; document.body.style.overflow = ""; $("#b-stage").innerHTML = ""; }
  function closeBinder() {
    if (history.state && history.state.binder && !BINDER.shared) return history.back();
    hideBinder(); history.replaceState(null, "", toURL(withBinder(HASH(), 0))); BINDER.shared = false;
  }
  // Opening a shared binder address: wait for the page's cards, then open the binder on that page.
  function openSharedBinder(page) {
    let tries = 0;
    const go = () => { const items = state.binderItems && state.binderItems.length ? state.binderItems : state.list;
      if (items && items.length && $("#app h1")) { BINDER.shared = true; openBinder(items, $("#app h1").textContent, page, true); }
      else if (tries++ < 50) setTimeout(go, 100); };
    setTimeout(go, 50);
  }
  // Page turns: the page lifts at the spine and flips over in 3D, showing the next page on its back (a real binder).
  let FLIPPING = false, QUEUED = 0;
  async function turn(d) {
    if (FLIPPING) { QUEUED = d; return; }   // a tap during a turn happens right after it, instead of being dropped
    const pages = Math.ceil(BINDER.items.length / 9), n = perView(), k = BINDER.k + d * n;
    if (k < 0 || k >= pages) return;
    FLIPPING = true;
    await preloadPages([k, k + 1].filter((p) => p < pages));
    if ($("#binder").hidden) { FLIPPING = false; return; }
    const old = BINDER.k; BINDER.k = k;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { FLIPPING = false; return drawBinder(); }
    binderAddress();
    const P = (p) => pageHTML(p, pages), stage = $("#b-stage");
    let under, leaf;
    if (n === 2) {
      // Next: the right page swings over to the left. Prev: the left page swings over to the right.
      under = d > 0 ? P(old) + P(k + 1) : P(k) + P(old + 1);
      leaf = d > 0 ? `<div class="b-leaf to-left"><div class="face front">${P(old + 1)}</div><div class="face back">${P(k)}</div></div>`
                   : `<div class="b-leaf to-right"><div class="face front">${P(old)}</div><div class="face back">${P(k + 1)}</div></div>`;
      if (d < 0 && !P(old + 1)) under = P(k) + `<div class="b-page b-ghost"></div>`;
      if (d > 0 && !P(k + 1)) under = P(old) + `<div class="b-page b-ghost"></div>`;
    } else {
      // One page at a time (phones): next lifts the page away to the left; prev brings the earlier page back over it.
      under = d > 0 ? P(k) : P(old);
      leaf = d > 0 ? `<div class="b-leaf single out"><div class="face front">${P(old)}</div><div class="face back"><div class="b-page b-backside"></div></div></div>`
                   : `<div class="b-leaf single in"><div class="face front">${P(k)}</div><div class="face back"><div class="b-page b-backside"></div></div></div>`;
    }
    stage.innerHTML = `<div class="b-spread flipping${n === 2 ? " two" : ""}">${under}${leaf}</div>`;
    placeRings();
    const lf = stage.querySelector(".b-leaf");
    const done = () => { if (!FLIPPING) return; FLIPPING = false; drawBinder(); const q = QUEUED; QUEUED = 0; if (q) turn(q); };
    lf.addEventListener("animationend", (e) => { if (e.target === lf) done(); });
    setTimeout(() => FLIPPING && done(), 1400);   // safety net
    updateBinderBar(pages, n);
  }
  // Binder images are loaded and decoded before a page is shown, and remembered (with their shape), so turning
  // a page never shows empty pockets or images popping in.
  const BIMG = new Map();
  window.__bimg = (el) => { BIMG.set(el.getAttribute("src"), [el.naturalWidth, el.naturalHeight]); if (el.naturalWidth > el.naturalHeight * 1.05) el.classList.add("land"); el.classList.add("ok"); };
  const pocketURL = (x) => (x && !x.empty ? img(x.id, x.rk, 400) : "");
  function preloadPages(ps) {
    const urls = ps.flatMap((p) => BINDER.items.slice(p * 9, p * 9 + 9).map(pocketURL)).filter((u) => u && !BIMG.has(u));
    const one = (u) => new Promise((ok) => { const im = new Image(); im.onload = () => { (im.decode ? im.decode() : Promise.resolve()).catch(() => {}).then(() => { BIMG.set(u, [im.naturalWidth, im.naturalHeight]); ok(); }); }; im.onerror = ok; im.src = u; });
    return Promise.race([Promise.all(urls.map(one)), new Promise((ok) => setTimeout(ok, 700))]);
  }
  function pocketHTML(x, i) {
    if (!x) return `<div class="b-pk empty"></div>`;
    if (x.empty) return `<div class="b-pk need"><div class="b-need"><b>${esc(x.label || "?")}</b><small>Need</small></div></div>`;
    const u = pocketURL(x), m = BIMG.get(u);
    // A graded card shows just the card in the pocket: the slab and its label are cropped away on screen
    // (the scan itself is untouched). Based on a standard PSA/BGS slab.
    // A slab scanned sideways (label strip on the right) gets its own crop, then turns like other horizontal cards.
    if (x.tags && x.tags.has("graded")) return `<button type="button" class="b-pk slab" data-bk="${i}" aria-label="${esc(x.name || x.caption || "")}"><span class="slabcrop${m && m[0] > m[1] ? " wide" : ""}"><img alt="" decoding="sync" src="${u}"${m ? ` class="ok"` : ` onload="if (this.naturalWidth > this.naturalHeight) this.parentNode.classList.add('wide'); this.classList.add('ok'); __bimg(this)"`}></span></button>`;
    const cls = m ? `ok${m[0] > m[1] * 1.05 ? " land" : ""}` : "";
    return `<button type="button" class="b-pk" data-bk="${i}" aria-label="${esc(x.name || x.caption || "")}"><img alt="" decoding="sync" src="${u}"${cls ? ` class="${cls}"` : ` onload="__bimg(this)"`}></button>`;
  }
  const HOLES = [17, 50, 83];
  const pageHTML = (p, pages) => p < 0 || p >= pages ? "" : `<div class="b-page${p % 2 ? " right" : ""}">${Array.from({ length: 9 }, (_, j) => pocketHTML(BINDER.items[p * 9 + j], p * 9 + j)).join("")}<span class="b-num">${p + 1}</span>${HOLES.map((t) => `<i class="b-hole" style="top:${t}%"></i>`).join("")}</div>`;
  // The D-ring mechanism, drawn from where the page holes actually are: a steel plate down the spine (or along the
  // left edge with one page) and three rings running into the holes.
  function placeRings() {
    const sp = $("#b-stage .b-spread"); if (!sp) return;
    sp.querySelector(".b-mech")?.remove();
    const r0 = sp.getBoundingClientRect(), two = sp.classList.contains("two");
    const pages = [...sp.children].filter((x) => x.classList.contains("b-page") && !x.classList.contains("b-ghost"));
    if (!pages.length || (two && pages.length < 2)) return;
    const hole = (pg, k) => { const h = pg.querySelectorAll(".b-hole")[k].getBoundingClientRect(); return [h.left + h.width / 2 - r0.left, h.top + h.height / 2 - r0.top, h.width]; };
    const W = r0.width, H = r0.height, t = Math.max(7, Math.min(11, W / 90));
    const plateX = two ? W / 2 : 30, plateW = Math.max(16, t * 2.1);
    const ys = HOLES.map((_, k) => hole(pages[0], k)[1]), top = Math.max(22, ys[0] - (ys[1] - ys[0]) * 0.55), bot = Math.min(H - 22, ys[2] + (ys[1] - ys[0]) * 0.55);
    let svg = `<svg class="b-mech" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs>
      <linearGradient id="bm-plate" x1="0" x2="1"><stop offset="0" stop-color="#5d636a"/><stop offset=".18" stop-color="#aeb4ba"/><stop offset=".42" stop-color="#eef1f3"/><stop offset=".55" stop-color="#c9ced3"/><stop offset=".8" stop-color="#868c93"/><stop offset="1" stop-color="#53585e"/></linearGradient>
      <linearGradient id="bm-ring" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7c8289"/><stop offset=".22" stop-color="#f4f6f7"/><stop offset=".42" stop-color="#d3d7db"/><stop offset=".7" stop-color="#7f858c"/><stop offset="1" stop-color="#4b5056"/></linearGradient>
</defs>
      <rect x="${plateX - plateW / 2 + 2}" y="${top + 3}" width="${plateW}" height="${bot - top}" rx="${plateW / 2}" fill="rgba(0,0,0,.22)"/>
      <rect x="${plateX - plateW / 2}" y="${top}" width="${plateW}" height="${bot - top}" rx="${plateW / 2}" fill="url(#bm-plate)" stroke="rgba(0,0,0,.35)" stroke-width=".8"/>
      ${[top + plateW * 0.75, bot - plateW * 0.75].map((y) => `<circle cx="${plateX}" cy="${y}" r="${plateW * 0.18}" fill="#8b9197" stroke="#4d5258" stroke-width=".8"/><circle cx="${plateX - plateW * 0.05}" cy="${y - plateW * 0.05}" r="${plateW * 0.07}" fill="#f2f4f5"/>`).join("")}`;
    HOLES.forEach((_, k) => {
      const [xa, y] = two ? hole(pages[0], k) : [plateX, hole(pages[0], k)[1]];
      const xb = two ? hole(pages[1], k)[0] : hole(pages[0], k)[0];
      // A ring seen from above: a round steel bar from hole to hole (from the plate to the hole with one page), its
      // shadow on the pages, and a bright line along the top where the light catches it.
      svg += `<rect x="${xa - t * 0.2}" y="${y - t / 2 + t * 0.55}" width="${xb - xa + t * 0.4}" height="${t}" rx="${t / 2}" fill="rgba(0,0,0,.25)"/>
        <rect x="${xa - t * 0.15}" y="${y - t / 2}" width="${xb - xa + t * 0.3}" height="${t}" rx="${t / 2}" fill="url(#bm-ring)" stroke="rgba(0,0,0,.4)" stroke-width=".7"/>
        <rect x="${xa + t * 0.3}" y="${y - t * 0.28}" width="${Math.max(0, xb - xa - t * 0.6)}" height="${t * 0.14}" rx="${t * 0.07}" fill="rgba(255,255,255,.85)"/>`;
    });
    sp.insertAdjacentHTML("beforeend", svg + "</svg>");
  }
  addEventListener("resize", () => { if ($("#binder") && !$("#binder").hidden && !FLIPPING) placeRings(); });
  function updateBinderBar(pages, n) {
    $("#b-title").textContent = BINDER.title;
    const last = Math.min(pages, BINDER.k + n);
    $("#b-pos").textContent = `${n === 2 && last > BINDER.k + 1 ? `Pages ${BINDER.k + 1}–${last}` : `Page ${BINDER.k + 1}`} of ${pages} · ${fmt(BINDER.items.filter((x) => !x.empty).length)} scans`;
    const first = BINDER.k === 0, end = BINDER.k + n >= pages;
    $("#b-prev").disabled = $("#b-left").disabled = first; $("#b-next").disabled = $("#b-right").disabled = end;
  }
  function drawBinder() {
    const pages = Math.max(1, Math.ceil(BINDER.items.length / 9)), n = perView();
    BINDER.k -= BINDER.k % n;
    binderAddress();
    // The D-ring mechanism is drawn after layout (placeRings), from where the holes are.
    $("#b-stage").innerHTML = `<div class="b-spread${n === 2 ? " two" : ""}">${pageHTML(BINDER.k, pages)}${n === 2 ? pageHTML(BINDER.k + 1, pages) : ""}</div>`;
    setTimeout(() => preloadPages([BINDER.k + n, BINDER.k + n + 1, BINDER.k - n, BINDER.k - n + 1].filter((p) => p >= 0 && p < pages)), 300);
    requestAnimationFrame(placeRings);
    updateBinderBar(pages, n);
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-binder]")) return;
    const items = state.binderItems && state.binderItems.length ? state.binderItems : state.list;
    if (items.length) openBinder(items, ($("#app h1") || {}).textContent || "Binder");
  });

  /* Best of the Best: the standout cards (1/1s, bat knobs, laundry tags, nameplates, buttons, shields, SSPs, low-numbered
     prime patches and autographs), cycling in and out on the stats page. */
  const BEST_RULES = [[/\bknob/i, 9], [/laundry|\btag\b|logo ?man/i, 8], [/nameplate|shield|button|barrel/i, 7], [/\bssp\b|\bSP\b(?! Authentic| Game| Legendary| Signature| Top| Chirography)|super short|image variation|\bvariation\b/i, 6],
    [/\bprime\b|jumbo/i, 4], [/booklet|dual auto|triple auto|quad auto|cut auto/i, 3]];
  function bestScore(c) {
    let n = BEST_RULES.reduce((t, [re, v]) => t + (re.test(c.name) ? v : 0), 0);
    if (c.one) n += 10; else if (c.serial && c.serial <= 5) n += 7; else if (c.serial && c.serial <= 10) n += 5; else if (c.serial && c.serial <= 25) n += 2;
    if (c.tags.has("auto") && c.tags.has("relic")) n += 3; else if (c.tags.has("auto")) n += 1;
    return n;
  }
  let BEST_TIMER = 0;
  function bestShow(cards) {
    clearInterval(BEST_TIMER);
    const pool = cards.filter((c) => !isWant(c))   // only cards I own, not the Want List
      .map((c) => [bestScore(c), c]).filter(([n]) => n >= 9).sort((a, b) => b[0] - a[0]).map((x) => x[1])
      .filter((c, k, a) => a.findIndex((x) => x.name === c.name) === k).slice(0, 80);   // a card filed in two collections counts once
    for (let k = pool.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [pool[k], pool[j]] = [pool[j], pool[k]]; }
    // As many cards as fit: two full rows on wide screens (three on phones), from the grid's column count.
    const box = () => $("#best");
    let N = 6, next = 0;
    const fit = () => { const b = box(); if (!b) return;
      b.innerHTML = '<div class="best-slot"></div>';
      const cols = getComputedStyle(b).gridTemplateColumns.split(" ").filter(Boolean).length || 2;
      N = Math.min(pool.length, cols * (cols <= 2 ? 3 : 2));
      b.innerHTML = pool.slice(next % pool.length).concat(pool).slice(0, N).map((c) => `<div class="best-slot">${cardHTML(c)}</div>`).join("");
      next += N; };
    setTimeout(fit, 0);
    let rt = 0; const onResize = () => { if (!box()) return removeEventListener("resize", onResize); clearTimeout(rt); rt = setTimeout(fit, 250); };
    addEventListener("resize", onResize);
    state.list = pool;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || pool.length <= 6) return pool;
    let slot = 0;
    BEST_TIMER = setInterval(() => {
      const b = box(); if (!b) return clearInterval(BEST_TIMER);
      if (!$("#viewer").hidden || document.hidden) return;
      if (pool.length <= N) return;
      const el = b.children[slot % N]; slot += 1 + Math.floor(Math.random() * Math.max(1, N - 1));
      const onScreen = new Set([...b.querySelectorAll(".cd[data-i]")].map((x) => +x.dataset.i));
      let c = pool[next++ % pool.length], tries = 0;
      while (onScreen.has(c.i) && tries++ < pool.length) c = pool[next++ % pool.length];
      el.classList.add("out");
      setTimeout(() => { el.innerHTML = cardHTML(c); el.classList.remove("out"); el.classList.add("in"); setTimeout(() => el.classList.remove("in"), 700); }, 600);
    }, 2600);
    return pool;
  }

  // Every player in the scans, most cards first (#/stats/players). Each row opens a search for that player.
  function statsPlayers() {
    setNav(""); setTitle("Players by number of scans");
    const m = new Map(); CARDS.forEach((c) => { if (c.photo || !c.title) return; const n = plainTitle(c); if (n) m.set(n, (m.get(n) || 0) + 1); });
    const rows = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), max = rows.length ? rows[0][1] : 1;
    $("#app").innerHTML = `<div class="wrap stp"><a class="back" href="#/stats">← Scanned Collection Stats</a>
      <div class="c-head"><div class="kick">Scanned Collection Stats</div><h1>Players by number of scans</h1><p>${fmt(rows.length)} players, most scans first. These are the cards scanned into the site, not every card I own. Tap a player to see his scans.</p></div>
      <section class="st-box"><ol class="st-bars st-rank">${rows.map(([n, k], i) => `<li><a href="#/search/${encodeURIComponent("=" + n)}"><b><span class="st-r">${i + 1}</span>${esc(n)}</b><i style="--w:${(k / max) * 100}%"></i><em>${fmt(k)}</em></a></li>`).join("")}</ol></section></div>`;
  }

  // Player-list thumbnails: a horizontal card gets a horizontal frame of its own shape (same height, wider), shown whole.
  // ProBallers Player Unit widget: load its script once, then draw every widget on the page (the SPA adds pages after load).
  window.loadProballers = () => {
    const go = () => { try { window.PbPlayerPlayerUnitWidget && window.PbPlayerPlayerUnitWidget.render(); } catch (e) {} };
    if (window.PbPlayerPlayerUnitWidget) return go();
    if (window.__pbLoading) return; window.__pbLoading = true;
    const sc = document.createElement("script"); sc.src = "https://widgets.proballers.com/dist/player-player-unit-widget-v1.0.js"; sc.onload = go; document.head.appendChild(sc);
  };
  window.thumbFit = (im) => { const w = im.naturalWidth, h = im.naturalHeight, f = im.parentNode;
    if (w > h * 1.05) { f.classList.add("land"); f.style.aspectRatio = `${w} / ${h}`; } im.classList.add("ok"); };
  // List-page fan: a horizontal card stays upright in a frame of its own shape (no bars, nothing trimmed), made wider
  // than the upright cards so it shows at a similar size.
  window.fanFit = (im, src = im) => {
    const w = src.naturalWidth, h = src.naturalHeight, land = w > h * 1.05, fr = im.parentNode;
    im.classList.toggle("land", land); fr.classList.toggle("land", land);
    fr.style.aspectRatio = land ? `${w} / ${h}` : ""; fr.style.setProperty("--ar", land ? (w / h).toFixed(3) : "");
  };

  /* ---------- About & sharing (#/about): config "sharing" ---------- */
  function aboutPage() {
    setNav(""); setTitle("About & sharing");
    const linkify = (t) => esc(t).replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, x, u) => `<a href="${u}" target="_blank" rel="noopener">${x}</a>`);
    const secs = ((DATA.site.sharing || {}).sections || []);
    $("#app").innerHTML = `<div class="wrap about"><div class="c-head"><h1>About &amp; sharing</h1></div>
      ${secs.map((s) => `<section class="about-sec"><h2>${esc(s.title)}</h2><p>${linkify(s.text)}</p></section>`).join("")}</div>`;
  }
  /* ---------- Collection stats (#/stats) ---------- */
  function statsPage() {
    setNav(""); setTitle("Scanned Collection Stats");
    const cards = CARDS.filter((c) => !c.photo), N = cards.length, pct = (n) => (N ? (n / N) * 100 : 0);
    const bar = (label, n, max, href) => `<li>${href ? `<a href="${href}">` : "<span>"}<b>${esc(label)}</b><i style="--w:${max ? (n / max) * 100 : 0}%"></i><em>${fmt(n)}</em>${href ? "</a>" : "</span>"}</li>`;
    // By card year
    const byYear = new Map(); cards.forEach((c) => c.year < 9999 && byYear.set(c.year, (byYear.get(c.year) || 0) + 1));
    const years = [...byYear.keys()].sort((a, b) => a - b), ymax = Math.max(1, ...byYear.values());
    const yearCols = years.length ? Array.from({ length: years[years.length - 1] - years[0] + 1 }, (_, k) => years[0] + k)
      .map((y) => `<a class="st-col" href="#/search/${y}" title="${y}: ${fmt(byYear.get(y) || 0)} scans"><i style="--h:${((byYear.get(y) || 0) / ymax) * 100}%"></i>${y % (years[years.length - 1] - years[0] > 40 ? 20 : 5) === 0 ? `<span>${y}</span>` : ""}</a>`).join("") : "";
    // What kind of card
    const has = (t) => cards.filter((c) => c.tags.has(t)).length;
    const both = cards.filter((c) => c.tags.has("auto") && c.tags.has("relic")).length;
    const kinds = [["Autographs", has("auto"), "#/search/autos"], ["Relics & patches", has("relic"), "#/search/relics"], ["Autograph + relic", both, "#/search/autos relics"],
      ["Numbered", has("numbered"), "#/search/numbered"], ["Customs", has("custom"), "#/customs"], ["Graded", has("graded"), "#/search/graded"]];
    const kmax = Math.max(...kinds.map((k) => k[1]));
    // Print runs
    const tiers = [["1 of 1", (c) => c.one, "1/1"], ["/2 – /5", (c) => !c.one && c.serial && c.serial <= 5, "over /1 /5 or less"], ["/6 – /10", (c) => c.serial > 5 && c.serial <= 10, "over /5 /10 or less"], ["/11 – /25", (c) => c.serial > 10 && c.serial <= 25, "over /10 /25 or less"],
      ["/26 – /50", (c) => c.serial > 25 && c.serial <= 50, "over /25 /50 or less"], ["/51 – /99", (c) => c.serial > 50 && c.serial <= 99, "over /50 /99 or less"], ["/100 – /250", (c) => c.serial > 99 && c.serial <= 250, "over /99 /250 or less"], ["/251 and up", (c) => c.serial > 250, "over /250"]]
      .map(([l, f, q]) => [l, cards.filter(f).length, "#/search/" + q]);
    const tmax = Math.max(1, ...tiers.map((t) => t[1]));
    // By collection
    const secs = SECTIONS.map((x, i) => [x, sectionCards(i).length]).filter(([x, n]) => n && shown(x)).sort((a, b) => b[1] - a[1]), smax = Math.max(1, ...secs.map((x) => x[1]));
    // Leaderboards
    const rb = new Map(); cards.forEach((c) => { const k = !isWant(c) && rainbowKey(c); if (k) (rb.get(k) || rb.set(k, []).get(k)).push(c); });
    const rainbows = [...rb.values()].filter((l) => l.length > 2).sort((a, b) => b.length - a.length).slice(0, 10);
    const players = new Map(); cards.forEach((c) => c.title && players.set(plainTitle(c), (players.get(plainTitle(c)) || 0) + 1));
    const top = [...players.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10), pmax = Math.max(1, ...top.map((x) => x[1]));
    $("#app").innerHTML = `<div class="wrap stp">
      <div class="c-head"><div class="kick">Whole collection</div><h1>Scanned Collection Stats</h1><p>${fmt(N)} scans, by the numbers. These count the cards scanned into the site, not every card I own. Tap a number or bar to see those scans.</p></div>
      <div class="st-tiles"><a href="#/all"><b>${fmt(N)}</b><span>scans →</span></a><a href="#/search/1/1"><b>${fmt(has("one"))}</b><span>one-of-ones →</span></a>
        <a href="#/search/autos"><b>${fmt(has("auto"))}</b><span>autographs (${pct(has("auto")).toFixed(0)}%) →</span></a><a href="#/stats/players"><b>${fmt(players.size)}</b><span>players →</span></a>
        <a href="#/all?sort=old"><b>${years.length ? years[0] : "–"}</b><span>oldest card year →</span></a></div>
      <section class="st-box"><h2>Scans by card year</h2><div class="st-years">${yearCols}</div></section>
      <div class="st-two">
        <section class="st-box"><h2>What kind of card</h2><ul class="st-bars">${kinds.map(([l, n, h]) => bar(l, n, kmax, h)).join("")}</ul></section>
        <section class="st-box"><h2>Print runs</h2><ul class="st-bars">${tiers.map(([l, n, h]) => bar(l, n, tmax, h)).join("")}</ul></section>
        <section class="st-box"><h2>By collection</h2><ul class="st-bars">${secs.map(([x, n]) => bar(x.title, n, smax, "#/c/" + x.slug)).join("")}</ul></section>
        <section class="st-box"><h2>Most scans of one player <a class="st-more" href="#/stats/players">All ${fmt(players.size)} →</a></h2><ul class="st-bars">${top.map(([n, k]) => bar(n, k, pmax, "#/search/" + encodeURIComponent("=" + n))).join("")}</ul></section>
      </div>
      <section class="st-box best"><h2>🔥 Best of the Best</h2><p class="best-sub">1/1s, bat knobs, laundry tags, nameplates, buttons, SSPs and the best patches, rotating through.</p><div class="grid small best-grid" id="best"></div></section>
      <section class="st-box"><h2>Biggest rainbows</h2><ol class="st-rb">${rainbows.map((l) => `<li><a href="#/rainbow/${encodeURIComponent(cid(l[0]))}"><b>${esc(l[0].title)}</b><span>${esc(l[0].sub.replace(/\s+#\S+$/, "").replace(PARALLEL_WORDS, "").trim())}</span><em>${l.length} versions scanned</em></a></li>`).join("")}</ol></section>
    </div>`;
    bestShow(cards);
  }
  function rainbowKey(c) {
    const m = (c.sub || "").match(/^(\S+)\s+(.*?)\s+#(\S+)$/); if (!m || !c.title) return null;
    // Autographed and relic versions are their own rainbows (same card number, different card).
    const kind = (c.tags.has("auto") ? "a" : "") + (c.tags.has("relic") ? "r" : "");
    return [m[1], m[2].replace(PARALLEL_WORDS, "").toLowerCase(), m[3].toLowerCase(), norm(c.title), kind].join("|");
  }
  // A back scan shown as its own card (its front isn't uploaded, or it's a "(back)"/"(inside)" scan): never a player's
  // main picture or a rainbow version. Names end "(back)", "Back" or "Back (note)", like the robot's pairing.
  // A card's address on the site. A back-only variation (Allen & Ginter "A and G Back", Topps 206 "Piedmont") shows its
  // base card's front scan, so its own back scan's ID tells it apart.
  function cid(x) { return x.fb ? x.backId : x.id; }
  function byCid(id) { return CARDS.find((x) => cid(x) === id); }

  // Big screens scale the whole page up (style.css, html zoom); window sizes and on-screen positions are divided by it to match CSS pixels.
  function pageZoom() { return parseFloat(getComputedStyle(document.documentElement).zoom) || 1; }
  const isWant = (x) => !!(x && (x.tw || (SECTIONS[x.si] && SECTIONS[x.si].kind === "want")));
  /* TCDb want list (data/rainbow-wants.json, from Ian's TCDb export via scripts/build_rainbow_wants.py): cards I still need,
     shown only as "Need it" placeholders on rainbow pages (never in collections, search or counts). Each links to TCDb.
     A version I have a scan of drops off by itself (rainbow()). Loaded once; rainbows are rebuilt when it arrives. */
  let TW = null, TWLOAD = null;
  const tcdbWants = () => TWLOAD || (TWLOAD = fetch("data/rainbow-wants.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
    .then((d) => { const mkT = (flag) => ([name, ids]) => { const n = name.replace(/\s+VAR(?:VAR)?:.*$/, "").trim();
        return { ...parse(n), name: n, [flag]: true, tcdb: ids, i: -1 }; };
      // cards: my TCDb want list; have: my TCDb collection (cards I have; without a scan they show as "Have it").
      TW = [...(d.cards || []).map(mkT("tw")), ...(d.have || []).map(mkT("th"))]; RAINBOWS = null; return TW; }));
  function rainbowOf(c, withWants = false) {
    if (!RAINBOWS) {
      RAINBOWS = new Map();
      const seen = new Set();   // a card uploaded twice counts once
      CARDS.forEach((x) => {
        if (seen.has(copyKey(x))) return; seen.add(copyKey(x));
        const k = rainbowKey(x); if (k) RAINBOWS.set(k, [...(RAINBOWS.get(k) || []), x]);
      });
      (TW || []).forEach((x) => { const k = rainbowKey(x); if (k && RAINBOWS.has(k)) RAINBOWS.get(k).push(x); });
    }
    const k = rainbowKey(c); let all = (k && RAINBOWS.get(k)) || [];
    if (!all.includes(c)) all = all.map((x) => (copyKey(x) === copyKey(c) ? c : x));   // opened the duplicate copy
    // Want List cards aren't part of a rainbow (they're shown as "Need it" placeholders on the rainbow page instead).
    all = all.filter((x) => withWants || !(isWant(x) || x.th));
    // Two copies of the same version (e.g. Prime 17/25 and 18/25) show once: the opened card, else the first copy.
    const ver = (x) => [isWant(x) ? "w" : "", (x.par || "").toLowerCase(), x.serial || 0, x.one ? 1 : 0].join("|");
    const pick = new Map(); all.forEach((x) => { const v = ver(x); if (!pick.has(v) || x === c) pick.set(v, x); });
    all = [...pick.values()];
    // 1/1 first, then lowest print run to highest, then unnumbered versions.
    return all.slice().sort((a, b) => rarity(a) - rarity(b) || a.name.localeCompare(b.name));
  }
  /* Set rainbows: one set or insert across players (e.g. 2008 TK Legacy Signature Series). Cards with a letter prefix
     in their number (#C1, #QB4) group by year, brand and prefix, so differently written set names still match;
     plain numbers (#97) group by year and set name. Shown when the set has two or more players. */
  const SET_NOISE = new Set(["nebraska", "cornhuskers", "huskers", "autographs", "autograph", "signature", "signatures", "series", "insert", "inserts"]);
  let SETS = null;
  function setKey(c) {
    const m = (c.sub || "").match(/^(\S+)\s+(.*?)\s+#(\S+)$/); if (!m) return null;
    const pre = (m[3].match(/^[A-Za-z]+/) || [""])[0].toLowerCase();
    const words = norm(`${m[2]} ${(c.par || "").replace(PARALLEL_WORDS, "")}`).split(" ").filter((w) => w && !SET_NOISE.has(w));
    if (!words.length) return null;
    return pre ? `${m[1]}|${words[0]}|${pre}` : `${m[1]}|${words.join(" ")}`;
  }
  function setOf(c) {
    if (!SETS) {
      SETS = new Map(); const seen = new Set();
      CARDS.forEach((x) => {
        if (seen.has(copyKey(x))) return; seen.add(copyKey(x));
        const k = setKey(x); if (k) SETS.set(k, [...(SETS.get(k) || []), x]);
      });
    }
    const all = SETS.get(setKey(c)) || [];
    if (new Set(all.map((x) => norm(x.title))).size < 2) return [];
    const num = (x) => { const n = (x.sub.match(/#(\S+)$/) || ["", ""])[1]; return [n.replace(/[^A-Za-z]/g, "").toLowerCase(), parseFloat(n.replace(/^[^0-9]*/, "")) || 0]; };
    return all.slice().sort((a, b) => { const [p, n] = num(a), [q, m] = num(b); return p.localeCompare(q) || n - m || (a.serial || 1e9) - (b.serial || 1e9) || a.name.localeCompare(b.name); });
  }
  function setPage(id) {
    const c = byCid(id); if (!c) return notFound();
    const all = setOf(c); if (!all.length) return notFound();
    const sec = SECTIONS[c.si], players = new Set(all.map((x) => norm(x.title))).size;
    const title = c.sub.replace(/\s+#\S+$/, "") + (c.par ? ` - ${c.par.replace(PARALLEL_WORDS, "")}` : "");
    setNav(sec.slug); setTitle(title);
    $("#app").innerHTML = `<div class="wrap coll rb-page${complete ? " rb-done" : ""} c-${sec.color || "royal"}">${sideBox}<div style="min-width:0">
      <a class="back" href="#/c/${sec.slug}">← ${esc(sec.title)}</a>
      <div class="c-head"><div class="kick">Set rainbow</div><h1>${esc(title)}</h1><p>${fmt(players)} players, ${fmt(all.length)} scans, in card-number order.</p></div><div class="b-row">${binderBtn()}</div>
      <div class="grid" id="grid">${all.map((x) => cardHTML(x)).join("")}</div></div></div>`;
    state.list = all;
  }
  /* Letterman sets: each card is one letter (e.g. "4N", "Letter 03 R", "#AP 1P"). The page spells the word in order,
     with a blank spot for each letter I'm missing. The word is the one that fits every letter I have: the player's
     last or full name, CORNHUSKERS, HUSKERS or NEBRASKA, or one set in config/site.json "letterWords". */
  const letterOf = (c) => {
    const n = c.name.replace(/#'d.*$|\b1 of 1\b.*$/i, " ");
    // "4N", "Letter 03 R", "3 E", and digits in a word like 49ERS written with a space: "1 4", "2 9".
    const m = n.match(/\bLetter\s+0?(\d{1,2})\s+([A-Z0-9])\b/) || n.match(/(?:^|\s)0?(\d{1,2})\s?([A-Z])(?=\s|$|\)|,)/) || n.match(/(?:^|\s)(\d)\s(\d)(?=\s|$|,)/);
    return m && +m[1] > 0 ? { pos: +m[1], letter: m[2] } : null;
  };
  // Own The Name / nameplate letters are real jersey nameplate relics, not letterman cards (Ian files them under Nameplate).
  const isLetterSet = (c) => /\blett(?:er|erman|ermen)\b|by the letter/i.test(c.name) && !/(?:signed|autographed)\s+letter\b/i.test(c.name)
    && !/\bown the name\b|\bnameplates?\b/i.test(c.name);
  // A letter code written into the set or parallel name ("2008 Razor Letterman 1P", "Letterman 20 7I") isn't part of the set.
  const noLetterCode = (t) => (t || "").replace(/\s+(?:Letter\s+)?0?\d{1,2}\s?[A-Z](?=\s|$)/g, "").trim();
  // A letter set's name on the page: set and parallel, without the letter code.
  const letterSetTitle = (c) => noLetterCode(c.sub.replace(/\s+#\S+$/, "")) + (c.par && noLetterCode(c.par) ? ` - ${noLetterCode(c.par)}` : "");
  const letterGroupKey = (c) => {
    const m = (c.sub || "").match(/^(\S+)\s+(.*?)\s+#(\S+)$/); if (!m) return null;
    // A card number ending in the card's own letter ("#AP-P", "#AP-I2") is the set's number plus that letter.
    const l = letterOf(c), num = l ? m[3].replace(new RegExp(`-${l.letter}\\d?$`, "i"), "") : m[3];
    const pre = num.replace(/[^A-Za-z]/g, "").toLowerCase();
    // The player, without the letter code that sits in the name ("Niles Paul 4N", "1P Aaron Pribanic", "Letter 03 R").
    const who = c.title.replace(/\b(?:creased|damaged|miscut|off-?center|dirty)\b/gi, " ").replace(/\bLetter\s+0?\d{1,2}\s+[A-Z]\b/g, " ").replace(/(?:^|\s)0?\d{1,2}\s?[A-Z](?=\s|$)|(?:^|\s)\d\s\d(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
    // An autographed version of a letter set is its own set (e.g. Roger Craig's 2009 Icons Immortal Lettermen /105 and
    // the /20 Autographs share a card number). Goes by the set's name, so one file missing its AU code stays in its set.
    const au = /autograph|signature|signed/i.test(c.name.split("#")[0]) || c.tags.has("auto");
    // Each parallel is its own set too (Brandon Jackson's 2007 SP Rookie Threads Lettermen: base /250, Silver /199, Black /25).
    const par = noLetterCode(c.par);
    return [m[1], norm(who), pre || norm(noLetterCode(m[2]))].join("|") + (au ? "|au" : "") + (par ? "|" + norm(par) : "");
  };
  let LETTERS = null;
  // Ian only chases letter sets of former Huskers: cards in the Nebraska collections and Alex Gordon's (a Husker).
  // Letter cards of other Royals (Billy Butler, Kila Ka'aihue, Daniel Cortes) aren't letter sets here.
  const huskerLetters = (c) => /^husker-|^alex-gordon$/.test(SECTIONS[c.si].slug);
  function lettersOf(c) {
    if (!isLetterSet(c) || !letterOf(c) || !huskerLetters(c)) return null;
    if (!LETTERS) {
      LETTERS = new Map(); const seen = new Set();
      CARDS.forEach((x) => {
        if (!isLetterSet(x) || !letterOf(x) || !huskerLetters(x)) return;
        const k = letterGroupKey(x), l = letterOf(x); if (!k) return;
        const id = k + "|" + l.pos + l.letter + "|" + (x.par || "") + "|" + (x.serial || ""); if (seen.has(id)) return; seen.add(id);
        LETTERS.set(k, [...(LETTERS.get(k) || []), x]);
      });
    }
    const k = letterGroupKey(c), cards = (k && LETTERS.get(k)) || [];
    const have = cards.map((x) => ({ x, ...letterOf(x) }));
    const custom = ((DATA.site.letterWords || {})[k] || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const name = c.title.replace(/\b(?:creased|damaged|miscut|off-?center|dirty)\b/gi, " ").replace(/\bLetter\s+0?\d{1,2}\s+[A-Z]\b/g, " ").replace(/(?:^|\s)0?\d{1,2}\s?[A-Z](?=\s|$)|(?:^|\s)\d\s\d(?=\s|$)/g, " ")
      .replace(/\b(jr|sr|ii|iii|iv)\.?\s*$/i, "").replace(/\s+/g, " ").trim().toUpperCase();
    const last = name.split(/\s+/).pop().replace(/[^A-Z]/g, "");
    // Words as shown (with spaces); matching ignores the spaces.
    const shows = [custom, last, name.replace(/[^A-Z ]/g, ""), "CORNHUSKERS", "HUSKERS", "NEBRASKA", "49ERS", "ROOKIE " + last, last + " KANSAS CITY ROYALS", last + " ROYALS"].filter(Boolean);
    const tries = shows.map((w) => w.replace(/[^A-Z0-9]/g, ""));
    // The word that fits the most letters I have (a mistyped letter in a file name shouldn't hide the whole word),
    // as long as at most two don't fit. A word set in config always wins.
    const fit = (w) => have.filter((h) => w[h.pos - 1] === h.letter).length;
    const best = custom || tries.slice().sort((p, q) => fit(q) - fit(p) || tries.indexOf(p) - tries.indexOf(q))[0] || "";
    const word = custom || (best && fit(best) >= Math.min(2, have.length) && have.length - fit(best) <= 2 && Math.max(...have.map((h) => h.pos)) <= best.length ? best : "");
    const shown = word ? (shows[tries.indexOf(word)] || word) : "";
    const len = word.length || Math.max(...have.map((h) => h.pos));
    const slots = Array.from({ length: len }, (_, i) => ({ pos: i + 1, letter: word ? word[i] : (have.find((h) => h.pos === i + 1) || {}).letter || "", cards: have.filter((h) => h.pos === i + 1).map((h) => h.x) }));
    return { key: k, word, shown, who: name.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()), slots, count: slots.filter((s) => s.cards.length).length };
  }
  // One column per letter; a second copy of a letter (another parallel) stacks under the first.
  const letterSlot = (s, shown) => s.cards.length
    ? `<div class="lt-slot"><span class="lt-l">${esc(s.letter)}</span>${s.cards.map((x) => { shown.push(x); return cardHTML(x, "", true); }).join("")}</div>`
    : `<div class="lt-slot lt-miss" aria-label="Missing ${esc(s.letter || "letter " + s.pos)}"><span class="lt-l">${esc(s.letter || "?")}</span><div class="lt-blank"><b>${esc(s.letter || "?")}</b><small>Need</small></div></div>`;
  // Each word on its own line ("GORDON" / "KANSAS" / "CITY" / "ROYALS"), its letters side by side. Every word uses the
  // longest word's column size, so all the cards are the same size.
  function letterRows(L, shown) {
    const lens = L.word ? (L.shown || L.word).split(/\s+/).map((w) => w.replace(/[^A-Z0-9]/g, "").length).filter(Boolean) : [L.slots.length];
    let at = 0; const cols = Math.max(...lens);
    return lens.map((n) => { const part = L.slots.slice(at, at + n); at += n;
      return `<div class="lt-word" style="--n:${cols}">${part.map((x) => letterSlot(x, shown)).join("")}</div>`; }).join("");
  }
  // The set's print run for its description (the cards themselves don't show it on letterman pages): "/25", "1 of 1",
  // "Print run of 99" (PR, no serial stamp).
  function letterRun(L) {
    const runs = [...new Set(L.slots.flatMap((s) => s.cards).map((x) => x.one ? "1 of 1" : x.printRun ? `Print run of ${fmt(x.printRun)}` : x.serial ? `/${fmt(x.serial)}` : "").filter(Boolean))];
    return runs.join(" & ");
  }
  // Every letterman set on one page (#/letters), grouped by the word it spells, with the letters I still need.
  function allLettersPage() {
    const first = CARDS.find((x) => isLetterSet(x) && letterOf(x)); if (!first) return notFound();
    lettersOf(first);   // builds LETTERS
    const sets = [...LETTERS.values()].map((cards) => ({ L: lettersOf(cards[0]), c: cards[0] })).filter((x) => x.L);
    setNav(SECTIONS[first.si].slug); setTitle("All letterman sets");
    const byWord = new Map();
    sets.forEach((x) => { const w = x.L.word ? (x.L.shown || x.L.word) : ""; byWord.set(w, [...(byWord.get(w) || []), x]); });
    // Words with the most sets first; sets whose full word isn't known last.
    const words = [...byWord.keys()].sort((p, q) => (!p - !q) || byWord.get(q).length - byWord.get(p).length || p.localeCompare(q));
    const done = sets.filter((x) => x.L.word && x.L.count === x.L.slots.length).length;
    const need = sets.reduce((n, x) => n + (x.L.word ? x.L.slots.length - x.L.count : 0), 0);
    const shown = [], binder = [];
    const body = words.map((w) => {
      const list = byWord.get(w).sort((p, q) => (p.c.year || 0) - (q.c.year || 0) || p.L.who.localeCompare(q.L.who));
      return `<section class="lt-group"><h2>${w ? esc(w) : "Other sets"} <small>${fmt(list.length)} set${list.length === 1 ? "" : "s"}</small></h2>${list.map(({ L, c }) => {
        const title = letterSetTitle(c);
        const miss = L.word ? L.slots.filter((x) => !x.cards.length).map((x) => x.letter) : [];
        binder.push(...L.slots.flatMap((x) => (x.cards.length ? x.cards : [{ empty: true, label: x.letter || "?" }])));
        // A complete set gets a celebration frame and badge (around the cards, never on them).
        const full = L.word && !miss.length;
        return `<section class="lt-set${full ? " lt-done" : ""}"><h3><a href="#/letters/${encodeURIComponent(cid(c))}">${esc(L.who)}</a>${full ? `<span class="lt-badge"><i aria-hidden="true">★</i>Complete set<b>${fmt(L.slots.length)}/${fmt(L.slots.length)}</b></span>` : ""}</h3>
          <p>${esc(title)}${letterRun(L) ? ` · ${esc(letterRun(L))}` : ""} · ${fmt(L.count)} of ${fmt(L.slots.length)}${L.word && !miss.length ? " · complete ✓" : miss.length ? ` · <b class="lt-need">Need: ${miss.map(esc).join(", ")}</b>` : ""}</p>
          <div class="lt-rows">${letterRows(L, shown)}</div></section>`; }).join("")}</section>`;
    }).join("");
    $("#app").innerHTML = `<div class="wrap coll c-husker"><div style="grid-column:1/-1;min-width:0">
      <div class="c-head"><div class="kick">Letterman sets</div><h1>All letterman sets</h1>
      <p>${fmt(sets.length)} sets, ${fmt(done)} complete, ${fmt(need)} letter${need === 1 ? "" : "s"} still needed. Grouped by the word each set spells; tap a name for that set's page.</p></div>
      <div class="b-row">${binderBtn()}</div><div class="lt-words">${body}</div><p class="lt-tip">Tap a card for its details. "Need" boxes are letters I'm still looking for.</p></div></div>`;
    state.list = shown; state.binderItems = binder;
  }

  function lettersPage(id) {
    const c = byCid(id); if (!c) return notFound();
    const L = lettersOf(c); if (!L) return notFound();
    const sec = SECTIONS[c.si], title = letterSetTitle(c);
    setNav(sec.slug); setTitle(`${c.title} letters`);
    const shown = [], rows = letterRows(L, shown);
    $("#app").innerHTML = `<div class="wrap coll rb-page${complete ? " rb-done" : ""} c-${sec.color || "royal"}">${sideBox}<div style="min-width:0">
      <a class="back" href="#/c/${sec.slug}">← ${esc(sec.title)}</a>
      <div class="c-head"><div class="kick">Letterman set</div><h1>${esc(L.shown || L.slots.map((x) => x.letter || "·").join(""))}</h1>
      <p>${esc(L.who)} · ${esc(title)}${letterRun(L) ? ` (${esc(letterRun(L))})` : ""}: ${fmt(L.count)} of ${fmt(L.slots.length)} letters scanned${L.word ? "" : " (the full word isn't known, so missing letters past the last one I have aren't shown)"}.</p></div>
      <div class="b-row">${binderBtn()}</div><div class="lt-words">${rows}</div><p class="lt-tip">Tap a card for its details. <a href="#/letters">All letterman sets →</a></p></div></div>`;
    state.list = shown;
    state.binderItems = L.slots.flatMap((x) => (x.cards.length ? x.cards : [{ empty: true, label: x.letter || "?" }]));
  }
  // Rainbow pages: a soft glow of each parallel's color behind its card (around it, never on the scan).
  // An American flag (stripes, blue canton with star dots) for Independence Day and other stars-and-stripes parallels.
  const FLAG = (() => { const h = 100 / 13; let svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 190 100' preserveAspectRatio='none'>`;
    for (let k = 0; k < 13; k++) svg += `<rect y='${(k * h).toFixed(2)}' width='190' height='${(h + 0.2).toFixed(2)}' fill='${k % 2 ? "#fff" : "#b22234"}'/>`;
    svg += `<rect width='76' height='${(7 * h).toFixed(2)}' fill='#3c3b6e'/>`;
    for (let r = 0; r < 9; r++) for (let c = 0; c < (r % 2 ? 5 : 6); c++) svg += `<circle cx='${(6.3 + c * 12.6 + (r % 2 ? 6.3 : 0)).toFixed(1)}' cy='${(5.4 + r * 5.4).toFixed(1)}' r='1.7' fill='#fff'/>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg + "</svg>")}") center/cover no-repeat`; })();
  const PAR_COLORS = [[/independence day|stars (and|&) stripes|red,? white,? (and|&) blue|\bpatriotic\b/i, FLAG], [/superfractor|rainbow|tie[- ]?dye|mojo|prismatic|kaleidoscope|disco|camo/i, "conic-gradient(from 0deg,#ff5f6d,#ffc371,#5ee7a0,#5aa9ff,#b07cff,#ff5f6d)"],
    [/printing plates?\b.*\bcyan|\bcyan\b/i, "#22c4e0"], [/\bmagenta\b/i, "#d6339a"], [/printing plates?\b.*\byellow|\byellow\b/i, "#f2d33a"],
    [/\bgold(en)?\b/i, "#e0b13a"], [/\borange\b/i, "#f28c28"], [/\bruby\b/i, "#c4123c"], [/\bred\b/i, "#e0453a"], [/\bpink\b/i, "#f06aa8"],
    [/\bsapphire\b/i, "#2a5fd6"], [/\b(light|sky) blue\b|\baqua\b|\bteal\b/i, "#3cc8d8"], [/\bblue\b/i, "#3b74e0"], [/\bemerald\b|\bgreen\b/i, "#2ea85a"],
    [/\bpurple\b|\bviolet\b/i, "#9a62e0"], [/\bbronze\b|\bcopper\b/i, "#c07a3c"], [/\bplatinum\b/i, "#dfe3ea"], [/\bblack\b/i, "#5d6470"],
    [/\bwhite\b/i, "#eef1f5"], [/\bsilver\b|\bchrome\b|refractor|prizm|holo|foil/i, "#c3cad4"]];
  const parColor = (c) => { const t = (c.par || "") + " " + c.name; const hit = PAR_COLORS.find(([re]) => re.test(t)); return hit ? hit[1] : ""; };
  // Want List / TCDb want list versions of a rainbow that I don't have a scan of yet (same parallel and print run).
  // 1/1s (printing plates, Superfractors…) are never listed as needed: Ian doesn't chase them.
  // TCDb collection versions I have but haven't scanned ("Have it"). A scan of the same version always wins.
  const haveKey = (x) => (x.par || "").toLowerCase() + "|" + (x.serial || 0);
  function rainbowHave(c, all = rainbowOf(c)) {
    const seen = new Set(all.map(haveKey));
    return rainbowOf(c, true).filter((x) => x.th && !seen.has(haveKey(x)) && seen.add(haveKey(x)));
  }
  function rainbowNeeds(c, all = rainbowOf(c), have = rainbowHave(c, all)) {
    const mine = new Set([...all, ...have].map(haveKey));
    return rainbowOf(c, true).filter((x) => isWant(x) && !x.one && !mine.has(haveKey(x)));
  }
  /* Confetti burst for a finished rainbow (display only; skipped for reduced motion). */
  const RB_CELEB = new Set();
  function celebrate() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const old = document.getElementById("rb-confetti"); if (old) old.remove();
    const cv = document.createElement("canvas"); cv.id = "rb-confetti"; cv.setAttribute("aria-hidden", "true");
    const W = cv.width = innerWidth, H = cv.height = innerHeight; document.body.appendChild(cv);
    const g = cv.getContext("2d"), cols = ["#ff5468", "#ffc446", "#50c878", "#5a96ff", "#aa6eff", "#fff"];
    const ps = Array.from({ length: 170 }, (_, i) => ({ x: W * (i % 2 ? 0.1 : 0.9), y: H * 0.85, vx: (i % 2 ? 1 : -1) * (2 + Math.random() * 9), vy: -(8 + Math.random() * 13), w: 6 + Math.random() * 7, h: 4 + Math.random() * 5, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: cols[i % cols.length] }));
    const t0 = performance.now();
    (function tick(t) {
      const el = t - t0; g.clearRect(0, 0, W, H);
      ps.forEach((p) => { p.vy += 0.32; p.vx *= 0.992; p.x += p.vx; p.y += p.vy; p.r += p.vr; g.save(); g.globalAlpha = Math.max(0, 1 - el / 4200); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore(); });
      if (el < 4200 && cv.isConnected) requestAnimationFrame(tick); else cv.remove();
    })(t0);
  }
  function rainbow(id) {
    if (!TW) { $("#app").innerHTML = '<div class="wrap"><p class="muted">Loading…</p></div>'; return void tcdbWants().then(() => HASH().startsWith("#/rainbow/") && rainbow(id)); }
    const c = byCid(id); if (!c) return notFound();
    const all = rainbowOf(c);
    // Want List versions of this rainbow I don't have yet: "Need it" placeholders in their rarity spot.
    const have = rainbowHave(c, all), needs = rainbowNeeds(c, all, have), extra = [...have, ...needs];
    if (!all.length || all.length + extra.length < 2) return notFound();
    const both = [...all, ...extra].sort((a, b) => (b.one - a.one) || rarity(a) - rarity(b) || a.name.localeCompare(b.name));
    // A TCDb want list card links to its TCDb page (opens in a new tab).
    // "Have it": a TCDb collection card I have but haven't scanned yet.
    const needHTML = (x) => `<${x.tcdb ? `a href="https://www.tcdb.com/ViewCard.cfm/sid/${x.tcdb.split("/").map(encodeURIComponent).join("/cid/")}" target="_blank" rel="noopener" title="See it on TCDb"` : "div"} class="cd need-cd${x.tcdb ? " need-tcdb" : ""}${x.th ? " have-cd" : ""}" data-need="${extra.indexOf(x)}" aria-label="${x.th ? "Have, not scanned yet" : "Need"}: ${esc(x.name)}"><div class="ph"><div class="need-stamp"><b>${x.th ? "Have it" : "Need it"}</b>${x.one ? "<small>1 of 1</small>" : x.serial ? `<small>/${x.serial}</small>` : ""}</div></div>
      <div class="cap"><b>${esc(x.title)}</b>${esc(x.sub)}${x.par ? `<br><span class="par">${esc(x.par)}</span>` : ""}${x.tcdb ? `<br><span class="need-link">${x.th ? "Not scanned yet · TCDb ↗" : "On my TCDb want list ↗"}</span>` : ""}</div></${x.tcdb ? "a" : "div"}>`;
    // The rainbow's name: the set, plus its insert name with the colors taken off ("Five Star - Golden Graphs").
    // Only when every version shares it (no plain base card among them).
    const pars = all.map((x) => (x.par || "").replace(PARALLEL_WORDS, "").trim());
    const common = pars.every(Boolean) ? pars.slice().sort((p, q) => p.length - q.length).find((p) => pars.every((q) => q.toLowerCase().startsWith(p.toLowerCase()))) : "";
    const sec = SECTIONS[(isWant(c) ? all[0] : c).si], base = c.sub.replace(/\s+#\S+$/, "").replace(PARALLEL_WORDS, "") + (common ? ` - ${common}` : "");
    // Progress tracker (like the collection pages): versions I have (scanned or not) out of every version I know of.
    // Shown only for rainbows on TCDb (a card on my want list or in my TCDb collection), where the full count is known.
    const owned = all.length + have.length, total = owned + needs.length, rbPct = total ? (owned / total) * 100 : 0;
    // Complete: nothing on my want list is missing (a version I still need always shows as a "Need it" card).
    const complete = !needs.length && owned >= 2;
    const tracked = complete || rainbowOf(c, true).some((x) => x.th || isWant(x));
    const prog = tracked ? `<div class="prog${complete ? " done" : ""}"><b>${complete ? 100 : Math.floor(rbPct)}%</b><div class="bar"><i style="width:${complete ? 100 : rbPct}%"></i></div><small>${complete ? `Complete: all ${fmt(total)} versions` : `${fmt(owned)} of ${fmt(total)} versions`}${have.length ? ` (${fmt(all.length)} scanned)` : ""}</small></div>${complete ? '<button type="button" class="rb-win" id="rb-win">🌈 Rainbow complete! <span>Tap to celebrate</span></button>' : ""}` : "";
    // Left box (desktop): every version by name, checked off when I have it.
    const verName = (x) => `${(x.par || "").trim() || "Base"}${x.one ? " 1/1" : x.serial ? " /" + x.serial : ""}`;
    const sideBox = `<aside class="side rb-side" aria-label="Checklist for this rainbow"><h4>Checklist ·${fmt(owned)} of ${fmt(total)}</h4><ul>${both.map((x) => { const got = !isWant(x) || x.th; return `<li class="${got ? "got" : "need"}"><i aria-hidden="true">${got ? "✓" : ""}</i><span>${esc(verName(x))}</span><em class="sr">${got ? "have" : "need"}</em></li>`; }).join("")}</ul></aside>`;
    // Few cards: bigger; dozens: small (desktop).
    const n = both.length, rbMin = n <= 2 ? 400 : n <= 4 ? 300 : n <= 8 ? 230 : n <= 14 ? 190 : 168;
    setNav(sec.slug); setTitle(`${c.title} rainbow`);
    $("#app").innerHTML = `<div class="wrap coll rb-page${complete ? " rb-done" : ""} c-${sec.color || "royal"}">${sideBox}<div style="min-width:0">
      <a class="back" href="#/c/${sec.slug}">← ${esc(sec.title)}</a>
      <div class="c-head"><div class="kick">Rainbow</div><h1>${esc(c.title)}</h1><p>${esc(base)} #${esc(c.sub.match(/#(\S+)$/)[1])}: ${fmt(all.length)} version${all.length === 1 ? "" : "s"} scanned${have.length ? `, ${fmt(have.length)} more I have but haven't scanned yet` : ""}${needs.length ? `, ${fmt(needs.length)} still needed` : ""}, from the rarest down.</p>${prog}</div><div class="b-row">${binderBtn()}</div>
      <div class="grid rb-grid" id="grid" style="--rb-min:${rbMin}px">${both.map((x) => (isWant(x) || x.th ? needHTML(x) : cardHTML(x))).join("")}</div></div></div>`;
    document.querySelectorAll("#grid .cd[data-i], #grid .cd[data-need]").forEach((el) => { const col = parColor(el.dataset.i != null ? CARDS[+el.dataset.i] : extra[+el.dataset.need]);
      if (col) { el.classList.add("par-bg"); el.style.setProperty(col.startsWith("#") ? "--pc" : "--pg", col); if (col === FLAG) el.classList.add("flag"); } });
    if (complete) { const w = $("#rb-win"); if (w) w.addEventListener("click", celebrate); if (!RB_CELEB.has(id)) { RB_CELEB.add(id); setTimeout(celebrate, 400); } }
    state.list = all;
    state.binderItems = both.map((x) => (isWant(x) || x.th ? { empty: true, label: x.th ? "Have" : x.one ? "1/1" : x.serial ? "/" + x.serial : "Need" } : x));
  }
  /* Chase pages (config "chases", e.g. Nebraska Cracked Ice): every Husker card of one kind, with progress. Scans in the
     Nebraska collections and Alex Gordon's, plus TCDb collection cards not scanned yet ("Have it") and TCDb want list cards
     ("Need it", never 1/1s) from data/chases.json (scripts/build_chases.py). A TCDb card I have a scan of drops off. */
  let CHASES = null, CHLOAD = null;
  const chaseData = () => CHLOAD || (CHLOAD = fetch("data/chases.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((d) => (CHASES = d.chases || {})));
  // Same card whatever the tags: year, set and insert, card number, player's first two words, plus a photo variation
  // written Ian's way (", VAR - Ball in one hand"), so a variation and the main design count as two cards.
  const chaseKey = (name) => { const v = name.match(/,?\s+VAR\s+-\s+(.+)$/), base = v ? name.slice(0, v.index) : name;
    const m = base.replace(/\s+VAR(?:VAR)?:.*$/, "").match(/^(\d{4})(?:-\d{2})?\s+(.*?)\s+#(\S+)\s+(.*)$/); if (!m) return name.toLowerCase();
    return [m[1], norm(m[2]), m[3].toLowerCase().replace(/[^a-z0-9]/g, ""), norm(m[4].replace(/\([^)]*\)/g, " ")).split(" ").slice(0, 2).join(" "), v ? norm(v[1]) : ""].join("|"); };
  function chasePage(slug) {
    const ch = (DATA.site.chases || []).find((x) => x.slug === slug); if (!ch) return notFound();
    if (!CHASES) { $("#app").innerHTML = '<div class="wrap"><p class="muted">Loading…</p></div>'; return void chaseData().then(() => HASH().startsWith("#/chase/") && chasePage(slug)); }
    const rx = new RegExp(ch.match, "i"), ex = ch.exclude ? new RegExp(ch.exclude, "i") : null, d = CHASES[slug] || {};
    // "skip": cards left off this page by name (e.g. someone else's custom card), matched whatever the tags.
    const skip = new Set((ch.skip || []).map(chaseKey));
    const fits = (n) => rx.test(n) && !(ex && ex.test(n)) && !skip.has(chaseKey(n));
    // A scan's sport is its Nebraska collection (Alex Gordon: baseball); a TCDb card's comes with it (data/chases.json).
    const sportOf = (c) => (SECTIONS[c.si].slug === "alex-gordon" ? "baseball" : SECTIONS[c.si].slug.replace(/^husker-/, ""));
    const scans = CARDS.filter((c) => fits(c.name) && /^husker-|^alex-gordon$/.test(SECTIONS[c.si].slug)).map((c) => Object.assign(c, { chaseSport: sportOf(c) }));
    const seen = new Set(scans.map((c) => chaseKey(c.name)));
    const mk = (flag) => ([name, ids, sp]) => { const n = name.replace(/\s+VAR(?:VAR)?:.*$/, "").trim(); return { ...parse(n), name: n, [flag]: true, tcdb: ids, i: -1, chaseSport: sp || "other" }; };
    const keep = (x) => { if (!fits(x.name)) return false; const k = chaseKey(x.name); if (seen.has(k)) return false; seen.add(k); return true; };
    const have = (d.have || []).map(mk("th")).filter(keep), need = (d.need || []).map(mk("tw")).filter(keep);
    // Oldest at the top, newest at the bottom.
    const every = [...scans, ...have, ...need].sort((a, b) => (a.year || 0) - (b.year || 0) || setOrder(a, b) || a.name.localeCompare(b.name));
    // College or pro card, from the set's name (config "chaseCollege": Contenders Draft Picks, Metal Universe Champions...),
    // or listed by name in "chaseCollegeCards" (college cards in mostly pro sets, e.g. Father's Day).
    const colRx = new RegExp(DATA.site.chaseCollege || "draft picks|collegiate|\\bcollege\\b", "i"), colCards = new Set((DATA.site.chaseCollegeCards || []).map(chaseKey));
    every.forEach((x) => { x.chaseLevel = colRx.test(x.name.replace(/\s+#.*$/, "")) || colCards.has(chaseKey(x.name)) ? "college" : "pro"; });
    const SPORTS = [["football", "Football"], ["baseball", "Baseball"], ["basketball", "Basketball"], ["other", "Other"]].filter(([k]) => every.some((x) => x.chaseSport === k));
    const tile = (x) => `<${x.tcdb ? `a href="https://www.tcdb.com/ViewCard.cfm/sid/${x.tcdb.split("/").map(encodeURIComponent).join("/cid/")}" target="_blank" rel="noopener" title="See it on TCDb"` : "div"} class="cd need-cd${x.tcdb ? " need-tcdb" : ""}${x.th ? " have-cd" : ""}" aria-label="${x.th ? "Have, not scanned yet" : "Need"}: ${esc(x.name)}"><div class="ph"><div class="need-stamp"><b>${x.th ? "Have it" : "Need it"}</b>${x.serial ? `<small>/${x.serial}</small>` : ""}</div></div>
      <div class="cap"><b>${esc(x.title)}</b>${esc(x.sub)}${x.par ? `<br><span class="par">${esc(x.par)}</span>` : ""}<br><span class="need-link">${x.th ? "Not scanned yet · TCDb ↗" : "On my TCDb want list ↗"}</span></div></${x.tcdb ? "a" : "div"}>`;
    setNav("chase-" + slug); setTitle(ch.title);
    // The shard wallpaper goes on the Cracked Ice page (set here too, since the page can render before pageBg runs).
    document.body.classList.toggle("ice-bg", slug === "cracked-ice"); if (slug === "cracked-ice") iceWall();
    $("#app").innerHTML = `<div class="wrap coll c-husker"><div style="grid-column:1/-1;min-width:0">
      <div class="c-head"><div class="kick">Nebraska chase</div><div class="c-title-row"><h1>${esc(ch.title)}</h1><div class="c-logos" id="c-logos"></div></div><p id="ch-sum"></p><div class="prog" id="ch-prog"></div></div>
      <div class="chips ch-chips">${SPORTS.length > 1 ? `<span class="ch-grp" role="group" aria-label="Sport">${[["", "All sports"], ...SPORTS].map(([k, l]) => `<button type="button" class="chip" data-g="sport" data-v="${k}" aria-pressed="${!k}">${l}</button>`).join("")}</span>` : ""}
        <span class="ch-grp" role="group" aria-label="College or pro">${[["", "College & pro"], ["college", "College"], ["pro", "Pro"]].map(([k, l]) => `<button type="button" class="chip" data-g="level" data-v="${k}" aria-pressed="${!k}">${l}</button>`).join("")}</span>
        <span class="ch-grp"><button type="button" class="chip" data-g="auto" data-v="1" aria-pressed="false">Autographs</button></span></div>
      <div class="b-row">${binderBtn()}</div><div class="grid" id="grid"></div>
      <p class="lt-tip">The want list and the cards I haven't scanned come from my TCDb lists. Tap a card for its details.</p><p class="c-logo-cr" id="c-logo-cr"></p></div></div>`;
    // Progress, counts and cards for the chosen filters (sport, college or pro, autographs), redrawn on every tap.
    drawLogos("husker-football");
    const f = { sport: "", level: "", auto: "" };
    const draw = () => {
      const sp = f.sport;
      const pick = (l) => l.filter((x) => (!sp || x.chaseSport === sp) && (!f.level || x.chaseLevel === f.level) && (!f.auto || x.tags.has("auto")));
      const sc = pick(scans), hv = pick(have), nd = pick(need), all = pick(every);
      const owned = sc.length + hv.length, total = owned + nd.length, pct = total ? (owned / total) * 100 : 0;
      $("#ch-sum").textContent = `${ch.blurb || ""} ${fmt(sc.length)} scanned${hv.length ? `, ${fmt(hv.length)} more I have but haven't scanned yet` : ""}${nd.length ? `, ${fmt(nd.length)} still needed` : ""}, oldest first.`;
      const label = [sp && (SPORTS.find(([k]) => k === sp) || [, ""])[1], f.level && { college: "College", pro: "Pro" }[f.level], f.auto && "Autographs"].filter(Boolean).join(" · ");
      $("#ch-prog").innerHTML = total ? `<b>${nd.length ? Math.floor(pct) : 100}%</b><div class="bar"><i style="width:${pct}%"></i></div><small>${fmt(owned)} of ${fmt(total)} cards${label ? ` · ${esc(label)}` : ""}</small>` : `<small>No cards match these filters.</small>`;
      $("#grid").innerHTML = all.map((x) => (x.tw || x.th ? tile(x) : cardHTML(x))).join("");
      state.list = sc;
      state.binderItems = all.map((x) => (x.tw || x.th ? { empty: true, label: x.th ? "Have" : x.serial ? "/" + x.serial : "Need" } : x));
    };
    draw();
    $(".ch-chips").addEventListener("click", (e) => { const b = e.target.closest("[data-g]"); if (!b) return;
      const g = b.dataset.g;
      if (g === "auto") { f.auto = f.auto ? "" : "1"; b.setAttribute("aria-pressed", !!f.auto); }
      else { f[g] = b.dataset.v; b.parentNode.querySelectorAll("[data-g]").forEach((x) => x.setAttribute("aria-pressed", x === b)); }
      draw(); });
  }
  function notFound() {
    setTitle("Page not found");
    $("#app").innerHTML = `<div class="wrap nf"><h1>That page isn't here</h1><p>It may have moved when the site was rebuilt. Try searching above, or:</p>
      <div class="go-links"><a href="#/">Home →</a><a href="#/random">Show me a random card →</a><a href="#/checklist">NFL Huskers Autograph List →</a><a href="#/media">Media &amp; interviews →</a></div></div>`;
  }

  /* ---------- Router ---------- */
  let LAST_BASE = null;
  // Sliding strips (.mq) start moving only once their pictures have loaded, so nothing changes width mid-slide
  // (that shoved the whole strip and made it stutter). Gives up waiting after 4 seconds.
  // Custom Cards "With the players": as many photos as fit in one row; every few seconds one fades out and a photo
  // not on screen fades in. Pauses on hover, off screen and in a background tab.
  let PHOTO_TIMER = 0;
  function startPhotoRow() {
    const row = $("#ph-row"); clearInterval(PHOTO_TIMER); if (!row || !PHOTOS.length) return;
    const order = PHOTOS.map((_, k) => k).sort(() => Math.random() - 0.5);
    const tile = (k) => { const p = PHOTOS[k]; return `<button type="button" class="ph-tile" data-photo="${k}" aria-label="${esc(p.caption)}"><img decoding="async" alt="" src="${img(p.id, p.rk, 500)}" onload="this.classList.add('ok')"><span><em>${esc(p.short)}</em></span></button>`; };
    const n = Math.min(order.length, Math.max(2, Math.floor(row.clientWidth / 250)));
    row.style.setProperty("--n", n);
    row.innerHTML = order.slice(0, n).map((k) => `<div class="ph-slot">${tile(k)}</div>`).join("");
    if (order.length <= n || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let next = n, slot = 0, seen = true;
    new IntersectionObserver((es) => (seen = es[0].isIntersecting)).observe(row);
    // Load the next photo first, so it appears already drawn.
    const pre = (k) => new Promise((ok) => { const im = new Image(); im.onload = im.onerror = () => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(ok); im.src = img(PHOTOS[k].id, PHOTOS[k].rk, 500); });
    PHOTO_TIMER = setInterval(async () => {
      if (!row.isConnected) return clearInterval(PHOTO_TIMER);
      if (!seen || document.hidden || row.matches(":hover") || !$("#viewer").hidden) return;
      const k = order[next++ % order.length], el = row.children[slot % n]; slot += 1 + Math.floor(Math.random() * Math.max(1, n - 1));
      await pre(k);
      el.classList.add("out");
      setTimeout(() => { el.innerHTML = tile(k); el.querySelector("img").classList.add("ok"); el.classList.remove("out"); }, 600);
    }, 3200);
  }
  function readyMarquees() {
    startPhotoRow();
    document.querySelectorAll(".mq:not(.ready)").forEach((m) => {
      const imgs = [...m.querySelectorAll("img")];
      const loaded = imgs.map((i) => (i.complete ? 0 : new Promise((r) => { i.addEventListener("load", r, { once: true }); i.addEventListener("error", r, { once: true }); })));
      Promise.race([Promise.all(loaded), new Promise((r) => setTimeout(r, 4000))]).then(() => m.classList.add("ready"));
    });
  }
  function route() {
    LAST_HASH = HASH(); $("#app").classList.remove("from-card");
    requestAnimationFrame(() => requestAnimationFrame(readyMarquees));
    const bpage = +(new URLSearchParams(HASH().split("?")[1] || "").get("binder") || 0), base = withBinder(HASH(), 0);
    if (base === LAST_BASE && $("#app h1")) {   // only the binder part changed (e.g. Back out of the binder): keep the page as it is
      closeViewer(true);
      if (!bpage) hideBinder(); else if (!$("#binder") || $("#binder").hidden) openSharedBinder(bpage);
      return;
    }
    LAST_BASE = base;
    if (bpage) openSharedBinder(bpage);
    closeViewer(true); hideBinder(); state.binderItems = null;
    const [path, qs = ""] = HASH().replace(/^#\/?/, "").split("?");
    const h = decodeURIComponent(path).split("/");
    const [a, b, c] = h;
    const key = a === "c" ? "c/" + b : a;
    // Filters and sort come from the address (?f=auto,relic&sort=old), so a filtered view can be shared or reloaded.
    // Moving between groups of the same collection keeps them.
    const prm = new URLSearchParams(qs), fs = (prm.get("f") || "").split(",").filter((k) => [...FILTERS, ...CUSTOM_FILTERS, INSCR].some(([x]) => x === k));
    const so = SORTS.some(([k]) => k === prm.get("sort")) ? prm.get("sort") : null;
    if (qs || key !== state.where) { state.filters = new Set(fs); state.sort = so || defaultSort(key); state.decade = /^\d{4}$/.test(prm.get("y") || "") ? prm.get("y") : ""; state.team = prm.get("t") || ""; }
    state.where = key;
    if (a !== "search") { state.q = ""; $("#q").value = ""; }
    NAV_NOW = null;   // each page sets its own (the background below goes by it)
    if (!a) home();
    else if (a === "cards") cardsHome();
    else if (a === "c") collection(b, c);
    else if (a === "customs") collection("customs");
    else if (a === "all") collection("all");
    else if (a === "rarest") collection("rarest");
    else if (a === "duplicates") collection("duplicates");
    else if (a === "recent") collection("recent");
    else if (a === "checklist") checklist(b);
    else if (a === "nfl-huskers") hub();
    else if (a === "nfl-teams") nflTeams(b);
    else if (a === "media") media();
    else if (a === "about") aboutPage();
    else if (a === "picks") picksPage(b || "");
    else if (a === "stats") (b === "players" ? statsPlayers() : statsPage());
    else if (a === "rainbow") rainbow(b);
    else if (a === "chase") chasePage(b);
    else if (a === "set") setPage(b);
    else if (a === "letters") (b ? lettersPage(b) : allLettersPage());
    else if (a === "word") go("#/letters", true);   // the old one-word letterman pages are gone; their links go to all letterman sets
    else if (a === "random") { cardsHome(); history.replaceState(null, "", toURL("#/")); setTimeout(() => $("#dice").click(), 50); }
    else if (a === "dye-career") dyeCareer();
    else if (a === "player") player(b);
    else if (a === "player-cards") playerCardsPage(b);
    else if (a === "search") { state.q = h.slice(1).join("/"); $("#q").value = state.q; collection("search"); }
    else if (a === "card") {   // a shared card link opens the card over its own collection
      const k = CARDS.findIndex((x) => cid(x) === b); if (k < 0) return notFound();
      const card = CARDS[k], slug = SECTIONS[card.si].slug;
      history.replaceState(null, "", toURL("#/c/" + slug)); state.where = "c/" + slug; state.filters.clear(); state.sort = defaultSort(state.where);
      collection(slug); window.scrollTo(0, 0);
      const j = state.list.findIndex((x) => x.i === card.i);
      return openViewer(j >= 0 ? j : 0, j >= 0 ? state.list : [card]);
    }
    else notFound();
    pageBg(a);
    window.scrollTo(0, 0);
    track();
  }
  /* ---------- Page backgrounds (Ian, 2026-11-25; color theme in place of the photos): stadium lights in one team color per page. Royals blue on Alex Gordon, Jermaine Dye and Royals pages (not the Nebraska chase pages like Cracked Ice), Honolulu blue on the Lions page, Husker red on
     everything else (Nebraska pages and the general ones). The colors live in style.css (body[data-bg]). ---------- */
  // Cracked Ice page wallpaper: the same shards spread over the whole page, behind everything (Ian's request).
  // Drawn on a canvas in the fixed page background; redrawn when the window size changes.
  function iceWall() {
    const bg = document.querySelector(".page-bg"); if (!bg) return;
    let cv = bg.querySelector("canvas.pb-ice");
    if (!cv) { cv = document.createElement("canvas"); cv.className = "pb-ice"; bg.append(cv); }
    const W = innerWidth, H = innerHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    const key = W + "x" + H; if (cv.dataset.key === key) return; cv.dataset.key = key;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    let sd = 4242;
    const R = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
    const sc = Math.max(0.6, Math.min(W, H) / 600), n = Math.round((W * H) / 2600);
    g.globalAlpha = 0.7;
    for (let i = 0; i < n; i++) paintShard(g, R, R() * W, R() * H, (1.2 + R() * 2.6) * sc);
    for (let i = 0; i < Math.round(n * 0.28); i++) paintShard(g, R, R() * W, R() * H, (3.5 + R() * 4.5) * sc);
    for (let i = 0; i < Math.round(n * 0.05); i++) paintShard(g, R, R() * W, R() * H, (8 + R() * 7) * sc);
  }
  let iceWallTimer = 0;
  addEventListener("resize", () => { clearTimeout(iceWallTimer); iceWallTimer = setTimeout(() => { if (document.body.classList.contains("ice-bg")) iceWall(); }, 150); });
  function pageBg(a) {
    document.body.classList.toggle("ice-bg", /^chase-cracked-ice$/.test(NAV_NOW || ""));
    if (document.body.classList.contains("ice-bg")) iceWall();
    const n = (NAV_NOW || "").replace(/^c\//, "");
    const dk = SLUG_TEAMS[n] && state.team ? teamKey(n, state.team) : "";
    document.body.dataset.bg = dk === "nebraska" ? "red" : dk && dk !== "royals" && dk !== "minor" ? "team-" + dk : /^(alex-gordon|jermaine-dye|royals)/.test(n) || a === "dye-career" ? "royals"
      : /^lions/.test(n) ? "lions" : "red";
  }
  /* ---------- Analytics: GoatCounter (no cookies), when config analytics.goatcounter has my site code ---------- */
  // Each #/ page counts as its own page, e.g. /cardcollection-site/#/player/ricky-simmons.
  function track() {
    const code = (DATA && DATA.site.analytics || {}).goatcounter; if (!code) return;
    const path = location.pathname;
    if (window.goatcounter && window.goatcounter.count) return void setTimeout(() => window.goatcounter.count({ path, title: document.title }), 300);
    if (document.getElementById("gc-js")) return;
    window.goatcounter = { no_onload: true };
    const sc = document.createElement("script");
    sc.id = "gc-js"; sc.async = true; sc.src = "https://gc.zgo.at/count.js";
    sc.dataset.goatcounter = `https://${encodeURIComponent(code)}.goatcounter.com/count`;
    sc.onload = () => track();
    document.head.appendChild(sc);
  }
  function syncURL() {
    const p = [];
    if (state.filters.size) p.push("f=" + [...state.filters].join(","));
    if (state.sort !== defaultSort(state.where)) p.push("sort=" + state.sort);
    if (state.decade) p.push("y=" + state.decade);
    if (state.team) p.push("t=" + encodeURIComponent(state.team));
    history.replaceState(history.state, "", toURL(HASH().split("?")[0] + (p.length ? "?" + p.join("&") : "")));
  }
  window.addEventListener("hashchange", route);

  /* ---------- Search box ---------- */
  let t;
  $("#q").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      const q = e.target.value.trim();
      if (q) history.replaceState(null, "", toURL("#/search/" + encodeURIComponent(q))), (state.q = q), collection("search");
      else go("#/");
    }, 160);
  });
  $("#search-form").addEventListener("submit", (e) => e.preventDefault());
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== $("#q") && $("#viewer").hidden) { e.preventDefault(); $("#q").focus(); }
  });

  // ← / → on a player or team page: the previous / next one (the page's pl-nav links).
  document.addEventListener("keydown", (e) => {
    if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
    if (!$("#viewer").hidden || ($("#binder") && !$("#binder").hidden)) return;
    const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (!/^#\/(player|nfl-teams)\/[^/?]/.test(HASH())) return;
    const a = $(`#app .pl-nav a[data-dir="${e.key === "ArrowLeft" ? "prev" : "next"}"]`); if (!a) return;
    e.preventDefault(); a.click();
  });

  /* ---------- Viewer ---------- */
  const V = { list: [], k: 0, back: false };
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".cd[data-i], .fd-item[data-i], .hub-ph[data-i]"); if (!b) return;
    // From the home page's Newest strip, open the card over its own collection, so closing it leaves you browsing.
    if (b.closest(".mq")) { go("#/card/" + cid(cardAt(+b.dataset.i))); return; }
    const i = +b.dataset.i, list = state.list.length && state.list.some((c) => c.i === i) ? state.list : [cardAt(i)];
    openViewer(list.findIndex((c) => c.i === i), list);
  });
  // Desktop shows a card's front and back side by side; phones flip between them with a tap.
  const wide = window.matchMedia("(min-width: 900px)");
  // The site bar (the header, or the slim bar on phones) stays on screen above the viewer; the viewer starts just under it.
  function fitViewer() {
    const mb = $("#mbar"), bar = getComputedStyle(mb).display !== "none" ? mb : $(".top");
    const h = Math.max(0, bar.getBoundingClientRect().bottom / pageZoom()) + "px";
    document.documentElement.style.setProperty("--bar-h", h); document.documentElement.style.setProperty("--site-bar", getComputedStyle(mb).display !== "none" ? h : "0px");
  }
  fitViewer();
  addEventListener("resize", fitViewer);
  function openViewer(k, list, random) {
    V.list = list; V.k = k; V.back = false; V.zoom = false; V.random = !!random;
    fitViewer(); $("#viewer").hidden = false; document.body.style.overflow = "hidden"; showCard(); $("#v-close").focus();
    // An extra history step, so the phone's Back button closes the card instead of leaving the page.
    // The step remembers which list and card were open, so coming Back to it reopens the same card.
    if (!(history.state && history.state.v)) { const t = ++VSEQ; VIEWS.set(t, { list: V.list, k: V.k, random: V.random }); history.pushState({ v: 1, t }, "", location.href); }
  }
  const VIEWS = new Map(); let VSEQ = 0, FROM_CARD = null, FROM_Y = 0;
  // Back onto a step where a card was open (e.g. from a rainbow or set page opened in the viewer): reopen that card.
  // And the page's own "← back" link goes back to the card too.
  addEventListener("hashchange", () => {
    const st = history.state, saved = st && st.v && VIEWS.get(st.t);
    if (saved && $("#viewer").hidden) {
      V.list = saved.list; V.k = saved.k; V.back = false; V.zoom = false; V.random = saved.random;
      // Back from a rainbow/set/letters page: put the page back where it was (the cards load in as it re-draws), then the card fades in.
      const y = FROM_Y; for (let n = 0, t = 0; n < 12 && y > 0; n++, t += 80) setTimeout(() => { if ($("#viewer").hidden || Math.abs(scrollY - y) < 2) return; scrollTo(0, y); }, t);
      fitViewer(); $("#viewer").hidden = false; document.body.style.overflow = "hidden"; showCard();
      const vw = $("#viewer"); vw.classList.remove("back-in"); void vw.offsetWidth; vw.classList.add("back-in");
    }
    if (FROM_CARD !== HASH()) { FROM_CARD = null; return; }
    // Reached from a card: a bar like the viewer's (round back button, page name), and the page slides in,
    // so it reads as a step forward, not as leaving.
    requestAnimationFrame(() => {
      const b = $("#app a.back"); if (!b) return;
      const kind = ($("#app .kick") || {}).textContent || "", name = ($("#app h1") || {}).textContent || "";
      b.outerHTML = `<div class="fc-bar"><a class="back v-ic" href="${esc(FROM_CARD)}" aria-label="Back to card"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></a>
        <div class="v-mid"><b>${esc(kind)}${kind && name ? " · " : ""}${esc(name)}</b><a class="back" href="${esc(FROM_CARD)}">Back to card</a></div><span></span></div>`;
      // Compact page: the bar above already names it, so the big title goes and the summary text folds to two lines (tap to open),
      // which puts the cards right under the bar.
      const app = $("#app"), p = app.querySelector(".c-head p"); app.classList.add("from-card");
      if (p) p.addEventListener("click", () => p.classList.toggle("open"));
      $("#app").classList.remove("slide-in"); void $("#app").offsetWidth; $("#app").classList.add("slide-in");
    });
  });
  $("#viewer").addEventListener("click", (e) => { const a = e.target.closest("a[href]"); if (a && !a.target) { FROM_CARD = hashOf(a.getAttribute("href")); FROM_Y = scrollY; } });
  // Capture phase, so this runs before the site's general link handler (which would otherwise push the page's own
  // address again and leave Back going nowhere): the round back button returns to the card exactly like the browser's Back.
  document.addEventListener("click", (e) => {
    const a = e.target.closest("#app a.back");
    if (a && FROM_CARD && FROM_CARD === HASH()) { e.preventDefault(); e.stopPropagation(); history.back(); }
  }, true);
  function closeViewer(silent) {
    if ($("#viewer").hidden) return;
    $("#viewer").hidden = true; document.body.style.overflow = ""; $("#v-stage").classList.remove("zoom", "pair"); $("#viewer").classList.remove("focus"); ["#v-img", "#v-img2"].forEach((q) => { const e = $(q); e.removeAttribute("src"); e.classList.remove("wm"); e.dataset.id = ""; }); $("#v-aura").className = "v-aura";
    if (!silent && history.state && history.state.v) history.back();
  }
  window.addEventListener("popstate", () => { if (!$("#viewer").hidden && !(history.state && history.state.v)) closeViewer(true); });
  /* Watermark: anything saved from the card viewer carries "IANBADEER.COM" in the lower part of the card,
     centered, like COMC, while visitors see the clean card. The viewer's <img> holds the marked copy (so
     right-click / long-press "Save image" gets it) but hides it, and shows the clean copy as its background. */
  const MARKED = new Map();   // file id -> {plain, marked} object URLs (kept for this visit)
  function marked(id, rk) {
    if (MARKED.has(id)) return MARKED.get(id);
    const p = new Promise((ok, no) => {
      const im = new Image(); im.crossOrigin = "anonymous";
      im.onload = () => {
        try {
          const cv = document.createElement("canvas"); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
          const g = cv.getContext("2d"); g.drawImage(im, 0, 0);
          // Small blob URLs (not huge data: URLs): phones redraw them without a blink.
          const plainP = new Promise((r) => cv.toBlob((b) => r(b && URL.createObjectURL(b)), "image/jpeg", 0.92));
          // Centered, about 69% of the way down the card (Ian, 2026-11-25: moved up from 80% and about 2 pt smaller),
          // spanning ~56% of its width;
          // see-through gray letters with a light edge so it reads on light and dark cards.
          const word = "IANBADEER.COM";
          g.textAlign = "center"; g.textBaseline = "middle";
          g.font = `800 100px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
          const per = g.measureText(word).width / 100;
          const size = Math.max(14, Math.min((cv.width * 0.565) / per, cv.height * 0.08));
          g.font = `800 ${size}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
          const x = cv.width / 2, y = cv.height * 0.69;
          g.lineJoin = "round"; g.lineWidth = Math.max(1.5, size * 0.05);
          g.strokeStyle = "rgba(255,255,255,.42)"; g.strokeText(word, x, y);
          g.fillStyle = "rgba(60,60,60,.40)"; g.fillText(word, x, y);
          plainP.then((plain) => cv.toBlob((b) => (b && plain ? ok({ plain, marked: URL.createObjectURL(b) }) : no(new Error("no image"))), "image/jpeg", 0.9));
        } catch (e) { no(e); }
      };
      im.onerror = () => no(new Error("image failed"));
      im.src = img(id, rk, 1600);
    });
    p.catch(() => MARKED.delete(id));
    MARKED.set(id, p);
    return p;
  }
  // Both versions decoded and kept in memory, so swapping them in never blinks.
  const READY = new Map();
  const ready = (id, rk) => marked(id, rk).then((u) => u.keep ? u : Promise.all((u.keep = [u.plain, u.marked].map((s) => { const i = new Image(); i.src = s; return i; })).map((i) => i.decode().catch(() => {}))).then(() => (READY.set(id, u), u)));
  // Show a card in one step: the old card (and its aura, via `done`) stays until the new picture is decoded,
  // then picture and effects change together. The large clean/marked pair replaces the preview when it's ready.
  // The viewer image is sized to fill its space from the start: the quick small image shows at the size the sharp one
  // will have (it used to show at its own small size, then jump bigger when the sharp one arrived).
  function fitImg(el, w, h) {
    if (w && h) el.dataset.ar = w / h;
    const ar = +el.dataset.ar, st = $("#v-stage"); if (!ar || !st) return;
    if (st.classList.contains("zoom")) { el.style.width = el.style.height = ""; return; }
    const cs = getComputedStyle(st), pair = st.classList.contains("pair");
    let W = st.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), H = st.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (pair) W = (W - 24) / 2;
    if (W <= 0 || H <= 0) return;
    const k = Math.min(W / ar, H);
    el.style.height = Math.floor(k) + "px"; el.style.width = Math.floor(k * ar) + "px";
  }
  // Front and back side by side (wide screens): both images change together. Each side waits until the other is
  // ready too, so the old back never lingers next to the new front.
  function showGroup(need) {
    const g = { fns: [], fired: false, add(f) { if (this.fired) return requestAnimationFrame(f); this.fns.push(f); if (this.fns.length === need) this.fire(); },
      fire() { if (this.fired) return; this.fired = true; requestAnimationFrame(() => { this.fns.forEach((f) => f()); if (this.after) this.after(); }); } };
    setTimeout(() => g.fire(), 2500);   // safety net: never wait forever for a slow image
    return g;
  }
  function loadInto(el, c, id, rk, alt, done, group) {
    el.dataset.id = id; el.alt = alt;
    let big = false, open = !group, pend = null, told = false;
    const live = () => el.dataset.id === id && V.list[V.k] === c;
    const tell = () => { if (!told && done) { told = true; done(); } };
    // Every change to the image goes through the gate: straight away, or (side by side) when both sides are ready.
    const gate = (fn) => { if (open) return fn(); const first = !pend; pend = fn; if (first) group.add(() => { open = true; if (live()) pend(); }); };
    const showBig = (u) => gate(() => { big = true; el.style.setProperty("--plain", `url("${u.plain}")`); el.classList.add("wm"); el.src = u.marked; tell(); });
    if (READY.has(id)) { showBig(READY.get(id)); return; }
    const t = new Image(); t.src = img(id, rk, 400);
    t.decode().catch(() => {}).then(() => {
      if (!live() || big) return;
      gate(() => { if (big) return; el.classList.remove("wm"); el.style.removeProperty("--plain"); fitImg(el, t.naturalWidth, t.naturalHeight); el.src = t.src; tell(); });
    });
    ready(id, rk).then((u) => { if (live()) requestAnimationFrame(() => { if (live()) showBig(u); }); })
      .catch(() => { if (live()) gate(() => { el.src = img(id, rk, 1600); tell(); }); });   // no mark possible: plain large image
  }
  // Get the next card ready while this one is looked at.
  const prefetch = () => { const n = V.list[V.k + 1]; if (!n || !n.id || n.photo) return;
    setTimeout(() => { if (!READY.has(n.id)) ready(n.id, n.rk).catch(() => {});
      if (n.backId && wide.matches && !READY.has(n.backId)) ready(n.backId, n.backRk).catch(() => {}); }, 600); };
  // "Save image": the marked image, named after the card.
  async function saveCard() {
    const c = V.list[V.k]; if (!c) return;
    const back = !isPair(c) && V.back && c.backId, id = back ? c.backId : c.id, rk = back ? c.backRk : c.rk;
    const b = $("#v-save"); b.dataset.tip = "Saving…";
    try {
      const u = (await marked(id, rk)).marked, a = document.createElement("a");
      a.href = u; a.download = (String(c.name || c.caption || "card").replace(/[\\/:*?"<>|#]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) + (back ? " (back)" : "")) + ".jpg";
      document.body.appendChild(a); a.click(); a.remove();
      b.dataset.tip = "Saved";
    } catch (e) { b.dataset.tip = "Couldn't save"; }
    setTimeout(() => delete b.dataset.tip, 1600);
  }
  const isPair = (c) => wide.matches && !!c.backId && !V.zoom;
  function showCard() {
    const c = V.list[V.k]; if (!c) return;
    if (typeof pzReset === "function" && PZ) pzReset();
    $("#v-copy").hidden = !!c.photo;
    { const vp = $("#v-pick"), on = isPicked(c); vp.hidden = !canPick(c); vp.classList.toggle("on", on); vp.setAttribute("aria-pressed", on); vp.setAttribute("aria-label", on ? "Remove from my picks" : "Add to my picks"); vp.dataset.tip = on ? "In my picks" : "Add to my picks"; }
    if (c.photo) {   // a photo with a player: caption instead of card details
      const stage = $("#v-stage"); stage.classList.remove("pair"); stage.classList.toggle("zoom", V.zoom && wide.matches);
      loadInto($("#v-img"), c, c.id, c.rk, c.caption, () => aura(c)); $("#v-img2").hidden = true;
      $("#v-title").innerHTML = `${esc(c.short)}${c.caption !== c.short ? `<small>${esc(c.caption)}</small>` : ""}`;
      $("#v-have").hidden = true; $("#v-more").innerHTML = ""; showBackText(null);
      $("#v-flip").hidden = true;
      $("#v-meta").innerHTML = `<span>${c.ref ? "Reference image" : "With the players"}</span><span>·</span><span>${V.k + 1} of ${fmt(V.list.length)}</span>`;
      navState();
      return;
    }
    const pair = isPair(c), stage = $("#v-stage"), im = $("#v-img"), im2 = $("#v-img2");
    const back = !pair && V.back;
    const id = back ? c.backId : c.id, rk = back ? c.backRk : c.rk;
    const g = pair ? showGroup(2) : null;
    // A back slot that was hidden (last card had no back) may still hold an old image: keep it invisible until both are ready.
    if (g && (im2.hidden || !im2.getAttribute("src"))) { im2.style.visibility = "hidden"; g.after = () => (im2.style.visibility = ""); }
    else im2.style.visibility = "";
    loadInto(im, c, id, rk, c.name + (back ? " (back)" : ""), () => aura(c), g);
    im2.hidden = !pair;
    if (pair) loadInto(im2, c, c.backId, c.backRk, c.name + " (back)", null, g);
    stage.classList.toggle("pair", pair);
    stage.classList.toggle("zoom", V.zoom && wide.matches);
    [im, im2].forEach((e) => e.dataset.id && e.getAttribute("src") && fitImg(e));
    $("#v-title").innerHTML = `${esc(c.title)}<small>${esc(c.sub || "")}${c.par ? " · " + esc(c.par) : ""}</small>`;
    $("#v-flip").hidden = !c.backId || pair; $("#v-flip").textContent = V.back ? "Show front" : "Show back";
    delete $("#v-save").dataset.tip;
    const sec = SECTIONS[c.si];
    // Want List cards get a button that starts an email to me with the card already named.
    $("#v-have").hidden = !(sec.kind === "want" && (DATA.site.contact || {}).code);
    if (!$("#v-have").hidden) $("#v-have").innerHTML = contactHTML("I have this card", "I have a card from your Want List: " + c.name,
      `Hi Ian,\n\nI have this card from your Want List:\n${c.name}\n${absURL("#/card/" + cid(c))}\n\n`, c.name);
        prefetch();
    showBackText(c);
    const setKey = (x) => x.sub.replace(/\s+#\S+$/, ""), same = (f) => CARDS.filter((x) => x !== c && f(x));
    const bySet = c.sub ? same((x) => x.sub && setKey(x) === setKey(c)) : [], byPlayer = c.title ? same((x) => plainTitle(x) === plainTitle(c)) : [];
    $("#v-more").innerHTML = (bySet.length ? `<button type="button" class="btn" data-more="set">More from ${esc(setKey(c))} (${fmt(bySet.length)} scan${bySet.length === 1 ? "" : "s"})</button>` : "")
      + (byPlayer.length && byPlayer.length < CARDS.length ? `<button type="button" class="btn" data-more="player">More of ${esc(plainTitle(c))} (${fmt(byPlayer.length)} scan${byPlayer.length === 1 ? "" : "s"})</button>` : "");
    // More of this player: oldest to newest (Ian), with this card in its place; the viewer moves on to the next one.
    V.more = { set: [c, ...bySet], player: sortList([c, ...byPlayer], "old") }; V.moreFrom = c;
    const rb = rainbowOf(c);
    const lt = lettersOf(c);
    if (lt && lt.count >= 1 && (lt.word || lt.count > 1)) $("#v-more").insertAdjacentHTML("afterbegin", `<a class="btn rb-btn" href="#/letters/${encodeURIComponent(cid(c))}">🔤 View letters (${lt.count} of ${lt.slots.length})</a>`);
    const st = setOf(c);
    if (st.length) $("#v-more").insertAdjacentHTML("afterbegin", `<a class="btn rb-btn" href="#/set/${encodeURIComponent(cid(c))}">📚 View set (${new Set(st.map((x) => norm(x.title))).size} players)</a>`);
    // With TCDb want list cards: "View rainbow (2 of 7)", and a rainbow of one scan plus cards I need counts too.
    // Owned = scanned + TCDb collection; "(5 of 8)" when TCDb want list cards are still needed.
    const rbHave = !isWant(c) && rb.length ? rainbowHave(c, rb) : [], rbNeed = !isWant(c) && rb.length ? rainbowNeeds(c, rb, rbHave).length : 0;
    const rbOwn = rb.length + rbHave.length;
    if (rbOwn > 1 || (rb.length && rbNeed)) $("#v-more").insertAdjacentHTML("afterbegin", `<a class="btn rb-btn" href="#/rainbow/${encodeURIComponent(cid(c))}">🌈 View rainbow (${rbNeed ? `${rbOwn} of ${rbOwn + rbNeed}` : rbOwn})</a>`);
    $("#v-meta").innerHTML = `${badges(c)}<span>${esc(sec.title)} · ${esc(sec.groups[c.gi].label)}</span><span>·</span><span>${V.random ? "Random card" : `${V.k + 1} of ${fmt(V.list.length)}`}</span><span>·</span><span style="font-family:var(--f-m)">${esc(c.name)}</span>`;
    navState();
  }
  /* Card back text: transcriptions of custom card backs (data/card-text.json, keyed by Drive file ID),
     readable under "Read the back" and linked to the image for screen readers. Loaded the first time it's needed. */
  let BACKTEXT = null;
  const backText = () => BACKTEXT || (BACKTEXT = fetch("data/card-text.json").then((r) => (r.ok ? r.json() : {})).then((d) => d.cards || {}).catch(() => ({})));
  function textHTML(t) {
    const out = [];
    for (const block of String(t || "").split(/\n\s*\n/)) {
      const lines = block.split("\n").map((x) => x.trim()).filter(Boolean); if (!lines.length) continue;
      if (lines.every((l) => l.includes(" | "))) {
        const rows = lines.map((l) => l.split(" | ").map((x) => x.trim()));
        out.push(`<div class="vt-tbl"><table><thead><tr>${rows[0].map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      } else if (lines[0].startsWith("## ")) {
        out.push(`<h3>${esc(lines[0].slice(3))}</h3>` + (lines.length > 1 ? `<p>${lines.slice(1).map(esc).join("<br>")}</p>` : ""));
      } else out.push(`<p>${lines.map(esc).join("<br>")}</p>`);
    }
    return out.join("");
  }
  function showBackText(c) {
    // Only for card backs: the text is keyed to the back scan, and the button shows only while the back is on screen
    // (flipped to the back on a phone, or front and back side by side on a wide screen).
    const btn = $("#v-read"), box = $("#v-text");
    btn.hidden = true; box.hidden = true; box.innerHTML = ""; btn.setAttribute("aria-expanded", "false");
    ["#v-img", "#v-img2"].forEach((q) => $(q).removeAttribute("aria-describedby"));
    if (!c || c.photo || !c.backId || !c.tags.has("custom")) return;   // customs only: Ian's own writing
    const pair = isPair(c); if (!pair && !V.back) return;
    backText().then((all) => {
      if (V.list[V.k] !== c || (!isPair(c) && !V.back)) return;
      const e = all[c.backId]; if (!e || !e.text) return;
      box.innerHTML = `<div class="vt-in"><h2>Card back</h2>${textHTML(e.text)}<button type="button" class="btn vt-close">Close</button></div>`;
      btn.hidden = false; $(pair ? "#v-img2" : "#v-img").setAttribute("aria-describedby", "v-text");
    });
  }
  $("#v-read").addEventListener("click", () => { const box = $("#v-text"), open = box.hidden; box.hidden = !open; $("#v-read").setAttribute("aria-expanded", String(open)); if (open) box.scrollTop = 0; });
  $("#v-text").addEventListener("click", (e) => { if (e.target.closest(".vt-close")) { $("#v-text").hidden = true; $("#v-read").setAttribute("aria-expanded", "false"); } });
  const step = (d) => { const n = V.k + d; if (n >= 0 && n < V.list.length) { V.k = n; V.back = false; V.zoom = false; showCard(); } };
  $("#v-prev").onclick = () => step(-1); $("#v-next").onclick = () => step(1);
  $("#v-close").onclick = $("#v-back").onclick = () => closeViewer();
  // Top bar (always shown; the main way around on phones): back, "3 of 24", and previous/next.
  function navState() {
    const st = history.state; if (st && st.v && VIEWS.has(st.t)) VIEWS.set(st.t, { list: V.list, k: V.k, random: V.random });
    const first = V.k <= 0, last = V.k >= V.list.length - 1;
    $("#v-prev").style.visibility = first ? "hidden" : "visible"; $("#v-next").style.visibility = last ? "hidden" : "visible";
    const cur = V.list[V.k] || {};
    $("#v-name").textContent = cur.title || cur.short || ""; $("#v-bio").hidden = true;
    // A player with a bio page on the site: his name links to it (lists load quietly the first time).
    if (!cur.photo && cur.name) loadCheckQuiet().then(() => {
      if (V.list[V.k] !== cur || $("#viewer").hidden) return;
      const p = bioFor(cur); if (!p) return;
      $("#v-name").innerHTML = `<a href="#/player/${esc(p.slug)}">${esc(cur.title || p.name)}</a>`; $("#v-bio").hidden = false;
    }).catch(() => {});
    $("#viewer").classList.toggle("focus", V.zoom && !wide.matches);
    $("#v-pos").textContent = V.random ? "Random card" : `${V.k + 1} of ${fmt(V.list.length)}`;
  }
  // Keep exploring inside the viewer: swap in the cards from the same set, or of the same player.
  $("#v-more").addEventListener("click", (e) => {
    const b = e.target.closest("[data-more]"); if (!b || !V.more) return;
    const list = V.more[b.dataset.more]; if (!list || list.length < 2) return;
    V.list = list; V.k = (list.indexOf(V.moreFrom) + 1) % list.length; V.back = false; V.zoom = false; V.random = false; showCard();
  });
  $("#v-save").onclick = saveCard;
  $("#v-flip").onclick = () => { V.back = !V.back; V.zoom = false; showCard(); };
  // Click an image: on desktop, zoom into that side (click again to go back);
  // on a phone, the page around the card hides so the whole card fills the screen (tap again to bring it back).
  function imageClick(side) {
    if (PZ.s > 1.02 || PZ.moved) { PZ.moved = false; return; }   // a tap after pinching/panning doesn't toggle
    const c = V.list[V.k];
    if (V.zoom) V.zoom = false;
    else { V.zoom = true; if (c.backId) V.back = side === "back"; }
    showCard();
  }
  $("#v-img").onclick = () => imageClick(isPair(V.list[V.k]) ? "front" : V.back ? "back" : "front");
  $("#v-img2").onclick = () => imageClick("back");
  wide.addEventListener("change", () => { if (!$("#viewer").hidden) { V.zoom = false; showCard(); } });
  $("#v-copy").onclick = async () => {
    const c = V.list[V.k], url = absURL("#/card/" + cid(c));
    try { await navigator.clipboard.writeText(url); $("#v-copy").dataset.tip = "Link copied"; }
    catch { $("#v-copy").dataset.tip = "Copy failed"; }
    setTimeout(() => delete $("#v-copy").dataset.tip, 1600);
  };
  document.addEventListener("keydown", (e) => {
    if ($("#viewer").hidden) return;
    if (e.key === "Escape") closeViewer(); else if (e.key === "ArrowLeft") step(-1); else if (e.key === "ArrowRight") step(1);
    else if (e.key.toLowerCase() === "f" && !$("#v-flip").hidden) $("#v-flip").click();
  });
  let tx = null;
  $("#v-stage").addEventListener("touchstart", (e) => (tx = e.touches.length === 1 && PZ.s <= 1.02 ? e.touches[0].clientX : null), { passive: true });
  $("#v-stage").addEventListener("touchend", (e) => { if (tx == null || PZ.s > 1.02 || PZ.pinched) { tx = null; PZ.pinched = false; return; } const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1); tx = null; });
  // Pinch to zoom on phones (great for decas and other big cards): two fingers zoom in up to 5x around the pinch,
  // one finger then moves around the card; pinch back out (or change cards) to reset. The scan itself isn't changed.
  var PZ = { s: 1, x: 0, y: 0, el: null, pts: new Map(), start: null, moved: false, pinched: false };
  const pzApply = () => { if (!PZ.el) return; PZ.el.style.transform = PZ.s > 1.02 ? `translate(${PZ.x}px, ${PZ.y}px) scale(${PZ.s})` : "";
    $("#v-stage").classList.toggle("pinched", PZ.s > 1.02); };
  function pzReset() { PZ.s = 1; PZ.x = PZ.y = 0; PZ.start = null; PZ.pts.clear(); if (PZ.el) PZ.el.style.transform = ""; PZ.el = null; $("#v-stage").classList.remove("pinched"); }
  const stg = $("#v-stage");
  stg.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    const im = e.target.closest("#v-img, #v-img2"); if (!im && !PZ.el) return;
    if (im && PZ.el && im !== PZ.el) pzReset();
    if (im) PZ.el = im;
    PZ.pts.set(e.pointerId, [e.clientX, e.clientY]); PZ.start = null;
  });
  stg.addEventListener("pointermove", (e) => {
    if (!PZ.pts.has(e.pointerId) || !PZ.el) return;
    const prev = PZ.pts.get(e.pointerId); PZ.pts.set(e.pointerId, [e.clientX, e.clientY]);
    const P = [...PZ.pts.values()];
    if (P.length >= 2) {
      const d = Math.hypot(P[0][0] - P[1][0], P[0][1] - P[1][1]), mx = (P[0][0] + P[1][0]) / 2, my = (P[0][1] + P[1][1]) / 2;
      if (!PZ.start) { PZ.start = { d, s: PZ.s, x: PZ.x, y: PZ.y, mx, my }; PZ.pinched = true; return; }
      const r = PZ.el.getBoundingClientRect(), cx = r.left + r.width / 2 - PZ.x, cy = r.top + r.height / 2 - PZ.y;   // untransformed centre
      const s = Math.min(5, Math.max(1, PZ.start.s * d / PZ.start.d)), k = s / PZ.start.s;
      // keep the point between the fingers under the fingers
      PZ.x = mx - cx - (PZ.start.mx - cx - PZ.start.x) * k; PZ.y = my - cy - (PZ.start.my - cy - PZ.start.y) * k; PZ.s = s;
      if (s <= 1.02) { PZ.x = PZ.y = 0; }
      pzApply(); PZ.moved = true;
    } else if (PZ.s > 1.02) {
      PZ.x += e.clientX - prev[0]; PZ.y += e.clientY - prev[1]; pzApply();
      if (Math.abs(e.clientX - prev[0]) + Math.abs(e.clientY - prev[1]) > 2) PZ.moved = true;
    }
  });
  const pzUp = (e) => { PZ.pts.delete(e.pointerId); if (PZ.pts.size < 2) PZ.start = null; if (PZ.s <= 1.02 && !PZ.pts.size) { const el = PZ.el; pzReset(); PZ.el = el; } };
  stg.addEventListener("pointerup", pzUp); stg.addEventListener("pointercancel", pzUp);
  $("#viewer").addEventListener("click", (e) => { if (e.target.id === "v-stage" || e.target.id === "viewer") closeViewer(); });

  /* ---------- Card auras: effects around special cards in the viewer, never on the scan itself ---------- */
  // 1/1: gold glow, light rays and sparkles. Numbered /25 or lower: a soft pulsing glow. Autographs: a faint ink-blue
  // glow. Refractors, Prizms, chrome and foil: a rainbow halo circling the card's edge. The rarest one wins.
  const HOLO = /\b(refractors?|prizms?|chrome|foil|holo(?:foil|graphic)?|x-?fractors?|superfractors?|diffractors?|shimmer|mojo|cracked ice|mirror|atomic|spectrum|sapphire|optic|finest|wave|rainbow|galactic|lava|hyper|disco|scope)\b/i;
  // Dirt relics (the Dirt Relics group, "Dirt"/"(Dirty" in the name, or listed in config "dirtRelics" when the name has
  // no room): a dusty brown haze with kicked-up specks. Same card filed in another collection too (e.g. Alex Gordon) gets it as well.
  let DIRT;
  const isDirt = (c) => {
    DIRT ||= new Set([...CARDS.filter((x) => SECTIONS[x.si]?.groups[x.gi]?.slug === "dirt").map((x) => x.name), ...(DATA.site.dirtRelics || [])]);
    return DIRT.has(c.name) || /\bdirt\b|\(dirty\b/i.test(c.name);
  };
  const auraTier = (c) => !c || c.photo ? "" : c.one ? "one" : c.serial && c.serial <= 25 ? "low" : isDirt(c) ? "dirt" : /cracked ice/i.test(c.name) ? "ice" : c.tags.has("auto") ? "auto" : HOLO.test(c.name) ? "holo" : "";
  function placeAura() {
    const a = $("#v-aura"), im = $("#v-img"), st = $("#v-stage");
    if (!a.className.match(/\bt-|has-ice/) || st.classList.contains("zoom") || !im.offsetWidth) { a.hidden = true; return; }
    a.hidden = false;
    // Dual view (front and back side by side): the aura wraps both cards, not just the front.
    const im2 = $("#v-img2"), both = !im2.hidden && im2.offsetWidth ? [im, im2] : [im];
    const L = Math.min(...both.map((e) => e.offsetLeft)), T = Math.min(...both.map((e) => e.offsetTop));
    const R = Math.max(...both.map((e) => e.offsetLeft + e.offsetWidth)), B = Math.max(...both.map((e) => e.offsetTop + e.offsetHeight));
    const w = R - L, h = B - T;
    Object.assign(a.style, { left: L + "px", top: T + "px", width: w + "px", height: h + "px" });
    if (a.classList.contains("t-dirt")) dirt(a, w, h);
    // Between the two cards (dual view), the shards fill the gap instead of showing the dark stage.
    let gap = null;
    if (both.length === 2) { const g0 = Math.min(im.offsetLeft + im.offsetWidth, im2.offsetLeft + im2.offsetWidth) - L, g1 = Math.max(im.offsetLeft, im2.offsetLeft) - L; if (g1 > g0) gap = [g0, g1]; }
    if (a.classList.contains("has-ice")) ice(a, w, h, gap);
    // The gap gets the card's own effect color (CSS .v-gap), so no dark stripe shows between the front and back.
    let gapEl = a.querySelector(":scope > .v-gap");
    if (!gapEl) { gapEl = document.createElement("div"); gapEl.className = "v-gap"; a.prepend(gapEl); }
    a.classList.toggle("dual", !!gap);
    if (gap) Object.assign(gapEl.style, { left: gap[0] + "px", width: gap[1] - gap[0] + "px", top: "0px", height: h + "px" });
  }
  // Dirt: crumbly clumps and fine powder drawn on a canvas around the card (behind it; the scan stays clean).
  // Seeded by the card, so the same card always gets the same pile.
  function dirt(a, w, h) {
    let cv = a.querySelector("canvas.v-dirt");
    const key = a.dataset.seed + "|" + w + "x" + h;
    if (cv && cv.dataset.key === key) return;
    if (!cv) { cv = document.createElement("canvas"); cv.className = "v-dirt"; a.append(cv); }
    cv.dataset.key = key;
    const m = Math.round(Math.min(w, h) * 0.22), W = w + 2 * m, H = h + 2 * m, dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr; Object.assign(cv.style, { left: -m + "px", top: -m + "px", width: W + "px", height: H + "px" });
    const g = cv.getContext("2d"); g.scale(dpr, dpr);
    let sd = [...String(a.dataset.seed)].reduce((x, ch) => (x * 31 + ch.charCodeAt(0)) >>> 0, 7) || 1;
    const R = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
    // A point outside the card, mostly close to its edge, with more at the bottom (a little pile).
    const spot = (spread) => {
      for (;;) {
        const side = R(), d = Math.pow(R(), 1.8) * m * spread, t = R();
        let x, y;
        if (side < 0.4) { x = m + t * w; y = m + h - 4 + d; }
        else if (side < 0.6) { x = m + t * w; y = m + 4 - d; }
        else if (side < 0.8) { x = m + 4 - d; y = m + t * h; }
        else { x = m + w - 4 + d; y = m + t * h; }
        if (x > 0 && y > 0 && x < W && y < H) return [x, y];
      }
    };
    const browns = [[78, 48, 26], [98, 62, 34], [120, 80, 44], [64, 38, 20], [138, 94, 54]];
    // Fine powder first, then crumbs, then clumps on top.
    for (let i = 0; i < 6000; i++) {
      const [x, y] = spot(1), c = browns[(R() * browns.length) | 0];
      g.fillStyle = `rgba(${c},${0.25 + R() * 0.5})`; g.beginPath(); g.arc(x, y, 0.4 + R() * 1.3, 0, 7); g.fill();
    }
    const chunk = (x, y, r) => {
      const n = 6 + ((R() * 6) | 0), pts = [];
      for (let k = 0; k < n; k++) { const an = (k / n) * 6.283 + R() * 0.5, rr = r * (0.6 + R() * 0.55); pts.push([x + Math.cos(an) * rr, y + Math.sin(an) * rr * (0.75 + R() * 0.3)]); }
      const c = browns[(R() * browns.length) | 0];
      const gr = g.createLinearGradient(x - r, y - r, x + r, y + r);
      gr.addColorStop(0, `rgb(${c.map((v) => Math.min(255, v + 38))})`); gr.addColorStop(0.55, `rgb(${c})`); gr.addColorStop(1, `rgb(${c.map((v) => v * 0.55)})`);
      g.fillStyle = gr; g.beginPath(); pts.forEach(([px, py], k) => (k ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath(); g.fill();
      if (r > 3) { g.strokeStyle = "rgba(160,115,70,.35)"; g.lineWidth = 0.8; g.stroke(); }
    };
    const sc = Math.min(w, h) / 400;
    for (let i = 0; i < 900; i++) { const [x, y] = spot(0.9); chunk(x, y, (1 + R() * 2.5) * Math.max(0.7, sc)); }
    for (let i = 0; i < 160; i++) { const [x, y] = spot(0.6); chunk(x, y, (3 + R() * 7) * Math.max(0.7, sc)); }
    for (let i = 0; i < 26; i++) { const [x, y] = spot(0.4); chunk(x, y, (8 + R() * 9) * Math.max(0.7, sc)); }
  }
  // One iridescent glass shard (pearly pastel facets with a bright edge). Shared by the card auras and the Cracked Ice wallpaper.
  const PEARL = [[190, 245, 255], [205, 190, 255], [255, 205, 235], [190, 255, 225], [235, 250, 255], [175, 215, 255], [255, 235, 205]];
  function paintShard(g, R, x, y, r) {
    const n = 3 + ((R() * 2) | 0), rot = R() * 6.283, pts = [];
    for (let k = 0; k < n; k++) { const an = rot + (k / n) * 6.283 + (R() - 0.5) * 0.9, rr = r * (0.35 + R() * 0.75); pts.push([x + Math.cos(an) * rr, y + Math.sin(an) * rr]); }
    const c1 = PEARL[(R() * PEARL.length) | 0], c2 = PEARL[(R() * PEARL.length) | 0];
    const gr = g.createLinearGradient(x - r, y - r, x + r, y + r);
    gr.addColorStop(0, `rgba(${c1},${0.8 + R() * 0.2})`); gr.addColorStop(0.6, `rgba(${c2},${0.7 + R() * 0.25})`); gr.addColorStop(1, `rgba(${c1},0.45)`);
    g.fillStyle = gr; g.beginPath(); pts.forEach(([px, py], k) => (k ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath(); g.fill();
    g.strokeStyle = "rgba(255,255,255,.6)"; g.lineWidth = 0.6; g.stroke();
  }
  // Cracked Ice: iridescent glass shards scattered around the card (drawn in app.js, like the dirt), seeded by the card.
  // Pearly pastel facets with a bright edge; more of them near the card, fewer farther out.
  // gap (dual view): [x0, x1] across the middle of the aura, between the front and back, filled with the same shards.
  function ice(a, w, h, gap) {
    let cv = a.querySelector("canvas.v-ice");
    const key = a.dataset.seed + "|" + w + "x" + h + "|" + (gap ? gap.join(",") : "");
    if (cv && cv.dataset.key === key) return;
    if (!cv) { cv = document.createElement("canvas"); cv.className = "v-ice"; a.append(cv); }
    cv.dataset.key = key;
    const m = Math.round(Math.min(w, h) * 0.2), W = w + 2 * m, H = h + 2 * m, dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr; Object.assign(cv.style, { left: -m + "px", top: -m + "px", width: W + "px", height: H + "px" });
    const g = cv.getContext("2d"); g.scale(dpr, dpr);
    let sd = [...String(a.dataset.seed + "|ice")].reduce((x, ch) => (x * 31 + ch.charCodeAt(0)) >>> 0, 7) || 1;
    const R = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
    // A point just outside the card's edge; the farther out, the rarer (power curve).
    const spot = (spread) => {
      for (;;) {
        const side = R(), d = Math.pow(R(), 1.6) * m * spread, t = R();
        let x, y;
        if (side < 0.25) { x = m + t * w; y = m + h + d - 6; }
        else if (side < 0.5) { x = m + t * w; y = m + 6 - d; }
        else if (side < 0.75) { x = m + 6 - d; y = m + t * h; }
        else { x = m + w + d - 6; y = m + t * h; }
        if (x > 0 && y > 0 && x < W && y < H) return [x, y];
      }
    };
    const sc = Math.max(0.7, Math.min(w, h) / 400);
    const shard = (x, y, r) => paintShard(g, R, x, y, r);
    for (let i = 0; i < 700; i++) { const [x, y] = spot(1); shard(x, y, (1.2 + R() * 2.6) * sc); }
    for (let i = 0; i < 200; i++) { const [x, y] = spot(0.8); shard(x, y, (3.5 + R() * 4.5) * sc); }
    for (let i = 0; i < 36; i++) { const [x, y] = spot(0.5); shard(x, y, (8 + R() * 7) * sc); }
    if (gap && gap[1] > gap[0]) {
      const n = Math.round(((gap[1] - gap[0]) * h) / 1500);
      for (let i = 0; i < n; i++) shard(m + gap[0] + R() * (gap[1] - gap[0]), m + R() * h, (1.2 + R() * 3.2) * sc);
      for (let i = 0; i < Math.round(n / 12); i++) shard(m + gap[0] + R() * (gap[1] - gap[0]), m + R() * h, (4 + R() * 5) * sc);
    }
  }
  function aura(c) {
    const a = $("#v-aura"), front = !(V.back && !isPair(c));
    a.className = "v-aura" + (front && auraTier(c) ? " t-" + auraTier(c) : "") + (front && c && /cracked ice/i.test(c.name) ? " has-ice" : "");
    a.dataset.seed = c ? c.id : "";
    requestAnimationFrame(placeAura);
  }
  // Keep the aura on the front card: it moves when either image loads or changes size (e.g. the back arriving).
  ["#v-img", "#v-img2"].forEach((q) => $(q).addEventListener("load", (e) => { fitImg(e.target, e.target.naturalWidth, e.target.naturalHeight); requestAnimationFrame(placeAura); }));
  if (window.ResizeObserver) { const ro = new ResizeObserver(() => { if (!$("#viewer").hidden) placeAura(); }); ro.observe($("#v-img")); ro.observe($("#v-img2")); ro.observe($("#v-stage"));
    new ResizeObserver(() => { if (!$("#viewer").hidden) { fitImg($("#v-img")); if (!$("#v-img2").hidden) fitImg($("#v-img2")); } }).observe($("#v-stage")); }
  window.addEventListener("resize", () => { if (!$("#viewer").hidden) placeAura(); });

  /* ---------- Random card: the dice in the header ---------- */
  // On a collection page it picks from that page's cards (with any filters on); anywhere else, from every card.
  let lastRandom = -1;
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  function randomCard() {
    const here = /^(c\/|customs$|all$|search$)/.test(state.where || "") && state.list.length ? state.list : CARDS;
    const pool = here;
    if (!pool.length) return null;
    let c;
    for (let n = 0; n < 6; n++) { c = pool[Math.floor(Math.random() * pool.length)]; if (c.i !== lastRandom || pool.length === 1) break; }
    lastRandom = c.i; return c;
  }
  function roll(el) { if (!el || calm.matches) return; el.classList.remove("roll"); void el.offsetWidth; el.classList.add("roll"); }
  $("#v-pick").addEventListener("click", () => { const c = V.list[V.k]; if (c && togglePick(c)) showCard(); });
  pickCount();
  let vSwap = false;
  // The dice sits in the site bar, which stays above the card viewer, so it never moves. With a card open it deals another.
  $("#dice").addEventListener("click", () => {
    if (!CARDS || !CARDS.length) return;
    const c = randomCard(); if (!c) return;
    roll($("#mb-dice")); roll($("#dice"));
    if (!$("#viewer").hidden) {
      // Smooth swap: fade the card out, get the next one fully decoded (both sides when shown side by side), switch while
      // it's invisible, then fade in. No half-loaded preview, no flip, no flash.
      if (vSwap) return; vSwap = true;
      const st = $("#v-stage"), wait = [ready(c.id, c.rk)];
      if (wide.matches && c.backId) wait.push(ready(c.backId, c.backRk));
      st.classList.add("swap");
      Promise.all([Promise.race([Promise.all(wait.map((p) => p.catch(() => {}))), new Promise((r) => setTimeout(r, 1500))]), new Promise((r) => setTimeout(r, calm.matches ? 0 : 150))]).then(() => {
        V.list = [c]; V.k = 0; V.back = false; V.zoom = false; V.random = true; showCard();
        requestAnimationFrame(() => requestAnimationFrame(() => { st.classList.remove("swap"); vSwap = false; }));
      });
      return;
    }
    setTimeout(() => openViewer(0, [c], true), calm.matches ? 0 : 260);
  });

  /* ---------- Boot ---------- */
  // The live Gordon and Dye numbers from the Inventory Stats master (published by the robot) load alongside the cards.
  const statsReady = fetch("data/lists/inventory-stats.json").then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => (INV = (d && d.tables) || {}));
  if (window.CATALOG) statsReady.then(() => load(window.CATALOG));
  else Promise.all([fetch("data/catalog.json").then((r) => r.json()), statsReady]).then(([cat]) => load(cat))
    .catch(() => ($("#app").innerHTML = `<p class="empty">The card list didn't load. Refresh the page to try again.</p>`));
})();

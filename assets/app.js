/* IanBadeer.com — reads data/catalog.json (built from the Google Drive folders) and renders the gallery. */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => n.toLocaleString("en-US");

  // Image URLs straight from Google Drive. A page can override this (used by the offline preview).
  const img = window.IMG_SRC || ((id, rk, w) => `https://lh3.googleusercontent.com/d/${id}=w${w}${rk ? `?resourcekey=${rk}` : ""}`);
  const driveUrl = (id, rk) => `https://drive.google.com/file/d/${id}/view${rk ? `?resourcekey=${rk}` : ""}`;

  let DATA, CARDS, SECTIONS, NEW_CUTOFF;

  /* ---------- File-name parsing ---------- */
  const RX = {
    main: /^(\d{4}(?:-\d{2})?)\s+(.*?)\s+#(\S+)\s+(.*)$/,
    serial: /#'?d\s*(?:to\s*)?(\d+)\s*(?:of\s*(\d+))?|print run of\s*(\d+)|\b(\d+)\s+of\s+(\d+)\b/i,
    grade: /\b(PSA|BGS|SGC|CGC|BVG|HGA)\b(?:\s+(?:DNA|GEM MT|GEM MINT|MINT|NM-MT|AUTH(?:ENTIC)?))*(?:\s+(\d+(?:\.\d)?))?/i,
    auto: /\b(auto(?:graph)?s?|autographed|signed|signatures?|sigs?|ink)\b/i,
    relic: /\b(relics?|patch(?:es)?|jerseys?|bat|materials?|buttons?|nameplates?|dirt|swatch|game[- ]used|threads|glove|logo(?:man)?|laundry|tag|letter|memorabilia|rpm|jumbo)\b/i,
    custom: /\bcustom\b/i,
    rc: /\b(RC|rookie)\b/i,
  };
  function parse(name) {
    const out = { title: name, sub: "", par: "", year: 9999, serial: 0, one: false, grade: "", tags: new Set() };
    const y = name.match(/^(\d{4})/); if (y) out.year = +y[1];
    const s = name.match(RX.serial);
    if (s) {
      const a = +(s[1] || s[3] || s[4] || 0), b = +(s[2] || s[5] || 0);
      out.serial = b || a; out.one = (b ? b === 1 : a === 1) || /\b1\s*of\s*1\b|1\/1/i.test(name);
    }
    const g = name.match(RX.grade); if (g) out.grade = (g[1].toUpperCase() + (g[2] ? " " + g[2] : "")).trim();
    if (RX.auto.test(name)) out.tags.add("auto");
    if (RX.relic.test(name)) out.tags.add("relic");
    if (RX.custom.test(name)) out.tags.add("custom");
    if (RX.rc.test(name)) out.tags.add("rc");
    if (out.serial) out.tags.add("numbered");
    if (out.one) out.tags.add("one");
    if (out.grade) out.tags.add("graded");
    const m = name.match(RX.main);
    if (m) {
      let [, yr, set, num, rest] = m;
      let par = "";
      const dash = set.indexOf(" - ");
      if (dash > 0) { par = set.slice(dash + 3); set = set.slice(0, dash); }
      let player = rest.replace(RX.serial, "").replace(RX.grade, "").replace(/\((?:[^)]*)\)/g, "").replace(/\s+(Back|2nd|3rd|\d)$/i, "").replace(/\s{2,}/g, " ").trim();
      out.title = player || rest; out.sub = `${yr} ${set} #${num}`; out.par = par;
    }
    return out;
  }

  /* ---------- Data ---------- */
  function load(json) {
    DATA = json; SECTIONS = json.sections;
    CARDS = json.cards.map((c, i) => {
      const [id, rk, name, si, gi, added, backId, backRk] = c;
      const p = parse(name);
      if (backId) p.tags.add("back");
      return { i, id, rk, name, si, gi, added, backId, backRk, ...p, hay: (name + " " + SECTIONS[si].title + " " + SECTIONS[si].groups[gi].label).toLowerCase() };
    });
    const dates = [...new Set(CARDS.map((c) => c.added))].sort().reverse();
    NEW_CUTOFF = dates[Math.min(dates.length - 1, 1)] || ""; // cards from the two most recent "drops" count as new
    const d30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    if (NEW_CUTOFF < d30) NEW_CUTOFF = dates[0];
    $("#q").placeholder = `Search ${fmt(CARDS.length)} cards… try “Triple Threads”`;
    renderNav(); renderFoot(); route();
  }

  /* ---------- Shared bits ---------- */
  const FILTERS = [["auto", "Autographs"], ["relic", "Relics & patches"], ["numbered", "Numbered"], ["one", "1 of 1"], ["graded", "Graded"], ["rc", "Rookies"], ["custom", "Customs"], ["back", "Has back scan"]];
  const SORTS = [["new", "Newest added"], ["old", "Year: oldest first"], ["recent", "Year: newest first"], ["az", "A–Z"], ["serial", "Lowest print run"]];
  const state = { filters: new Set(), sort: "new", list: [], shown: 0, q: "", where: null };

  function sortList(list, how) {
    const by = {
      new: (a, b) => (b.added > a.added ? 1 : b.added < a.added ? -1 : a.i - b.i),
      old: (a, b) => a.year - b.year || a.i - b.i,
      recent: (a, b) => (b.year === 9999 ? 0 : b.year) - (a.year === 9999 ? 0 : a.year) || a.i - b.i,
      az: (a, b) => a.name.localeCompare(b.name),
      serial: (a, b) => (a.serial || 1e9) - (b.serial || 1e9) || a.i - b.i,
    }[how];
    return list.slice().sort(by);
  }
  function hl(text, q) {
    const t = esc(text); if (!q) return t;
    const words = q.split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return words.length ? t.replace(new RegExp(`(${words.map(esc).join("|")})`, "gi"), "<mark>$1</mark>") : t;
  }
  function badges(c) {
    let b = "";
    if (c.added >= NEW_CUTOFF) b += `<span class="bd new">NEW</span>`;
    if (c.one) b += `<span class="bd one">1/1</span>`; else if (c.serial) b += `<span class="bd">/${c.serial}</span>`;
    if (c.tags.has("auto")) b += `<span class="bd auto">AUTO</span>`;
    if (c.grade) b += `<span class="bd">${esc(c.grade)}</span>`;
    if (c.backId) b += `<span class="bd back" title="Front and back">⇆</span>`;
    return b;
  }
  function cardHTML(c, q) {
    return `<button class="cd" type="button" data-i="${c.i}" aria-label="${esc(c.name)}">
      <div class="ph"><img loading="lazy" decoding="async" alt="" src="${img(c.id, c.rk, 400)}" onload="this.classList.add('ok')"><div class="badges">${badges(c)}</div></div>
      <div class="cap"><b>${hl(c.title, q)}</b>${hl(c.sub, q)}${c.par ? `<br><span class="par">${hl(c.par, q)}</span>` : ""}</div></button>`;
  }
  function sectionCards(si) { return CARDS.filter((c) => c.si === si); }
  function search(list, q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? list.filter((c) => words.every((w) => c.hay.includes(w))) : list;
  }

  /* ---------- Views ---------- */
  function renderNav() {
    $("#nav").innerHTML = SECTIONS.map((s) => `<a href="#/c/${s.slug}" data-s="${s.slug}">${esc(s.title)}</a>`).join("") + `<a href="#/customs" data-s="customs">Customs</a>`;
  }
  function renderFoot() {
    const s = DATA.site;
    $("#foot").innerHTML = `<div class="wrap"><span>Trades, questions, or a card I need? Email <span class="email">${esc(s.email)}</span></span><span>${fmt(CARDS.length)} scans · updated ${esc(DATA.generated.slice(0, 10))}</span></div>`;
  }
  function setNav(slug) {
    document.querySelectorAll("#nav a").forEach((a) => (a.dataset.s === slug ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  }

  function home() {
    setNav(null);
    const s = DATA.site;
    const feat = CARDS.find((c) => s.featured && c.name.includes(s.featured.match)) || CARDS.find((c) => c.one);
    const newest = sortList(CARDS, "new").slice(0, 12);
    const autos = CARDS.filter((c) => c.tags.has("auto")).length, ones = CARDS.filter((c) => c.one).length;
    const tiles = SECTIONS.map((sec, si) => {
      const list = sectionCards(si);
      const pick = [...list.filter((c) => c.one || c.tags.has("relic")), ...list].filter((c, k, a) => a.indexOf(c) === k);
      const step = Math.max(1, Math.floor(pick.length / 4));
      const four = [0, 1, 2, 3].map((k) => pick[k * step]).filter(Boolean);
      return `<a class="tile c-${sec.color}" href="#/c/${sec.slug}">
        <div class="fan">${four.map((c) => `<img loading="lazy" alt="" src="${img(c.id, c.rk, 240)}">`).join("")}</div>
        <h3>${esc(sec.title)}</h3>
        ${sec.progress ? `<div class="bar"><i style="width:${sec.progress}%"></i></div>` : ""}
        <div class="tm"><span>${fmt(list.length)} cards</span><span>${sec.progress ? sec.progress + "% complete" : sec.groups.length > 1 ? sec.groups.length + " groups" : ""}</span></div></a>`;
    }).join("");
    $("#app").innerHTML = `<div class="wrap">
      <section class="hero">
        <div>
          <div class="kick">The collection of Ian Badeer</div>
          <h1>Alex Gordon & Jermaine Dye <em>super collector</em></h1>
          <p>${esc(s.intro)}</p>
          <div class="pills">${s.links.map((l) => `<a class="pill" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join("")}</div>
        </div>
        ${feat ? `<button class="feat cd" type="button" data-i="${feat.i}"><div class="ph"><img alt="${esc(feat.name)}" src="${img(feat.id, feat.rk, 800)}" onload="this.classList.add('ok')"></div><small>${esc(s.featured?.caption || feat.name)}</small></button>` : ""}
      </section>
      <section class="stats" aria-label="Collection stats">
        <div class="stat"><b>${fmt(CARDS.length)}</b><span>cards scanned</span></div>
        <div class="stat"><b>${fmt(autos)}</b><span>autographs</span></div>
        <div class="stat"><b>${fmt(ones)}</b><span>one-of-ones</span></div>
        ${SECTIONS.filter((x) => x.progress).map((x) => `<div class="stat"><b>${x.progress}%</b><span>${esc(x.title)}</span></div>`).join("")}
      </section>
      <div class="sec-h"><h2>Collections</h2></div>
      <section class="tiles">${tiles}</section>
      <div class="sec-h"><h2>Newest additions</h2><a href="#/all">Browse everything →</a></div>
      <section class="grid small" style="margin-bottom:64px">${newest.map((c) => cardHTML(c)).join("")}</section>
    </div>`;
    state.list = newest;
  }

  function collection(slug, gslug) {
    const virtual = slug === "customs" || slug === "all" || slug === "search";
    const si = SECTIONS.findIndex((x) => x.slug === slug);
    const sec = virtual ? null : SECTIONS[si];
    if (!virtual && !sec) return notFound();
    setNav(slug);
    let base, title, kick, blurb = "", groups = [], gi = -1, color = "royal", prog = "";
    if (sec) {
      base = sectionCards(si); title = sec.title; color = sec.color; blurb = sec.blurb || "";
      kick = { pc: "Player collection", chase: "Autograph chase", team: "Team collection", want: "Still hunting" }[sec.kind] || "Collection";
      groups = sec.groups;
      gi = groups.findIndex((g) => g.slug === gslug);
      if (gi >= 0) base = base.filter((c) => c.gi === gi);
      if (sec.progress) prog = `<div class="prog"><b>${sec.progress}%</b><div class="bar"><i style="width:${sec.progress}%"></i></div><small>${esc(sec.progressLabel || "complete")}</small></div>`;
      blurb = esc(blurb) + (sec.extraLinks || []).map((l) => ` <a href="${esc(l.url)}" target="_blank" rel="noopener" style="color:var(--acc)">${esc(l.label)} ↗</a>`).join(" ·");
    } else if (slug === "customs") {
      base = CARDS.filter((c) => c.tags.has("custom")); title = "Custom Cards"; kick = "Made by hand"; color = "gold";
      blurb = "Custom cards are a labor of love. I make mini cardboard treasures for myself, for friends, and as keepsakes for the athletes themselves.";
    } else {
      base = CARDS; title = state.q ? `Results for “${esc(state.q)}”` : "Every card"; kick = "Whole collection";
    }
    const side = groups.length > 1 ? `<div><h4>${esc(sec.title)}</h4><ul>
        <li><a href="#/c/${slug}" aria-current="${gi < 0}"><em style="font-style:normal">All</em><span>${fmt(sectionCards(si).length)}</span></a></li>
        ${groups.map((g, k) => `<li><a href="#/c/${slug}/${g.slug}" aria-current="${k === gi}">${esc(g.label)}<span>${fmt(g.count)}</span></a></li>`).join("")}</ul></div>` : "";
    const others = `<div><h4>Collections</h4><ul>${SECTIONS.map((x) => `<li><a href="#/c/${x.slug}" aria-current="${x.slug === slug}">${esc(x.title)}<span>${fmt(sectionCards(SECTIONS.indexOf(x)).length)}</span></a></li>`).join("")}
        <li><a href="#/customs" aria-current="${slug === "customs"}">Customs<span>${fmt(CARDS.filter((c) => c.tags.has("custom")).length)}</span></a></li></ul></div>`;
    const mg = groups.length > 1 ? `<nav class="mgroups" aria-label="Groups"><a href="#/c/${slug}" aria-current="${gi < 0}">All</a>${groups.map((g, k) => `<a href="#/c/${slug}/${g.slug}" aria-current="${k === gi}">${esc(g.label)}</a>`).join("")}</nav>` : "";
    $("#app").innerHTML = `<div class="wrap coll c-${color}">
      <aside class="side">${side}${others}</aside>
      <div style="min-width:0">
        <div class="c-head"><div class="kick">${kick}${gi >= 0 ? " · " + esc(groups[gi].label) : ""}</div><h1>${title}</h1>${blurb ? `<p>${blurb}</p>` : ""}${prog}</div>
        ${mg}
        <div class="tools">
          <div class="chips" role="group" aria-label="Filters">${FILTERS.map(([k, l]) => `<button type="button" class="chip" data-f="${k}" aria-pressed="${state.filters.has(k)}">${l}</button>`).join("")}</div>
          <div class="tools-r"><span class="count" id="count"></span><label class="sr" for="sort">Sort</label><select id="sort">${SORTS.map(([k, l]) => `<option value="${k}"${state.sort === k ? " selected" : ""}>${l}</option>`).join("")}</select></div>
        </div>
        <div class="grid" id="grid"></div><div class="sentinel" id="sentinel"></div>
      </div></div>`;
    const apply = () => {
      let list = search(base, state.q);
      state.filters.forEach((f) => (list = list.filter((c) => c.tags.has(f))));
      state.list = sortList(list, state.sort); state.shown = 0;
      $("#grid").innerHTML = state.list.length ? "" : `<p class="empty">No cards match. Try removing a filter or a search word.</p>`;
      $("#count").textContent = `${fmt(state.list.length)} card${state.list.length === 1 ? "" : "s"}`;
      more();
    };
    $(".chips").addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      state.filters.has(b.dataset.f) ? state.filters.delete(b.dataset.f) : state.filters.add(b.dataset.f);
      b.setAttribute("aria-pressed", state.filters.has(b.dataset.f)); apply();
    });
    $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; apply(); });
    apply();
    io.observe($("#sentinel"));
  }
  function more() {
    const grid = $("#grid"); if (!grid) return;
    const next = state.list.slice(state.shown, state.shown + 72);
    grid.insertAdjacentHTML("beforeend", next.map((c) => cardHTML(c, state.q)).join(""));
    state.shown += next.length;
  }
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && state.shown < state.list.length && more()), { rootMargin: "1200px" });

  function notFound() { $("#app").innerHTML = `<p class="empty">That page doesn't exist. <a href="#/">Go home</a></p>`; }

  /* ---------- Router ---------- */
  function route() {
    closeViewer(true);
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, "")).split("/");
    const [a, b, c] = h;
    const key = a === "c" ? "c/" + b : a;
    if (key !== state.where) { state.filters.clear(); state.where = key; }
    if (a !== "search") { state.q = ""; $("#q").value = ""; }
    if (!a) home();
    else if (a === "c") collection(b, c);
    else if (a === "customs") collection("customs");
    else if (a === "all") collection("all");
    else if (a === "search") { state.q = h.slice(1).join("/"); $("#q").value = state.q; collection("search"); }
    else if (a === "card") { home(); const k = CARDS.findIndex((x) => x.id === b); if (k >= 0) openViewer(k, [CARDS[k]]); }
    else notFound();
    if (a !== "card") window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  /* ---------- Search box ---------- */
  let t;
  $("#q").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      const q = e.target.value.trim();
      if (q) history.replaceState(null, "", "#/search/" + encodeURIComponent(q)), (state.q = q), collection("search");
      else location.hash = "#/";
    }, 160);
  });
  $("#search-form").addEventListener("submit", (e) => e.preventDefault());
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== $("#q") && $("#viewer").hidden) { e.preventDefault(); $("#q").focus(); }
  });

  /* ---------- Viewer ---------- */
  const V = { list: [], k: 0, back: false };
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".cd[data-i]"); if (!b) return;
    const i = +b.dataset.i, list = state.list.length && state.list.some((c) => c.i === i) ? state.list : [CARDS[i]];
    openViewer(list.findIndex((c) => c.i === i), list);
  });
  // Desktop shows a card's front and back side by side; phones flip between them with a tap.
  const wide = window.matchMedia("(min-width: 900px)");
  function openViewer(k, list) {
    V.list = list; V.k = k; V.back = false; V.zoom = false;
    $("#viewer").hidden = false; document.body.style.overflow = "hidden"; showCard(); $("#v-close").focus();
  }
  function closeViewer(silent) {
    if ($("#viewer").hidden) return;
    $("#viewer").hidden = true; document.body.style.overflow = ""; $("#v-stage").classList.remove("zoom", "pair");
    if (!silent && location.hash.startsWith("#/card/")) history.back();
  }
  function loadInto(el, c, id, rk, alt) {
    el.src = img(id, rk, 400); el.alt = alt;
    const big = new Image(); big.onload = () => { if (V.list[V.k] === c && el.dataset.id === id) el.src = big.src; };
    el.dataset.id = id; big.src = img(id, rk, 1600);
  }
  const isPair = (c) => wide.matches && !!c.backId && !V.zoom;
  function showCard() {
    const c = V.list[V.k]; if (!c) return;
    const pair = isPair(c), stage = $("#v-stage"), im = $("#v-img"), im2 = $("#v-img2");
    const back = !pair && V.back;
    const id = back ? c.backId : c.id, rk = back ? c.backRk : c.rk;
    loadInto(im, c, id, rk, c.name + (back ? " (back)" : ""));
    im2.hidden = !pair;
    if (pair) loadInto(im2, c, c.backId, c.backRk, c.name + " (back)");
    stage.classList.toggle("pair", pair);
    stage.classList.toggle("zoom", V.zoom);
    $("#v-title").innerHTML = `${esc(c.title)}<small>${esc(c.sub || "")}${c.par ? " · " + esc(c.par) : ""}</small>`;
    $("#v-flip").hidden = !c.backId || pair; $("#v-flip").textContent = V.back ? "Show front" : "Show back";
    $("#v-drive").href = driveUrl(id, rk);
    $("#v-drive").textContent = pair ? "Front full-res ↗" : "Full-res in Drive ↗";
    $("#v-drive2").hidden = !pair;
    if (pair) $("#v-drive2").href = driveUrl(c.backId, c.backRk);
    const sec = SECTIONS[c.si];
    $("#v-meta").innerHTML = `${badges(c)}<span>${esc(sec.title)} · ${esc(sec.groups[c.gi].label)}</span><span>·</span><span>${V.k + 1} of ${fmt(V.list.length)}</span><span>·</span><span style="font-family:var(--f-m)">${esc(c.name)}</span>`;
    $("#v-prev").style.visibility = V.k > 0 ? "visible" : "hidden";
    $("#v-next").style.visibility = V.k < V.list.length - 1 ? "visible" : "hidden";
  }
  const step = (d) => { const n = V.k + d; if (n >= 0 && n < V.list.length) { V.k = n; V.back = false; V.zoom = false; showCard(); } };
  $("#v-prev").onclick = () => step(-1); $("#v-next").onclick = () => step(1);
  $("#v-close").onclick = () => closeViewer();
  $("#v-flip").onclick = () => { V.back = !V.back; V.zoom = false; showCard(); };
  // Click an image: on desktop, zoom into that side (click again to go back);
  // on a phone, a card with a back flips, and one without zooms.
  function imageClick(side) {
    const c = V.list[V.k];
    if (!wide.matches && c.backId) { V.back = !V.back; V.zoom = false; }
    else if (V.zoom) V.zoom = false;
    else { V.zoom = true; if (c.backId) V.back = side === "back"; }
    showCard();
  }
  $("#v-img").onclick = () => imageClick(isPair(V.list[V.k]) ? "front" : V.back ? "back" : "front");
  $("#v-img2").onclick = () => imageClick("back");
  wide.addEventListener("change", () => { if (!$("#viewer").hidden) { V.zoom = false; showCard(); } });
  $("#v-copy").onclick = async () => {
    const c = V.list[V.k], url = location.href.split("#")[0] + "#/card/" + c.id;
    try { await navigator.clipboard.writeText(url); $("#v-copy").textContent = "Link copied"; }
    catch { $("#v-copy").textContent = "Copy failed"; }
    setTimeout(() => ($("#v-copy").textContent = "Copy link"), 1600);
  };
  document.addEventListener("keydown", (e) => {
    if ($("#viewer").hidden) return;
    if (e.key === "Escape") closeViewer(); else if (e.key === "ArrowLeft") step(-1); else if (e.key === "ArrowRight") step(1);
    else if (e.key.toLowerCase() === "f" && !$("#v-flip").hidden) $("#v-flip").click();
  });
  let tx = null;
  $("#v-stage").addEventListener("touchstart", (e) => (tx = e.touches[0].clientX), { passive: true });
  $("#v-stage").addEventListener("touchend", (e) => { if (tx == null) return; const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1); tx = null; });
  $("#viewer").addEventListener("click", (e) => { if (e.target.id === "v-stage" || e.target.id === "viewer") closeViewer(); });

  /* ---------- Boot ---------- */
  if (window.CATALOG) load(window.CATALOG);
  else fetch("data/catalog.json").then((r) => r.json()).then(load).catch(() => ($("#app").innerHTML = `<p class="empty">The card list didn't load. Refresh the page to try again.</p>`));
})();

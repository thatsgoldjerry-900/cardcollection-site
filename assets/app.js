/* IanBadeer.com — reads data/catalog.json (built from the Google Drive folders) and renders the gallery. */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => n.toLocaleString("en-US");

  // Image URLs straight from Google Drive. A page can override this (used by the offline preview).
  const img = window.IMG_SRC || ((id, rk, w) => `https://lh3.googleusercontent.com/d/${id}=w${w}${rk ? `?resourcekey=${rk}` : ""}`);

  let DATA, CARDS, SECTIONS, NEW_CUTOFF;
  let PHOTOS = [], INV = {};

  /* ---------- File-name parsing ---------- */
  const RX = {
    main: /^(\d{4}(?:-\d{2})?)\s+(.*?)\s+#(\S+)\s+(.*)$/,
    serial: /#'?d\s*(?:to\s*)?(\d+)\s*(?:of\s*(\d+))?|print run of\s*(\d+)|\b(\d+)\s+of\s+(\d+)\b/i,
    grade: /\b(PSA|BGS|SGC|CGC|BVG|HGA)\b(?:\s+(?:DNA|GEM MT|GEM MINT|MINT|NM-MT|AUTH(?:ENTIC)?))*(?:\s+(\d+(?:\.\d)?))?/i,
    auto: /\b(auto(?:graph)?s?|autographed|signed|signatures?|sigs?|ink)\b/i,
    relic: /\b(fabrics?|ball hoggs|souvenirs|leather and laces|piece of action|threads|swatch(?:es)?|towels?|laces|socks?|cleats?|relics?|patch(?:es)?|jerseys?|bat|materials?|buttons?|nameplates?|dirt|game[- ]used|glove|logoman|laundry|tag|letter|memorabilia|rpm|footballs)\b/i,
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

  // A landscape card (e.g. a horizontal patch auto) gets a landscape frame instead of a tall, mostly empty one.
  window.fitFrame = (im) => { im.classList.add("ok"); if (im.naturalWidth > im.naturalHeight * 1.1) im.parentNode.classList.add("land"); };

  /* ---------- Data ---------- */
  function load(json) {
    DATA = json; SECTIONS = json.sections;
    CARDS = json.cards.map((c, i) => {
      const [id, rk, name, si, gi, added, backId, backRk] = c;
      const p = parse(name);
      if (backId) p.tags.add("back");
      // Hand corrections from config/site.json "tagFixes", e.g. {"auto": {"add": [card names], "remove": [card names]}}.
      for (const [tag, fix] of Object.entries(json.site.tagFixes || {})) {
        if ((fix.add || []).includes(name)) p.tags.add(tag);
        if ((fix.remove || []).includes(name)) p.tags.delete(tag);
      }
      return { i, id, rk, name, si, gi, added, backId, backRk, ...p, hay: (name + " " + SECTIONS[si].title + " " + SECTIONS[si].groups[gi].label).toLowerCase() };
    });
    // Photos of athletes with my custom cards. The file name is the caption; the part before the first
    // " - " or sentence break is the short label on the strip ("Jr." and similar don't count as a break).
    const caps = (json.site.customsPhotos || {}).captions || {};
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
  function sectionCards(si) { return CARDS.filter((c) => c.si === si); }
  // A section with no scans yet (e.g. a new folder still being filled) stays out of menus and tiles.
  function shown(s) { const si = SECTIONS.indexOf(s); return CARDS.some((c) => c.si === si); }
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
  function fixQuery(q, vocab, known) {
    let changed = false;
    const out = q.toLowerCase().split(/\s+/).filter(Boolean).map((w) => {
      if (w.length < 4 || /\d/.test(w) || known(w)) return w;
      const max = w.length >= 8 ? 2 : 1;
      let best = null, bd = max + 1, bn = 0;
      vocab.forEach((n, t) => { const d = typoDist(w, t, max); if (d <= max && (d < bd || (d === bd && n > bn))) { best = t; bd = d; bn = n; } });
      if (best) { changed = true; return best; }
      return w;
    });
    return changed ? out.join(" ") : null;
  }
  function search(list, q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? list.filter((c) => words.every((w) => c.hay.includes(w))) : list;
  }

  /* ---------- Views ---------- */
  // One order everywhere (home tiles, sidebar): Gordon, Dye, the Nebraska sections, Customs,
  // the other collections, Detroit Lions last. "customs" stands for the Customs page.
  const LAST = ["lions"];
  function siteOrder() {
    const secs = SECTIONS.filter(shown), other = secs.filter((s) => !isNeb(s));
    const lead = other.filter((s) => !LAST.includes(s.slug)).slice(0, 2);
    return [...lead, ...secs.filter(isNeb), "customs", ...other.filter((s) => !lead.includes(s) && !LAST.includes(s.slug)), ...other.filter((s) => LAST.includes(s.slug))];
  }
  // Nebraska sections and the Husker autograph pages share one "Nebraska Cornhuskers" dropdown.
  const isNeb = (s) => /^husker-/.test(s.slug);
  function renderNav() {
    const neb = SECTIONS.filter((s) => shown(s) && isNeb(s));
    // Menu order: Alex Gordon, Jermaine Dye, Nebraska Cornhuskers ▾, Customs, the other collections, Detroit Lions last.
    const links = siteOrder().filter((s) => s === "customs" || !isNeb(s))
      .map((s) => s === "customs" ? `<a href="#/customs" data-s="customs">Customs</a>` : `<a href="#/c/${s.slug}" data-s="${s.slug}">${esc(s.title)}</a>`);
    if ((DATA.site.media?.items || []).length) links.push(`<a href="#/media" data-s="media">Media</a>`);
    links.splice(2, 0, `<button type="button" class="dd-btn" id="dd-btn" aria-expanded="false" aria-controls="dd-menu">Nebraska Cornhuskers <span aria-hidden="true">▾</span></button>`);
    $("#nav").innerHTML = links.join("");
    document.body.insertAdjacentHTML("beforeend", `<div class="dd-menu" id="dd-menu" hidden>${neb.map((s) => `<a href="#/c/${s.slug}" data-s="${s.slug}">${esc(s.title)}</a>`).join("")}</div>`);
    $("#dd-btn").addEventListener("click", (e) => { e.stopPropagation(); $("#dd-menu").hidden ? openDD() : closeDD(); });
    // The autograph pages appear once the checklist data has been published.
    fetch("data/lists/husker-pros.json", { method: "HEAD" }).then((r) => {
      if (!r.ok || $('#dd-menu a[href="#/checklist"]')) return;
      $("#dd-menu").insertAdjacentHTML("beforeend", `${CK_PAGES.map((x, k) => `<a href="#/checklist${x.path}" data-s="checklist${x.path}"${k === 0 ? ' class="sep"' : ""}>${x.label}</a>`).join("")}
        <a href="#/nfl-huskers" data-s="nfl-huskers" class="sep">NFL Huskers Player Pages</a>`);
      setNav(NAV_NOW);
    }).catch(() => {});
  }
  function openDD() {
    const b = $("#dd-btn").getBoundingClientRect(), m = $("#dd-menu");
    m.hidden = false;
    const w = m.offsetWidth;
    m.style.top = b.bottom + 6 + "px";
    m.style.left = Math.max(12, Math.min(b.left, innerWidth - w - 12)) + "px";
    $("#dd-btn").setAttribute("aria-expanded", "true");
  }
  function closeDD() {
    const m = $("#dd-menu"); if (!m || m.hidden) return;
    m.hidden = true; $("#dd-btn").setAttribute("aria-expanded", "false");
  }
  document.addEventListener("click", (e) => { if (!e.target.closest("#dd-menu")) closeDD(); else if (e.target.closest("a")) closeDD(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#dd-menu") && !$("#dd-menu").hidden) { closeDD(); $("#dd-btn").focus(); } });
  addEventListener("scroll", closeDD, { passive: true }); addEventListener("resize", closeDD);
  $("#nav").addEventListener("scroll", closeDD, { passive: true });
  function renderFoot() {
    const s = DATA.site;
    $("#foot").innerHTML = `<div class="wrap"><span>Trades, questions, or a card I need? ${gform() ? `<button type="button" class="linkish" data-form data-item="" data-body="">Send me a message</button> · ` : ""}<button type="button" class="linkish" data-mail data-subject="Hello from IanBadeer.com">Email me</button> · <button type="button" class="linkish" data-copymail>Copy my address</button></span><span>${fmt(CARDS.length)} scans · updated ${esc(DATA.generated.slice(0, 10))} · All scans © Ian Badeer. Please ask before reusing them.</span></div>`;
  }
  // Each page gets its own browser-tab title, so tabs, bookmarks and shared links say where they go.
  function setTitle(t) { document.title = t ? `${t} · IanBadeer.com` : "IanBadeer.com"; }
  let NAV_NOW = null;
  function setNav(slug) {
    NAV_NOW = slug;
    document.querySelectorAll("#nav a, #dd-menu a").forEach((a) => (a.dataset.s === slug ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    const dd = $("#dd-btn"); if (dd) dd.classList.toggle("on", !!$("#dd-menu a[aria-current]"));
  }

  /* ---------- Contact: my address is only put together when someone clicks, so scrapers can't read it ---------- */
  const myEmail = () => { const c = DATA.site.contact || {}; try { return c.code ? atob(c.code).split("").reverse().join("") : ""; } catch (e) { return ""; } };
  // An email button (opens the visitor's mail app with the subject and message filled in), plus a fallback
  // for people without a mail app: copy my address, or the Google Form when one is set up.
  // A Google Form, filled in from a form on this page, delivers messages to me (config: contact.googleForm =
  // {"id": "<form id from its link>", "fields": {"name": "entry…", "email": "entry…", "item": "entry…", "message": "entry…"}}).
  const gform = () => { const g = (DATA.site.contact || {}).googleForm || {}; return g.id && g.fields && g.fields.email && g.fields.message ? g : null; };
  // A contact button: opens the form on this page when it's set up, otherwise the visitor's email app.
  // Underneath, the other ways to reach me.
  function contactHTML(label, subject, body, item) {
    const data = `data-subject="${esc(subject)}" data-body="${esc(body)}" data-item="${esc(item || "")}"`;
    if (gform()) return `<div class="cta"><button type="button" class="btn have-btn" data-form ${data}>✉ ${esc(label)}</button>
      <small class="cta-alt">Prefer email? <button type="button" class="linkish" data-mail ${data}>Email me</button> · <button type="button" class="linkish" data-copymail>Copy my address</button></small></div>`;
    return `<div class="cta"><button type="button" class="btn have-btn" data-mail ${data}>✉ ${esc(label)}</button>
      <small class="cta-alt">No email app? <button type="button" class="linkish" data-copymail>Copy my address</button></small></div>`;
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

  function home() {
    setNav(null); setTitle("");
    const s = DATA.site;
    const feat = CARDS.find((c) => s.featured && c.name.includes(s.featured.match)) || CARDS.find((c) => c.one);
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
        <div class="tm"><span>${fmt(list.length)} cards</span><span>${sec.progress ? pctText(sec) + " complete" : sec.groups.length > 1 ? sec.groups.length + " groups" : ""}</span></div></a>`;
    }).join("");
    function customsTile() {   // Customs isn't a Drive section (cards are tagged custom), so it gets its own tile
      const list = CARDS.filter((c) => c.tags.has("custom")); if (!list.length) return "";
      const step = Math.max(1, Math.floor(list.length / 4)), four = [0, 1, 2, 3].map((k) => list[k * step]).filter(Boolean);
      return `<a class="tile c-gold" href="#/customs"><div class="fan">${four.map((c) => `<img loading="lazy" alt="" src="${img(c.id, c.rk, 240)}">`).join("")}</div>
        <h3>Custom Cards</h3><div class="tm"><span>${fmt(list.length)} cards</span><span>${PHOTOS.length ? PHOTOS.length + " photos with players" : ""}</span></div></a>`;
    }
    $("#app").innerHTML = `<div class="wrap">
      <section class="hero">
        <div>
          <div class="kick">The collection of Ian Badeer</div>
          <h1>Alex Gordon & Jermaine Dye <em>super collector</em></h1>
          <p>${esc(s.intro).replace("a Husker autograph I need", `<a class="inl" href="#/checklist">a Husker autograph I need</a>`)}</p>
          <div class="pills">${(() => { const f = (s.media?.items || []).find((it) => it.featured) || (s.media?.items || [])[0];
            return f ? `<a class="pill pill-feat" href="${esc(f.url)}" target="_blank" rel="noopener"><b>Featured:</b> ${esc(f.title)} ↗</a><a class="pill pill-in" href="#/media">All media &amp; interviews →</a>` : ""; })()}${s.links.map((l) => `<a class="pill" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join("")}</div>
        </div>
        ${feat ? `<button class="feat cd" type="button" data-i="${feat.i}"><div class="ph"><img alt="${esc(feat.name)}" src="${img(feat.id, feat.rk, 600)}" srcset="${img(feat.id, feat.rk, 400)} 400w, ${img(feat.id, feat.rk, 600)} 600w, ${img(feat.id, feat.rk, 800)} 800w" sizes="(max-width: 800px) 200px, 320px" onload="fitFrame(this)"></div><small>${esc(s.featured?.caption || feat.name)}</small></button>` : ""}
      </section>
      <section class="stats" aria-label="Collection stats">
        <div class="stat"><b>${fmt(CARDS.length)}</b><span>cards scanned</span></div>
        <div class="stat"><b>${fmt(ones)}</b><span>one-of-ones</span></div>
        ${SECTIONS.filter((x) => x.progress).map((x) => `<a class="stat link" href="#/c/${x.slug}"><b>${pctText(x)}</b><span>${esc(x.title)} Chase →</span></a>`).join("")}
        <a class="stat link" id="stat-nfl" href="#/checklist" hidden><b></b><span>NFL Husker Chase →</span></a>
      </section>
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
      el.querySelector("b").textContent = ((t.filter((p) => p.have).length / t.length) * 100).toFixed(2) + "%"; el.hidden = false;
    }).catch(() => {});
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
      if (sec.progress) prog = `<div class="prog"><b>${pctText(sec)}</b><div class="bar"><i style="width:${sec.progress}%"></i></div><small>${esc(sec.progressLabel || "complete")}</small></div>`;
      // Links to pages on this site open in place (→); outside links open a new tab (↗).
      blurb = esc(blurb) + (sec.extraLinks || []).map((l) => l.url.startsWith("#")
        ? ` <a href="${esc(l.url)}" style="color:var(--acc)">${esc(l.label)} →</a>`
        : ` <a href="${esc(l.url)}" target="_blank" rel="noopener" style="color:var(--acc)">${esc(l.label)} ↗</a>`).join(" ·");
    } else if (slug === "customs") {
      base = CARDS.filter((c) => c.tags.has("custom")); title = "Custom Cards"; kick = "Made by hand"; color = "gold";
      blurb = "Custom cards are a labor of love. I make mini cardboard treasures for myself, for friends, and as keepsakes for the athletes themselves.";
    } else {
      base = CARDS; title = state.q ? `Results for “${esc(state.q)}”` : "Every card"; kick = "Whole collection";
    }
    setTitle(slug === "search" ? `Search: ${state.q}` : slug === "all" ? "Every card" : (sec ? sec.title : title) + (gi >= 0 ? ` (${groups[gi].label})` : ""));
    const side = groups.length > 1 ? `<div><h4>${esc(sec.title)}</h4><ul>
        <li><a href="#/c/${slug}" aria-current="${gi < 0}"><em style="font-style:normal">All</em><span>${fmt(sectionCards(si).length)}</span></a></li>
        ${groups.map((g, k) => `<li><a href="#/c/${slug}/${g.slug}" aria-current="${k === gi}">${esc(g.label)}<span>${fmt(g.count)}</span></a></li>`).join("")}</ul></div>` : "";
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
        <div class="c-top${sec && invBox(sec.slug) ? " with-inv" : ""}"><div class="c-head"><div class="kick">${kick}${gi >= 0 ? " · " + esc(groups[gi].label) : ""}</div><h1>${title}</h1>${blurb ? `<p>${blurb}</p>` : ""}${prog}</div>${sec ? invBox(sec.slug) : ""}</div>
        ${mg}
        ${fixed ? `<p class="fixnote">Nothing matched “${esc(state.q)}”, so these are results for <b>${esc(fixed)}</b>.</p>` : ""}
        ${slug === "search" ? `<div id="pmatch"></div>` : ""}
        ${slug === "customs" ? withPlayers() : ""}
        <div class="tools">
          <div class="chips" role="group" aria-label="Filters">${FILTERS.map(([k, l]) => `<button type="button" class="chip" data-f="${k}" aria-pressed="${state.filters.has(k)}">${l}</button>`).join("")}</div>
          <div class="tools-r"><span class="count" id="count"></span><label class="sr" for="sort">Sort</label><select id="sort">${SORTS.map(([k, l]) => `<option value="${k}"${state.sort === k ? " selected" : ""}>${l}</option>`).join("")}</select></div>
        </div>
        <div class="grid" id="grid"></div><div class="sentinel" id="sentinel"></div>
      </div></div>`;
    const apply = () => {
      let list = search(base, q);
      state.filters.forEach((f) => (list = list.filter((c) => c.tags.has(f))));
      state.list = sortList(list, state.sort); state.shown = 0;
      $("#grid").innerHTML = state.list.length ? "" : `<p class="empty">${state.filters.size ? "No cards match. Try removing a filter or a search word." : `No cards match “${esc(state.q)}”. Try a player (Alex Gordon), a set (Triple Threads) or a year (2013).`}</p>`;
      $("#count").textContent = `${fmt(state.list.length)} card${state.list.length === 1 ? "" : "s"}`;
      more();
    };
    $(".chips").addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      state.filters.has(b.dataset.f) ? state.filters.delete(b.dataset.f) : state.filters.add(b.dataset.f);
      b.setAttribute("aria-pressed", state.filters.has(b.dataset.f)); apply(); syncURL();
    });
    $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; apply(); syncURL(); });
    apply();
    if (state.filters.size || state.sort !== "new") syncURL();
    io.observe($("#sentinel"));
    if (slug === "search") playerMatches(q, state.q);
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
      box.innerHTML = `<div class="pmatch"><h4>Player pages</h4><div class="pm-list">${hits.map((p) => {
        const sc = p.have ? bestScan(p.name, p.sport) : null;
        return `<a class="pm" href="#/player/${p.slug}"><span class="pm-ph">${sc ? `<img alt="" loading="lazy" src="${img(sc.id, sc.rk, 160)}" onload="this.classList.add('ok')">` : ""}</span>
          <span class="pm-t"><b>${hl(p.name, q)}</b><small>${p.league} Husker${p.year ? ` · Nebraska through ${esc(p.year)}` : ""}</small></span><span class="pm-go">→</span></a>`;
      }).join("")}</div></div>`;
    }).catch(() => {});
  }
  // Customs page: a slowly rotating strip of photos with the players, then the videos.
  function withPlayers() {
    const cfg = DATA.site.customsPhotos || {}, vids = (cfg.videos || []).filter((v) => v.id);
    const tile = (p, k) => `<button type="button" class="ph-tile" data-photo="${k}" aria-label="${esc(p.caption)}">
      <img loading="lazy" decoding="async" alt="" src="${img(p.id, p.rk, 700)}" onload="this.classList.add('ok')"><span><em>${esc(p.short)}</em></span></button>`;
    const strip = PHOTOS.length ? `<h2 class="sub-h">With the players</h2>
      <section class="mq photos" aria-label="Photos with the players"><div class="mq-track" style="--dur:${Math.max(40, PHOTOS.length * 9)}s">
        ${PHOTOS.map(tile).join("")}<div class="mq-dup" aria-hidden="true">${PHOTOS.map(tile).join("")}</div></div></section>` : "";
    const videos = vids.length ? `<div class="vids">${vids.map((v) => `<figure class="vid">
        <div class="vid-frame"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}${v.start ? `?start=${+v.start}` : ""}" title="${esc(v.caption || "Video")}" loading="lazy"
          referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>
        ${v.caption ? `<figcaption>${esc(v.caption)}</figcaption>` : ""}</figure>`).join("")}</div>` : "";
    return strip || videos ? `<div class="players">${strip}${videos}<h2 class="sub-h">The cards</h2></div>` : "";
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-photo]"); if (!b) return;
    openViewer(+b.dataset.photo, PHOTOS);
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
  const CK = { list: 0, q: "", show: "all" };
  const norm = (t) => String(t).toLowerCase().replace(/"[^"]*"/g, " ").replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  // A player's scans come only from their own sport's Nebraska section, so two Huskers with the
  // same name in different sports (e.g. Eric Johnson, football and basketball) never share cards.
  const scanIndex = {};
  const SPORT_OF_LIST = { "nfl-tier-1-huskers": "football", "nfl-tier-2-huskers": "football", "pro-football-huskers": "football", "baseball-mlb": "baseball", "basketball-nba": "basketball" };
  function scansFor(name, sport = "football") {
    if (!scanIndex[sport]) {
      const si = SECTIONS.findIndex((s) => s.slug === "husker-" + sport);
      scanIndex[sport] = si < 0 ? [] : CARDS.filter((c) => c.si === si).map((c) => [" " + norm(c.name) + " ", c]);
    }
    const n = norm(name); if (n.split(" ").length < 2) return [];
    return scanIndex[sport].filter(([t]) => t.includes(" " + n + " ")).map(([, c]) => c);
  }
  // One page per published list. #/checklist (no suffix) stays the NFL page so old links keep working.
  const CK_PAGES = [
    { path: "", slug: "nfl-tier-1-huskers", label: "NFL Tier 1 Huskers Autograph List", blurb: "One autograph of every Husker who played in at least one NFL game." },
    { path: "/tier-2", slug: "nfl-tier-2-huskers", label: "NFL Tier 2 Huskers Autograph List", blurb: "One autograph of every Husker who made an NFL active roster, preseason roster, injured reserve or practice squad without playing in a game." },
    { path: "/tier-3", slug: "pro-football-huskers", label: "NFL Tier 3 Huskers Autograph List", blurb: "One autograph of every Husker who was drafted by, went to camp with or tried out for an NFL team, or played in another pro league." },
    { path: "/mlb", slug: "baseball-mlb", label: "MLB Huskers Autograph List", blurb: "One autograph of every Husker who played in the major leagues." },
    { path: "/nba", slug: "basketball-nba", label: "NBA Huskers Autograph List", blurb: "One autograph of every Husker who played in the NBA." },
  ];
  function checklist(which) {
    const page = CK_PAGES.find((x) => x.path === (which ? "/" + which : "")) || CK_PAGES[0];
    setNav("checklist" + page.path); setTitle(page.label);
    if (!CHECK) {
      $("#app").innerHTML = `<p class="loading">Loading the checklist…</p>`;
      fetch("data/lists/husker-pros.json").then((r) => { if (!r.ok) throw 0; return r.json(); })
        .then((d) => { CHECK = d; checklist(which); })
        .catch(() => ($("#app").innerHTML = `<p class="empty">The checklist isn't available yet.</p>`));
      return;
    }
    CK.list = CHECK.lists.findIndex((x) => x.slug === page.slug);
    if (CK.list < 0) return ($("#app").innerHTML = `<p class="empty">This list isn't available yet.</p>`);
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
        .map((r) => scansFor(r[0], sport).filter((c) => c.tags.has("auto") && !/\(back\)/i.test(c.name))).filter((x) => x.length);
      const rest = pool.slice();
      while (showcase.length < 3 && rest.length) { const k = Math.floor(Math.random() * rest.length), list = rest.splice(k, 1)[0]; showcase.push(list[Math.floor(Math.random() * list.length)]); }
    }
    $("#app").innerHTML = `<div class="wrap ck c-husker">
      <div class="${showcase.length ? "ck-top" : ""}"><div class="c-head">
        <div class="kick">Autograph checklist · updated from my collection spreadsheet</div>
        <h1>${esc(page.label)}</h1>
        ${page.path === "" && DATA.site.nflListStory ? `<div class="story short">${DATA.site.nflListStory.map((t) => `<p>${esc(t)}</p>`).join("")}<button type="button" class="story-more" onclick="this.parentNode.classList.remove('short')">Read the full story</button></div>` : ""}
        <p>${esc(page.blurb)} Green means it's in my collection. If you can help with anyone marked <b>Need</b>, I'd love to hear from you.</p>
        <div class="prog"><b>${pct.toFixed(2)}%</b><div class="bar"><i style="width:${pct}%"></i></div><small>${fmt(y)} of ${fmt(n)} signed</small></div>
      </div>${showcase.length ? `<div class="ck-fan" aria-label="Autographs from this list">${showcase.map((c) => `<button type="button" class="cd" data-i="${c.i}" aria-label="${esc(c.name)}">
        <img alt="" src="${img(c.id, c.rk, 400)}" onload="this.classList.add('ok')"></button>`).join("")}</div>` : ""}</div>
      <nav class="ck-others" aria-label="Other autograph lists">${CK_PAGES.filter((x) => x !== page && CHECK.lists.some((m) => m.slug === x.slug)).map((x) => `<a href="#/checklist${x.path}">${esc(x.label)} →</a>`).join("")}</nav>
      <div class="ck-body${typeRows.length ? "" : " solo"}">
        <div style="min-width:0">
          <div class="tools">
            <div class="chips" role="group" aria-label="Show">${[["all", "Everyone"], ["have", "Have"], ["need", "Need"]].map(([k, t]) => `<button type="button" class="chip" data-show="${k}" aria-pressed="${CK.show === k}">${t}</button>`).join("")}</div>
            <div class="tools-r"><label class="sr" for="ck-q">Search this list</label><input id="ck-q" class="ck-q" type="search" placeholder="Find a player" value="${esc(CK.q)}"><span class="count" id="ck-count"></span></div>
          </div>
          <div class="ck-table" id="ck-table"></div>
        </div>
        ${typeRows.length ? `<aside class="ck-side"><h4>What they signed</h4>${typeRows.map(([t, c]) => `<div class="ty"><span>${esc(t)}</span><span class="tn">${fmt(c)}</span><div class="bar"><i style="width:${(c / tmax) * 100}%"></i></div></div>`).join("")}</aside>` : ""}
      </div></div>`;
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
          im.src = pre.src; btn.dataset.i = next.i; btn.setAttribute("aria-label", next.name);
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
    const q = CK.q.toLowerCase(); let count = 0;
    const body = l.groups.map((g) => {
      const rows = g.rows.filter((r) => (CK.show === "all" || (CK.show === "have") === (r[ai] === "Yes")) && (!q || r.join(" ").toLowerCase().includes(q)));
      count += rows.length; if (!rows.length) return "";
      return (g.title ? `<tr class="grp"><th colspan="${shown.length + 2}">${esc(g.title)}</th></tr>` : "") + rows.map((r) => {
        const have = r[ai] === "Yes", scans = have ? scansFor(r[0], SPORT_OF_LIST[l.slug]) : [];
        return `<tr class="${have ? "have" : "need"}"${scans.length ? ` data-peek="${esc(r[0])}" data-sport="${SPORT_OF_LIST[l.slug]}"` : ""}><td><span class="st ${have ? "have" : "need"}">${have ? "Have" : "Need"}</span>${(l.notes || {})[r[0]] ? `<button type="button" class="nt-btn nt-m" data-note="${esc(r[0])}" aria-expanded="false" aria-label="Why ${esc(r[0])} is on this list">i</button>` : ""}</td>
          ${shown.map((i, k) => `<td class="${k === 0 ? "nm" : ""}${opt(cols[i])}">${k === 0 ? (hasPages ? `<a class="pl-link" href="#/player/${slugFor(l.slug, r[i])}">${hl(r[i], CK.q)}</a>` : hl(r[i], CK.q)) + ((l.notes || {})[r[i]] ? ` <button type="button" class="nt-btn nt-d" data-note="${esc(r[i])}" aria-expanded="false" aria-label="Why ${esc(r[i])} is on this list" title="Why he's on this list">i</button>` : "") : esc(r[i])}</td>`).join("")}
          <td class="sc">${scans.length ? `<button type="button" class="btn sm" data-scan="${esc(r[0])}" data-sport="${SPORT_OF_LIST[l.slug]}">${scans.length === 1 ? "Scan" : scans.length + " scans"}</button>` : ""}</td></tr>`;
      }).join("");
    }).join("");
    $("#ck-count").textContent = `${fmt(count)} ${count === 1 ? "person" : "people"}`;
    $("#ck-table").innerHTML = count ? `<table><thead><tr><th>Status</th>${shown.map((i) => `<th class="${opt(cols[i]).trim()}">${esc(label(cols[i]))}</th>`).join("")}<th></th></tr></thead><tbody>${body}</tbody></table>` : `<p class="empty">Nobody matches. Try another name or switch to Everyone.</p>`;
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
        const r = t.getBoundingClientRect(), w = 190, h = 300;
        peek.style.left = Math.max(8, Math.min(r.right + 14, innerWidth - w - 8)) + "px";
        peek.style.top = Math.max(8, Math.min(r.top + r.height / 2 - h / 2, innerHeight - h - 8)) + "px";
        peek.hidden = false;
      }, 350);
    });
    addEventListener("scroll", hidePeek, { passive: true });
    addEventListener("hashchange", hidePeek);
  }
  document.addEventListener("click", (e) => {
    if (!peek.hidden) hidePeek();
    const b = e.target.closest("[data-scan]"); if (!b) return;
    const list = scansFor(b.dataset.scan, b.dataset.sport || "football"); if (list.length) openViewer(0, list);
  });

  /* ---------- NFL Tier 1 Huskers: list with autographs, and a page per player ---------- */
  let PLAYERS = null;
  const HUB = { q: "", show: "all", sort: "scans", shown: 0, rows: [] };
  function loadHub(then) {
    const need = [];
    if (!CHECK) need.push(fetch("data/lists/husker-pros.json").then((r) => { if (!r.ok) throw 0; return r.json(); }).then((d) => (CHECK = d)));
    if (!PLAYERS) need.push(fetch("data/players.json").then((r) => (r.ok ? r.json() : { players: [] })).catch(() => ({ players: [] })).then((d) => (PLAYERS = d)));
    if (!need.length) return then();
    $("#app").innerHTML = `<p class="loading">Loading…</p>`;
    Promise.all(need).then(then).catch(() => ($("#app").innerHTML = `<p class="empty">This page isn't available yet.</p>`));
  }
  // The home page stat and search's player matches only need the autograph lists, not the (larger) player info.
  function loadCheckQuiet() {
    return Promise.resolve(CHECK || fetch("data/lists/husker-pros.json").then((r) => { if (!r.ok) throw 0; return r.json(); }).then((d) => (CHECK = d)));
  }
  const pslug = (n) => norm(n).replace(/ /g, "-");
  function bestScan(name, sport = "football") {
    const all = scansFor(name, sport).filter((c) => !/\(back\)/i.test(c.name));
    return all.find((c) => c.tags.has("auto")) || all[0] || null;
  }
  // Player pages for every name on the NFL, MLB and NBA lists. Slugs match scripts/build_players.py:
  // a name already used by an earlier list gets "-baseball" or "-basketball" added.
  // [sport, list, label, back link, back label, slug suffix for a name already used by an earlier list].
  // Order matters (it decides who gets the plain slug) and must match SPORTS in scripts/build_players.py.
  const SPORT_LISTS = [["football", "nfl-tier-1-huskers", "NFL", "#/nfl-huskers", "NFL Huskers Player Pages", "football"],
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
    return ALL;
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
  function hub() {
    setNav("nfl-huskers"); setTitle("NFL Huskers Player Pages");
    loadHub(() => {
      const all = tier1(), have = all.filter((p) => p.have).length;
      $("#app").innerHTML = `<div class="wrap hub c-husker">
        <div class="c-head"><div class="kick">Autograph collection</div><h1>NFL Huskers Player Pages</h1>
          <p>Every Nebraska Cornhusker who played in at least one NFL game. Pick a name for that player's page, with the autograph I have when I have one.</p>
          <div class="prog"><b>${((have / all.length) * 100).toFixed(2)}%</b><div class="bar"><i style="width:${(have / all.length) * 100}%"></i></div><small>${fmt(have)} of ${fmt(all.length)} signed</small></div></div>
        <div class="tools">
          <div class="chips" role="group" aria-label="Show">${[["all", "Everyone"], ["have", "Have"], ["need", "Need"], ["pages", "Has a bio"]].map(([k, t]) => `<button type="button" class="chip" data-show="${k}" aria-pressed="${HUB.show === k}">${t}</button>`).join("")}</div>
          <div class="tools-r"><label class="sr" for="hub-q">Find a player</label><input id="hub-q" class="ck-q" type="search" placeholder="Find a player" value="${esc(HUB.q)}">
            <label class="sr" for="hub-sort">Sort</label><select id="hub-sort">${[["scans", "With autographs first"], ["new", "Newest first"], ["old", "Oldest first"], ["most", "Most NFL games"], ["fewest", "Fewest NFL games"], ["az", "A–Z"]].map(([k, t]) => `<option value="${k}"${HUB.sort === k ? " selected" : ""}>${t}</option>`).join("")}</select>
            <span class="count" id="hub-count"></span></div>
        </div>
        <ol class="hub-list" id="hub-list"></ol><div class="sentinel" id="hub-more"></div></div>`;
      const apply = () => {
        const q = HUB.q.toLowerCase();
        HUB.rows = all.filter((p) => (HUB.show === "all" || (HUB.show === "have" && p.have) || (HUB.show === "need" && !p.have) || (HUB.show === "pages" && p.page)) && (!q || p.name.toLowerCase().includes(q)));
        // The checklist is newest first; "with autographs first" keeps that order within each group.
        const scanned = (p) => (p.have && bestScan(p.name) ? 0 : 1), yr = (p) => parseInt(p.year) || 0;
        // Games like "1*" count as 1; players with no games listed go last either way.
        const gm = (p) => { const n = parseInt(p.games); return isNaN(n) ? null : n; };
        const byGames = (dir) => (a, b) => (gm(a) === null) - (gm(b) === null) || dir * ((gm(a) || 0) - (gm(b) || 0));
        const by = { scans: (a, b) => scanned(a) - scanned(b), new: () => 0, old: (a, b) => yr(a) - yr(b), most: byGames(-1), fewest: byGames(1), az: (a, b) => a.name.localeCompare(b.name) }[HUB.sort];
        HUB.rows = HUB.rows.map((p, i) => [p, i]).sort((a, b) => by(a[0], b[0]) || a[1] - b[1]).map(([p]) => p);
        HUB.shown = 0; $("#hub-list").innerHTML = HUB.rows.length ? "" : `<li class="empty">Nobody matches.</li>`;
        $("#hub-count").textContent = `${fmt(HUB.rows.length)} players`; hubMore();
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
      const sc = p.have ? bestScan(p.name) : null;
      const nm = `<a class="hub-name${p.page ? "" : " nobio"}" href="#/player/${p.slug}">${hl(p.name, HUB.q)}</a>`;
      return `<li class="hub-row ${p.have ? "have" : "need"}">
        ${sc ? `<button type="button" class="hub-ph" data-scan="${esc(p.name)}" aria-label="View ${esc(p.name)}'s autograph"><img loading="lazy" alt="" src="${img(sc.id, sc.rk, 240)}" onload="this.classList.add('ok')"></button>`
             : `<div class="hub-ph none">${p.have ? esc(p.signed || "Signed") : "Need"}</div>`}
        <div class="hub-info">${nm}<div class="hub-meta">Final Nebraska season ${esc(p.year)}${p.games ? ` · ${esc(p.games)} NFL game${parseInt(p.games) === 1 ? "" : "s"}` : ""}${p.notes ? ` · ${esc(p.notes)}` : ""}</div>
          <div class="hub-meta2"><span class="st ${p.have ? "have" : "need"}">${p.have ? "Have" : "Need"}</span>${p.have && p.signed ? `<span>Signed ${esc(p.signed.toLowerCase())}</span>` : ""}</div></div></li>`;
    }).join(""));
  }
  const hubIO = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && HUB.shown < HUB.rows.length && hubMore()), { rootMargin: "1000px" });

  // Videos that feature a player: Media items and Customs videos with "players": [player page slugs].
  function playerMedia(slug) {
    const s = DATA.site, yt = (v) => v.url || `https://www.youtube.com/watch?v=${encodeURIComponent(v.youtube || v.id)}${v.start ? `&t=${+v.start}s` : ""}`;
    return [...(s.media?.items || []), ...(s.customsPhotos?.videos || [])]
      .filter((v) => (v.players || []).includes(slug)).map((v) => ({ title: v.title || v.caption, url: yt(v) }));
  }
  function player(slug) {
    setNav("nfl-huskers");
    loadHub(() => {
      const p = (PLAYERS.players || []).find((x) => x.slug === slug);
      const row = allPlayers().find((x) => x.slug === slug);
      if (!p && !row) return notFound();
      const info = { ...(row || {}), ...(p || {}) }, w = (p && p.wiki) || null;
      const football = (info.sport || "football") === "football";
      setTitle(info.name);
      if (info.back && info.back.startsWith("#/checklist/")) setNav(info.back.slice(2));
      const back = info.back || "#/nfl-huskers", backLabel = info.backLabel || "NFL Huskers Player Pages";
      const sport = info.sport || "football";
      const scans = scansFor(info.name, sport).filter((c) => !/\(back\)/i.test(c.name));
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
      const facts = [["Position", info.position || (pick("Position") || [])[1] || bbPos], ["Final season at Nebraska", info.year || info.finalYear],
        ["Nebraska years", (schools.find(([n]) => /nebraska/i.test(n)) || [])[1]],
        ["Also played at", schools.filter(([n]) => !/nebraska/i.test(n)).map(([n, y]) => `${n} (${y})`).join(", ")],
        ["NFL draft", (pick("NFL draft") || [])[1]], ["NBA draft", (pick("NBA draft") || [])[1]], ["MLB draft", (pick("MLB draft") || [])[1]],
        [debut ? debut[0] : "", debut ? (debut[1][0] || [])[0] : ""],
        ["NFL games", football ? info.games || info.nflGames : ""], ["Born", (pick("Born") || [])[1] || line(/^Born:\s*/)],
        ["Bats / throws", line(/^(?=Bat(?:s|ted):)/).replace(/Bat(?:s|ted):\s*/, "").replace(/\s*Thr(?:ows|ew):\s*/, " / ")],
        ...Object.entries(sec).filter(([k]) => /^Last .*appearance$/i.test(k)).map(([k, v]) => [k, (v[0] || [])[0]]),
        ["High school", (pick("High school") || [])[1]], ["Height / weight", [(pick("Listed height") || [])[1], (pick("Listed weight") || [])[1]].filter(Boolean).join(" · ")]]
        .filter(([, v]) => v && String(v).trim());
      const statKey = Object.keys(sec).find((k) => /statistics/i.test(k));
      // A list section, in whichever name this sport's infobox uses; "2022–2024 | Team" rows read as "Team (2022–2024)".
      const list = (...ks) => { const k = ks.find((x) => sec[x] && sec[x].length); return k ? sec[k].map((r) => `<li>${esc(r.length === 2 ? `${r[1].replace(/^→\s*/, "↳ ")} (${r[0]})` : r[0])}</li>`).join("") : ""; };
      const teams = list("Career history", "Playing", "Teams"), awards = list("Awards and highlights", "Career highlights and awards", "Career highlights");
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
      $("#app").innerHTML = `<div class="wrap pl c-husker">
        <a class="back" href="${back}">← ${esc(backLabel)}</a>
        <div class="pl-top">
          <div class="pl-card">${hero ? `<button type="button" class="pl-ph${scans.includes(hero) ? "" : " cd"}" ${scans.includes(hero) ? `data-scan="${esc(info.name)}" data-sport="${sport}"` : `data-i="${hero.i}"`}><img alt="${esc(hero.name)}" src="${img(hero.id, hero.rk, 900)}" onload="fitFrame(this)"></button><small>${esc(hero.name)}</small>`
            : `<div class="pl-ph none"><span class="st ${info.have ? "have" : "need"}">${info.have ? "Have" : "Need"}</span><p>${info.have ? `${info.signed ? `Signed ${esc(info.signed.toLowerCase())}. ` : ""}Scan coming soon.` : "I'm still looking for this autograph. Can you help?"}</p>${info.have ? "" : contactHTML("I can help with this autograph", `${info.name} autograph`, `Hi Ian,\n\nI saw you're looking for a ${info.name} autograph. I might be able to help:\n\n`, info.name)}</div>`}</div>
          <div class="pl-main">
            <div class="kick">${esc(info.position || bbPos || (football ? "Nebraska Cornhusker" : `Nebraska Cornhuskers ${info.sport}`))}</div>
            <h1>${esc(info.name)}</h1>
            <div class="pl-badges"><span class="st ${info.have ? "have" : "need"}">${info.have ? "In my collection" : "Need"}</span>${info.have && info.signed ? `<span class="pill">Signed ${esc(info.signed.toLowerCase())}</span>` : ""}</div>
            ${statsLink ? `<a class="statlink" href="${esc(statsLink)}" target="_blank" rel="noopener">Career stats at ${esc(siteName(statsLink))} ↗</a>` : ""}
            ${playerMedia(slug).map((m) => `<a class="statlink watch" href="${esc(m.url)}" target="_blank" rel="noopener">▶ Watch: ${esc(m.title)} ↗</a>`).join("")}
            ${(() => { const l = row && CHECK.lists.find((x) => x.slug === row.listSlug), t = l && (l.notes || {})[row.name];
              return t ? `<section class="why"><h2>Why he's on the ${esc((row.backLabel || "").replace(/ Huskers Autograph List$/, ""))} list</h2>${noteHTML(t)}</section>` : ""; })()}
            <dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
            ${w && w.intro ? `<div class="bio">${w.intro.split("\n\n").map((t) => `<p>${esc(t)}</p>`).join("")}</div>` : `<p class="muted">${p && p.checked ? "No biography available for this player yet." : "Biography coming soon."}</p>`}
          </div>
        </div>
        <div class="pl-grid">
          ${statKey ? `<section><h2>${esc(statKey.replace(/\s*\n.*$/s, "").replace(/\s+as of.*$/i, ""))}</h2><table class="kv">${sec[statKey].filter((r) => r.length === 2).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table></section>` : ""}
          ${!football && !wtables ? "" : `<section class="wide-sec"><h2>College stats</h2>${wtables ? `${wtables}<p class="note">From <a href="${esc(w.url)}" target="_blank" rel="noopener">Wikipedia</a>, CC BY-SA 4.0.</p>` : collegeHTML ? `${collegeHTML}<p class="note">${p.collegeSource === "recordbook"
              ? `Seasons he led Nebraska in a category, from the <a href="https://huskers.com/football-history-and-records" target="_blank" rel="noopener">Nebraska Football Record Book</a> (huskers.com). Full stats for this era aren't in my data source yet.`
              : p.collegeSource === "games" ? "From CollegeFootballData.com (season totals added up from game box scores)." : "From CollegeFootballData.com."}</p>`
            : `<p class="muted">${!(p && (p.checked || p.wiki)) ? "Stats coming soon." : DEF.test(info.position || "") ? "Defensive stats from this era aren't in my data source yet." : (info.year || info.finalYear) < 2005 ? "Stats from this era are coming later." : "No individual college stats recorded."}</p>`}</section>`}
          ${teams ? `<section><h2>Pro teams</h2><ul class="plain">${teams}</ul></section>` : ""}
          ${awards ? `<section><h2>Awards and highlights</h2><ul class="plain">${awards}</ul></section>` : ""}
        </div>
        ${pc.length ? `<p class="pc-link"><a href="#/c/${SECTIONS[pcIdx].slug}">See all ${fmt(pc.length)} cards in my ${esc(SECTIONS[pcIdx].title)} collection →</a></p>` : ""}
        ${scans.length > 1 ? `<h2 class="more-h">More of ${esc(info.name)} in my collection</h2><div class="grid small">${scans.map((c) => cardHTML(c)).join("")}</div>` : ""}
        <p class="credit">${w ? `Biography and facts from <a href="${esc(w.url)}" target="_blank" rel="noopener">Wikipedia</a>, licensed <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.` : ""}${w && w.pfr && w.pfr !== statsLink ? ` Full pro stats at <a href="${esc(w.pfr)}" target="_blank" rel="noopener">Pro Football Reference</a>.` : ""} Autograph status from my collection records.</p>
      </div>`;
      state.list = scans;
    });
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
    const sec = SECTIONS[si], mine = sectionCards(si).filter((c) => !/\(back\)|\(inside\)/i.test(c.name));
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
        ${gi >= 0 ? `<a class="ds-all" href="#/c/${sec.slug}/${sec.groups[gi].slug}">See all ${fmt(sec.groups[gi].count)} of my ${esc(ch.group)} cards →</a>` : ""}
      </section>`;
    }).join("");
    $("#app").innerHTML = `<div class="wrap ds c-royal">
      <a class="back" href="#/c/${sec.slug}">← Jermaine Dye collection</a>
      <div class="kick">Player collection · Career story</div>
      <h1>${esc(st.title)}</h1>
      <div class="ds-intro">${(st.intro || []).map((p) => `<p>${esc(p)}</p>`).join("")}</div>
      ${hi.length ? `<section class="ds-hi"><h2 class="sub-h">Favorite pieces</h2><div class="ds-hi-grid">${hi.map((h) => `<figure>${card(h.c)}<figcaption>${esc(h.cap)}</figcaption></figure>`).join("")}</div></section>` : ""}
      ${chapters}
      <p class="ds-end"><a href="#/c/${sec.slug}">Browse all ${fmt(mine.length)} of my Jermaine Dye cards →</a></p>
    </div>`;
    state.list = shownCards;   // the card viewer steps through the cards on this page
  }

  function notFound() { setTitle("Page not found"); $("#app").innerHTML = `<p class="empty">That page doesn't exist. <a href="#/">Go home</a></p>`; }

  /* ---------- Router ---------- */
  function route() {
    closeViewer(true);
    const [path, qs = ""] = location.hash.replace(/^#\/?/, "").split("?");
    const h = decodeURIComponent(path).split("/");
    const [a, b, c] = h;
    const key = a === "c" ? "c/" + b : a;
    // Filters and sort come from the address (?f=auto,relic&sort=old), so a filtered view can be shared or reloaded.
    // Moving between groups of the same collection keeps them.
    const prm = new URLSearchParams(qs), fs = (prm.get("f") || "").split(",").filter((k) => FILTERS.some(([x]) => x === k));
    const so = SORTS.some(([k]) => k === prm.get("sort")) ? prm.get("sort") : null;
    if (qs || key !== state.where) { state.filters = new Set(fs); state.sort = so || "new"; }
    state.where = key;
    if (a !== "search") { state.q = ""; $("#q").value = ""; }
    if (!a) home();
    else if (a === "c") collection(b, c);
    else if (a === "customs") collection("customs");
    else if (a === "all") collection("all");
    else if (a === "checklist") checklist(b);
    else if (a === "nfl-huskers") hub();
    else if (a === "media") media();
    else if (a === "dye-career") dyeCareer();
    else if (a === "player") player(b);
    else if (a === "search") { state.q = h.slice(1).join("/"); $("#q").value = state.q; collection("search"); }
    else if (a === "card") {   // a shared card link opens the card over its own collection
      const k = CARDS.findIndex((x) => x.id === b); if (k < 0) return notFound();
      const card = CARDS[k], slug = SECTIONS[card.si].slug;
      history.replaceState(null, "", "#/c/" + slug); state.where = "c/" + slug; state.filters.clear(); state.sort = "new";
      collection(slug); window.scrollTo(0, 0);
      const j = state.list.findIndex((x) => x.i === card.i);
      return openViewer(j >= 0 ? j : 0, j >= 0 ? state.list : [card]);
    }
    else notFound();
    window.scrollTo(0, 0);
    track();
  }
  /* ---------- Analytics: GoatCounter (no cookies), when config analytics.goatcounter has my site code ---------- */
  // Each #/ page counts as its own page, e.g. /cardcollection-site/#/player/ricky-simmons.
  function track() {
    const code = (DATA && DATA.site.analytics || {}).goatcounter; if (!code) return;
    const path = location.pathname + (location.hash.split("?")[0] || "#/");
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
    if (state.sort !== "new") p.push("sort=" + state.sort);
    history.replaceState(history.state, "", location.hash.split("?")[0] + (p.length ? "?" + p.join("&") : ""));
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
  function openViewer(k, list, random) {
    V.list = list; V.k = k; V.back = false; V.zoom = false; V.random = !!random;
    $("#viewer").hidden = false; document.body.style.overflow = "hidden"; showCard(); $("#v-close").focus();
    // An extra history step, so the phone's Back button closes the card instead of leaving the page.
    if (!(history.state && history.state.v)) history.pushState({ v: 1 }, "", location.href);
  }
  function closeViewer(silent) {
    if ($("#viewer").hidden) return;
    $("#viewer").hidden = true; document.body.style.overflow = ""; $("#v-stage").classList.remove("zoom", "pair");
    if (!silent && history.state && history.state.v) history.back();
  }
  window.addEventListener("popstate", () => { if (!$("#viewer").hidden && !(history.state && history.state.v)) closeViewer(true); });
  /* Watermark: the large viewer image (and anything saved from it) carries "IANBADEER.COM" along the bottom,
     centered, like COMC. Thumbnails and the quick first preview stay plain. */
  const MARKED = new Map();   // file id -> object URL of the marked image (kept for this visit)
  function marked(id, rk) {
    if (MARKED.has(id)) return MARKED.get(id);
    const p = new Promise((ok, no) => {
      const im = new Image(); im.crossOrigin = "anonymous";
      im.onload = () => {
        try {
          const cv = document.createElement("canvas"); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
          const g = cv.getContext("2d"); g.drawImage(im, 0, 0);
          const size = Math.max(14, Math.round(Math.min(cv.width, cv.height * 1.4) * 0.045));
          g.font = `700 ${size}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
          g.textAlign = "center"; g.textBaseline = "alphabetic";
          const x = cv.width / 2, y = cv.height - Math.round(size * 0.7);
          g.lineJoin = "round"; g.lineWidth = Math.max(2, size * 0.12);
          g.strokeStyle = "rgba(0,0,0,.35)"; g.strokeText("IANBADEER.COM", x, y);
          g.fillStyle = "rgba(255,255,255,.62)"; g.fillText("IANBADEER.COM", x, y);
          cv.toBlob((b) => (b ? ok(URL.createObjectURL(b)) : no(new Error("no image"))), "image/jpeg", 0.9);
        } catch (e) { no(e); }
      };
      im.onerror = () => no(new Error("image failed"));
      im.src = img(id, rk, 1600);
    });
    p.catch(() => MARKED.delete(id));
    MARKED.set(id, p);
    return p;
  }
  function loadInto(el, c, id, rk, alt) {
    el.src = img(id, rk, 400); el.alt = alt; el.dataset.id = id;
    marked(id, rk).then((u) => { if (V.list[V.k] === c && el.dataset.id === id) el.src = u; })
      .catch(() => { if (V.list[V.k] === c && el.dataset.id === id) el.src = img(id, rk, 1600); });   // no mark possible: plain large image
  }
  // "Save image": the marked image, named after the card.
  async function saveCard() {
    const c = V.list[V.k]; if (!c) return;
    const back = !isPair(c) && V.back && c.backId, id = back ? c.backId : c.id, rk = back ? c.backRk : c.rk;
    const b = $("#v-save"); b.textContent = "Saving…";
    try {
      const u = await marked(id, rk), a = document.createElement("a");
      a.href = u; a.download = (String(c.name || c.caption || "card").replace(/[\\/:*?"<>|#]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) + (back ? " (back)" : "")) + ".jpg";
      document.body.appendChild(a); a.click(); a.remove();
      b.textContent = "Saved";
    } catch (e) { b.textContent = "Couldn't save"; }
    setTimeout(() => (b.textContent = "⬇ Save image"), 1600);
  }
  const isPair = (c) => wide.matches && !!c.backId && !V.zoom;
  function showCard() {
    const c = V.list[V.k]; if (!c) return;
    $("#v-copy").hidden = !!c.photo;
    if (c.photo) {   // a photo with a player: caption instead of card details
      const stage = $("#v-stage"); stage.classList.remove("pair"); stage.classList.toggle("zoom", V.zoom);
      loadInto($("#v-img"), c, c.id, c.rk, c.caption); $("#v-img2").hidden = true;
      $("#v-title").innerHTML = `${esc(c.short)}${c.caption !== c.short ? `<small>${esc(c.caption)}</small>` : ""}`;
      $("#v-have").hidden = true; $("#v-dice").hidden = true;
      $("#v-flip").hidden = true;
      $("#v-meta").innerHTML = `<span>With the players</span><span>·</span><span>${V.k + 1} of ${fmt(V.list.length)}</span>`;
      $("#v-prev").style.visibility = V.k > 0 ? "visible" : "hidden";
      $("#v-next").style.visibility = V.k < V.list.length - 1 ? "visible" : "hidden";
      return;
    }
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
    $("#v-save").textContent = "⬇ Save image";
    const sec = SECTIONS[c.si];
    // Want List cards get a button that starts an email to me with the card already named.
    $("#v-have").hidden = !(sec.kind === "want" && (DATA.site.contact || {}).code);
    if (!$("#v-have").hidden) $("#v-have").innerHTML = contactHTML("I have this card", "I have a card from your Want List: " + c.name,
      `Hi Ian,\n\nI have this card from your Want List:\n${c.name}\n${location.href.split("#")[0]}#/card/${c.id}\n\n`, c.name);
    $("#v-dice").hidden = !V.random;
    $("#v-meta").innerHTML = `${badges(c)}<span>${esc(sec.title)} · ${esc(sec.groups[c.gi].label)}</span><span>·</span><span>${V.random ? "Random card" : `${V.k + 1} of ${fmt(V.list.length)}`}</span><span>·</span><span style="font-family:var(--f-m)">${esc(c.name)}</span>`;
    $("#v-prev").style.visibility = V.k > 0 ? "visible" : "hidden";
    $("#v-next").style.visibility = V.k < V.list.length - 1 ? "visible" : "hidden";
  }
  const step = (d) => { const n = V.k + d; if (n >= 0 && n < V.list.length) { V.k = n; V.back = false; V.zoom = false; showCard(); } };
  $("#v-prev").onclick = () => step(-1); $("#v-next").onclick = () => step(1);
  $("#v-close").onclick = () => closeViewer();
  $("#v-save").onclick = saveCard;
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

  /* ---------- Random card: the dice in the header ---------- */
  // On a collection page it picks from that page's cards (with any filters on); anywhere else, from every card.
  let lastRandom = -1;
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  function randomCard() {
    const here = /^(c\/|customs$|all$|search$)/.test(state.where || "") && state.list.length ? state.list : CARDS;
    const pool = here.filter((c) => !/\((back|inside)\)/i.test(c.name));
    if (!pool.length) return null;
    let c;
    for (let n = 0; n < 6; n++) { c = pool[Math.floor(Math.random() * pool.length)]; if (c.i !== lastRandom || pool.length === 1) break; }
    lastRandom = c.i; return c;
  }
  function roll(el) { if (!el || calm.matches) return; el.classList.remove("roll"); void el.offsetWidth; el.classList.add("roll"); }
  $("#dice").addEventListener("click", () => {
    if (!CARDS || !CARDS.length) return;
    const c = randomCard(); if (!c) return;
    roll($("#dice"));
    setTimeout(() => openViewer(0, [c], true), calm.matches ? 0 : 260);
  });
  $("#v-dice").addEventListener("click", () => {
    const c = randomCard(); if (!c) return;
    roll($("#v-dice"));
    const show = () => { V.list = [c]; V.k = 0; V.back = false; V.zoom = false; showCard(); };
    if (calm.matches) return show();
    const st = $("#v-stage"); st.classList.remove("shuffle"); void st.offsetWidth; st.classList.add("shuffle");
    setTimeout(show, 190);
    setTimeout(() => st.classList.remove("shuffle"), 420);
  });

  /* ---------- Boot ---------- */
  // The live Gordon and Dye numbers from the Inventory Stats master (published by the robot) load alongside the cards.
  const statsReady = fetch("data/lists/inventory-stats.json").then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => (INV = (d && d.tables) || {}));
  if (window.CATALOG) statsReady.then(() => load(window.CATALOG));
  else Promise.all([fetch("data/catalog.json").then((r) => r.json()), statsReady]).then(([cat]) => load(cat))
    .catch(() => ($("#app").innerHTML = `<p class="empty">The card list didn't load. Refresh the page to try again.</p>`));
})();

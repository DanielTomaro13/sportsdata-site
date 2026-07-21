// RacingBoard Terminal client. One codebase, two sources: live WebSocket or a
// captured replay (GitHub Pages / offline).
(() => {
  const cfg = window.MF_CONFIG || {};
  const qs = new URLSearchParams(location.search);
  const state = { board: [], movers: [], value: [], scores: null, selected: null, expanded: null, details: {}, codeFilter: "ALL", confirmedOnly: false, mode: "connecting" };
  const flash = {}; // `${key}:${num}` -> last share, for cell flashing

  const $ = (id) => document.getElementById(id);
  const pct = (x) => (x == null ? "–" : (x * 100).toFixed(1));
  const money = (x) => (x == null ? null : "$" + Math.round(x).toLocaleString());
  const moneyShort = (x) => {
    if (!x) return null;
    if (x >= 1000) return "$" + (x / 1000).toFixed(x >= 10000 ? 0 : 1) + "k";
    return "$" + Math.round(x);
  };
  const esc = (s) => (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const BOOK = { pointsbet: "PB", sportsbet: "SB", betfair: "BF", tab: "TAB" };
  const ticks = (n) => "✓".repeat(n || 2);  // confirmation marks (one per market)
  function confirmMarkets(r) {
    const m = [];
    if (r.direction === "firming") m.push("Tote");
    if (r.bf_wom != null && r.bf_wom >= 0.55) m.push("Betfair");
    (r.corp_short || []).forEach((b) => m.push(BOOK[b] || b));
    if (r.betr_short) m.push("Betr");
    return m;
  }
  function ttg(iso) {
    const m = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
    if (isNaN(m)) return "";
    if (m <= 0) return "NOW";
    if (m < 60) return m + "m";
    return Math.floor(m / 60) + "h" + (m % 60);
  }

  // ---------- data source ----------
  function apply(msg) {
    if (msg.type === "board") {
      state.board = msg.board || [];
      state.movers = msg.movers || [];
      state.value = msg.value || [];
      state.scores = msg.scores || null;
      renderScores();
      // Drop cached detail for races that have left the board (bounds memory over a day).
      const liveKeys = new Set(state.board.map((r) => r.race_key));
      for (const k of Object.keys(state.details)) {
        if (!liveKeys.has(k) && k !== state.selected) delete state.details[k];
      }
      renderTop(); renderTape(); renderBoard(); renderSignals();
      checkAlerts();
      if (!state.selected && state.board.length) {
        const withPick = state.movers[0] ? state.movers[0].race_key : state.board[0].race_key;
        select(withPick);
      }
    } else if (msg.type === "race") {
      state.details[msg.race_key] = msg.detail;
      if (msg.race_key === state.selected) renderDetail();
    }
  }
  function liveConnect() {
    const base = (cfg.apiBase || (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host).replace(/^http/, "ws");
    let ws, opened = false;
    try { ws = new WebSocket(base + "/ws"); } catch { return startReplay(); }
    const ft = setTimeout(() => { if (!opened) { try { ws.close(); } catch {} startReplay(); } }, 3500);
    ws.onopen = () => { opened = true; clearTimeout(ft); setMode("live"); };
    ws.onmessage = (e) => apply(JSON.parse(e.data));
    ws.onclose = () => { if (!opened) startReplay(); else { setMode("down"); setTimeout(liveConnect, 2500); } };
    window.__sub = (k) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "subscribe", race_key: k })); };
  }
  async function startReplay() {
    if (state.mode === "replay") return;
    setMode("replay");
    let frames = [];
    try { frames = await (await fetch(qs.get("replay") || cfg.replayUrl || "data/replay.json")).json(); }
    catch { setMode("noreplay"); return; }
    if (!frames.length) { setMode("noreplay"); return; }
    let i = 0;
    window.__sub = (k) => { const f = frames[i % frames.length]; if (f.races && f.races[k]) apply({ type: "race", race_key: k, detail: f.races[k] }); };
    const tick = () => {
      const f = frames[i % frames.length];
      apply({ type: "board", board: f.board, movers: f.movers, value: f.value || [], scores: f.scores });
      if (state.selected && f.races && f.races[state.selected]) apply({ type: "race", race_key: state.selected, detail: f.races[state.selected] });
      i++;
    };
    tick(); setInterval(tick, 2600);
  }
  function setMode(m) {
    state.mode = m;
    const d = $("conn"), l = $("conn-label");
    d.className = "dot";
    if (m === "live") { d.classList.add("on"); l.textContent = "LIVE"; }
    else if (m === "replay") { d.classList.add("replay"); l.textContent = "REPLAY"; $("banner").classList.add("show"); }
    else if (m === "down") l.textContent = "RECONNECT";
    else if (m === "noreplay") l.textContent = "NO DATA";
    else l.textContent = "CONNECTING";
  }

  // ---------- top stats ----------
  function renderTop() {
    const b = state.board;
    $("s-races").textContent = b.length || "–";
    $("s-firmers").textContent = state.movers.length || "0";
    const matched = b.reduce((s, r) => s + (r.bf_total_matched || 0), 0);
    $("s-matched").textContent = matched ? money(matched) : "–";
    const next = [...b].filter((r) => r.status === "OPEN").sort((a, z) => new Date(a.start_time) - new Date(z.start_time))[0] || b[0];
    $("s-next").textContent = next ? ttg(next.start_time) : "–";
  }

  // ---------- scorecard (signal hit-rate) ----------
  function renderScores() {
    const el = $("scores"); if (!el) return;
    const s = state.scores;
    if (!s || !s.races) { el.innerHTML = `<div class="noscore">grading as races resolve…</div>`; $("score-races").textContent = ""; return; }
    $("score-races").textContent = s.races + " races";
    const sign = (x) => (x > 0 ? "up" : x < 0 ? "down" : "mut");
    const row = (label, d) => {
      if (!d || !d.n) return `<tr><td>${label}</td><td class="mut">–</td><td class="mut">–</td><td class="mut">–</td></tr>`;
      const roi = d.roi, pnl = d.profit;
      return `<tr title="${d.bets || 0} bets · bank $${d.bankroll}"><td>${label} <span class="sn">${d.n}</span></td><td>${d.win_pct != null ? d.win_pct + "%" : "–"}</td><td class="${roi != null ? sign(roi) : "mut"}">${roi != null ? (roi > 0 ? "+" : "") + roi + "%" : "–"}</td><td class="${pnl != null ? sign(pnl) : "mut"}">${pnl != null ? (pnl >= 0 ? "+$" : "−$") + Math.abs(pnl).toFixed(0) : "–"}</td></tr>`;
    };
    el.innerHTML = `<div class="bankline">flat $${s.stake} bets · $${s.bankroll} bank · best price</div>
      <table class="scoretbl"><thead><tr><th></th><th>WIN</th><th>ROI</th><th>P&amp;L</th></tr></thead><tbody>
      ${row("PICK", s.pick)}
      ${row('<span class="up">✓</span> CONF', s.confirmed)}
      ${row('<span class="amberh">◆</span> VALUE', s.value)}
      ${row("FAV", s.favourite)}
    </tbody></table>`;
  }

  // ---------- ticker tape (money in) ----------
  function renderTape() {
    const el = $("tape");
    if (!state.movers.length) { el.innerHTML = `<div class="t"><span class="v">waiting for market moves…</span></div>`; el.style.animation = "none"; return; }
    el.style.animation = "";
    const items = state.movers.map((m) => `
      <div class="t" data-key="${esc(m.race_key)}">
        <span class="d">${m.live ? "⚡" : "▲"}</span><span class="r">${esc(m.runner)}</span>
        <span class="v">${esc(m.venue)} R${m.race_no}</span>
        <span class="d">+${(m.share_delta * 100).toFixed(1)}pt</span>
        ${m.corp_best ? `<span class="v">$${m.corp_best.toFixed(2)}</span>` : ""}
      </div>`).join("");
    el.innerHTML = items + items; // duplicate for seamless loop
    el.querySelectorAll(".t[data-key]").forEach((t) => t.onclick = () => select(t.dataset.key));
  }

  // ---------- races board ----------
  function renderBoard() {
    const el = $("board");
    const rows = state.board.filter((r) => state.codeFilter === "ALL" || r.code === state.codeFilter);
    $("board-count").textContent = rows.length || "";
    if (!rows.length) { el.innerHTML = `<div class="brow"><span class="flatc mono">waiting…</span></div>`; return; }
    el.innerHTML = rows.map((r) => {
      const p = r.pick;
      const soon = (new Date(r.start_time) - Date.now()) < 5 * 60000;
      const pickTxt = r.result_winner
        ? `<span class="won">🏁 WON #${r.result_winner}</span>`
        : p
        ? `<span class="pn">${p.confirmed ? ticks(p.confirm) + " " : ""}#${p.number} ${esc(p.name)}</span>${p.direction === "firming" ? ` <span class="pd">${p.live ? "⚡" : "▲"}${((p.share_delta || 0) * 100).toFixed(0)}pt</span>` : ` <span class="flatc">${esc(p.confidence)}</span>`}`
        : "";
      return `
      <div class="brow ${r.race_key === state.selected ? "sel" : ""}" data-key="${esc(r.race_key)}">
        <span class="code ${r.code}">${r.code}</span>
        <span class="rv-wrap" style="min-width:0">
          <div class="rv"><span class="venue">${esc(r.venue)}</span><span class="rno">R${r.race_no}</span>${r.has_betfair ? '<span class="bf">BF</span>' : ""}${r.confirmed_count ? `<span class="confcount" title="${r.confirmed_count} confirmed (2+ markets)">${r.confirmed_count}✓</span>` : ""}</div>
          <div class="pick">${pickTxt}</div>
        </span>
        <span class="rt"><div class="ttg ${soon ? "soon" : ""}">${ttg(r.start_time)}</div><div class="st">${r.status !== "OPEN" ? esc(r.status) : ""}</div></span>
      </div>`;
    }).join("");
    el.querySelectorAll(".brow[data-key]").forEach((x) => x.onclick = () => select(x.dataset.key));
  }

  // ---------- signals: firmers (money in) + value (overlays), merged ----------
  function renderSignals() {
    const el = $("signals");
    if (!el) return;
    // merge by runner: a row can be firming, value, or both (the standout)
    const map = new Map();
    const keyOf = (m) => m.race_key + ":" + m.number;
    state.movers.forEach((m) => map.set(keyOf(m), {
      race_key: m.race_key, code: m.code, venue: m.venue, race_no: m.race_no, runner: m.runner,
      firm: m.share_delta, live: m.live, recent: m.share_delta_recent, confirmed: m.confirmed, confirm: m.confirm, value: null, best: null, book: null,
    }));
    state.value.forEach((m) => {
      const e = map.get(keyOf(m)) || {
        race_key: m.race_key, code: m.code, venue: m.venue, race_no: m.race_no, runner: m.runner, firm: null,
      };
      e.value = m.value_pct; e.best = m.corp_best; e.book = m.corp_best_book;
      map.set(keyOf(m), e);
    });
    let rows = [...map.values()];
    if (state.confirmedOnly) rows = rows.filter((e) => e.confirmed);
    if (!rows.length) { el.innerHTML = `<div class="frow"><span></span><span class="who flatc">${state.confirmedOnly ? "no confirmed runners" : "no signals yet…"}</span><span></span><span></span></div>`; $("signals-count").textContent = ""; return; }
    // confirmed steam first, then live, then both-signals, then firmers, then value
    const tier = (e) => (e.confirmed ? 4 : e.live ? 3 : e.firm && e.value ? 2 : e.firm ? 1 : 0);
    rows.sort((a, b) => tier(b) - tier(a) || ((b.recent || 0) - (a.recent || 0)) || ((b.firm || 0) - (a.firm || 0)) || ((b.value || 0) - (a.value || 0)));
    $("signals-count").textContent = rows.length;
    el.innerHTML = rows.map((e) => {
      const both = e.firm && e.value;
      return `
      <div class="frow ${both ? "both" : ""} ${e.live ? "live" : ""} ${e.confirmed ? "confd" : ""}" data-key="${esc(e.race_key)}">
        <span class="ar ${e.firm ? "up" : "amber"}">${e.live ? '<span class="live-mark">⚡</span>' : e.firm ? "▲" : "◆"}</span>
        <span class="who"><div class="n">${esc(e.runner)}${e.confirmed ? ` <span class="conf">${ticks(e.confirm)}</span>` : ""}</div><div class="c"><span class="code ${e.code}">${e.code}</span> ${esc(e.venue)} R${e.race_no}</div></span>
        <span class="d up">${e.firm ? "+" + (e.firm * 100).toFixed(1) : ""}</span>
        <span class="v amber">${e.value != null ? "+" + e.value.toFixed(0) + "%" : ""}</span>
      </div>`;
    }).join("");
    el.querySelectorAll(".frow[data-key]").forEach((x) => x.onclick = () => select(x.dataset.key));
  }

  // ---------- detail ----------
  function select(k) {
    if (k !== state.selected) {
      state.expanded = null;                 // collapse when switching races
      for (const fk of Object.keys(flash)) delete flash[fk];  // flash is per-race; drop stale
    }
    state.selected = k;
    if (window.__sub) window.__sub(k);
    if (state.details[k]) renderDetail();
    else if ((state.mode === "live" || state.mode === "down") && !cfg.apiBase)
      fetch(`/api/race/${encodeURIComponent(k)}`).then((r) => r.ok ? r.json() : null).then((d) => { if (d) { state.details[k] = d; renderDetail(); } });
    renderBoard();
  }

  // ---------- exotics & same-race-multi price generator (client-side, mirrors
  // sportsdata-agents quant/exotics.py: Harville closed form for exotics,
  // Plackett-Luce Monte Carlo for SRM; driven by the board's fair prices, so
  // it uses the sportsdata racing engine's win probs when they're present) ----
  const pricer = { bet: "exacta", picks: [], legs: [], box: false, result: null };
  const BANDS = { win: 1, top2: 2, top3: 3, top4: 4 };
  const EXOTIC_N = { exacta: 2, quinella: 2, trifecta: 3, first4: 4 };
  function winProbs(runners) {
    const p = {}; let tot = 0;
    for (const r of runners) { if (r.fair_price && r.fair_price > 1) { p[r.number] = 1 / r.fair_price; tot += p[r.number]; } }
    for (const k in p) p[k] /= tot || 1;
    return p;
  }
  function orderedProb(probs, seq) { let rem = 1, pr = 1; for (const n of seq) { const q = probs[n]; if (!q || rem <= 0) return 0; pr *= q / rem; rem -= q; } return pr; }
  function perms(arr, k) { if (k === 0) return [[]]; const out = []; arr.forEach((x, i) => { for (const rest of perms(arr.slice(0, i).concat(arr.slice(i + 1)), k - 1)) out.push([x, ...rest]); }); return out; }
  function priceExotic(probs, bet, picks, box) {
    const need = EXOTIC_N[bet];
    if (picks.length < need) return { warning: `needs ${need} runners` };
    let prob = 0, combos = 1;
    if (bet === "quinella") { prob = orderedProb(probs, [picks[0], picks[1]]) + orderedProb(probs, [picks[1], picks[0]]); if (box) { const ps = perms(picks, 2); prob = ps.reduce((s, q) => s + orderedProb(probs, q), 0); combos = picks.length * (picks.length - 1) / 2; } }
    else if (box) { const ps = perms(picks, need); prob = ps.reduce((s, q) => s + orderedProb(probs, q), 0); combos = ps.length; }
    else prob = orderedProb(probs, picks.slice(0, need));
    return prob > 0 ? { prob, fair: 1 / prob, combos } : { warning: "no chance / unpriced" };
  }
  function priceSRM(probs, legs, sims = 8000) {
    if (legs.length < 2) return { warning: "2+ legs" };
    if (legs.filter((l) => BANDS[l.position] === 1).length > 1) return { prob: 0, fair: null, warning: "two can't both win" };
    const nums = Object.keys(probs).map(Number), depth = Math.max(...legs.map((l) => BANDS[l.position]));
    let hits = 0;
    for (let s = 0; s < sims; s++) {
      const pool = nums.slice(), w = pool.map((n) => probs[n]), pos = {};
      for (let d = 0; d < depth && pool.length; d++) {
        let tot = 0; for (const x of w) tot += x; let x = Math.random() * tot, idx = 0;
        for (; idx < w.length; idx++) { x -= w[idx]; if (x <= 0) break; }
        idx = Math.min(idx, pool.length - 1); pos[pool[idx]] = d + 1; pool.splice(idx, 1); w.splice(idx, 1);
      }
      if (legs.every((l) => (pos[l.runner] || 99) <= BANDS[l.position])) hits++;
    }
    const prob = hits / sims;
    return prob > 0 ? { prob, fair: 1 / prob, sims } : { warning: "no simulated combos landed" };
  }
  function pricePanel(runners) {
    const isSrm = pricer.bet === "srm";
    const opts = runners.map((r) => `<option value="${r.number}">${r.number} · ${esc(r.name)}</option>`).join("");
    const chips = isSrm
      ? pricer.legs.map((l, i) => `<span class="pxchip" data-rm="${i}">#${l.runner} ${l.position} ✕</span>`).join("")
      : pricer.picks.map((n, i) => `<span class="pxchip" data-rm="${i}">${i ? "→ " : ""}#${n} ✕</span>`).join("");
    const res = pricer.result;
    let resHtml = '<span class="flatc">build a bet, then generate</span>';
    if (res) {
      if (res.warning) resHtml = `<span class="down">${esc(res.warning)}</span>`;
      else resHtml = `<b class="up">$${res.fair.toFixed(2)}</b> fair · <span class="flatc">${(res.prob * 100).toFixed(res.prob < 0.01 ? 3 : 2)}%</span>${res.combos > 1 ? ` · ${res.combos} combos` : ""}${res.sims ? ` · ${res.sims} sims` : ""}`;
    }
    return `<div class="pricer">
      <div class="pxhead">GENERATE PRICE <span class="sub">exotics &amp; same-race multi — off the board's fair prices</span></div>
      <div class="pxrow">
        ${["exacta", "quinella", "trifecta", "first4", "srm"].map((b) => `<button class="pxbet ${pricer.bet === b ? "on" : ""}" data-bet="${b}">${b.toUpperCase()}</button>`).join("")}
        ${isSrm ? "" : `<label class="pxbox"><input type="checkbox" id="pxbox" ${pricer.box ? "checked" : ""}> box</label>`}
      </div>
      <div class="pxrow">
        <select id="pxrunner">${opts}</select>
        ${isSrm ? `<select id="pxpos"><option value="win">win</option><option value="top2">top-2</option><option value="top3" selected>top-3</option><option value="top4">top-4</option></select>` : ""}
        <button class="pxadd" id="pxadd">+ add</button>
        <button class="pxclear" id="pxclear">clear</button>
      </div>
      <div class="pxchips">${chips || '<span class="flatc">pick runners…</span>'}</div>
      <div class="pxrow"><button class="pxgen" id="pxgen">⚡ Generate price</button><span class="pxresult">${resHtml}</span></div>
    </div>`;
  }
  function computePrice() {
    const d = state.details[state.selected];
    if (!d) return;
    const probs = winProbs(d.runners.filter((r) => !r.scratched));
    pricer.result = pricer.bet === "srm" ? priceSRM(probs, pricer.legs) : priceExotic(probs, pricer.bet, pricer.picks, pricer.box);
    renderDetail();
  }

  function renderDetail() {
    const d = state.details[state.selected];
    const el = $("detail");
    if (!d) { el.innerHTML = `<div class="empty"><div class="big">▟</div>NO DATA FOR THIS RACE</div>`; return; }
    const ref = d.ref, p = d.pick;
    const runners = d.runners.filter((r) => !r.scratched);
    const maxShare = Math.max(0.001, ...runners.map((r) => r.tote_pool_share || 0));
    const pickNum = p ? p.number : -1;
    const tipped = new Set((d.tips && d.tips.numbers) || []);
    const nameOf = {}; d.runners.forEach((x) => (nameOf[x.number] = x.name));
    const placing = {}; (d.results || []).forEach((n, i) => (placing[n] = i + 1));

    el.innerHTML = `
      <div class="dhead">
        <span class="code ${ref.code}">${ref.code}</span>
        <h2>${esc(ref.venue)} <span class="rno">R${ref.race_no}</span></h2>
        <span class="st ${d.status === "OPEN" ? "open" : ""}">${esc(d.status)}</span>
      </div>
      <div class="meta">
        <div class="m"><div class="k">JUMP</div><div class="v ${(new Date(ref.start_time) - Date.now()) < 3e5 ? "up" : ""}">${ttg(ref.start_time)}</div></div>
        <div class="m"><div class="k">TOTE WIN POOL</div><div class="v">${money(d.tote_win_pool) || "<span class='flatc'>forming</span>"}</div></div>
        <div class="m"><div class="k">BETFAIR MATCHED</div><div class="v">${money(d.bf_total_matched) || (ref.betfair_market_id ? "…" : "n/a")}</div></div>
        <div class="m"><div class="k">RUNNERS</div><div class="v">${runners.length}</div></div>
      </div>
      ${d.results ? `<div class="resultbar"><span class="flag">🏁 RESULT</span>${d.results.slice(0, 4).map((n, i) => `<span class="pl"><b class="p${i + 1}">${["1st", "2nd", "3rd", "4th"][i]}</b> #${n} ${esc(nameOf[n] || "")}</span>`).join("")}</div>` : ""}
      ${d.tips ? `<div class="raceinfo"><span class="tips">⭐ TIPS <b>${(d.tips.numbers || []).join("-")}</b>${d.tips.tipster ? ` · ${esc(d.tips.tipster)}` : ""}</span><span class="hint">click a runner for form</span></div>` : ""}
      ${p && !d.results ? pickCard(p) : ""}
      <div class="grid">
        <div class="ghead"><span>#</span><span>RUNNER</span><span class="r">SHARE</span><span class="r">Δ IN</span><span class="r">FAIR</span><span class="r">BEST</span><span class="r">VAL</span><span class="r">BF</span><span class="r">WGT $</span><span class="r">BF IN*</span><span class="r">TREND</span></div>
        ${runners.map((r) => grow(r, maxShare, pickNum, tipped, ref.code, placing)).join("")}
      </div>
      ${pricePanel(runners)}
      <div class="legend"><b class="up">✓ per market</b> shortening (tote · Betfair · Sportsbet · Pointsbet · Betr) · <b><span class="live-mark">⚡</span> live</b> = shortening now · <b>▲ money in</b> = pool share rising since open · FAIR = de-vigged Betfair·tote · <b style="color:var(--amber)">amber BEST</b> = value · <b>BF IN*</b> = est. Betfair $ since open</div>`;

    el.querySelectorAll("canvas.spark").forEach(drawSpark);
    el.querySelectorAll(".grow[data-num]").forEach((x) => x.onclick = () => {
      const n = +x.dataset.num;
      state.expanded = state.expanded === n ? null : n;
      renderDetail();
    });
  }

  function pickCard(p) {
    const dv = (p.share_delta || 0) * 100;
    const why = p.reason === "money in"
      ? `<span class="conf">${esc(p.confidence)}</span> · money in ▲${dv.toFixed(0)}pt${p.price_move_pct != null ? ` · price ${p.price_move_pct.toFixed(0)}%` : ""}`
      : `<span class="conf">${esc(p.confidence)}</span> · market favourite`;
    return `
      <div class="pickcard ${p.confirmed ? "confd" : ""}">
        <span class="tag">${p.confirmed ? ticks(p.confirm) + " PICK" : p.live ? "⚡ PICK" : "PICK"}</span>
        <div class="who"><div class="n"><span class="sn">#${p.number}</span>${esc(p.name)}</div><div class="why">${why}</div></div>
        <div class="nums">
          <div class="c"><div class="k">SHARE</div><div class="val">${pct(p.share)}%</div></div>
          <div class="c"><div class="k">FAIR</div><div class="val">${p.fair_price ? p.fair_price.toFixed(2) : "–"}</div></div>
          <div class="c"><div class="k">BEST</div><div class="val up">${p.corp_best ? p.corp_best.toFixed(2) : "–"}</div></div>
        </div>
      </div>`;
  }

  function grow(r, maxShare, pickNum, tipped, code, placing) {
    const key = state.selected + ":" + r.number;
    const pos = placing && placing[r.number];
    const share = r.tote_pool_share || 0;
    const prev = flash[key];
    flash[key] = share;
    const fl = prev != null && Math.abs(share - prev) > 0.001 ? (share > prev ? "fUp" : "fDn") : "";
    const barW = (share / maxShare) * 100;
    const dv = r.share_delta != null ? r.share_delta * 100 : null;
    const val = r.value_pct;
    const live = r.direction === "firming" && (r.share_delta_recent || 0) > 0.006;
    const expanded = state.expanded === r.number;
    return `
      <div class="grow ${r.direction === "firming" ? "firm" : ""} ${live ? "live" : ""} ${r.confirmed ? "confd" : ""} ${r.number === pickNum && !pos ? "isPick" : ""} ${expanded ? "exp" : ""} ${fl}" data-num="${r.number}">
        <span class="num">${pos ? `<span class="pos p${pos}">${pos}</span>` : `<span class="chev">${expanded ? "▾" : "▸"}</span>${r.number}`}</span>
        <span class="nm">${tipped && tipped.has(r.number) ? '<span class="star">⭐</span>' : ""}${r.best_bet ? `<span class="bestbet" title="Sportsbet best bet — ${esc(r.best_bet)}">🎯</span>` : ""}${esc(r.name)} ${live ? '<span class="live-mark">⚡</span>' : r.direction === "firming" ? '<span class="up">▲</span>' : ""}${r.confirmed ? `<span class="conf" title="${r.confirm} markets agree">${ticks(r.confirm)}</span>` : ""}</span>
        <span class="r share">${pct(share)}<span class="bar ${r.direction === "drifting" ? "dn" : r.direction === "firming" ? "up" : ""}" style="width:${barW}%"></span></span>
        <span class="r delta ${dv > 0.5 ? "up" : "flatc"}">${dv != null && dv > 0.5 ? "+" + dv.toFixed(0) : "·"}</span>
        <span class="r fair">${r.fair_price ? r.fair_price.toFixed(2) : "–"}${r.fair_source === "engine" ? '<span class="eng" title="sportsdata racing engine fair">E</span>' : ""}</span>
        <span class="r best ${r.value_pct != null && r.value_pct > 0 ? "value" : ""}">${r.corp_best ? r.corp_best.toFixed(2) : "–"}${r.corp_best_book ? ` <span class="bk">${BOOK[r.corp_best_book] || ""}</span>` : ""}</span>
        <span class="r val ${val > 0 ? "pos" : "neg"}">${val != null ? (val > 0 ? "+" : "") + val.toFixed(0) : "·"}</span>
        <span class="r bf">${r.bf_back ? r.bf_back.toFixed(1) : "–"}</span>
        <span class="womcell">${r.bf_wom != null ? `<span class="womb" title="back vs lay pressure"><b style="width:${(r.bf_wom * 100).toFixed(0)}%"></b></span>` : '<span class="flatc">·</span>'}</span>
        <span class="r bfin ${r.bf_money_est ? "" : "z"}">${moneyShort(r.bf_money_est) || "·"}</span>
        <canvas class="spark" height="30" data-points='${esc(JSON.stringify(r.share_spark || []))}' data-dir="${r.direction}"></canvas>
      </div>${expanded ? expandBlock(r, code) : ""}`;
  }

  function expandBlock(r, code) {
    const isGrey = code === "G", isHarness = code === "H";
    const corp = r.corp || {};
    const books = Object.entries(corp).sort((a, z) => z[1] - a[1]).map(([b, px]) => `${BOOK[b] || b} ${px.toFixed(2)}`).join(" · ") || "–";
    const cell = (label, val) => `<div class="exp-cell"><label>${label}</label><b>${val}</b></div>`;
    const opt = (label, val) => (val == null || val === "" ? "" : cell(label, val));

    // runner info — tailored per code
    let info = "";
    if (isGrey) {
      info = opt("BOX", r.barrier) + opt("TRAINER", esc(r.trainer || "")) + opt("BEST TIME", esc(r.best_time || "")) +
             opt("CAREER", esc(r.career || "")) + opt("RUN STYLE", esc(r.speed_band || "")) + opt("LAST 5", esc(r.last5 || "")) +
             opt("🎯 BEST BET", esc(r.best_bet || ""));
    } else {
      info = opt(isHarness ? "DRIVER" : "JOCKEY", esc(r.jockey || "")) + opt("TRAINER", esc(r.trainer || "")) +
             opt("BARRIER", r.barrier) + opt(isHarness ? "MOBILE/HCP" : "WEIGHT", r.weight ? r.weight + "kg" : "") +
             opt("CAREER", esc(r.career || "")) + opt("RUN STYLE", esc(r.speed_band || "")) +
             opt("LAST 5", esc(r.last5 || "")) + opt("FORM RTG", r.form_rating || "") +
             opt("🎯 BEST BET", esc(r.best_bet || ""));
    }

    // market/odds — common to all codes
    const odds =
      cell("TOTE / TAB FIX", (r.tote_win ? r.tote_win.toFixed(2) : "–") + " / " + (r.fixed_win ? r.fixed_win.toFixed(2) : "–")) +
      cell("BETFAIR B / L", (r.bf_back ?? "–") + " / " + (r.bf_lay ?? "–")) +
      opt("WEIGHT OF $", r.bf_wom != null ? (r.bf_wom * 100).toFixed(0) + "% back" : "") +
      cell("FAIR / VALUE", (r.fair_price ? r.fair_price.toFixed(2) : "–") + (r.value_pct != null ? ` / ${r.value_pct > 0 ? "+" : ""}${r.value_pct}%` : "")) +
      cell("BOOKS", books) +
      opt("EST BF IN", moneyShort(r.bf_money_est)) +
      opt("SHORTENING ON", confirmMarkets(r).map((m) => `<span class="up">${m}</span>`).join(" · "));

    return `
      <div class="growexp">
        ${r.comment ? `<div class="exp-comment">${esc(r.comment)}</div>` : ""}
        <div class="exp-sec">RUNNER</div><div class="exp-grid">${info}</div>
        <div class="exp-sec">MARKET</div><div class="exp-grid">${odds}</div>
      </div>`;
  }

  function drawSpark(c) {
    c.width = Math.max(80, Math.round(c.clientWidth || 130));  // fill the TREND column
    const pts = JSON.parse(c.dataset.points || "[]").filter((v) => v != null);
    const ctx = c.getContext("2d"), W = c.width, H = c.height, pad = 3;
    ctx.clearRect(0, 0, W, H);
    if (pts.length < 2) return;
    const mn = Math.min(...pts), mx = Math.max(...pts), rg = (mx - mn) || 1;
    const col = c.dataset.dir === "firming" ? "#21d16b" : c.dataset.dir === "drifting" ? "#ff4d4f" : "#6a6a76";
    const X = (i) => pad + (i / (pts.length - 1)) * (W - 2 * pad);
    const Y = (v) => H - pad - ((v - mn) / rg) * (H - 2 * pad);
    // subtle area + line
    ctx.beginPath(); ctx.moveTo(X(0), H - pad);
    pts.forEach((v, i) => ctx.lineTo(X(i), Y(v)));
    ctx.lineTo(X(pts.length - 1), H - pad); ctx.closePath();
    ctx.fillStyle = col + "1f"; ctx.fill();
    ctx.beginPath(); pts.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)));
    ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.beginPath(); ctx.arc(X(pts.length - 1), Y(pts[pts.length - 1]), 2, 0, 7); ctx.fillStyle = col; ctx.fill();
  }

  // ---------- alerts ----------
  let alertsOn = false, audioCtx = null;
  const alerted = new Set();
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination); o.type = "sine";
      o.frequency.setValueAtTime(1046, audioCtx.currentTime);
      o.frequency.setValueAtTime(1568, audioCtx.currentTime + 0.09);
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.18, audioCtx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.28);
      o.start(); o.stop(audioCtx.currentTime + 0.3);
    } catch {}
  }
  $("alerts").onclick = () => {
    alertsOn = !alertsOn;
    $("alerts").classList.toggle("on", alertsOn);
    if (alertsOn) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
      if (window.Notification && Notification.permission === "default") Notification.requestPermission();
      beep();  // confirm it's on (and unlock audio via the user gesture)
      // don't fire for signals already on screen when enabling
      state.movers.forEach((m) => { if ((m.confirm || 0) >= 3) alerted.add(m.race_key + ":" + m.number); });
    }
  };
  function checkAlerts() {
    if (!alertsOn) return;
    for (const m of state.movers) {
      if ((m.confirm || 0) < 3) continue;            // only strong multi-market steam
      const k = m.race_key + ":" + m.number;
      if (alerted.has(k)) continue;
      alerted.add(k);
      beep();
      if (window.Notification && Notification.permission === "granted") {
        new Notification(`▲ ${ticks(m.confirm)} ${m.runner}`, {
          body: `${m.venue} R${m.race_no} · +${(m.share_delta * 100).toFixed(1)}pt across ${m.confirm} markets`,
          silent: true,
        });
      }
      break;  // at most one alert per update
    }
  }

  // ---------- chrome ----------
  $("conf-filter").onclick = () => {
    state.confirmedOnly = !state.confirmedOnly;
    $("conf-filter").classList.toggle("on", state.confirmedOnly);
    renderSignals();
  };
  $("code-filters").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.codeFilter = b.dataset.code;
    document.querySelectorAll("#code-filters button").forEach((x) => x.classList.toggle("active", x === b));
    renderBoard();
  });
  const th = localStorage.getItem("mf-theme");
  if (th) document.documentElement.setAttribute("data-theme", th);
  $("theme").onclick = () => {
    const c = document.documentElement.getAttribute("data-theme") === "light" ? "" : "light";
    if (c) document.documentElement.setAttribute("data-theme", c); else document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("mf-theme", c);
    if (state.selected) renderDetail();
  };
  setInterval(() => {
    $("clock").textContent = new Date().toLocaleTimeString("en-GB");
    // Update time-to-go text in place — no full board teardown every second.
    document.querySelectorAll("#board .brow[data-key] .ttg").forEach((el) => {
      const r = state.board.find((x) => x.race_key === el.closest("[data-key]").dataset.key);
      if (r && !r.result_winner) {
        const t = ttg(r.start_time);
        if (el.firstChild) el.firstChild.textContent = t;
        el.classList.toggle("soon", (new Date(r.start_time) - Date.now()) < 5 * 60000);
      }
    });
    renderTop();
  }, 1000);

  // price generator — one delegated listener on the persistent #detail node
  $("detail").addEventListener("click", (e) => {
    const bet = e.target.closest(".pxbet");
    if (bet) { pricer.bet = bet.dataset.bet; pricer.picks = []; pricer.legs = []; pricer.result = null; return renderDetail(); }
    if (e.target.closest("#pxadd")) {
      const num = Number($("pxrunner").value);
      if (pricer.bet === "srm") { if (!pricer.legs.some((l) => l.runner === num)) pricer.legs.push({ runner: num, position: $("pxpos").value }); }
      else if (!pricer.picks.includes(num)) pricer.picks.push(num);
      return renderDetail();
    }
    const rm = e.target.closest(".pxchip");
    if (rm) { const i = Number(rm.dataset.rm); (pricer.bet === "srm" ? pricer.legs : pricer.picks).splice(i, 1); pricer.result = null; return renderDetail(); }
    if (e.target.closest("#pxclear")) { pricer.picks = []; pricer.legs = []; pricer.result = null; return renderDetail(); }
    if (e.target.closest("#pxgen")) return computePrice();
  });
  $("detail").addEventListener("change", (e) => { if (e.target.id === "pxbox") { pricer.box = e.target.checked; if (pricer.result) computePrice(); } });

  const api = qs.get("api") || cfg.apiBase;
  if (api) { cfg.apiBase = api; liveConnect(); }
  else if (cfg.forceReplay) startReplay();
  else liveConnect();
})();

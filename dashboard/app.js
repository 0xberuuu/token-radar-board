// Token Value Radar's dashboard. It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, filters, sorting, a
// per-protocol detail view with the model's own arithmetic and the farm plan,
// the live-token tab, and the model explainer. No network: every byte it
// shows is already in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var state = { q: '', cat: 'all', chain: 'all', watch: false, sort: 'implied_value_usd', dir: -1, tab: 'board', sel: null };

  // The model, recomputed in the page from the snapshot figures, so the page's
  // arithmetic and board.json's numbers are visibly the same function.
  function impliedOf(row) {
    var m = DATA.model;
    var growth = Math.min(m.growth_max, Math.max(m.growth_min, row.change_7d === null ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_base + (Math.min(Math.max(age, 0), m.maturity_cap_days) / m.maturity_cap_days) * m.maturity_span;
    var breadth = 1 + Math.min(Math.max(row.chains.length - 1, 0), m.breadth_max_extra) * m.breadth_per_chain;
    return {
      growthPct: growth, growthMult: growthMult, maturityMult: maturity, breadthMult: breadth,
      base: row.tvl_usd * m.tvl_multiple,
      implied: Math.max(1, Math.round(row.tvl_usd * m.tvl_multiple * growthMult * maturity * breadth)),
    };
  }

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtChains(chains) {
    if (!chains || chains.length === 0) return '—';
    if (chains.length <= 3) return chains.join(', ');
    return chains.slice(0, 3).join(', ') + ' +' + (chains.length - 3);
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function $(id) { return document.getElementById(id); }

  // ---- header stats -------------------------------------------------------
  (function stats() {
    var items = [
      ['Snapshot', DATA.as_of],
      ['Scanned', String(DATA.protocols_scanned)],
      ['On the board', String(DATA.board_size)],
      ['Watchlist', String(DATA.watchlist_size)],
      ['Early finds', String(DATA.early_size)],
    ];
    items.forEach(function (it) {
      $('stats').appendChild(el('div', null, el('dt', { text: it[0] }), el('dd', { text: it[1] })));
    });
  })();

  // ---- filter dropdowns ---------------------------------------------------
  (function options() {
    var cats = {}, chains = {};
    DATA.rows.forEach(function (r) {
      if (r.category) cats[r.category] = 1;
      r.chains.forEach(function (c) { chains[c] = 1; });
    });
    Object.keys(cats).sort().forEach(function (c) {
      $('cat').appendChild(el('option', { value: c, text: c }));
    });
    Object.keys(chains).sort().forEach(function (c) {
      $('chain').appendChild(el('option', { value: c, text: c }));
    });
  })();

  // ---- filtering + sorting -------------------------------------------------
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watch && !r.on_watchlist) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort, dir = state.dir;
    rows.sort(function (a, b) {
      var va, vb;
      if (key === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
      else if (key === 'category') { va = (a.category || '').toLowerCase(); vb = (b.category || '').toLowerCase(); }
      else if (key === 'chains') { va = a.chains.length; vb = b.chains.length; }
      else if (key === 'change_7d') { va = a.change_7d === null ? -Infinity : a.change_7d; vb = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age_days') { va = a.age_days === null ? -1 : a.age_days; vb = b.age_days === null ? -1 : b.age_days; }
      else { va = a[key]; vb = b[key]; }
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.rank - b.rank;
    });
    return rows;
  }

  function renderBoard() {
    var rows = filtered();
    var tbody = $('rows');
    tbody.textContent = '';
    rows.forEach(function (r) {
      var tr = el('tr', { 'class': state.sel === r.slug ? 'sel' : '', onclick: function () { select(r.slug); } });
      tr.appendChild(el('td', { 'class': 'num', text: String(r.rank) }));
      var nameCell = el('td', null, el('span', { 'class': 'name', text: r.name }));
      nameCell.appendChild(document.createTextNode(' '));
      nameCell.appendChild(el('span', { 'class': 'slug', text: r.slug }));
      if (r.on_watchlist) nameCell.appendChild(el('span', { 'class': 'badge', text: 'WATCHLIST' }));
      tr.appendChild(nameCell);
      tr.appendChild(el('td', { text: r.category || '—' }));
      tr.appendChild(el('td', { text: fmtChains(r.chains) }));
      tr.appendChild(el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }));
      var chg = el('td', { 'class': 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) });
      tr.appendChild(chg);
      tr.appendChild(el('td', { 'class': 'num', text: fmtAge(r.age_days) }));
      tr.appendChild(el('td', { 'class': 'num imp', text: fmtUsd(r.implied_value_usd) }));
      tbody.appendChild(tr);
    });
    $('count').textContent = rows.length + ' of ' + DATA.board_size + ' protocols';
    $('foot').textContent = 'Snapshot ' + DATA.as_of + ' · ' + DATA.source +
      ' · Implied values are this radar\u2019s own claim from the snapshot\u2019s figures, never a prediction that a token issues, or when.';
    document.querySelectorAll('#board thead th').forEach(function (th) {
      th.classList.toggle('sorted', th.getAttribute('data-sort') === state.sort);
    });
  }

  // ---- detail view ---------------------------------------------------------
  function select(slug) {
    state.sel = slug;
    renderBoard();
    renderDetail();
    syncHash();
  }

  function renderDetail() {
    var box = $('detail');
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === state.sel) row = r; });
    if (!row) { box.hidden = true; box.textContent = ''; return; }
    var calc = impliedOf(row);
    box.hidden = false;
    box.textContent = '';
    box.appendChild(el('button', { 'class': 'close', text: 'Close ✕', onclick: function () { select(null); } }));
    box.appendChild(el('h2', { text: '#' + row.rank + ' · ' + row.name }));
    box.appendChild(el('p', { 'class': 'meta', text: row.slug + (row.on_watchlist ? ' · on the snapshot\u2019s watchlist' : ' · early find below the watchlist floor') + ' · records no token' }));
    var facts = el('dl', { 'class': 'facts' });
    [['TVL', fmtUsd(row.tvl_usd)], ['7-day change', fmtPct(row.change_7d)], ['Age', fmtAge(row.age_days)],
     ['Category', row.category || '—'], ['Chains', fmtChains(row.chains)], ['Implied value', fmtUsd(row.implied_value_usd)]
    ].forEach(function (f) {
      facts.appendChild(el('div', null, el('dt', { text: f[0] }), el('dd', { text: f[1] })));
    });
    box.appendChild(facts);
    box.appendChild(el('h3', { text: 'How the implied value is computed' }));
    var math = el('table', { 'class': 'math' });
    var m = DATA.model;
    [
      ['Base', fmtUsd(row.tvl_usd) + ' TVL × ' + m.tvl_multiple, fmtUsd(calc.base)],
      ['Growth', fmtPct(calc.growthPct) + ' over 7 days', '× ' + calc.growthMult.toFixed(4)],
      ['Maturity', fmtAge(row.age_days) + ' old', '× ' + calc.maturityMult.toFixed(4)],
      ['Breadth', row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's'), '× ' + calc.breadthMult.toFixed(4)],
    ].forEach(function (line) {
      var tr = el('tr', null, el('td', { text: line[0] }), el('td', { text: line[1] }), el('td', { text: line[2] }));
      math.appendChild(tr);
    });
    math.appendChild(el('tr', { 'class': 'total' }, el('td', { text: 'Implied value' }), el('td', { text: 'rounded to whole dollars' }), el('td', { text: fmtUsd(calc.implied) })));
    box.appendChild(math);
    box.appendChild(el('h3', { text: 'Farm plan — what to do, what it costs, how long it takes' }));
    var ol = el('ol', { 'class': 'steps' });
    row.farm_steps.forEach(function (s) { ol.appendChild(el('li', { text: s })); });
    box.appendChild(ol);
  }

  // ---- live tab ------------------------------------------------------------
  function renderLive() {
    var tbody = $('liveRows');
    tbody.textContent = '';
    DATA.live.forEach(function (r) {
      var tr = el('tr', null,
        el('td', null, el('span', { 'class': 'name', text: r.name }), document.createTextNode(' '), el('span', { 'class': 'slug', text: r.slug })),
        el('td', { text: r.category || '—' }),
        el('td', { text: fmtChains(r.chains) }),
        el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { 'class': 'num imp', text: fmtUsd(r.mcap_usd) }),
        el('td', { 'class': 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }));
      tbody.appendChild(tr);
    });
  }

  // ---- model tab -----------------------------------------------------------
  function renderModel() {
    var m = DATA.model;
    var top = DATA.rows[0];
    var calc = top ? impliedOf(top) : null;
    var box = $('modelWrap');
    box.textContent = '';
    box.appendChild(el('h2', { text: 'How the model works' }));
    box.appendChild(el('p', { text: 'Every implied value on the board comes from one formula, applied to the snapshot\u2019s own figures. No protocol name is ever special-cased, and the same function scores every row. The model version is ' + DATA.model_version + '.' }));
    box.appendChild(el('pre', { text:
      'base      = tvl_usd × ' + m.tvl_multiple + '\n' +
      'growth    = clamp(change_7d, ' + m.growth_min + ', ' + m.growth_max + ') per cent\n' +
      'growth ×  = 1 + (growth / 100) × ' + m.growth_weight + '\n' +
      'maturity  = ' + m.maturity_base + ' + min(age_days, ' + m.maturity_cap_days + ') / ' + m.maturity_cap_days + ' × ' + m.maturity_span + '\n' +
      'breadth   = 1 + min(chains − 1, ' + m.breadth_max_extra + ') × ' + m.breadth_per_chain + '\n' +
      'implied   = max(1, round(base × growth × maturity × breadth))' }));
    box.appendChild(el('p', { text: 'Age is the days from listed_at to the snapshot date; when the snapshot records no listing date, ' + m.unknown_age_days + ' days is assumed. A protocol whose 7-day change is unreported scores growth as zero. The board holds every protocol on the snapshot\u2019s watchlist plus every other rankable protocol that records no token — ' + DATA.board_size + ' rows in all, ' + DATA.early_size + ' of them early finds below the watchlist floor of ' + fmtUsd(DATA.floor_usd) + '.' }));
    if (top && calc) {
      box.appendChild(el('h3', { text: 'Worked example — the board\u2019s rank 1, ' + top.name }));
      var t = el('table', null);
      [['TVL', fmtUsd(top.tvl_usd)], ['7-day change', fmtPct(top.change_7d)], ['Age', fmtAge(top.age_days)],
       ['Chains', String(top.chains.length)], ['Base', fmtUsd(calc.base)],
       ['Growth multiplier', '× ' + calc.growthMult.toFixed(4)], ['Maturity multiplier', '× ' + calc.maturityMult.toFixed(4)],
       ['Breadth multiplier', '× ' + calc.breadthMult.toFixed(4)], ['Implied value', fmtUsd(calc.implied)]
      ].forEach(function (line) {
        t.appendChild(el('tr', null, el('td', { text: line[0] }), el('td', { text: line[1] })));
      });
      box.appendChild(t);
    }
    box.appendChild(el('p', { 'class': 'warn', text: 'Honesty note: “records no token” means the snapshot records none — a protocol may still have a token its record does not carry. An implied value is this radar\u2019s own claim, never a prediction that a token issues, or when, and never financial advice.' }));
  }

  // ---- tabs + controls ------------------------------------------------------
  function showTab(tab) {
    state.tab = tab;
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === tab);
    });
    $('boardWrap').hidden = tab !== 'board';
    $('controls').style.display = tab === 'board' ? '' : 'none';
    $('detail').hidden = tab !== 'board' || !state.sel;
    $('liveWrap').hidden = tab !== 'live';
    $('modelWrap').hidden = tab !== 'model';
    if (tab === 'live') renderLive();
    if (tab === 'model') renderModel();
    syncHash();
  }
  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
  });
  document.querySelectorAll('#board thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' || key === 'category' ? 1 : -1; }
      renderBoard();
      syncHash();
    });
  });
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); syncHash(); });
  $('cat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); syncHash(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); syncHash(); });
  $('watch').addEventListener('change', function (e) { state.watch = e.target.checked; renderBoard(); syncHash(); });

  // ---- shareable state in the URL hash --------------------------------------
  function syncHash() {
    var parts = [];
    if (state.tab !== 'board') parts.push('tab=' + state.tab);
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.cat !== 'all') parts.push('cat=' + encodeURIComponent(state.cat));
    if (state.chain !== 'all') parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.watch) parts.push('watch=1');
    if (state.sort !== 'implied_value_usd' || state.dir !== -1) parts.push('sort=' + state.sort + ':' + state.dir);
    if (state.sel) parts.push('detail=' + encodeURIComponent(state.sel));
    history.replaceState(null, '', parts.length ? '#' + parts.join('&') : ' ');
  }
  function readHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return;
    h.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      var k = kv[0], v = decodeURIComponent(kv[1] || '');
      if (k === 'tab' && (v === 'board' || v === 'live' || v === 'model')) state.tab = v;
      else if (k === 'q') state.q = v;
      else if (k === 'cat') state.cat = v;
      else if (k === 'chain') state.chain = v;
      else if (k === 'watch') state.watch = v === '1';
      else if (k === 'sort') { var s = v.split(':'); state.sort = s[0]; state.dir = s[1] === '1' ? 1 : -1; }
      else if (k === 'detail') state.sel = v || null;
    });
  }

  readHash();
  $('q').value = state.q;
  $('cat').value = state.cat;
  $('chain').value = state.chain;
  $('watch').checked = state.watch;
  renderBoard();
  renderDetail();
  showTab(state.tab);
})();

/* Pricing assistant concept: six interaction states of an AI feature in an analytics product.
   All data is invented. No network calls; everything runs in the page. */
(function () {
  'use strict';
  var root = document.querySelector('[data-pa]');
  if (!root) return;
  var app = root.querySelector('[data-app]');
  var ruleEl = root.querySelector('[data-rule]');
  var live = root.querySelector('[data-live]');
  var tabs = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]'));
  var playBtn = root.querySelector('[data-play]');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var QUESTION = 'Which products lost margin after last week’s price changes, and why?';
  var DRIVERS = ['Price elasticity', 'Supplier cost increase', 'Promo depth', 'Competitor undercut', 'Stock-out, not price', 'Other'];
  var ROWS = [
    { id: 'oat', name: 'Oat milk 1.89 L', change: '+$0.30', units: '−14%', margin: -4180, driver: 'Price elasticity', conf: 'high', comp: true,
      why: 'Units fell 14% in the week the price rose, while the two nearest competitors held their price. Elasticity from the last 26 weeks predicts a 12–16% drop.',
      src: ['POS wk 41–42', 'Price file v3', 'Competitor feed'] },
    { id: 'yog', name: 'Greek yogurt 750 g', change: '+$0.40', units: '−3%', margin: -2960, driver: 'Price elasticity', conf: 'medium', comp: false,
      why: 'Units barely moved, so elasticity explains only part of the loss. Medium confidence: the cost file for this supplier was last updated in week 39.',
      src: ['POS wk 41–42', 'Price file v3', 'Cost file (wk 39)'] },
    { id: 'cof', name: 'Coffee beans 340 g', change: '−$1.00 promo', units: '+22%', margin: -1870, driver: 'Promo depth', conf: 'high', comp: false,
      why: 'The promotion lifted units 22%, but at this discount it needed about 31% to break even on margin.',
      src: ['POS wk 41–42', 'Promo calendar'] },
    { id: 'spk', name: 'Sparkling water 12-pack', change: '+$0.50', units: '−9%', margin: -1240, driver: 'Competitor undercut', conf: 'medium', comp: true,
      why: 'A competitor priced this pack $0.70 lower from Tuesday. Units fell 9% from that day.',
      src: ['POS wk 41–42', 'Competitor feed'] },
    { id: 'egg', name: 'Free-range eggs, 12', change: '+$0.20', units: '−11%', margin: -790, driver: 'Stock-out, not price', conf: 'medium', comp: false,
      why: 'Shelves were empty Tuesday to Thursday in 14 of 38 stores. The loss follows the stock-out, not the price change.',
      src: ['POS wk 41–42', 'Inventory'] }
  ];
  var STEPS = [
    { label: 'Read week 42 price changes', detail: 'Price file v3 · 312 products changed' },
    { label: 'Join point-of-sale sales for weeks 41–42', detail: 'POS · 1.2 M transactions' },
    { label: 'Compare competitor prices', detail: 'Competitor feed · 2 banners' },
    { label: 'Rank by margin impact and explain drivers', detail: 'Elasticity, cost, promo and stock models' }
  ];
  var RULES = {
    ready: 'Rule: never open on a blank prompt. Offer tasks from the user’s own workspace and show which data the assistant can see.',
    working: 'Rule: show the plan and its data sources while it runs, and let the user stop it without losing finished steps.',
    result: 'Rule: return work the user can check and edit. Every row has a confidence level, its sources and a plain reason.',
    low: 'Rule: when data is weak, flag the affected rows, say why, and offer to refresh, exclude or keep with a note.',
    error: 'Rule: say what failed in plain words, keep completed steps, and offer a retry or a way forward without the failed source.',
    corrected: 'Rule: record what the user changed, why, and where the change applies. Never update silently.'
  };

  var S;
  var timers = [];
  function reset() {
    S = { state: 'ready', step: 0, stepState: [], stopped: false, feed: 'fresh', excluded: {}, notes: {}, corrections: {}, audit: [], open: null, editing: null, noting: null, toast: '' };
  }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function later(fn, ms) { timers.push(setTimeout(fn, reduce ? Math.min(ms, 60) : ms)); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { var a = Math.abs(n).toLocaleString('en-US'); return (n < 0 ? '−$' : '+$') + a; }

  /* ---------- Derived row view for the current state ---------- */
  function rowView(r) {
    var v = { conf: r.conf, cause: '', driver: r.driver, src: r.src.slice() };
    if (S.feed === 'stale' && r.comp) {
      if (r.id === 'spk') { v.conf = 'low'; v.cause = 'Competitor price is 9 days old.'; }
      else { v.conf = 'medium'; v.cause = 'Competitor price is 9 days old.'; }
      v.src = v.src.map(function (s) { return s === 'Competitor feed' ? 'Competitor feed (9 days old)' : s; });
    }
    if ((S.feed === 'down' || S.feed === 'skipped') && r.comp) {
      v.conf = 'low'; v.cause = 'Competitor prices not included.';
      v.driver = r.id === 'spk' ? 'Unknown without competitor data' : r.driver;
      v.src = v.src.filter(function (s) { return s !== 'Competitor feed'; });
    }
    if (S.feed === 'refreshed' && r.id === 'spk') { v.conf = 'medium'; v.cause = ''; }
    var c = S.corrections[r.id];
    if (c) { v.driver = c.to; v.conf = 'high'; v.corrected = c; }
    return v;
  }

  /* ---------- Rendering ---------- */
  function feedChip() {
    var map = {
      fresh: ['ok', 'Competitor feed · updated today'],
      refreshed: ['ok', 'Competitor feed · refreshed just now'],
      stale: ['warn', 'Competitor feed · 9 days old'],
      down: ['bad', 'Competitor feed · not responding'],
      skipped: ['bad', 'Competitor feed · not used']
    }[S.feed];
    return '<span class="pa-chip pa-chip--' + map[0] + '">' + map[1] + '</span>';
  }
  function chrome(inner) {
    return '<div class="pa-top"><div class="pa-brand"><span class="pa-logo" aria-hidden="true">N</span><span><b>Northfield Grocers</b> · Pricing workspace</span></div>' +
      '<span class="pa-week">Week 42</span></div>' +
      '<div class="pa-data" aria-label="Data the assistant can see"><span class="pa-chip pa-chip--ok">POS · updated today</span><span class="pa-chip pa-chip--ok">Price file v3</span><span class="pa-chip pa-chip--ok">Cost file</span>' + feedChip() + '</div>' +
      '<div class="pa-body">' + inner + '</div>' +
      '<form class="pa-composer" data-composer><label class="pa-sr" for="pa-input">Ask about your pricing data</label><input id="pa-input" name="q" autocomplete="off" placeholder="Ask about your pricing data…"' + (S.state === 'working' ? ' disabled' : '') + '><button type="submit"' + (S.state === 'working' ? ' disabled' : '') + '>Ask</button></form>' +
      (S.toast ? '<div class="pa-toast" role="status">' + esc(S.toast) + '</div>' : '');
  }
  function question() { return '<div class="pa-q"><span class="pa-q-label">You asked</span><p>' + esc(QUESTION) + '</p></div>'; }

  function viewReady() {
    return '<h3 class="pa-h">What do you want to check this week?</h3>' +
      '<div class="pa-starters">' +
      '<button type="button" class="pa-starter pa-starter--primary" data-run>' +
      '<span class="pa-starter-k">Margin</span><span class="pa-starter-t">Which products lost margin after last week’s price changes, and why?</span><span class="pa-starter-m">Uses POS, price file, cost file, competitor feed</span></button>' +
      '<button type="button" class="pa-starter" data-demo-only><span class="pa-starter-k">Competitors</span><span class="pa-starter-t">Where are we priced above competitors on our top 50 products?</span><span class="pa-starter-m">Uses competitor feed, price file</span></button>' +
      '<button type="button" class="pa-starter" data-demo-only><span class="pa-starter-k">Promotions</span><span class="pa-starter-t">Did last month’s promotions pay for themselves?</span><span class="pa-starter-m">Uses POS, promo calendar</span></button>' +
      '</div>' +
      '<p class="pa-limits">The assistant can see the four sources listed above. It can\u2019t see supplier contracts or store staffing, so it won\u2019t guess at them.</p>';
  }
  function viewWorking() {
    var html = question() + '<div class="pa-plan" aria-label="Plan"><div class="pa-plan-head"><b>Plan</b><span>' + (S.stopped ? 'Stopped. Finished steps are kept.' : 'Working…') + '</span></div><ol>';
    STEPS.forEach(function (st, i) {
      var s = S.stepState[i] || 'pending';
      var label = { done: 'Done', active: 'In progress', pending: 'Waiting', failed: 'Failed' }[s];
      html += '<li class="pa-step pa-step--' + s + '"><span class="pa-step-ico" aria-hidden="true"></span><span class="pa-step-t"><b>' + esc(st.label) + '</b><small>' + esc(st.detail) + '</small></span><span class="pa-step-s">' + label + '</span></li>';
    });
    html += '</ol><div class="pa-plan-actions">' + (S.stopped ? '<button type="button" class="pa-btn pa-btn--primary" data-resume>Resume</button>' : '<button type="button" class="pa-btn" data-stop>Stop</button>') + '</div></div>';
    return html;
  }
  function confBadge(v) {
    var t = { high: 'High', medium: 'Medium', low: 'Low' }[v.conf];
    return '<span class="pa-conf pa-conf--' + v.conf + '"><span aria-hidden="true"></span>' + t + '</span>';
  }
  function viewResult() {
    var views = {}; ROWS.forEach(function (r) { views[r.id] = rowView(r); });
    var active = ROWS.filter(function (r) { return !S.excluded[r.id]; });
    var total = active.reduce(function (a, r) { return a + r.margin; }, 0);
    var lowRows = ROWS.filter(function (r) { return views[r.id].conf === 'low' && !S.excluded[r.id]; });
    var html = question();
    if (S.feed === 'down') {
      html += '<div class="pa-banner pa-banner--bad" role="alert"><div><b>Couldn’t reach the competitor price feed.</b> It didn’t answer within 30 seconds. Steps 1, 2 and 4 are done and kept below; competitor gaps are not included.</div>' +
        '<div class="pa-banner-actions"><button type="button" class="pa-btn pa-btn--primary" data-retry>Retry the feed</button><button type="button" class="pa-btn" data-skip>Continue without it</button></div></div>';
    } else if (S.feed === 'skipped') {
      html += '<div class="pa-banner pa-banner--info"><div>Continuing without competitor prices. Rows that need them are marked low confidence.</div><div class="pa-banner-actions"><button type="button" class="pa-btn" data-retry>Retry the feed</button></div></div>';
    } else if (lowRows.length) {
      html += '<div class="pa-banner pa-banner--warn"><div><b>' + lowRows.length + (lowRows.length === 1 ? ' result is' : ' results are') + ' low confidence.</b> The competitor feed is 9 days old, so competitor-driven rows may be out of date.</div>' +
        '<div class="pa-banner-actions"><button type="button" class="pa-btn pa-btn--primary" data-refresh>Refresh competitor feed</button></div></div>';
    } else if (S.feed === 'refreshed') {
      html += '<div class="pa-banner pa-banner--ok" role="status"><div>Competitor feed refreshed. Sparkling water is now medium confidence.</div></div>';
    }
    html += '<p class="pa-summary"><b>' + active.length + ' products lost ' + money(total).replace('−', '') + '</b> in weekly margin after the week 42 price changes. Largest: oat milk.</p>';
    html += '<div class="pa-table-wrap"><table class="pa-table"><caption class="pa-sr">Products that lost margin, with drivers, confidence and sources</caption><thead><tr><th scope="col">Product</th><th scope="col">Price change</th><th scope="col">Units</th><th scope="col">Margin</th><th scope="col">Likely driver</th><th scope="col">Confidence</th><th scope="col"><span class="pa-sr">Actions</span></th></tr></thead><tbody>';
    ROWS.forEach(function (r) {
      var v = views[r.id];
      var ex = !!S.excluded[r.id];
      html += '<tr class="' + (ex ? 'is-excluded ' : '') + (v.conf === 'low' ? 'is-low ' : '') + (v.corrected ? 'is-corrected' : '') + '">' +
        '<th scope="row" data-l="Product">' + esc(r.name) + (ex ? ' <span class="pa-tag">Excluded</span>' : '') + '</th>' +
        '<td data-l="Price change">' + esc(r.change) + '</td><td data-l="Units">' + esc(r.units) + '</td>' +
        '<td data-l="Margin" class="pa-num">' + money(r.margin) + '</td>' +
        '<td data-l="Likely driver">' + esc(v.driver) + (v.corrected ? ' <span class="pa-tag pa-tag--you">Corrected by you</span>' : '') + '</td>' +
        '<td data-l="Confidence">' + confBadge(v) + (v.cause ? '<small class="pa-cause">' + esc(v.cause) + '</small>' : '') + '</td>' +
        '<td class="pa-actions"><button type="button" class="pa-link" data-why="' + r.id + '" aria-expanded="' + (S.open === r.id) + '">Why</button>' +
        (S.state === 'error' ? '' : '<button type="button" class="pa-link" data-edit="' + r.id + '">Correct</button>') + '</td></tr>';
      if (S.open === r.id) {
        html += '<tr class="pa-detail"><td colspan="7"><p>' + esc(r.why) + '</p><div class="pa-src">' + v.src.map(function (s) { return '<span class="pa-chip">' + esc(s) + '</span>'; }).join('') + '</div>' +
          (v.corrected ? '<p class="pa-corr-note"><b>Your correction:</b> ' + esc(v.corrected.from) + ' → ' + esc(v.corrected.to) + '. Reason: ' + esc(v.corrected.reason) + '</p>' : '') +
          (S.notes[r.id] ? '<p class="pa-corr-note"><b>Your note:</b> ' + esc(S.notes[r.id]) + '</p>' : '') + '</td></tr>';
      }
      if (v.conf === 'low' && S.feed === 'stale' && !ex && S.noting !== r.id && !S.notes[r.id]) {
        html += '<tr class="pa-detail pa-detail--low"><td colspan="7"><span>Low confidence: ' + esc(v.cause) + ' What do you want to do?</span>' +
          '<span class="pa-row-actions"><button type="button" class="pa-btn pa-btn--primary" data-refresh>Refresh feed</button><button type="button" class="pa-btn" data-exclude="' + r.id + '">Exclude row</button><button type="button" class="pa-btn" data-note="' + r.id + '">Keep with note</button></span></td></tr>';
      }
      if (S.noting === r.id) {
        html += '<tr class="pa-detail"><td colspan="7"><form class="pa-form" data-note-form="' + r.id + '"><label for="pa-note">Note for reviewers</label><input id="pa-note" name="note" required placeholder="e.g. Competitor promo ended Friday; recheck next week"><span class="pa-row-actions"><button type="submit" class="pa-btn pa-btn--primary">Keep row with note</button><button type="button" class="pa-btn" data-cancel>Cancel</button></span></form></td></tr>';
      }
      if (S.editing === r.id) {
        html += '<tr class="pa-detail"><td colspan="7"><form class="pa-form" data-edit-form="' + r.id + '"><label for="pa-driver">Driver</label><select id="pa-driver" name="driver">' +
          DRIVERS.map(function (d) { return '<option' + (d === v.driver ? ' selected' : '') + '>' + esc(d) + '</option>'; }).join('') + '</select>' +
          '<label for="pa-reason">Why? Reviewers and the assistant will see this.</label><input id="pa-reason" name="reason" required placeholder="e.g. Supplier invoice for week 41 shows a 6% cost increase">' +
          '<p class="pa-scope">Applies to: this workspace. Logged in the audit trail.</p><span class="pa-row-actions"><button type="submit" class="pa-btn pa-btn--primary">Save correction</button><button type="button" class="pa-btn" data-cancel>Cancel</button></span></form></td></tr>';
      }
    });
    html += '</tbody></table></div>';
    html += '<div class="pa-foot"><button type="button" class="pa-btn" data-demo-only>Add to review list</button><button type="button" class="pa-btn" data-demo-only>Export CSV</button><span class="pa-foot-src">Plan: 4 steps · Sources listed per row under <b>Why</b></span></div>';
    if (S.audit.length) {
      html += '<div class="pa-audit"><b>Audit trail</b><ol>' + S.audit.map(function (a) { return '<li><span>' + esc(a.t) + '</span><div>' + a.html + '</div></li>'; }).join('') + '</ol></div>';
    }
    return html;
  }

  function focusKey() {
    var a = document.activeElement;
    if (!a || !app.contains(a)) return null;
    var attrs = ['data-why', 'data-edit', 'data-note', 'data-exclude', 'data-refresh', 'data-retry', 'data-skip', 'data-stop', 'data-resume', 'data-run', 'data-demo-only'];
    for (var i = 0; i < attrs.length; i++) if (a.hasAttribute(attrs[i])) { var v = a.getAttribute(attrs[i]); return '[' + attrs[i] + (v ? '="' + v + '"' : '') + ']'; }
    return a.id ? '#' + a.id : null;
  }
  function announce() {
    if (!live) return;
    var msg = { ready: 'Ready. Choose a task.', result: 'Result: 5 products with drivers and confidence.', low: '', error: '', corrected: 'Correction recorded in the audit trail.' }[S.state] || '';
    if (S.state === 'working') {
      var done = S.stepState.filter(function (x) { return x === 'done'; }).length;
      msg = S.stopped ? 'Stopped. Finished steps are kept.' : 'Working: step ' + Math.min(done + 1, 4) + ' of 4.';
    }
    if (S.state !== 'working' && S.feed === 'down') msg = 'Error: the competitor price feed did not respond. Finished steps are kept.';
    if (S.feed === 'stale' && S.state !== 'working') msg = 'One result is low confidence: competitor prices are 9 days old.';
    if (S.toast) msg = S.toast;
    if (live.textContent !== msg) live.textContent = msg;
  }
  function render() {
    var key = focusKey();
    var inner = S.state === 'ready' ? viewReady() : S.state === 'working' ? viewWorking() : viewResult();
    app.innerHTML = chrome(inner);
    if (key) { var el = app.querySelector(key); (el || app).focus(); }
    announce();
    ruleEl.textContent = RULES[S.state];
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-state') === S.state;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
  }

  /* ---------- Transitions ---------- */
  function go(state, opts) {
    clearTimers();
    opts = opts || {};
    reset();
    S.state = state;
    if (state === 'working') { run('fresh'); return; }
    if (state === 'low') S.feed = 'stale';
    if (state === 'error') { run('down'); return; }
    if (state === 'corrected') {
      S.corrections.yog = { from: 'Price elasticity', to: 'Supplier cost increase', reason: 'Supplier invoice for week 41 shows a 6% cost increase.' };
      S.open = 'yog';
      S.audit = [
        { t: 'Today 10:42', html: 'Analysis run: week 42 price changes, 4 steps, 5 products' },
        { t: 'Today 10:44', html: 'You changed the driver for <b>Greek yogurt 750 g</b>: Price elasticity → Supplier cost increase. Reason: “Supplier invoice for week 41 shows a 6% cost increase.” Applies to this workspace.' },
        { t: 'Today 10:44', html: 'Summary updated. Correction available to reviewers.' }
      ];
    }
    render();
  }
  function run(feed) {
    S.state = 'working'; S.feed = feed; S.stopped = false;
    S.stepState = ['active', 'pending', 'pending', 'pending']; S.step = 0;
    render();
    advance();
  }
  function advance() {
    if (S.stopped) return;
    later(function () {
      if (S.stopped) return;
      var i = S.step;
      if (i === 2 && S.feed === 'down') {
        S.stepState[2] = 'failed'; S.stepState[3] = 'done'; render();
        later(function () { S.state = 'error'; render(); }, 900);
        return;
      }
      S.stepState[i] = 'done';
      if (i < STEPS.length - 1) { S.step = i + 1; S.stepState[i + 1] = 'active'; render(); advance(); }
      else { render(); later(function () { S.state = 'result'; S.audit = []; render(); }, 500); }
    }, 850);
  }

  /* ---------- Events ---------- */
  app.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || b.type === 'submit') return;
    S.toast = '';
    if (b.hasAttribute('data-run')) { clearTimers(); reset(); run('fresh'); return; }
    if (b.hasAttribute('data-demo-only')) { S.toast = 'Not part of this demo. The margin task shows the full flow.'; render(); return; }
    if (b.hasAttribute('data-stop')) { S.stopped = true; clearTimers(); render(); return; }
    if (b.hasAttribute('data-resume')) { S.stopped = false; render(); advance(); return; }
    if (b.hasAttribute('data-retry')) { clearTimers(); var keep = S.corrections; reset(); S.corrections = keep; run('fresh'); return; }
    if (b.hasAttribute('data-skip')) { S.feed = 'skipped'; S.state = 'result'; render(); return; }
    if (b.hasAttribute('data-refresh')) {
      b.disabled = true; b.textContent = 'Refreshing…';
      later(function () { S.feed = 'refreshed'; S.excluded = {}; render(); }, 900);
      return;
    }
    if (b.hasAttribute('data-exclude')) { var id = b.getAttribute('data-exclude'); S.excluded[id] = true; S.audit.push({ t: 'Just now', html: 'You excluded <b>' + esc(nameOf(id)) + '</b> from the summary.' }); render(); return; }
    if (b.hasAttribute('data-note')) { S.noting = b.getAttribute('data-note'); render(); focusFirst('[data-note-form] input'); return; }
    if (b.hasAttribute('data-why')) { var w = b.getAttribute('data-why'); S.open = S.open === w ? null : w; render(); focusFirst('[data-why="' + w + '"]'); return; }
    if (b.hasAttribute('data-edit')) { S.editing = b.getAttribute('data-edit'); S.open = null; render(); focusFirst('[data-edit-form] select'); return; }
    if (b.hasAttribute('data-cancel')) { S.editing = null; S.noting = null; render(); return; }
  });
  app.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    if (f.hasAttribute('data-composer')) {
      var q = (f.q.value || '').trim();
      if (!q) { f.q.focus(); return; }
      clearTimers(); reset(); run('fresh');
      return;
    }
    if (f.hasAttribute('data-edit-form')) {
      var id = f.getAttribute('data-edit-form');
      var r = ROWS.filter(function (x) { return x.id === id; })[0];
      var to = f.driver.value, reason = (f.reason.value || '').trim();
      if (!reason) { f.reason.focus(); return; }
      var from = rowView(r).driver;
      S.corrections[id] = { from: from, to: to, reason: reason };
      if (!S.audit.length) S.audit.push({ t: 'Today 10:42', html: 'Analysis run: week 42 price changes, 4 steps, 5 products' });
      S.audit.push({ t: 'Just now', html: 'You changed the driver for <b>' + esc(r.name) + '</b>: ' + esc(from) + ' → ' + esc(to) + '. Reason: “' + esc(reason) + '” Applies to this workspace.' });
      S.editing = null; S.open = id; S.state = 'corrected';
      render();
      return;
    }
    if (f.hasAttribute('data-note-form')) {
      var nid = f.getAttribute('data-note-form');
      var note = (f.note.value || '').trim();
      if (!note) { f.note.focus(); return; }
      S.notes[nid] = note; S.noting = null; S.open = nid;
      S.audit.push({ t: 'Just now', html: 'You kept <b>' + esc(nameOf(nid)) + '</b> with a note: “' + esc(note) + '”' });
      render();
    }
  });
  function nameOf(id) { return ROWS.filter(function (x) { return x.id === id; })[0].name; }
  function focusFirst(sel) { var el = app.querySelector(sel); if (el) el.focus(); }

  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { stopPlay(); go(t.getAttribute('data-state')); });
    t.addEventListener('keydown', function (e) {
      var n = null;
      if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
      if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
      if (e.key === 'Home') n = 0;
      if (e.key === 'End') n = tabs.length - 1;
      if (n !== null) { e.preventDefault(); tabs[n].focus(); stopPlay(); go(tabs[n].getAttribute('data-state')); }
    });
  });

  /* ---------- Play the full flow ---------- */
  var playing = false, playTimers = [];
  function stopPlay() { playing = false; playTimers.forEach(clearTimeout); playTimers = []; playBtn.textContent = 'Play the full flow'; playBtn.setAttribute('aria-pressed', 'false'); }
  function at(fn, ms) { playTimers.push(setTimeout(fn, ms)); }
  playBtn.addEventListener('click', function () {
    if (playing) { stopPlay(); return; }
    playing = true; playBtn.textContent = 'Stop playing'; playBtn.setAttribute('aria-pressed', 'true');
    go('ready');
    at(function () { clearTimers(); reset(); run('fresh'); }, 2200);
    at(function () { go('low'); }, 9000);
    at(function () { go('error'); }, 14000);
    at(function () { go('corrected'); }, 19000);
    at(function () { stopPlay(); }, 19500);
  });

  reset();
  render();
})();

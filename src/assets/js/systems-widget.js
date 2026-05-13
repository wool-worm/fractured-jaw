// Systems-status widget. Pinned left-center of every page. Renders a
// "monitoring panel" — antenna states, animated load bars, a buffer
// spinner, and real site stats (post / tag / word counts + the
// intercepted-origin author race fed by /system-status.json).
//
// Animations:
//   - Two oscillating bars (core_load, signal) — driven by CSS
//     keyframes; JS polls the rendered width to render the current
//     percentage as text alongside the bar.
//   - Buffer spinner — braille-pattern frames cycled by JS.
//   - Antenna states — each band's state rotates on a timer; the
//     rotation is deterministic-ish (hashed off (band, timeBucket))
//     so the panel feels machine-driven rather than purely random.
//
// Real data:
//   - Fetched once from /system-status.json (emitted by
//     src/system-status.11ty.js). The intercepted-origin race pads
//     with stylized synthetic entries when there are fewer than three
//     real authors, so the bar race always has visual rhythm without
//     fabricating real handles.

(function () {
  if (typeof document === "undefined") return;

  var shell = document.getElementById("systems-widget");
  if (!shell) return;

  var foldBtn = document.getElementById("systems-widget-fold");

  // ── State ───────────────────────────────────────────────────────────────
  var folded = false;

  // ── Encryption state machine ────────────────────────────────────────────
  // Most of the time the encryption row reads "active" (green letters,
  // green dot). Occasionally it fails — the row turns blood red, a
  // warning triangle replaces the dot, and a scrolling banner appears
  // at the top of the widget. Failures last exactly 60s, then return
  // to active.
  //
  // Timing constants below. The long-run failure ratio depends on
  // ENCRYPTION_FAILURE_MS vs the mean of ENCRYPTION_ACTIVE_*_MS:
  // 60s / (60s + ~17.5min) ≈ 5.4% failure ratio, ≈ 94.6% active —
  // close to the "95% active" target. First failure is scheduled
  // earlier (30-90s after page load) so visitors see the alarm
  // during a typical session.
  var ENCRYPTION_FAILURE_MS         = 60 * 1000;
  var ENCRYPTION_FIRST_DELAY_MIN_MS = 30 * 1000;
  var ENCRYPTION_FIRST_DELAY_RANGE_MS = 60 * 1000;       // 30-90s
  var ENCRYPTION_ACTIVE_MIN_MS      = 10 * 60 * 1000;
  var ENCRYPTION_ACTIVE_RANGE_MS    = 15 * 60 * 1000;    // 10-25min

  var encryptionFailureTimer = null;
  var encryptionResetTimer = null;

  // ── FNV-1a 32-bit hash — duplicated locally so this widget doesn't
  //    depend on the radio widget's IIFE-private hash. Tiny function,
  //    not worth a shared module yet.
  function hash(str) {
    var h = 0x811c9dc5 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h;
  }

  // ── Antenna state rotation ──────────────────────────────────────────────
  // Each antenna picks a state every ANTENNA_TICK_MS based on a hash of
  // (band, time-bucket). Same bucket → same state across visits in that
  // window, so the panel doesn't strobe but also doesn't stagnate.
  var ANTENNA_TICK_MS = 4500;
  var ANTENNA_STATES = ["BROADCASTING", "RECEIVING", "CORRUPTED", "STANDBY", "WAITING"];

  // Weight distribution: most antennae sit in benign states, with
  // CORRUPTED rare and dramatic.
  // index   0=BROADCASTING 1=RECEIVING 2=CORRUPTED 3=STANDBY 4=WAITING
  var ANTENNA_WEIGHTS = [25, 30, 8, 25, 12];

  function pickAntennaState(band, bucket) {
    var roll = hash(band + ":" + bucket) % 100;
    var acc = 0;
    for (var i = 0; i < ANTENNA_WEIGHTS.length; i++) {
      acc += ANTENNA_WEIGHTS[i];
      if (roll < acc) return ANTENNA_STATES[i];
    }
    return "STANDBY";
  }

  var BANDS = ["alpha", "beta", "gamma", "delta"];

  function rotateAntennas() {
    var bucket = Math.floor(Date.now() / ANTENNA_TICK_MS);
    for (var i = 0; i < BANDS.length; i++) {
      var el = document.getElementById("ant-" + BANDS[i]);
      if (!el) continue;
      var state = pickAntennaState(BANDS[i].toUpperCase(), bucket);
      if (el.getAttribute("data-state") !== state) {
        el.setAttribute("data-state", state);
        el.textContent = state;
      }
    }
  }

  // ── Buffer spinner ──────────────────────────────────────────────────────
  // Braille spinner frames — distinctive "computer-thinking" look. Cycles
  // every 120 ms. The pending count drifts slowly via its own slower
  // timer; together they read as a queue depth that breathes.
  var SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  var spinnerIdx = 0;
  var spinnerEl = document.getElementById("systems-spinner");

  function tickSpinner() {
    if (folded) return; // pause while folded — save CPU
    if (!spinnerEl) return;
    spinnerEl.textContent = SPINNER_FRAMES[spinnerIdx];
    spinnerIdx = (spinnerIdx + 1) % SPINNER_FRAMES.length;
  }

  // Pending count drifts in [0, 7] on a slow schedule. Seeded by Date
  // so a refresh always sees a new value.
  var BUFFER_TICK_MS = 5500;
  var bufferCountEl = document.getElementById("buffer-count");

  function tickBufferCount() {
    if (!bufferCountEl) return;
    var bucket = Math.floor(Date.now() / BUFFER_TICK_MS);
    var n = hash("buffer:" + bucket) % 8;
    bufferCountEl.textContent = n + " pending";
  }

  // ── Bar percentage display ──────────────────────────────────────────────
  // The bars themselves animate via CSS keyframes. We sample their
  // rendered width on a timer and write the percentage next to them as
  // text. Cheaper than driving the width itself from JS.
  var bars = [
    { fill: document.getElementById("bar-core-load"), pct: document.getElementById("pct-core-load") },
    { fill: document.getElementById("bar-signal"),    pct: document.getElementById("pct-signal")    }
  ];

  function tickBarPercents() {
    if (folded) return;
    for (var i = 0; i < bars.length; i++) {
      var b = bars[i];
      if (!b.fill || !b.pct || !b.fill.parentElement) continue;
      var fillW = b.fill.getBoundingClientRect().width;
      var trackW = b.fill.parentElement.getBoundingClientRect().width;
      if (trackW <= 0) continue;
      var pct = Math.round((fillW / trackW) * 100);
      b.pct.textContent = pct + "%";
    }
  }

  // ── Encryption state machine ────────────────────────────────────────────

  var encryptionRow = null;
  var encryptionStateText = null;

  function setEncryptionState(state) {
    if (encryptionRow) encryptionRow.setAttribute("data-state", state);
    if (encryptionStateText) encryptionStateText.textContent = state.toLowerCase();
    // Put the failure class on <body> so other widgets can react —
    // the broadcast ticker (cult.css) and the .site-nav::after station
    // ID both rewrite their "ENCRYPTED" reference to a bold blood-red
    // "unencrypted" while this class is present.
    if (state === "FAILURE") {
      document.body.classList.add("is-encryption-failure");
    } else {
      document.body.classList.remove("is-encryption-failure");
    }
  }

  function triggerEncryptionFailure() {
    if (encryptionResetTimer) clearTimeout(encryptionResetTimer);
    setEncryptionState("FAILURE");
    encryptionResetTimer = setTimeout(function () {
      setEncryptionState("ACTIVE");
      scheduleNextEncryptionFailure();
    }, ENCRYPTION_FAILURE_MS);
  }

  function scheduleNextEncryptionFailure() {
    if (encryptionFailureTimer) clearTimeout(encryptionFailureTimer);
    var delay = ENCRYPTION_ACTIVE_MIN_MS + Math.random() * ENCRYPTION_ACTIVE_RANGE_MS;
    encryptionFailureTimer = setTimeout(triggerEncryptionFailure, delay);
  }

  function scheduleFirstEncryptionFailure() {
    if (encryptionFailureTimer) clearTimeout(encryptionFailureTimer);
    var delay = ENCRYPTION_FIRST_DELAY_MIN_MS + Math.random() * ENCRYPTION_FIRST_DELAY_RANGE_MS;
    encryptionFailureTimer = setTimeout(triggerEncryptionFailure, delay);
  }

  // ── Fold ────────────────────────────────────────────────────────────────
  function setFolded(next) {
    if (next === folded) return;
    folded = next;
    if (folded) {
      shell.classList.add("is-folded");
      foldBtn.textContent = "»";
      foldBtn.setAttribute("aria-pressed", "true");
      foldBtn.setAttribute("aria-label", "Unfold panel");
      foldBtn.setAttribute("title", "Unfold panel");
    } else {
      shell.classList.remove("is-folded");
      foldBtn.textContent = "«";
      foldBtn.setAttribute("aria-pressed", "false");
      foldBtn.setAttribute("aria-label", "Fold panel");
      foldBtn.setAttribute("title", "Fold panel to left margin");
    }
  }

  if (foldBtn) {
    foldBtn.addEventListener("click", function () {
      setFolded(!folded);
    });
  }

  // ── Real data fetch + render ────────────────────────────────────────────
  function formatCount(n) {
    if (n >= 10000) return (n / 1000).toFixed(1) + "k";
    if (n >= 1000)  return n.toLocaleString();
    return String(n);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  // Stylized placeholders used to pad the origin race when fewer
  // than MIN_ORIGIN_ROWS real authors exist. Reads as "we got blips
  // on the spectrum but couldn't identify the source" instead of as
  // fake claims of authorship.
  var SYNTHETIC_ORIGINS = [
    { name: "[unverified]", count: 1 },
    { name: "[redacted]",   count: 0 },
    { name: "(intercept)",  count: 1 }
  ];

  // Show up to MAX_ORIGIN_ROWS real authors; pad with synthetics only
  // when fewer than MIN_ORIGIN_ROWS real authors exist. As new
  // pseudonyms publish posts they'll appear automatically; the widget
  // grows to fit (min-height in CSS, no fixed cap). Bump MAX if you
  // ever want a longer leaderboard.
  var MIN_ORIGIN_ROWS = 3;
  var MAX_ORIGIN_ROWS = 5;

  function renderOrigins(authors) {
    var list = document.getElementById("origin-list");
    if (!list) return;
    var rows = [];
    for (var i = 0; i < authors.length && rows.length < MAX_ORIGIN_ROWS; i++) {
      rows.push({ name: authors[i].name, count: authors[i].count, synthetic: false });
    }
    for (var j = 0; rows.length < MIN_ORIGIN_ROWS && j < SYNTHETIC_ORIGINS.length; j++) {
      rows.push({ name: SYNTHETIC_ORIGINS[j].name, count: SYNTHETIC_ORIGINS[j].count, synthetic: true });
    }
    // Sort so real top-author is first, but keep visual variety by
    // mixing synthetic entries after.
    var max = 0;
    for (var k = 0; k < rows.length; k++) if (rows[k].count > max) max = rows[k].count;
    if (max < 1) max = 1;

    var html = "";
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var pct = Math.round((row.count / max) * 100);
      html += '<div class="origin-row' + (row.synthetic ? " is-synthetic" : "") + '">';
      html += '<span class="origin-name" title="' + escapeHtml(row.name) + '">' + escapeHtml(row.name) + "</span>";
      html += '<span class="origin-bar-track"><span class="origin-bar-fill" style="width:' + pct + '%"></span></span>';
      html += '<span class="origin-count">' + row.count + "</span>";
      html += "</div>";
    }
    list.innerHTML = html;
  }

  function loadStats() {
    if (typeof fetch !== "function") return;
    fetch("/system-status.json")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        var c = data.counts || {};
        var postsEl = document.getElementById("stat-posts");
        var tagsEl  = document.getElementById("stat-tags");
        var wordsEl = document.getElementById("stat-words");
        if (postsEl && typeof c.posts === "number") postsEl.textContent = formatCount(c.posts);
        if (tagsEl  && typeof c.tags  === "number") tagsEl.textContent  = formatCount(c.tags);
        if (wordsEl && typeof c.words === "number") wordsEl.textContent = formatCount(c.words);
        renderOrigins(data.authors || []);
      })
      .catch(function () { /* leave fallbacks in place */ });
  }

  // ── Boot ────────────────────────────────────────────────────────────────
  function boot() {
    rotateAntennas();
    setInterval(rotateAntennas, ANTENNA_TICK_MS);

    tickSpinner();
    setInterval(tickSpinner, 120);

    tickBufferCount();
    setInterval(tickBufferCount, BUFFER_TICK_MS);

    tickBarPercents();
    setInterval(tickBarPercents, 250);

    encryptionRow = document.getElementById("systems-encryption");
    encryptionStateText = document.getElementById("systems-encryption-state-text");
    setEncryptionState("ACTIVE");
    scheduleFirstEncryptionFailure();

    loadStats();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

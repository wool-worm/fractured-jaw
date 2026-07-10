// Site search.
//
// Two jobs:
//   1. Modal toggle. The eye icon in the header opens a centered modal with
//      a single input. Submitting (Enter or click) navigates to /search/?q=...
//   2. Results rendering. On /search/, parse the URL's ?q=, fetch the static
//      /search-index.json once, score every post, and render post cards
//      that match the section-page list styling.
//
// Query syntax:
//   bare word        contributes to score (OR-style — more matches rank higher)
//   +word            REQUIRED (post must contain it)
//   |word            same as bare — explicit OR-default marker for clarity
//   -word            FORBIDDEN (post must not contain it)
//   "quoted phrase"  exact phrase substring (with optional +/- prefix)
//
// Stemming is crude on purpose: lowercase + strip a small set of suffixes
// (ies/es/ing/ed/s) so "battleaxes" matches "battleaxe" without needing a
// full porter implementation. Applied identically to indexed tokens and
// query tokens.

(function () {
  if (typeof document === "undefined") return;

  var INDEX_URL = "/search-index.json";

  // Field weights for ranking. Title hits matter most; content hits least.
  var WEIGHTS = {
    title: 10,
    tags: 5,
    authors: 5,
    description: 3,
    content: 1,
  };

  // ---------- Modal ----------

  var modalEl = null;
  var modalInput = null;
  var openerEl = null;

  function getModal() {
    if (modalEl) return modalEl;
    modalEl = document.getElementById("search-modal");
    if (modalEl) {
      modalInput = modalEl.querySelector("#search-modal-input");
    }
    return modalEl;
  }

  function openModal(opener) {
    var m = getModal();
    if (!m) return;
    openerEl = opener || null;
    m.hidden = false;
    document.body.classList.add("search-modal-open");
    if (modalInput) {
      modalInput.value = "";
      // Defer focus until after the unhide so screen readers announce
      // the dialog before landing in the input.
      setTimeout(function () { modalInput.focus(); }, 0);
    }
  }

  function closeModal() {
    var m = getModal();
    if (!m || m.hidden) return;
    m.hidden = true;
    document.body.classList.remove("search-modal-open");
    if (openerEl && typeof openerEl.focus === "function") {
      openerEl.focus();
    }
    openerEl = null;
  }

  function initModal() {
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var opener = t.closest("[data-search-open]");
      if (opener) {
        e.preventDefault();
        openModal(opener);
        return;
      }
      if (t.closest("[data-search-close]")) {
        e.preventDefault();
        closeModal();
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        var m = getModal();
        if (m && !m.hidden) closeModal();
      }
    });
    // Focus trap: while the dialog is open, Tab cycles within it instead
    // of escaping into the page behind the backdrop (role="dialog" +
    // aria-modal promise exactly that). Focusables are queried live so
    // this needs no bookkeeping as the modal's markup evolves.
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") return;
      var m = getModal();
      if (!m || m.hidden) return;
      var focusables = m.querySelectorAll(
        'button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      var active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !m.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !m.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  // ---------- Query parser ----------

  // Tokenize a raw query into structured terms. Quoted phrases stay intact;
  // a leading +/- on either a word or a quoted phrase sets its mode.
  //
  // Bare words are re-tokenized through the same /[a-z0-9]+/ split the index
  // uses, so that a search like "wool-worm" expands into two same-mode
  // terms (wool, worm) instead of looking for a literal token that the
  // indexer would never produce. To match a hyphenated string as one unit,
  // use quotes: "wool-worm" performs a substring search against the raw
  // lowercase field.
  function parseQuery(raw) {
    var terms = [];
    if (!raw) return terms;
    var i = 0;
    var s = raw.trim();
    while (i < s.length) {
      // Skip whitespace
      while (i < s.length && /\s/.test(s[i])) i++;
      if (i >= s.length) break;

      var mode = "should";
      var ch = s[i];
      if (ch === "+") { mode = "must"; i++; }
      else if (ch === "-") { mode = "not"; i++; }
      else if (ch === "|") { mode = "should"; i++; }
      if (i >= s.length) break;

      var isPhrase = false;
      var value = "";
      if (s[i] === '"') {
        // Quoted phrase — read until the next quote (or end).
        isPhrase = true;
        i++;
        while (i < s.length && s[i] !== '"') {
          value += s[i];
          i++;
        }
        if (i < s.length && s[i] === '"') i++;
      } else {
        // Bare word — read until whitespace.
        while (i < s.length && !/\s/.test(s[i])) {
          value += s[i];
          i++;
        }
      }
      value = value.trim().toLowerCase();
      if (!value) continue;
      if (isPhrase) {
        terms.push({ mode: mode, phrase: true, value: value });
      } else {
        // Re-tokenize bare words so multi-token values (hyphens, punctuation)
        // expand into multiple terms that match index tokens. Each sub-token
        // inherits the parent's mode: `+foo-bar` becomes `+foo +bar`,
        // `-foo-bar` becomes `-foo -bar`, etc.
        var subTokens = value.match(/[a-z0-9]+/g) || [];
        for (var st = 0; st < subTokens.length; st++) {
          terms.push({ mode: mode, phrase: false, value: subTokens[st] });
        }
      }
    }
    return terms;
  }

  // ---------- Stemmer ----------

  // Strip common English suffixes. Crude but enough for "battleaxes" ↔
  // "battleaxe", "cities" ↔ "city", "jumped" ↔ "jump" without dragging in a
  // full Porter implementation. Length guards keep us from chewing short
  // words down to noise ("is" → "i", etc.). Skips `es` because it would
  // strip "battles" to "battl" while leaving "battle" unchanged — the bare
  // `s` rule catches "battles" → "battle" instead.
  function stem(word) {
    var w = word;
    if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + "y";
    if (w.length > 4 && /ing$/.test(w)) return w.slice(0, -3);
    if (w.length > 4 && /ed$/.test(w))  return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
    return w;
  }

  // Split a string into lowercase, stemmed tokens. Used for word-mode
  // matching on both the query side and the indexed-field side.
  function tokenize(text) {
    if (!text) return [];
    var lowered = String(text).toLowerCase();
    var raw = lowered.match(/[a-z0-9]+/g) || [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      out.push(stem(raw[i]));
    }
    return out;
  }

  // ---------- Scoring ----------

  // Per-record cache so we don't re-tokenize on every keystroke or rerun.
  function ensureCache(record) {
    if (record._cache) return record._cache;
    var c = {
      tokens: {
        title: tokenize(record.title),
        description: tokenize(record.description),
        content: tokenize(record.content),
        tags: tokenize((record.tags || []).join(" ")),
        authors: tokenize((record.authors || []).join(" ")),
      },
      lower: {
        title: (record.title || "").toLowerCase(),
        description: (record.description || "").toLowerCase(),
        content: (record.content || "").toLowerCase(),
        tags: (record.tags || []).join(" ").toLowerCase(),
        authors: (record.authors || []).join(" ").toLowerCase(),
      },
    };
    record._cache = c;
    return c;
  }

  // For a single term against a single field, return a hit count.
  // Word mode = compare stemmed query token against the field's stemmed
  // tokens. Phrase mode = substring match against the raw lowercase field.
  function fieldHits(term, cache, fieldKey) {
    if (term.phrase) {
      var haystack = cache.lower[fieldKey];
      if (!haystack) return 0;
      var needle = term.value;
      if (!needle) return 0;
      var count = 0;
      var idx = 0;
      while ((idx = haystack.indexOf(needle, idx)) !== -1) {
        count++;
        idx += needle.length;
      }
      return count;
    }
    var tokens = cache.tokens[fieldKey];
    if (!tokens || !tokens.length) return 0;
    var qStem = stem(term.value);
    var hits = 0;
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i] === qStem) hits++;
    }
    return hits;
  }

  // Total weighted hits for a term across all fields.
  function termRecordHits(term, cache) {
    var total = 0;
    for (var key in WEIGHTS) {
      if (!Object.prototype.hasOwnProperty.call(WEIGHTS, key)) continue;
      total += fieldHits(term, cache, key) * WEIGHTS[key];
    }
    return total;
  }

  function scoreRecord(record, terms) {
    var cache = ensureCache(record);
    var score = 0;
    var mustOk = true;
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      var hits = termRecordHits(t, cache);
      if (t.mode === "must") {
        if (hits === 0) { mustOk = false; break; }
        score += hits;
      } else if (t.mode === "not") {
        if (hits > 0) { mustOk = false; break; }
      } else {
        score += hits;
      }
    }
    if (!mustOk) return 0;
    return score;
  }

  // A query is "all negative" if it has no must/should terms — in that case
  // we don't want to return the entire archive. Return 0 results instead.
  function hasPositiveTerm(terms) {
    for (var i = 0; i < terms.length; i++) {
      if (terms[i].mode !== "not") return true;
    }
    return false;
  }

  // ---------- Results rendering ----------

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }

  function formatDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function renderCard(record) {
    var parts = [];
    parts.push('<li class="post-card"><article>');
    if (record.image_html) {
      // record.image_html is the full <picture>...</picture> markup
      // pre-rendered by src/search-index.11ty.js using eleventy-img with
      // the same widths/formats as the rest of the site, so the inline
      // injection here matches what server-rendered cards emit.
      parts.push(
        '<a href="' + escapeHtml(record.url) + '" class="post-card-image-link" tabindex="-1" aria-hidden="true">' +
          record.image_html +
        '</a>'
      );
    }
    if (record.section && record.section !== "pages") {
      parts.push(
        '<p class="post-card-section">' +
          '<a href="/' + escapeHtml(record.section) + '/">' + escapeHtml(record.section) + '</a>' +
        '</p>'
      );
    }
    parts.push(
      '<h2 class="post-card-title"><a href="' + escapeHtml(record.url) + '">' +
        escapeHtml(record.title || record.url) +
      '</a></h2>'
    );
    if (record.description) {
      parts.push(
        '<p class="post-card-description">' + escapeHtml(record.description) + '</p>'
      );
    }
    var meta = [];
    var dateStr = formatDate(record.date);
    if (dateStr) {
      meta.push('<time datetime="' + escapeHtml(record.date) + '">' + escapeHtml(dateStr) + '</time>');
    }
    if (record.authors && record.authors.length) {
      var authorSlugs = record.authorSlugs || [];
      var authorLinks = record.authors.map(function (a, idx) {
        var slug = authorSlugs[idx] || "";
        return '<a href="/authors/' + escapeHtml(slug) + '/" class="author-link">' + escapeHtml(a) + '</a>';
      }).join(", ");
      meta.push(authorLinks);
    }
    if (meta.length) {
      parts.push('<p class="post-card-meta">' + meta.join(' &middot; ') + '</p>');
    }
    if (record.tags && record.tags.length) {
      var tagSlugs = record.tagSlugs || [];
      var tagItems = record.tags.map(function (t, idx) {
        var slug = tagSlugs[idx] || "";
        return '<li><a href="/tags/' + escapeHtml(slug) + '/">' + escapeHtml(t) + '</a></li>';
      }).join("");
      parts.push('<ul class="post-card-tags">' + tagItems + '</ul>');
    }
    parts.push('</article></li>');
    return parts.join("");
  }

  // ---------- Page driver ----------

  var indexPromise = null;
  function loadIndex() {
    if (!indexPromise) {
      indexPromise = fetch(INDEX_URL)
        .then(function (r) { return r.ok ? r.json() : []; })
        .catch(function () { return []; });
    }
    return indexPromise;
  }

  function getQueryParam(name) {
    var s = window.location.search || "";
    if (!s) return "";
    // decodeURIComponent throws a URIError on malformed input (a hand-typed
    // "?q=100%" is enough); fall back to the raw text so the results page
    // still runs instead of dying silently.
    function decode(v) {
      try { return decodeURIComponent(v); } catch (e) { return v; }
    }
    var pairs = s.replace(/^\?/, "").split("&");
    for (var i = 0; i < pairs.length; i++) {
      var p = pairs[i].split("=");
      if (decode(p[0]) === name) {
        return decode((p[1] || "").replace(/\+/g, " "));
      }
    }
    return "";
  }

  function runSearch(query) {
    var statusEl = document.querySelector("[data-search-status]");
    var listEl = document.querySelector("[data-search-results]");
    if (!statusEl || !listEl) return;

    var terms = parseQuery(query);
    if (!terms.length || !hasPositiveTerm(terms)) {
      statusEl.textContent = query
        ? "Enter at least one search term (negative-only queries return nothing)."
        : "Type a query and press Enter.";
      listEl.hidden = true;
      listEl.innerHTML = "";
      return;
    }

    statusEl.textContent = "Searching…";
    loadIndex().then(function (records) {
      var scored = [];
      for (var i = 0; i < records.length; i++) {
        var s = scoreRecord(records[i], terms);
        if (s > 0) scored.push({ record: records[i], score: s });
      }
      scored.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        // Tiebreak: newer first.
        var da = a.record.date ? new Date(a.record.date).getTime() : 0;
        var db = b.record.date ? new Date(b.record.date).getTime() : 0;
        return db - da;
      });

      if (!scored.length) {
        statusEl.textContent = 'No results for "' + query + '".';
        listEl.hidden = true;
        listEl.innerHTML = "";
        return;
      }

      statusEl.textContent =
        scored.length + (scored.length === 1 ? " result" : " results") +
        ' for "' + query + '".';
      listEl.hidden = false;
      listEl.innerHTML = scored.map(function (r) { return renderCard(r.record); }).join("");
    });
  }

  function initResultsPage() {
    // Only the /search/ page has the results container.
    var form = document.querySelector(".search-results-form");
    var input = document.getElementById("search-results-input");
    if (!form || !input) return;

    var initialQuery = getQueryParam("q");
    if (initialQuery) {
      input.value = initialQuery;
      runSearch(initialQuery);
    } else {
      var statusEl = document.querySelector("[data-search-status]");
      if (statusEl) statusEl.textContent = "Type a query and press Enter.";
    }

    form.addEventListener("submit", function (e) {
      // Let the browser handle the navigation when the URL would change,
      // so users get a real history entry. But when the query is identical
      // to what's already in the URL, re-run in place so a stale render
      // can be refreshed without a no-op reload.
      var current = getQueryParam("q");
      var next = (input.value || "").trim();
      if (next && next === current) {
        e.preventDefault();
        runSearch(next);
      }
      // Otherwise default form submission writes ?q=… and reloads.
    });
  }

  function init() {
    initModal();
    initResultsPage();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

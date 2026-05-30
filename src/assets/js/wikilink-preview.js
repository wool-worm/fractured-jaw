// Wikilink hover preview.
//
// Hooks any <a class="wikilink"> on the page. On hover or keyboard focus,
// fetches /preview-index.json (once per page load), looks up the target
// URL, and shows a tooltip with title, date, description, and an optional
// image thumbnail.
//
// The tooltip uses minimal inline styles so it's usable without a
// stylesheet. Phase 8 (brutalist styling) is expected to override these
// via CSS targeting the .wikilink-preview classes.

(function () {
  if (typeof document === "undefined") return;

  var INDEX_URL = "/preview-index.json";
  var HIDE_DELAY_MS = 200;

  var indexPromise = null;
  var tooltipEl = null;
  var hideTimer = null;

  function loadIndex() {
    if (!indexPromise) {
      indexPromise = fetch(INDEX_URL)
        .then(function (r) { return r.ok ? r.json() : {}; })
        .catch(function () { return {}; });
    }
    return indexPromise;
  }

  function ensureTooltip() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement("div");
    tooltipEl.className = "wikilink-preview";
    tooltipEl.setAttribute("role", "tooltip");
    // Just enough inline style to make the tooltip usable without CSS.
    // Phase 8 stylesheet should override these.
    var s = tooltipEl.style;
    s.position = "absolute";
    s.zIndex = "1000";
    s.display = "none";
    s.maxWidth = "320px";
    s.padding = "0.5rem 0.75rem";
    s.background = "#fff";
    s.color = "#000";
    s.border = "1px solid #000";
    s.fontSize = "0.875rem";
    s.lineHeight = "1.4";
    s.boxShadow = "2px 2px 0 #000";
    document.body.appendChild(tooltipEl);

    // Keep open while cursor is over the tooltip itself.
    tooltipEl.addEventListener("mouseenter", cancelHide);
    tooltipEl.addEventListener("mouseleave", scheduleHide);
    return tooltipEl;
  }

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

  function render(el, data) {
    var parts = [];
    if (data.section) {
      parts.push(
        '<p class="wikilink-preview-section" style="margin:0 0 0.25rem;font-size:0.75em;text-transform:uppercase;letter-spacing:0.08em;opacity:0.7;">' +
          escapeHtml(data.section) +
          "</p>"
      );
    }
    if (data.title) {
      parts.push(
        '<h3 class="wikilink-preview-title" style="margin:0 0 0.25rem;font-size:1rem;font-weight:bold;">' +
          escapeHtml(data.title) +
          "</h3>"
      );
    }
    if (data.image_html) {
      // data.image_html is the full <picture>...</picture> markup
      // pre-rendered by src/preview-index.11ty.js, including inline styles
      // so the tooltip layout works without depending on stylesheet rules.
      parts.push(data.image_html);
    }
    if (data.description) {
      parts.push(
        '<p class="wikilink-preview-description" style="margin:0;">' +
          escapeHtml(data.description) +
          "</p>"
      );
    }
    var dateStr = formatDate(data.date);
    if (dateStr) {
      parts.push(
        '<p class="wikilink-preview-meta" style="margin:0.25rem 0 0;font-size:0.8em;opacity:0.7;"><time datetime="' +
          escapeHtml(data.date) +
          '">' +
          escapeHtml(dateStr) +
          "</time></p>"
      );
    }
    el.innerHTML = parts.join("");
  }

  function position(el, anchor) {
    var rect = anchor.getBoundingClientRect();
    var width = el.offsetWidth || 320;
    var height = el.offsetHeight || 0;
    var margin = 8;
    var gap = 4;

    // Horizontal: align to the anchor's left edge, clamped to the viewport.
    var left = rect.left + window.scrollX;
    var maxLeft = window.innerWidth + window.scrollX - width - margin;
    el.style.left = Math.max(margin, Math.min(left, maxLeft)) + "px";

    // Vertical: prefer rendering below the anchor, but flip above it when
    // there isn't room below (e.g. links near the bottom of the window).
    // All math is done in viewport coordinates so we can clamp to the
    // visible area; only at the end do we convert to document coordinates
    // by adding scrollY. Keeping the tooltip inside the viewport stops it
    // from spilling off-screen and from growing the page when it sits near
    // the bottom.
    var spaceBelow = window.innerHeight - rect.bottom;
    var spaceAbove = rect.top;
    var topVp;
    if (spaceBelow >= height + gap + margin || spaceBelow >= spaceAbove) {
      topVp = rect.bottom + gap;
    } else {
      topVp = rect.top - gap - height;
    }
    topVp = Math.max(margin, Math.min(topVp, window.innerHeight - height - margin));
    el.style.top = topVp + window.scrollY + "px";
  }

  function cancelHide() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function scheduleHide() {
    cancelHide();
    hideTimer = setTimeout(function () {
      if (tooltipEl) tooltipEl.style.display = "none";
    }, HIDE_DELAY_MS);
  }

  function show(anchor) {
    var href = anchor.getAttribute("href");
    if (!href) return;
    loadIndex().then(function (index) {
      var data = index[href];
      if (!data) return;
      var el = ensureTooltip();
      render(el, data);
      el.style.display = "block";
      position(el, anchor);
      cancelHide();
    });
  }

  function init() {
    document.addEventListener("mouseover", function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a.wikilink") : null;
      if (a) show(a);
    });
    document.addEventListener("mouseout", function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a.wikilink") : null;
      if (a) scheduleHide();
    });
    document.addEventListener("focusin", function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a.wikilink") : null;
      if (a) show(a);
    });
    document.addEventListener("focusout", function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a.wikilink") : null;
      if (a) scheduleHide();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

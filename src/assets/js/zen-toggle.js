// Zen-mode toggle.
//
// Wires the persistent chip (#zen-toggle, pinned bottom-left) to the `zen`
// class on <html>. zen.css keys off that class to strip motion + decoration,
// mute the loud palette, and hide the radio + systems widgets down to a calm
// reading state (the graph widget stays).
//
// Persistence: sessionStorage["fj.zen"] = "1" while zen is on, removed when
// off. sessionStorage survives navigation + reload within a tab but clears
// when the session ends, so the full site is always the default on a fresh
// visit. The no-flash bootstrap in head.njk reads the same key synchronously
// (before first paint) so a zen-session page never flashes the full styling
// before this deferred script runs — this script only needs to keep the chip
// affordances in sync and handle clicks.
//
// Cross-widget: dispatches CustomEvent("fj:zenchange", { detail: { zen } })
// on document so other widgets can react. radio-widget.js listens and powers
// the radio off on zen-enter (it's hidden in zen, so its audio would
// otherwise keep playing with no visible control).
//
// Also wires the announcements caret (#zen-announce-toggle), shown only in
// zen: it reveals a calm panel (#zen-announce-panel) carrying the same
// announcements log the hidden systems widget normally shows.

(function () {
  "use strict";

  var STORAGE_KEY = "fj.zen";
  var STORAGE_KEY_ANNOUNCE = "fj.zen.announce";

  var btn = document.getElementById("zen-toggle");
  if (!btn) return;

  var root = document.documentElement;
  var glyph = btn.querySelector(".zen-toggle-glyph");
  var label = btn.querySelector(".zen-toggle-label");

  // Announcements disclosure (zen only). Zen hides the systems widget, which
  // normally carries the announcements log, so a caret next to the chip
  // reveals a calm panel with the same log. The panel is CSS-gated to
  // html.zen .is-open, so this just toggles the .is-open class + affordances.
  var announceBtn = document.getElementById("zen-announce-toggle");
  var announcePanel = document.getElementById("zen-announce-panel");
  var announceClose = document.getElementById("zen-announce-close");

  function isAnnounceOpen() {
    return !!announcePanel && announcePanel.classList.contains("is-open");
  }

  function setAnnounceOpen(open) {
    if (!announceBtn || !announcePanel) return;
    announcePanel.classList.toggle("is-open", open);
    announceBtn.setAttribute("aria-expanded", open ? "true" : "false");
    announceBtn.setAttribute("title", open ? "Hide messages" : "Show messages");
    announceBtn.textContent = open ? "▾" : "▴";
    // Persist so the open/closed state survives navigation within a tab
    // session (same lifecycle as zen itself; see STORAGE_KEY note above).
    try {
      if (open) sessionStorage.setItem(STORAGE_KEY_ANNOUNCE, "1");
      else sessionStorage.removeItem(STORAGE_KEY_ANNOUNCE);
    } catch (e) {}
  }

  function isZen() {
    return root.classList.contains("zen");
  }

  // Reflect the current state in the chip's affordances. Glyph: filled ring
  // (signal live) in the full site, hollow ring (signal flatlined) in zen.
  function apply(zen) {
    btn.setAttribute("aria-pressed", zen ? "true" : "false");
    btn.setAttribute("title", zen ? "Revive the signal" : "Flatline the signal");
    if (glyph) glyph.textContent = zen ? "◯" : "◉";
    if (label) label.textContent = zen ? "revive" : "flatline";
  }

  function persist(zen) {
    try {
      if (zen) sessionStorage.setItem(STORAGE_KEY, "1");
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

  function setZen(zen) {
    root.classList.toggle("zen", zen);
    apply(zen);
    persist(zen);
    document.dispatchEvent(
      new CustomEvent("fj:zenchange", { detail: { zen: zen } })
    );
  }

  // Sync the chip to whatever state the no-flash bootstrap already applied.
  apply(isZen());

  // Restore the panel's open/closed state so it persists across navigation.
  // The panel is CSS-gated to html.zen, so restoring while not in zen just
  // pre-sets the affordance and stays invisible until zen is entered.
  try {
    if (sessionStorage.getItem(STORAGE_KEY_ANNOUNCE) === "1") setAnnounceOpen(true);
  } catch (e) {}

  btn.addEventListener("click", function () {
    setZen(!isZen());
  });

  // Announcements caret: toggle the panel; Escape closes it. No
  // click-outside-to-close: a click on a nav link is "outside" the dock too,
  // so closing on it would clear the persisted open state right before the
  // page unloads, defeating the across-navigation persistence. The panel is
  // a sticky info panel, so it closes only via the caret or Escape.
  if (announceBtn && announcePanel) {
    announceBtn.addEventListener("click", function () {
      setAnnounceOpen(!isAnnounceOpen());
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isAnnounceOpen()) setAnnounceOpen(false);
    });

    if (announceClose) {
      announceClose.addEventListener("click", function () {
        setAnnounceOpen(false);
      });
    }
  }
})();

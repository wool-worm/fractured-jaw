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

(function () {
  "use strict";

  var STORAGE_KEY = "fj.zen";

  var btn = document.getElementById("zen-toggle");
  if (!btn) return;

  var root = document.documentElement;
  var glyph = btn.querySelector(".zen-toggle-glyph");
  var label = btn.querySelector(".zen-toggle-label");

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

  btn.addEventListener("click", function () {
    setZen(!isZen());
  });
})();

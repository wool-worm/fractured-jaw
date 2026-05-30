// Mobile-only intro folding. At <=820px viewport widths, page-intro
// blocks taller than THRESHOLD_PX are clipped with a gradient fade
// and an inline "read more / read less" toggle. Above the breakpoint,
// or for short intros, the JS leaves the markup alone.
//
// Targets the markdown-body wrappers used by home + section layouts:
//   .home-intro     (home.njk)
//   .section-intro  (section.njk)
//
// Re-evaluates on resize so rotating a phone or toggling desktop dev
// tools doesn't strand the page in the wrong state. Per-element expand
// state is preserved across resize tick (no surprise auto-collapse).

(function () {
  if (typeof document === "undefined") return;

  var BREAKPOINT_MAX = 820;
  var THRESHOLD_PX = 100;
  var SELECTORS = ".home-intro, .section-intro";

  var intros = Array.prototype.slice.call(document.querySelectorAll(SELECTORS));
  if (!intros.length) return;

  function makeButton(intro) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "intro-fold-toggle";
    btn.setAttribute("aria-expanded", "false");
    btn.textContent = "read more";
    btn.addEventListener("click", function () {
      var expanded = intro.classList.toggle("is-expanded");
      btn.textContent = expanded ? "read less" : "read more";
      btn.setAttribute("aria-expanded", expanded ? "true" : "false");
    });
    intro.parentNode.insertBefore(btn, intro.nextSibling);
    return btn;
  }

  function evaluate() {
    var narrow = window.matchMedia(
      "(max-width: " + BREAKPOINT_MAX + "px)"
    ).matches;
    for (var i = 0; i < intros.length; i++) {
      var intro = intros[i];
      // scrollHeight returns full content height regardless of a
      // max-height clip, so we can measure even when .intro-foldable
      // is already applied.
      var tall = intro.scrollHeight > THRESHOLD_PX;
      var btn = intro._foldBtn;
      if (narrow && tall) {
        if (!btn) {
          btn = makeButton(intro);
          intro._foldBtn = btn;
        }
        intro.classList.add("intro-foldable");
        btn.hidden = false;
      } else {
        intro.classList.remove("intro-foldable");
        if (btn) btn.hidden = true;
      }
    }
  }

  evaluate();

  // Re-evaluate after web fonts settle. Monospace fonts are wider than
  // the system fallback, so an intro that fit in 2 lines at script-run
  // time can reflow to 4 lines once the font arrives — pushing it past
  // the threshold. Without this, short-ish intros (like /media/) get
  // measured against the wrong layout and never fold.
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(evaluate);
  }
  // Belt-and-suspenders: also re-evaluate at window load (after every
  // resource including fonts has finished). Cheap; runs once.
  window.addEventListener("load", evaluate);

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(evaluate, 150);
  });
})();

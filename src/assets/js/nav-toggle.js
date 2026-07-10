/* Mobile nav toggle.
   Wires the hamburger button (.site-nav-toggle) to the nav dropdown
   (.site-nav) by flipping data-open + aria-expanded. The button is
   visually hidden above 820px via CSS, so this script no-ops at desktop
   widths (the listeners are attached but never fire — the button is
   display:none). Closes the panel on:
     - Esc keypress
     - Click on any link inside the panel
     - Click outside the header (overlay-dismiss)
     - Viewport widening past 820px (so the panel doesn't stay "open"
       invisibly when the user resizes back up to desktop)
*/
(function () {
  "use strict";

  var toggleBtn = document.getElementById("site-nav-toggle");
  var nav = document.getElementById("site-nav-menu");
  if (!toggleBtn || !nav) return;

  var open = false;

  function apply() {
    nav.setAttribute("data-open", open ? "true" : "false");
    toggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
    toggleBtn.setAttribute(
      "aria-label",
      open ? "Close navigation" : "Open navigation"
    );
  }

  function setOpen(next) {
    if (next === open) return;
    open = next;
    apply();
  }

  toggleBtn.addEventListener("click", function () {
    setOpen(!open);
  });

  // Close when a link inside the panel is clicked. Search icon stays
  // here too — clicking it opens the search modal, which would otherwise
  // sit awkwardly behind a still-open nav dropdown.
  nav.addEventListener("click", function (e) {
    var target = e.target;
    if (!target) return;
    if (target.closest("a") || target.closest("button")) {
      setOpen(false);
    }
  });

  // Esc dismisses. Match the search-modal's keyboard-close convention.
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && open) setOpen(false);
  });

  // Overlay-dismiss: click outside the header closes the panel.
  document.addEventListener("click", function (e) {
    if (!open) return;
    var header = toggleBtn.closest(".site-header");
    if (!header) return;
    if (!header.contains(e.target)) setOpen(false);
  });

  // Resize past the breakpoint: clear the open state so the panel
  // doesn't stay logically "open" while invisible at desktop widths.
  // Matches the 820px hamburger breakpoint in layout.css.
  var desktopMQ = window.matchMedia("(min-width: 821px)");
  function onMQChange(e) {
    if (e.matches && open) setOpen(false);
  }
  if (desktopMQ.addEventListener) {
    desktopMQ.addEventListener("change", onMQChange);
  } else if (desktopMQ.addListener) {
    desktopMQ.addListener(onMQChange);
  }
})();

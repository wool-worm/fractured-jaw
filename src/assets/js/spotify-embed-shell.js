"use strict";

// Click-to-load handler for {% spotify %} embeds. The shortcode renders a
// `<div class="spotify-embed-shell" data-src="..." data-height="...">`
// placeholder; this script swaps in the real iframe only when the reader
// clicks/keys it.
//
// The privacy story: Spotify's iframe loads tracking scripts on injection
// (IP + browser fingerprint reach Spotify regardless of authentication).
// Bandcamp's iframe is lower-cost and loads directly. Gating the Spotify
// iframe behind explicit reader engagement means default page loads pay
// no privacy cost; readers who actually want to listen opt in.
//
// Script is loaded unconditionally from base.njk; bails fast when no
// `.spotify-embed-shell` elements exist on the page.

(function () {
  function loadShell(shell) {
    const src = shell.getAttribute("data-src");
    if (!src) return;
    const height = shell.getAttribute("data-height") || "352";
    const maxWidth = shell.getAttribute("data-max-width");

    const iframe = document.createElement("iframe");
    iframe.className = "spotify-embed-inline";
    iframe.src = src;
    iframe.setAttribute("height", height);
    iframe.setAttribute("width", "100%");
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute("allow", "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture");
    iframe.setAttribute("loading", "lazy");
    iframe.style.border = "0";
    if (maxWidth) iframe.style.maxWidth = maxWidth + "px";

    shell.replaceWith(iframe);
  }

  function wire() {
    const shells = document.querySelectorAll(".spotify-embed-shell");
    for (let i = 0; i < shells.length; i++) {
      const shell = shells[i];
      shell.addEventListener("click", function () { loadShell(shell); });
      shell.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          loadShell(shell);
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();

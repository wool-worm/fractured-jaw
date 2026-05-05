/* Minimal baffle-style text scrambler — no dependencies.
   Targets elements with class .baffle-forever and scrambles their text
   content continuously using a pool of replacement characters. */
(function () {
  'use strict';

  var CHARS = '!<>-_\\/[]{}—=+*^?#________';
  var SPEED  = 60; // ms per frame

  function randomChar() {
    return CHARS[Math.floor(Math.random() * CHARS.length)];
  }

  function scramble(el) {
    var original = el.dataset.baffleText;
    if (!original) {
      original = el.textContent;
      el.dataset.baffleText = original;
    }

    var out = '';
    for (var i = 0; i < original.length; i++) {
      if (original[i] === ' ') {
        out += ' ';
      } else if (Math.random() < 0.28) {
        out += randomChar();
      } else {
        out += original[i];
      }
    }
    el.textContent = out;
  }

  function init() {
    var els = document.querySelectorAll('.baffle-forever');
    if (!els.length) return;

    setInterval(function () {
      els.forEach(scramble);
    }, SPEED);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

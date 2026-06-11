// Subscribe form enhancement (progressive enhancement, first-party vanilla JS).
//
// The /subscribe/ form is a plain HTML POST to Buttondown. We deliberately do
// NOT intercept it with fetch: Buttondown's firewall can answer a borderline
// signup with a CAPTCHA / "needs-capture" challenge, and that challenge lives in
// the HTTP RESPONSE. A background fetch (no-cors) throws the response away, so
// the reader never sees the challenge and the subscriber gets flagged/blocked.
//
// Instead we let the native submit run: target=_blank opens Buttondown's
// response (including any CAPTCHA) in a new tab, and on the current tab we add
// the nice-to-haves, clear the fields and show a small "check your email" modal.
// The reset is deferred to the next tick so the browser serializes + sends the
// data before we wipe it. With JS off, the plain form still works.

(function () {
  "use strict";

  var form = document.querySelector(".newsletter-form");
  var modal = document.getElementById("subscribe-modal");
  if (!form || !modal) return;

  var closeBtn = modal.querySelector(".subscribe-modal-close");

  function openModal() {
    modal.classList.add("is-open");
    if (closeBtn) closeBtn.focus();
  }
  function closeModal() {
    modal.classList.remove("is-open");
  }

  // No preventDefault: the native POST goes to Buttondown (new tab) so its
  // firewall challenge can render. Defer the reset + modal to the next tick,
  // after the browser has serialized and submitted the form.
  form.addEventListener("submit", function () {
    setTimeout(function () {
      form.reset();
      openModal();
    }, 0);
  });

  if (closeBtn) {
    closeBtn.addEventListener("click", closeModal);
  }
  modal.addEventListener("click", function (e) {
    if (e.target === modal) closeModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && modal.classList.contains("is-open")) closeModal();
  });
})();

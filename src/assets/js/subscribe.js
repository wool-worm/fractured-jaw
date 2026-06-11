// Subscribe confirmation modal + email-param cleanup (first-party vanilla JS).
//
// Loaded on /subscribe/ and the home page: the two pages Buttondown redirects
// to ("after subscribing" -> /subscribe/, "after confirming" -> /). Buttondown
// appends ?email_address=<email> to those redirects (the home page also catches
// the case where an already-subscribed person resubmits). We strip that param
// on whatever page it lands on, so a subscriber's email never lingers in the
// URL / history / a shared link, and on /subscribe/ we additionally show the
// success modal.
//
// The form is a plain SAME-TAB POST (not fetch) so Buttondown's firewall CAPTCHA
// can render. Configure the "after subscribing" redirect as the BARE
// /subscribe/ URL (Buttondown appends with `?` not `&`, so an own query would
// malform it). `?subscribed=1` is accepted to preview the modal. With JS off the
// signup still works; the reader just doesn't get the modal.

(function () {
  "use strict";

  // Strip Buttondown's email param (and our preview flag) from the URL on
  // whatever page it redirected to. Remember whether we just came back from a
  // signup so /subscribe/ can show the modal.
  var justSubscribed = false;
  try {
    var params = new URLSearchParams(window.location.search);
    if (params.has("email_address") || params.get("subscribed") === "1") {
      justSubscribed = true;
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  } catch (e) {}

  // The modal only exists on /subscribe/. On the home redirect the strip above
  // was all we needed.
  var modal = document.getElementById("subscribe-modal");
  if (!modal) return;

  var closeBtn = modal.querySelector(".subscribe-modal-close");

  function openModal() {
    modal.classList.add("is-open");
    if (closeBtn) closeBtn.focus();
  }
  function closeModal() {
    modal.classList.remove("is-open");
  }

  if (justSubscribed) openModal();

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

// Subscribe confirmation modal (first-party vanilla JS).
//
// The /subscribe/ form is a plain SAME-TAB HTML POST to Buttondown's public
// embed endpoint. We deliberately do NOT intercept it: Buttondown handles the
// signup (including any firewall CAPTCHA, which needs a visible page), then
// redirects back here.
//
// Set Buttondown's "after subscribing" redirect to the bare page URL
// (https://fractured-jaw.com/subscribe/). Buttondown appends its own
// `?email_address=<email>` to that redirect, and we use the presence of that
// param as the "just subscribed" signal to show the modal. We then strip the
// whole query string via replaceState so the email doesn't linger in the URL,
// the history, or a shared link.
//
// Do NOT put your own ?query on the redirect: Buttondown appends with `?`
// rather than `&`, which produces a malformed `?a=1?email_address=...` URL.
//
// `?subscribed=1` is also accepted so you can preview the modal directly without
// signing up. With JS off the signup still works; the reader just doesn't get
// the modal (the confirmation email is the real signal either way).

(function () {
  "use strict";

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

  // Show the modal on the return from Buttondown, then strip the query so the
  // email isn't left in the URL / history (or re-triggered on refresh).
  try {
    var params = new URLSearchParams(window.location.search);
    if (params.has("email_address") || params.get("subscribed") === "1") {
      openModal();
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  } catch (e) {}

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

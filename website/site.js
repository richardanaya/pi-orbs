(function () {
  var buttons = document.querySelectorAll("[data-copy]");
  buttons.forEach(function (button) {
    button.addEventListener("click", function () {
      var text = button.getAttribute("data-copy");
      var label = button.textContent;
      function done(message) {
        button.textContent = message;
        window.setTimeout(function () {
          button.textContent = label;
        }, 1400);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          done("Copied");
        }, function () {
          done("Copy failed");
        });
        return;
      }
      done("Copy failed");
    });
  });

  var nav = document.querySelector(".nav");
  var toggle = document.querySelector(".nav-toggle");
  var links = document.getElementById("site-nav");
  if (!nav || !toggle || !links) return;

  var label = toggle.querySelector(".nav-toggle-label");
  var phoneNav = window.matchMedia("(max-width: 42.5rem)");

  function setOpen(open) {
    var show = open && phoneNav.matches;
    nav.classList.toggle("is-open", show);
    document.body.classList.toggle("nav-locked", show);
    toggle.setAttribute("aria-expanded", show ? "true" : "false");
    if (label) label.textContent = show ? "Close" : "Menu";
  }

  toggle.addEventListener("click", function () {
    setOpen(toggle.getAttribute("aria-expanded") !== "true");
  });

  links.addEventListener("click", function (event) {
    if (event.target.closest("a")) setOpen(false);
  });

  document.addEventListener("click", function (event) {
    if (!nav.classList.contains("is-open")) return;
    if (event.target === nav || !nav.contains(event.target)) setOpen(false);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") setOpen(false);
  });

  phoneNav.addEventListener("change", function () {
    if (!phoneNav.matches) setOpen(false);
  });
})();

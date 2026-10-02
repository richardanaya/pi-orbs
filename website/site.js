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
})();

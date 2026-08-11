/* main.js — runs on every page. Progressive enhancement, no framework. */
(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  /* ---------- Code-block copy buttons ---------- */
  function initCopyButtons() {
    var buttons = document.querySelectorAll(".code-block__copy");
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var block = btn.closest(".code-block");
        if (!block) return;
        var code = block.querySelector("pre code");
        if (!code) return;
        var text = code.innerText;
        var done = function () {
          var original = btn.textContent;
          btn.classList.add("is-copied");
          btn.textContent = "Copied";
          window.setTimeout(function () {
            btn.classList.remove("is-copied");
            btn.textContent = original;
          }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(fallback);
        } else {
          fallback();
        }
        function fallback() {
          var ta = document.createElement("textarea");
          ta.value = text;
          ta.setAttribute("readonly", "");
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand("copy"); } catch (e) { /* noop */ }
          document.body.removeChild(ta);
          done();
        }
      });
    });
  }

  /* ---------- Interactive task lists ---------- */
  function initTaskLists() {
    var inputs = document.querySelectorAll("li.task-list-item > input[type='checkbox']");
    inputs.forEach(function (cb) {
      cb.disabled = false;
      // Sync state with classList for line-through styling
      var sync = function () {
        var li = cb.parentElement;
        if (!li) return;
        if (cb.checked) li.classList.add("is-checked");
        else li.classList.remove("is-checked");
      };
      sync();
      cb.addEventListener("change", sync);
    });
  }

  /* ---------- Convert "FAQ" sections into <details> accordions ---------- */
  // Heuristic: any H2/H3 whose text matches /faq|frequently asked questions/i is
  // treated as the start of an accordion section. Each subsequent H3/H4 in the
  // same section becomes the <summary> of a <details> wrapping its sibling content.
  function initFaqAccordions() {
    var headings = document.querySelectorAll(".prose h2, .prose h3");
    headings.forEach(function (h) {
      var text = (h.textContent || "").trim().toLowerCase();
      if (!/^(faq|frequently asked questions)\b/i.test(text)) return;
      var startLevel = parseInt(h.tagName.substring(1), 10);
      var questionLevel = startLevel + 1;
      var node = h.nextElementSibling;
      while (node) {
        var next = node.nextElementSibling;
        if (/^H[1-6]$/.test(node.tagName)) {
          var lvl = parseInt(node.tagName.substring(1), 10);
          if (lvl <= startLevel) break;
          if (lvl === questionLevel) {
            // Build a <details>
            var details = document.createElement("details");
            details.className = "faq-item";
            var summary = document.createElement("summary");
            summary.textContent = node.textContent;
            details.appendChild(summary);
            var body = node.nextElementSibling;
            while (body && !/^H[1-6]$/.test(body.tagName)) {
              var afterBody = body.nextElementSibling;
              details.appendChild(body);
              body = afterBody;
            }
            node.parentNode.insertBefore(details, node);
            node.parentNode.removeChild(node);
            next = details.nextElementSibling;
          }
        }
        node = next;
      }
    });
  }

  /* ---------- Theme toggle ----------
     The scheme itself is already resolved by the inline <head> script, so this
     only wires the control: flip the attribute, remember the choice, and keep
     following the OS while the reader has not expressed one. */
  function initThemeToggle() {
    var root = document.documentElement;
    var btn = document.querySelector("[data-theme-toggle]");

    function label() {
      if (!btn) return;
      var dark = root.getAttribute("data-theme") === "dark";
      btn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
      btn.setAttribute("aria-pressed", dark ? "true" : "false");
    }

    function apply(theme, remember) {
      root.setAttribute("data-theme", theme);
      if (remember) {
        try { localStorage.setItem("theme", theme); } catch (e) { /* private mode */ }
      }
      label();
    }

    label();

    if (btn) {
      btn.addEventListener("click", function () {
        apply(root.getAttribute("data-theme") === "dark" ? "light" : "dark", true);
      });
    }

    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      var onChange = function (e) {
        var stored;
        try { stored = localStorage.getItem("theme"); } catch (err) { stored = null; }
        if (stored !== "dark" && stored !== "light") apply(e.matches ? "dark" : "light", false);
      };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  }

  /* ---------- Service worker registration ---------- */
  function initServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      // Skip on file:// previews
      return;
    }
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () { /* silent */ });
    });
  }

  ready(function () {
    initThemeToggle();
    initCopyButtons();
    initTaskLists();
    initFaqAccordions();
    initServiceWorker();
  });
})();

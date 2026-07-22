/**
 * Tisso Banner — lightweight interactions (vanilla JS only)
 * Handles the mobile menu toggle for the custom banner top bar.
 */
(function () {
  'use strict';

  function initBanner(root) {
    if (!root || root.dataset.tissoBannerReady === 'true') return;
    root.dataset.tissoBannerReady = 'true';

    var toggle = root.querySelector('[data-tisso-menu-toggle]');
    var nav = root.querySelector('[data-tisso-mobile-nav]');
    if (!toggle || !nav) return;

    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
      nav.classList.toggle('is-open', !open);
    });

    // Close the drawer when a link is chosen
    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) {
        toggle.setAttribute('aria-expanded', 'false');
        nav.classList.remove('is-open');
      }
    });
  }

  function initAll() {
    document.querySelectorAll('[data-tisso-banner]').forEach(initBanner);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

  // Theme editor support: re-init when a section is re-rendered
  document.addEventListener('shopify:section:load', function (event) {
    var section = event.target.querySelector('[data-tisso-banner]');
    if (section) {
      section.dataset.tissoBannerReady = 'false';
      initBanner(section);
    }
  });
})();

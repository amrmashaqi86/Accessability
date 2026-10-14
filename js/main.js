(function () {
  'use strict';

  var DESIGN_WIDTH = 1920;
  /** Below this width the layout reflows (css/responsive.css) instead of scaling. */
  var DESKTOP_MIN = 1280;
  var canvas = document.getElementById('canvas');
  var fitted = Array.prototype.slice.call(document.querySelectorAll('[data-fit-width]'));

  function layout() {
    var width = document.documentElement.clientWidth;
    if (!width) return; // hidden / not yet laid out
    var desktop = width >= DESKTOP_MIN;

    // Desktop: keep the 1920px design pixel-identical and scale it to the screen.
    var scale = desktop ? Math.min(1, width / DESIGN_WIDTH) : 1;
    canvas.style.zoom = scale === 1 ? '' : String(scale);

    // Tablet / mobile: shrink fixed-size illustrations to fit their column.
    fitted.forEach(function (el) {
      el.style.zoom = '';
      if (desktop) return;
      var available = el.parentElement.clientWidth;
      var ratio = Math.min(1, available / parseFloat(el.dataset.fitWidth));
      if (ratio < 1) el.style.zoom = String(ratio);
    });

    if (desktop) setMenu(false);
  }

  // Header menu toggle (tablet / mobile).
  var header = document.querySelector('.r-header');
  var toggle = document.querySelector('[data-menu-toggle]');

  function setMenu(open, returnFocus) {
    if (!header || !toggle) return;
    header.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'إغلاق القائمة' : 'فتح القائمة');
    if (!open && returnFocus) toggle.focus();
  }

  if (toggle) {
    toggle.addEventListener('click', function () {
      setMenu(!header.classList.contains('is-open'));
    });
    header.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && header.classList.contains('is-open')) setMenu(false, true);
    });
    document.getElementById('site-menu').addEventListener('click', function (e) {
      if (e.target.closest('a, [data-a11y-open]')) setMenu(false);
    });
    document.addEventListener('click', function (e) {
      if (header.classList.contains('is-open') && !header.contains(e.target)) setMenu(false);
    });
  }

  layout();
  window.addEventListener('resize', layout);

  // The header's night-mode switch is driven by the accessibility tool (js/a11y.js).

  // E-services category tabs.
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-tab]'));
  var ACTIVE = ['bg-primary', 'border-primary', 'text-white'];
  var INACTIVE = ['bg-white', 'border-[#e1e1e1]'];

  function selectTab(tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (!t.dataset.color) {
        t.dataset.color = t.classList.contains('text-brand') ? 'text-brand' : 'text-primary';
      }
      ACTIVE.forEach(function (c) { t.classList.toggle(c, on); });
      INACTIVE.forEach(function (c) { t.classList.toggle(c, !on); });
      t.classList.toggle(t.dataset.color, !on);
      t.querySelectorAll('img').forEach(function (img) {
        // The active tab's own icon is already white.
        if (!/tab-accidents/.test(img.getAttribute('src'))) img.classList.toggle('tab-active-icon', on);
      });
    });
    var panel = document.querySelector('[role="tabpanel"]');
    panel.setAttribute('aria-label', tab.textContent.trim());
    if (focus) tab.focus();
  }

  tabs.forEach(function (tab, i) {
    if (tab.dataset.color === undefined) {
      tab.dataset.color = tab.classList.contains('text-brand') ? 'text-brand' : 'text-primary';
    }
    tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1;
    tab.addEventListener('click', function () { selectTab(tab, false); });
    tab.addEventListener('keydown', function (e) {
      // RTL: ArrowLeft moves to the next tab, ArrowRight to the previous one.
      var next = null;
      if (e.key === 'ArrowLeft') next = tabs[(i + 1) % tabs.length];
      else if (e.key === 'ArrowRight') next = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === 'Home') next = tabs[0];
      else if (e.key === 'End') next = tabs[tabs.length - 1];
      if (next) {
        e.preventDefault();
        selectTab(next, true);
      }
    });
  });

  // Back to top.
  document.getElementById('back-to-top').addEventListener('click', function () {
    window.scrollTo({ top: 0 });
    var skip = document.querySelector('.skip-link');
    if (skip) skip.focus({ preventScroll: true });
  });

  // Prevent placeholder links from jumping to the top of the page.
  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[href="#"]');
    if (link) e.preventDefault();
  });
})();

/**
 * Najm accessibility tool — a framework-free port of the Najm site's Angular implementation
 * (src/app/shared/a11y, reader, voice). Same settings, storage keys, markup, wording and behaviour:
 *
 *  - Settings panel: theme, text size, high contrast, text spacing, link highlighting,
 *    reduced motion, colour-vision correction, reset (side panel on desktop, sheet on mobile).
 *  - Screen reader (Web Speech Synthesis, Arabic voice): read page, focus/tap/hover reading,
 *    floating player bar with previous / play-pause / next / stop and speed.
 *  - Voice control (Web Speech Recognition, ar-SA): spoken commands, "show numbers" badges,
 *    docked status bar with the command list.
 *
 * Settings are applied as classes on <html> (css/a11y.css). The inline script in index.html
 * mirrors `apply()` so there is no flash before this file runs — keep the two in sync.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function normalizeArabic(text) {
    return text
      .toLowerCase()
      .replace(/[ً-ٰٟـ]/g, '') // tashkeel + tatweel
      .replace(/[إأآٱ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function readJSON(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}');
    } catch (e) {
      return {};
    }
  }

  function mql(q) {
    return typeof matchMedia === 'function' ? matchMedia(q) : null;
  }

  function create(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** Angular's [class]="cond ? 'a b' : 'c d'" — swap one class set for the other. */
  function variant(node, on, onCls, offCls) {
    if (!node) return;
    var add = (on ? onCls : offCls).split(' ').filter(Boolean);
    var remove = (on ? offCls : onCls).split(' ').filter(Boolean);
    remove.forEach(function (c) { node.classList.remove(c); });
    add.forEach(function (c) { node.classList.add(c); });
  }

  function setHidden(node, hidden) {
    if (node) node.hidden = !!hidden;
  }

  // Coalesced re-render (the equivalent of Angular change detection).
  var renderQueued = false;
  function changed() {
    if (renderQueued) return;
    renderQueued = true;
    queueMicrotask(function () {
      renderQueued = false;
      render();
    });
  }

  // ---------------------------------------------------------------------------
  // A11yService — theme, text size, contrast, colour vision, spacing, links, motion
  // ---------------------------------------------------------------------------
  var A11Y_KEY = 'najm-a11y';
  /** Text scale steps (WCAG 1.4.4 asks for up to 200% via zoom; these cover in-page resizing). */
  var TEXT_SCALES = [0.9, 1, 1.125, 1.25, 1.375, 1.5];

  var liveRegion = null;

  var a11y = (function () {
    var stored = readJSON(A11Y_KEY);
    var darkMq = mql('(prefers-color-scheme: dark)');
    var systemContrast = (mql('(prefers-contrast: more)') || {}).matches || false;
    var systemMotion = (mql('(prefers-reduced-motion: reduce)') || {}).matches || false;
    /** Persist only once the user has changed something, so OS defaults keep following the OS. */
    var dirty = Object.keys(stored).length > 0;
    var announceTimer;

    var s = {
      systemDark: (darkMq && darkMq.matches) || false,
      theme: stored.theme || 'system',
      textScale: stored.textScale || 1,
      contrast: stored.contrast !== undefined ? stored.contrast : systemContrast,
      cvd: stored.cvd || 'none',
      spacing: stored.spacing || false,
      links: stored.links || false,
      reduceMotion: stored.motion !== undefined ? stored.motion : systemMotion,
      /** Whether the settings panel is open (opened from the header). */
      panelOpen: false,

      get isDark() {
        return this.theme === 'dark' || (this.theme === 'system' && this.systemDark);
      },
      get textPercent() {
        return Math.round(this.textScale * 100);
      },
      get canIncrease() {
        return this.textScale < TEXT_SCALES[TEXT_SCALES.length - 1];
      },
      get canDecrease() {
        return this.textScale > TEXT_SCALES[0];
      },

      // --- actions --------------------------------------------------------------
      toggleDark: function () {
        s.setTheme(s.isDark ? 'light' : 'dark');
      },
      setTheme: function (theme) {
        s.theme = theme;
        say(theme === 'dark' ? 'تم تفعيل الوضع الليلي' : theme === 'light' ? 'تم تفعيل الوضع النهاري' : 'المظهر يتبع إعدادات الجهاز');
        update();
      },
      increaseText: function () {
        var next = TEXT_SCALES.find(function (x) { return x > s.textScale; });
        if (next === undefined) return say('حجم الخط في الحد الأقصى');
        s.textScale = next;
        say('حجم الخط ' + s.textPercent + '%');
        update();
      },
      decreaseText: function () {
        var prev = TEXT_SCALES.slice().reverse().find(function (x) { return x < s.textScale; });
        if (prev === undefined) return say('حجم الخط في الحد الأدنى');
        s.textScale = prev;
        say('حجم الخط ' + s.textPercent + '%');
        update();
      },
      resetText: function () {
        s.textScale = 1;
        say('حجم الخط الافتراضي');
        update();
      },
      toggle: function (setting, label) {
        s[setting] = !s[setting];
        say(label + ': ' + (s[setting] ? 'مفعّل' : 'غير مفعّل'));
        update();
      },
      setCvd: function (mode, label) {
        s.cvd = mode;
        say('تصحيح الألوان: ' + label);
        update();
      },
      resetAll: function () {
        s.theme = 'system';
        s.textScale = 1;
        s.contrast = systemContrast;
        s.cvd = 'none';
        s.spacing = false;
        s.links = false;
        s.reduceMotion = systemMotion;
        say('تمت إعادة ضبط إعدادات إمكانية الوصول');
        dirty = false;
        try {
          localStorage.removeItem(A11Y_KEY);
        } catch (e) {}
        update();
      },
      /** Speak a message through the polite live region without counting as a settings change. */
      announce: function (message) {
        // Clear first so repeating the same message is still announced.
        if (liveRegion) liveRegion.textContent = '';
        clearTimeout(announceTimer);
        announceTimer = setTimeout(function () {
          if (liveRegion) liveRegion.textContent = message;
        }, 30);
      },
      apply: apply,
    };

    if (darkMq && darkMq.addEventListener) {
      darkMq.addEventListener('change', function (e) {
        s.systemDark = e.matches;
        update();
      });
    }

    function say(message) {
      dirty = true;
      s.announce(message);
    }

    function update() {
      apply();
      changed();
    }

    function apply() {
      var root = document.documentElement;
      root.classList.toggle('dark', s.isDark);
      root.classList.toggle('hc', s.contrast);
      root.classList.toggle('text-spacing', s.spacing);
      root.classList.toggle('hl-links', s.links);
      root.classList.toggle('reduce-motion', s.reduceMotion);
      if (s.cvd === 'none') root.removeAttribute('data-cvd');
      else root.setAttribute('data-cvd', s.cvd);
      root.style.setProperty('--ts', String(s.textScale));

      if (!dirty) return;
      try {
        localStorage.setItem(
          A11Y_KEY,
          JSON.stringify({
            theme: s.theme,
            textScale: s.textScale,
            contrast: s.contrast,
            cvd: s.cvd,
            spacing: s.spacing,
            links: s.links,
            motion: s.reduceMotion,
          })
        );
      } catch (e) {}
    }

    return s;
  })();

  // ---------------------------------------------------------------------------
  // ReaderService — built-in screen reader (text-to-speech, Arabic voice)
  // ---------------------------------------------------------------------------
  var READER_KEY = 'najm-reader';
  var READER_RATES = [0.75, 1, 1.25, 1.5];
  /** Selector for the readable blocks of "read the page", in document order. */
  var BLOCKS = 'main :is(h1, h2, h3, h4, p, li, dt, dd, figcaption, legend, label), footer :is(h2, li, p)';

  var reader = (function () {
    var synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
    var saved = readJSON(READER_KEY);
    var voice = null;
    var seq = 0;
    var blocks = [];
    var highlighted = null;
    var hoverTimer;
    var lastSpoken = null;
    var listenersOn = false;

    var r = {
      supported: !!synth,
      enabled: saved.enabled || false,
      rate: saved.rate || 1,
      hover: saved.hover || false,
      /** 'idle' | 'reading' (page reading in progress) | 'paused' */
      state: 'idle',
      speaking: false,
      current: '',
      position: 0,
      total: 0,
      hasArabicVoice: true,
      get rateLabel() {
        return r.rate + '×';
      },

      setEnabled: function (on) {
        if (!r.supported) return;
        r.enabled = on;
        sync();
        if (on) {
          r.speak('تم تشغيل قارئ الشاشة. استخدم زر قراءة الصفحة، أو تنقّل بزر التبويب لسماع العناصر.');
        } else {
          r.stop();
          a11y.announce('تم إيقاف قارئ الشاشة');
        }
        changed();
      },
      setRate: function (rate) {
        r.rate = rate;
        persist();
        if (r.state === 'reading') readFrom(r.position); // apply immediately
        changed();
      },
      setHover: function (on) {
        r.hover = on;
        persist();
        changed();
      },
      /** Read the page from the top (or resume if paused). */
      readPage: function () {
        if (!r.supported) return;
        if (!r.enabled) {
          r.enabled = true;
          sync();
        }
        if (r.state === 'paused') return r.resume();
        collectBlocks();
        if (!blocks.length) return r.speak('لا يوجد محتوى للقراءة في هذه الصفحة');
        readFrom(0);
      },
      pause: function () {
        if (r.state !== 'reading') return;
        seq++;
        synth.cancel(); // cancel+restart from block is more reliable than synth.pause() across browsers
        r.state = 'paused';
        r.speaking = false;
        changed();
      },
      resume: function () {
        if (r.state !== 'paused') return;
        readFrom(r.position);
      },
      next: function () {
        if (r.state === 'idle') return;
        readFrom(Math.min(r.position + 1, blocks.length - 1));
      },
      previous: function () {
        if (r.state === 'idle') return;
        readFrom(Math.max(r.position - 1, 0));
      },
      stop: function () {
        seq++;
        if (synth) synth.cancel();
        r.state = 'idle';
        r.speaking = false;
        r.current = '';
        unhighlight();
        changed();
      },
      /** Speak arbitrary text (interrupts anything currently being spoken). */
      speak: function (text) {
        if (!synth || !text.trim()) return;
        if (r.state !== 'idle') {
          r.state = 'idle';
          unhighlight();
        }
        synth.cancel();
        var u = utterance(text);
        u.onstart = function () {
          r.speaking = true;
          changed();
        };
        u.onend = u.onerror = function () {
          r.speaking = false;
          changed();
        };
        r.current = text;
        synth.speak(u);
        changed();
      },
    };

    // --- page reading ---------------------------------------------------------
    function collectBlocks() {
      var all = Array.prototype.slice.call(document.querySelectorAll(BLOCKS));
      blocks = all.filter(function (el) {
        if (all.some(function (other) { return other !== el && other.contains(el); })) return false; // keep outermost
        var rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height || getComputedStyle(el).visibility === 'hidden') return false;
        if (el.closest('[aria-hidden="true"], [role="dialog"]')) return false;
        return textOf(el).length > 0;
      });
      r.total = blocks.length;
    }

    function readFrom(index) {
      if (!synth || !blocks[index]) return r.stop();
      synth.cancel();
      r.state = 'reading';
      r.position = index;
      var el = blocks[index];
      var text = textOf(el);
      r.current = text;
      highlight(el);

      var mySeq = ++seq;
      var u = utterance(text);
      u.onstart = function () {
        r.speaking = true;
        changed();
      };
      u.onend = function () {
        // Ignore events from utterances that were cancelled/replaced (e.g. speed change, next/prev).
        if (mySeq !== seq || r.state !== 'reading') return;
        if (index + 1 < blocks.length) readFrom(index + 1);
        else {
          r.stop();
          a11y.announce('انتهت قراءة الصفحة');
        }
      };
      u.onerror = function (e) {
        if (e.error !== 'interrupted' && e.error !== 'canceled') r.stop();
      };
      synth.speak(u);
      changed();
    }

    function highlight(el) {
      unhighlight();
      el.classList.add('tts-reading');
      highlighted = el;
      el.scrollIntoView({ block: 'center', behavior: a11y.reduceMotion ? 'auto' : 'smooth' });
    }

    function unhighlight() {
      if (highlighted) highlighted.classList.remove('tts-reading');
      highlighted = null;
    }

    // --- focus / tap / hover reading ------------------------------------------
    function onFocus(e) {
      var el = e.target;
      if (!el || el === document.body || r.state === 'reading') return;
      if (el.id === 'main') return;
      speakElement(el);
    }

    function onClick(e) {
      var target = e.target;
      if (!target || !target.closest || r.state === 'reading') return;
      // Interactive elements are announced on focus; here we only read plain text that was tapped.
      if (target.closest('a, button, input, select, textarea, [role="button"], [role="option"], [role="switch"], [role="tab"]')) return;
      var block = target.closest('h1, h2, h3, h4, p, li, dt, dd, span, label');
      if (block) speakElement(block);
    }

    function onHover(e) {
      if (!r.hover || r.state === 'reading') return;
      var target = e.target && e.target.closest ? e.target.closest('a, button, h1, h2, h3, h4, p, li, label, img[alt]') : null;
      if (!target || target === lastSpoken) return;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(function () { speakElement(target); }, 450);
    }

    function speakElement(el) {
      var text = describe(el);
      if (!text) return;
      lastSpoken = el;
      r.speak(text);
    }

    /** Role + accessible name, e.g. "رابط: الخدمات". */
    function describe(el) {
      var tag = el.tagName.toLowerCase();
      var role = el.getAttribute('role');
      var name = accessibleNameForSpeech(el);
      if (!name) return '';
      var state =
        el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true'
          ? '، مفعّل'
          : el.getAttribute('aria-checked') === 'false' || el.getAttribute('aria-pressed') === 'false'
            ? '، غير مفعّل'
            : el.getAttribute('aria-expanded') === 'true'
              ? '، مفتوح'
              : el.getAttribute('aria-expanded') === 'false'
                ? '، مغلق'
                : '';
      var prefix =
        role === 'switch' ? 'مفتاح'
        : role === 'tab' ? 'تبويب'
        : role === 'option' ? 'خيار'
        : role === 'radio' ? 'خيار'
        : role === 'combobox' || tag === 'input' || tag === 'textarea' ? 'حقل إدخال'
        : tag === 'select' ? 'قائمة منسدلة'
        : tag === 'a' ? 'رابط'
        : tag === 'button' ? 'زر'
        : /^h[1-6]$/.test(tag) ? 'عنوان'
        : tag === 'img' ? 'صورة'
        : '';
      return prefix ? prefix + ': ' + name + state : name;
    }

    function accessibleNameForSpeech(el) {
      var labelledby = el.getAttribute('aria-labelledby');
      if (labelledby) {
        var t = labelledby
          .split(/\s+/)
          .map(function (id) {
            var n = document.getElementById(id);
            return n && n.textContent ? n.textContent.trim() : '';
          })
          .join(' ')
          .trim();
        if (t) return t;
      }
      var label = el.getAttribute('aria-label') || el.alt || el.getAttribute('title');
      if (label) return label.trim();
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        var v = el.value || el.placeholder;
        return v ? v.trim() : '';
      }
      if (el instanceof HTMLSelectElement) {
        var opt = el.selectedOptions[0];
        return opt && opt.textContent ? opt.textContent.trim() : '';
      }
      return textOf(el);
    }

    function textOf(el) {
      return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    }

    // --- plumbing ---------------------------------------------------------------
    function utterance(text) {
      var u = new SpeechSynthesisUtterance(text);
      u.lang = voice ? voice.lang : 'ar-SA';
      if (voice) u.voice = voice;
      u.rate = r.rate;
      return u;
    }

    function pickVoice() {
      var voices = synth ? synth.getVoices() : [];
      if (!voices.length) return;
      voice =
        voices.find(function (v) { return v.lang === 'ar-SA'; }) ||
        voices.find(function (v) { return v.lang && v.lang.toLowerCase().indexOf('ar') === 0; }) ||
        null;
      r.hasArabicVoice = !!voice;
      changed();
    }

    function attach() {
      if (listenersOn) return;
      document.addEventListener('focusin', onFocus);
      document.addEventListener('click', onClick);
      document.addEventListener('mouseover', onHover);
      listenersOn = true;
    }

    function detach() {
      if (!listenersOn) return;
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('click', onClick);
      document.removeEventListener('mouseover', onHover);
      clearTimeout(hoverTimer);
      listenersOn = false;
    }

    function persist() {
      try {
        localStorage.setItem(READER_KEY, JSON.stringify({ enabled: r.enabled, rate: r.rate, hover: r.hover }));
      } catch (e) {}
    }

    /** Equivalent of the service's effect: listeners follow `enabled`, settings persist. */
    function sync() {
      if (r.enabled && r.supported) attach();
      else detach();
      persist();
    }

    if (synth) {
      pickVoice();
      if (synth.addEventListener) synth.addEventListener('voiceschanged', pickVoice);
    }
    sync();

    return r;
  })();

  // ---------------------------------------------------------------------------
  // Voice access — every visible interactive element reachable by voice
  // ---------------------------------------------------------------------------
  var INTERACTIVE = [
    'a[href]',
    'button',
    'input:not([type=hidden])',
    'select',
    'textarea',
    'summary',
    '[role=button]',
    '[role=link]',
    '[role=tab]',
    '[role=radio]',
    '[role=checkbox]',
    '[role=switch]',
    '[role=option]',
    '[role=menuitem]',
    '[tabindex]:not([tabindex="-1"])',
    'label:has(> input.sr-only)',
  ].join(',');

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /** Words people put in front of a name that aren't part of it. */
  var FILLERS = ['علي', 'زر', 'رابط', 'خانه', 'حقل', 'تبويب', 'ايقونه'];

  /** Accessible name, roughly as assistive tech computes it. */
  function accessibleName(el) {
    var label = el.getAttribute('aria-label');
    if (label) return label;
    var by = el.getAttribute('aria-labelledby');
    if (by) {
      var text = by
        .split(/\s+/)
        .map(function (id) {
          var n = document.getElementById(id);
          return n ? n.textContent || '' : '';
        })
        .join(' ')
        .trim();
      if (text) return text;
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      var own = el.labels && el.labels[0] ? el.labels[0].innerText.trim() : '';
      if (own) return own;
      if ('placeholder' in el && el.placeholder) return el.placeholder;
      if (el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'button')) return el.value;
    }
    var inner = el.innerText ? el.innerText.replace(/\s+/g, ' ').trim() : '';
    if (inner) return inner;
    var img = el.querySelector('img[alt]');
    return el.getAttribute('title') || (img ? img.getAttribute('alt') : '') || '';
  }

  function isDisabled(el) {
    return el.disabled || el.getAttribute('aria-disabled') === 'true' || !!el.closest('[inert], [aria-hidden="true"]');
  }

  /** Visible, enabled, on-screen and not covered by something else (e.g. a modal backdrop). */
  function isReachable(el) {
    if (isDisabled(el) || el.closest('#voice-hints')) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false;
    var x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
    var y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
    var hit = document.elementFromPoint(x, y);
    if (!hit) return false;
    var lbl = hit.closest('label');
    return el === hit || el.contains(hit) || hit.contains(el) || (!!lbl && lbl.contains(el));
  }

  function reachableElements(root) {
    root = root || document;
    var seen = new Set();
    var out = [];
    root.querySelectorAll(INTERACTIVE).forEach(function (el) {
      // Skip an element nested inside another target (e.g. a span[tabindex] inside a button).
      var outer = el.parentElement ? el.parentElement.closest(INTERACTIVE) : null;
      if (outer && seen.has(outer)) return;
      if (!isReachable(el)) return;
      seen.add(el);
      out.push(el);
    });
    return out;
  }

  /** The modal/dialog currently on top, if any — its elements win over the page behind it. */
  function topDialog() {
    var dialogs = Array.prototype.slice
      .call(document.querySelectorAll('[role=dialog], [aria-modal=true]'))
      .filter(function (d) { return d.getBoundingClientRect().height > 0; });
    return dialogs.length ? dialogs[dialogs.length - 1] : null;
  }

  /** Best element whose name matches what was said, with a 0–100 confidence. */
  function findByName(spoken, root) {
    var q = normalizeArabic(spoken).trim();
    FILLERS.forEach(function (f) { q = q.replace(new RegExp('^' + f + '\\s+'), ''); });
    if (!q) return null;
    var qWords = q.split(' ');
    var best = null;
    reachableElements(root || document).forEach(function (el) {
      var name = accessibleName(el);
      var n = normalizeArabic(name).trim();
      if (!n) return;
      var score = 0;
      if (n === q) score = 100;
      else if (n.indexOf(q) === 0 || (n.length >= 3 && q.indexOf(n) === 0)) score = 85;
      else if (q.length >= 3 && n.indexOf(q) !== -1) score = 70;
      else if (qWords.length > 1 && qWords.every(function (w) { return n.indexOf(w) !== -1; })) score = 55;
      if (!score) return;
      // Prefer the more specific (shorter) name on ties.
      if (!best || score > best.score || (score === best.score && n.length < normalizeArabic(best.name).length)) best = { el: el, score: score, name: name };
    });
    return best;
  }

  /** Click (or focus, for text fields) the way a pointer/keyboard user would. */
  function activate(el) {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    var textField =
      (el instanceof HTMLInputElement && ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].indexOf(el.type) === -1) ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement;
    el.focus({ preventScroll: true });
    if (!textField) el.click();
  }

  /** Types into the focused field (or the first text field on top), firing `input` like real typing. */
  function typeText(text, append) {
    function isField(e) {
      return (e instanceof HTMLInputElement && /^(text|search|email|tel|url|password|number)$/.test(e.type)) || e instanceof HTMLTextAreaElement;
    }
    var field = document.activeElement;
    if (!isField(field)) field = reachableElements(topDialog() || document).find(isField) || null;
    if (!isField(field)) return null;
    // Numbers are often recognised with spaces between digits ("١ ٠ ٢") — join them for numeric fields.
    var numeric = field.inputMode === 'numeric' || field.type === 'tel' || field.type === 'number';
    var value = numeric ? text.replace(/\s+/g, '') : text;
    var desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value');
    if (desc && desc.set) desc.set.call(field, append && field.value ? field.value + ' ' + value : value);
    field.focus();
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return field;
  }

  /** Picks an option in a visible <select> by its text. */
  function selectOption(spoken, root) {
    var q = normalizeArabic(spoken).trim();
    if (!q) return null;
    var selects = reachableElements(root || document).filter(function (e) { return e instanceof HTMLSelectElement; });
    // The focused dropdown first, then any other one on screen.
    selects.sort(function (a, b) { return (b === document.activeElement ? 1 : 0) - (a === document.activeElement ? 1 : 0); });
    for (var i = 0; i < selects.length; i++) {
      var select = selects[i];
      var option = Array.prototype.slice.call(select.options).find(function (o) {
        var n = normalizeArabic(o.text).trim();
        return n === q || (q.length >= 3 && n.indexOf(q) === 0);
      });
      if (option) {
        select.value = option.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        select.focus();
        return option.text;
      }
    }
    return null;
  }

  /** Tab / Shift+Tab equivalent. */
  function moveFocus(step) {
    var scope = topDialog() || document;
    var list = Array.prototype.slice.call(scope.querySelectorAll(FOCUSABLE)).filter(function (e) {
      return !isDisabled(e) && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    });
    if (!list.length) return null;
    var i = list.indexOf(document.activeElement);
    var next = list[(i + step + list.length) % list.length];
    next.focus();
    next.scrollIntoView({ block: 'nearest' });
    return next;
  }

  // --- Spoken numbers ----------------------------------------------------------
  var UNITS = {
    'صفر': 0, 'واحد': 1, 'واحده': 1, 'اثنين': 2, 'اثنان': 2, 'اثنتين': 2, 'ثنين': 2, 'ثلاثه': 3, 'ثلاث': 3, 'اربعه': 4, 'اربع': 4, 'خمسه': 5, 'خمس': 5,
    'سته': 6, 'ست': 6, 'سبعه': 7, 'سبع': 7, 'ثمانيه': 8, 'ثمان': 8, 'ثماني': 8, 'تسعه': 9, 'تسع': 9, 'عشره': 10, 'عشر': 10,
  };
  var TENS = { 'عشرين': 20, 'عشرون': 20, 'ثلاثين': 30, 'ثلاثون': 30, 'اربعين': 40, 'اربعون': 40, 'خمسين': 50, 'خمسون': 50 };

  /** "٧", "7", "رقم سبعه", "احد عشر", "خمسه وعشرين" → number (or null). */
  function parseSpokenNumber(raw) {
    var t = raw.replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); }).trim();
    t = normalizeArabic(t).replace(/^(رقم|اضغط|اختر|انقر)\s+/, '').replace(/^(رقم)\s+/, '').trim();
    if (/^\d+$/.test(t.replace(/\s+/g, ''))) return +t.replace(/\s+/g, '');
    if (t === 'احد عشر' || t === 'احدعشر') return 11;
    if (/^(اثنا|اثني) ?عشر$/.test(t)) return 12;
    var teen = t.match(/^(\S+) ?عشر$/);
    if (teen && UNITS[teen[1]] !== undefined && UNITS[teen[1]] < 10) return 10 + UNITS[teen[1]];
    var compound = t.match(/^(\S+) و ?(\S+)$/);
    if (compound && UNITS[compound[1]] !== undefined && TENS[compound[2]] !== undefined) return UNITS[compound[1]] + TENS[compound[2]];
    if (UNITS[t] !== undefined) return UNITS[t];
    if (TENS[t] !== undefined) return TENS[t];
    return null;
  }

  // --- Numbered badges ("show numbers") ------------------------------------------
  function NumberHints() {
    var self = this;
    var layer = null;
    var targets = [];
    var frame = 0;
    var interval;
    function refresh() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(renderHints);
    }
    function renderHints() {
      if (!layer) return;
      targets = reachableElements();
      var frag = document.createDocumentFragment();
      targets.forEach(function (el, i) {
        var r = el.getBoundingClientRect();
        var b = document.createElement('span');
        b.className = 'voice-hint';
        b.textContent = String(i + 1);
        // RTL: badge on the element's top-right corner.
        b.style.top = Math.max(2, r.top - 8) + 'px';
        b.style.left = Math.min(innerWidth - 30, Math.max(2, r.right - 18)) + 'px';
        frag.appendChild(b);
      });
      layer.replaceChildren(frag);
    }
    Object.defineProperty(self, 'visible', { get: function () { return !!layer; } });
    self.show = function () {
      if (!layer) {
        layer = document.createElement('div');
        layer.id = 'voice-hints';
        layer.setAttribute('aria-hidden', 'true');
        document.body.appendChild(layer);
        addEventListener('scroll', refresh, { passive: true, capture: true });
        addEventListener('resize', refresh);
        // Content changes after clicks (tabs switching…) — keep numbers current.
        interval = setInterval(refresh, 1200);
      }
      renderHints();
      return targets.length;
    };
    self.hide = function () {
      removeEventListener('scroll', refresh, { capture: true });
      removeEventListener('resize', refresh);
      clearInterval(interval);
      cancelAnimationFrame(frame);
      if (layer) layer.remove();
      layer = null;
      targets = [];
    };
    /** Element for badge `n` (1-based). */
    self.get = function (n) {
      return targets[n - 1] || null;
    };
  }

  // ---------------------------------------------------------------------------
  // VoiceService — continuous Arabic command recognition
  // ---------------------------------------------------------------------------
  /** Commands shown in the help list (the parser below accepts a few more synonyms). */
  var VOICE_COMMANDS = [
    { say: 'اضغط على …', does: 'تفعيل أي زر أو رابط بذكر اسمه، مثل: اضغط على تسجيل الدخول (أو قل الاسم فقط)' },
    { say: 'أظهر الأرقام', does: 'ترقيم كل العناصر القابلة للنقر، ثم قل الرقم لتفعيله، مثل: سبعة' },
    { say: 'إخفاء الأرقام', does: 'إزالة الترقيم' },
    { say: 'اكتب …', does: 'الكتابة في الحقل الحالي، مثل: اكتب ساعات العمل' },
    { say: 'امسح / أرسل', does: 'مسح الحقل الحالي أو إرسال النموذج' },
    { say: 'العنصر التالي / العنصر السابق / اضغط', does: 'التنقل بين العناصر وتفعيل العنصر الحالي' },
    { say: 'الرئيسية', does: 'الانتقال إلى أعلى الصفحة الرئيسية' },
    { say: 'الخدمات', does: 'الانتقال إلى الخدمات الإلكترونية' },
    { say: 'تسجيل الدخول', does: 'تفعيل زر تسجيل الدخول' },
    { say: 'انزل / اطلع', does: 'تمرير الصفحة للأسفل أو للأعلى' },
    { say: 'أعلى الصفحة / أسفل الصفحة', does: 'الانتقال إلى بداية أو نهاية الصفحة' },
    { say: 'رجوع', does: 'العودة إلى الصفحة السابقة' },
    { say: 'إغلاق', does: 'إغلاق النافذة المفتوحة' },
    { say: 'الوضع الليلي / الوضع النهاري / حسب النظام', does: 'تغيير المظهر' },
    { say: 'تكبير الخط / تصغير الخط / الخط الافتراضي', does: 'تغيير حجم النص' },
    { say: 'التباين العالي / تباعد النص / تمييز الروابط / تقليل الحركة', does: 'تشغيل أو إيقاف خيارات العرض' },
    { say: 'عمى الأحمر / عمى الأخضر / عمى الأزرق / تدرج رمادي / ألوان طبيعية', does: 'مرشحات عمى الألوان' },
    { say: 'إعادة ضبط الإعدادات', does: 'إرجاع إعدادات الوصول للوضع الافتراضي' },
    { say: 'إعدادات الوصول', does: 'فتح إعدادات إمكانية الوصول' },
    { say: 'قارئ الشاشة / اقرأ الصفحة', does: 'تشغيل قارئ الشاشة وقراءة الصفحة' },
    { say: 'إيقاف مؤقت / استئناف / الفقرة التالية / الفقرة السابقة', does: 'التحكم في القراءة' },
    { say: 'توقف عن القراءة', does: 'إيقاف القراءة الصوتية' },
    { say: 'توقف', does: 'إيقاف التحكم الصوتي' },
  ];

  var voice = (function () {
    var Ctor = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : undefined;
    var hints = new NumberHints();
    var recognition = null;

    var v = {
      supported: !!Ctor,
      /** Continuous command mode is on. */
      active: false,
      /** Microphone is currently capturing. */
      listening: false,
      transcript: '',
      feedback: '',
      helpOpen: false,

      setActive: function (on) {
        if (!v.supported) return;
        if (on === v.active) return;
        v.active = on;
        if (on) {
          v.feedback = 'قل «مساعدة» لعرض الأوامر';
          a11y.announce('تم تشغيل التحكم الصوتي. قل مساعدة لعرض الأوامر');
          startCommands();
        } else {
          if (recognition) recognition.abort();
          recognition = null;
          v.listening = false;
          v.transcript = '';
          v.helpOpen = false;
          hints.hide();
          a11y.announce('تم إيقاف التحكم الصوتي');
        }
        changed();
      },
      setHelpOpen: function (open) {
        v.helpOpen = open;
        changed();
      },
    };

    function createRec() {
      var rec = new Ctor();
      rec.lang = 'ar-SA';
      rec.maxAlternatives = 1;
      return rec;
    }

    function startCommands() {
      var rec = createRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = function (e) {
        for (var i = e.resultIndex; i < e.results.length; i++) {
          var text = e.results[i][0].transcript.trim();
          v.transcript = text;
          // Ignore what the microphone hears while our own screen reader is talking.
          if (e.results[i].isFinal && text && !reader.speaking) handle(text);
        }
        changed();
      };
      rec.onerror = function (e) {
        onError(e.error);
      };
      // Browsers end sessions after silence — restart while command mode is on.
      rec.onend = function () {
        v.listening = false;
        changed();
        if (v.active && recognition === rec) {
          setTimeout(function () {
            if (v.active) restart(rec);
          }, 250);
        }
      };
      recognition = rec;
      restart(rec);
    }

    function restart(rec) {
      try {
        rec.start();
        v.listening = true;
      } catch (e) {
        /* already started */
      }
      changed();
    }

    function onError(error) {
      if (error === 'no-speech' || error === 'aborted') return; // harmless; onend restarts
      var messages = {
        'not-allowed': 'لم يتم السماح باستخدام الميكروفون. فعّل الإذن من إعدادات المتصفح.',
        'service-not-allowed': 'خدمة التعرف على الكلام غير متاحة في هذا المتصفح.',
        'audio-capture': 'لم يتم العثور على ميكروفون.',
        network: 'تعذر الاتصال بخدمة التعرف على الكلام.',
      };
      var msg = messages[error] || 'حدث خطأ في التعرف على الكلام.';
      v.feedback = msg;
      a11y.announce(msg);
      if (error in messages) {
        v.active = false;
        recognition = null;
        v.listening = false;
      }
      changed();
    }

    /** In-page destinations (this page has no other routes). */
    function goTo(where) {
      var smooth = a11y.reduceMotion ? 'auto' : 'smooth';
      if (where === 'top') return window.scrollTo({ top: 0, behavior: smooth });
      var title = document.getElementById(where);
      var section = title ? title.closest('section') || title : null;
      if (section) section.scrollIntoView({ block: 'start', behavior: smooth });
    }

    // --- command parsing ----------------------------------------------------------
    function handle(raw) {
      var t = normalizeArabic(raw).replace(/[.!؟?،,]+$/g, '').trim();
      var has = function () {
        var words = Array.prototype.slice.call(arguments);
        return words.some(function (w) { return t.indexOf(normalizeArabic(w)) !== -1; });
      };
      var is = function () {
        var words = Array.prototype.slice.call(arguments);
        return words.some(function (w) { return t === normalizeArabic(w); });
      };
      var done = function (msg) {
        v.feedback = '✓ ' + msg;
        a11y.announce(msg);
      };
      var press = function (el, label) {
        activate(el);
        done(label);
      };

      // 1. Numbered badges: "٧" / "رقم سبعه" while numbers are shown.
      if (hints.visible) {
        var n = parseSpokenNumber(raw);
        if (n !== null) {
          var target = hints.get(n);
          if (!target) return (v.feedback = 'لا يوجد عنصر برقم ' + n);
          return press(target, 'تفعيل العنصر ' + n);
        }
      }
      if (has('الارقام', 'رقم العناصر', 'رقم الازرار')) {
        if (has('اخف', 'اخفاء', 'ازل', 'الغ')) {
          hints.hide();
          return done('إخفاء الأرقام');
        }
        var count = hints.show();
        return done('تم ترقيم ' + count + ' عنصراً. قل الرقم لتفعيله');
      }

      // 2. Screen reader.
      if (has('ايقاف مؤقت', 'وقف مؤقت')) return reader.pause(), done('إيقاف القراءة مؤقتاً');
      if (has('استئناف', 'تابع القراءه', 'استمر')) return reader.resume(), done('استئناف القراءة');
      if (has('الفقره التاليه')) return reader.next(), done('الفقرة التالية');
      if (has('الفقره السابقه')) return reader.previous(), done('الفقرة السابقة');
      if (has('توقف عن القراءه', 'اوقف القراءه', 'اسكت', 'ايقاف قارئ الشاشه')) return reader.stop(), done('إيقاف القراءة');
      if (has('قارئ الشاشه')) return reader.setEnabled(true), done('تشغيل قارئ الشاشة');
      if (has('اقرا الصفحه', 'اقرا المحتوي') || t === 'اقرا') return reader.readPage(), done('قراءة الصفحة');
      if (is('توقف', 'ايقاف الاستماع', 'اوقف', 'ايقاف التحكم الصوتي')) return v.setActive(false);

      if (has('الاوامر', 'ماذا اقول') || is('مساعده')) {
        v.helpOpen = true;
        return done('عرض قائمة الأوامر');
      }

      // 3. Typing & focus — works in every field.
      var typeMatch = raw.match(/^(?:[اأإ]كتب|اكتبي)\s+(.+)$/);
      if (typeMatch) {
        var typed = typeMatch[1].trim();
        return typeText(typed) ? done('كتابة: ' + typed) : (v.feedback = 'لا يوجد حقل نصي للكتابة فيه. قل «أظهر الأرقام» لاختيار حقل');
      }
      if (is('امسح', 'مسح', 'امسح الحقل', 'امسح النص')) {
        return typeText('') ? done('مسح الحقل') : (v.feedback = 'لا يوجد حقل لمسحه');
      }
      if (is('ارسل', 'ارسال', 'ارسل الرساله', 'تاكيد', 'ارسل النموذج')) {
        var form = document.activeElement ? document.activeElement.closest('form') : null;
        if (form) {
          form.requestSubmit();
          return done('إرسال');
        }
        var btn = findByName(t, topDialog() || document);
        if (btn) return press(btn.el, btn.name);
      }
      if (is('التالي', 'العنصر التالي', 'السابق', 'العنصر السابق')) {
        var moved = moveFocus(has('التالي') ? 1 : -1);
        return moved ? done('التركيز على ' + (moved.getAttribute('aria-label') || moved.innerText || '').trim().slice(0, 40)) : undefined;
      }
      if (is('اضغط', 'انقر', 'تفعيل', 'نفذ', 'اختر') && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
        return press(document.activeElement, 'تفعيل العنصر الحالي');
      }

      // 4. Site features available on this page.
      if (has('تسجيل الدخول', 'سجل دخول', 'سجل الدخول')) {
        var login = Array.prototype.slice.call(document.querySelectorAll('header a')).find(function (a) { return a.textContent.trim() === 'تسجيل الدخول'; });
        if (login) return press(login, 'فتح تسجيل الدخول');
      }
      if (has('اغلاق', 'اغلق', 'سكر')) {
        closeAll();
        return done('إغلاق');
      }

      // 5. Accessibility settings.
      if (has('الوضع الليلي', 'الوضع الداكن', 'الوضع المظلم')) return a11y.setTheme('dark'), done('الوضع الليلي');
      if (has('الوضع النهاري', 'الوضع الفاتح')) return a11y.setTheme('light'), done('الوضع النهاري');
      if (has('حسب النظام', 'الوضع التلقائي')) return a11y.setTheme('system'), done('المظهر حسب النظام');
      if (has('الخط الافتراضي', 'اعاده ضبط الخط', 'حجم الخط الطبيعي')) return a11y.resetText(), done('حجم الخط الافتراضي');
      if (has('تكبير الخط', 'كبر الخط', 'كبر')) return a11y.increaseText(), done('تكبير الخط');
      if (has('تصغير الخط', 'صغر الخط', 'صغر')) return a11y.decreaseText(), done('تصغير الخط');
      if (has('التباين')) return a11y.toggle('contrast', 'التباين العالي'), done('التباين العالي');
      if (has('تباعد')) return a11y.toggle('spacing', 'تباعد النص'), done('تباعد النص');
      if (has('تمييز الروابط', 'ابراز الروابط')) return a11y.toggle('links', 'تمييز الروابط'), done('تمييز الروابط');
      if (has('تقليل الحركه', 'ايقاف الحركه')) return a11y.toggle('reduceMotion', 'تقليل الحركة'), done('تقليل الحركة');
      if (has('عمي الاحمر', 'بروتانوبيا')) return a11y.setCvd('protanopia', 'عمى اللون الأحمر'), done('عمى اللون الأحمر');
      if (has('عمي الاخضر', 'ديوترانوبيا')) return a11y.setCvd('deuteranopia', 'عمى اللون الأخضر'), done('عمى اللون الأخضر');
      if (has('عمي الازرق', 'تريتانوبيا')) return a11y.setCvd('tritanopia', 'عمى اللون الأزرق'), done('عمى اللون الأزرق');
      if (has('تدرج رمادي', 'احادي اللون', 'ابيض واسود')) return a11y.setCvd('monochrome', 'تدرج رمادي'), done('تدرج رمادي');
      if (has('الوان طبيعيه', 'الالوان الطبيعيه', 'الغاء الفلتر', 'بدون فلتر')) return a11y.setCvd('none', 'الألوان الطبيعية'), done('الألوان الطبيعية');
      if (has('اعاده ضبط الاعدادات', 'اعاده ضبط الكل', 'الاعدادات الافتراضيه')) return a11y.resetAll(), done('إعادة ضبط إعدادات الوصول');
      if (has('اعدادات الوصول', 'امكانيه الوصول')) {
        openPanel();
        return done('فتح إعدادات إمكانية الوصول');
      }

      // 6. Scrolling & history.
      var smooth = a11y.reduceMotion ? 'auto' : 'smooth';
      if (has('اعلي الصفحه', 'بدايه الصفحه')) return window.scrollTo({ top: 0, behavior: smooth }), done('أعلى الصفحة');
      if (has('اسفل الصفحه', 'نهايه الصفحه')) return window.scrollTo({ top: document.body.scrollHeight, behavior: smooth }), done('أسفل الصفحة');
      if (is('انزل', 'للاسفل', 'نزل', 'مرر للاسفل')) return window.scrollBy({ top: innerHeight * 0.7, behavior: smooth }), done('تمرير للأسفل');
      if (is('اطلع', 'للاعلي', 'اصعد', 'طلع', 'مرر للاعلي')) return window.scrollBy({ top: -innerHeight * 0.7, behavior: smooth }), done('تمرير للأعلى');
      if (is('رجوع', 'ارجع', 'الخلف', 'للخلف')) return history.back(), done('رجوع');

      // 7. "اضغط على X" / "افتح X" — any element by its visible or accessible name.
      var clickMatch = t.match(/^(?:اضغط|انقر|اختر|افتح|فعل|شغل|اذهب)\s+(?:علي\s+|الي\s+)?(.+)$/);
      var dialog = topDialog();
      if (clickMatch) {
        var picked = selectOption(clickMatch[1], dialog || document);
        if (picked) return done('اختيار ' + picked);
        var hit = findByName(clickMatch[1], dialog || document);
        if (hit && hit.score >= 55) return press(hit.el, hit.name);
      }
      // While a dialog is open, its own buttons win over page navigation.
      if (dialog) {
        var dHit = findByName(t, dialog);
        if (dHit && dHit.score >= 85) return press(dHit.el, dHit.name);
      }

      var routes = [
        [['الخدمات'], 'eservices-title', 'الخدمات'],
        [['الرئيسيه', 'الصفحه الرئيسيه', 'البدايه'], 'top', 'الرئيسية'],
      ];
      var spoken = clickMatch ? clickMatch[1] : t;
      for (var i = 0; i < routes.length; i++) {
        if (routes[i][0].some(function (w) { return spoken === normalizeArabic(w); })) {
          goTo(routes[i][1]);
          return done('الانتقال إلى ' + routes[i][2]);
        }
      }

      // 8. Just an element's name ("الشريحة التالية", "إقرأ المزيد"…).
      var opt = selectOption(spoken, dialog || document);
      if (opt) return done('اختيار ' + opt);
      var nHit = findByName(spoken, dialog || document);
      if (nHit && nHit.score >= 70) return press(nHit.el, nHit.name);

      // Looser route match as a last resort ("قسم الخدمات"…).
      for (var j = 0; j < routes.length; j++) {
        if (has.apply(null, routes[j][0])) {
          goTo(routes[j][1]);
          return done('الانتقال إلى ' + routes[j][2]);
        }
      }
      v.feedback = 'لم أفهم «' + raw + '». قل «أظهر الأرقام» أو «مساعدة» لعرض الأوامر';
    }

    /** Closes whatever is open on top: number badges, help, settings. */
    function closeAll() {
      hints.hide();
      v.helpOpen = false;
      a11y.panelOpen = false;
      // Dialogs listen for Escape on their own element, so send it from inside the focused one.
      var from = document.activeElement || document.body;
      from.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }

    return v;
  })();

  // ---------------------------------------------------------------------------
  // Shared SVG snippets
  // ---------------------------------------------------------------------------
  var ICON_SPEAKER = '<path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />';
  var ICON_MIC = '<rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />';
  var ICON_CLOSE = '<svg aria-hidden="true" viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>';
  var ICON_PLAY = '<svg aria-hidden="true" viewBox="0 0 24 24" class="size-5" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>';
  var ICON_PAUSE = '<svg aria-hidden="true" viewBox="0 0 24 24" class="size-5" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>';

  var SWITCH_KNOB = '<span aria-hidden="true" class="absolute top-0.5 right-0.5 size-6 rounded-full bg-white shadow-sm transition-transform duration-200" data-knob></span>';

  // ---------------------------------------------------------------------------
  // A11yPanel — settings dialog (side panel on desktop, bottom sheet on small screens)
  // ---------------------------------------------------------------------------
  var THEMES = [
    { id: 'light', label: 'فاتح' },
    { id: 'dark', label: 'داكن' },
    { id: 'system', label: 'تلقائي' },
  ];
  var TOGGLES = [
    { key: 'contrast', label: 'التباين العالي', hint: 'نص أغمق وحدود أوضح لقراءة أسهل' },
    { key: 'spacing', label: 'تباعد النص', hint: 'زيادة المسافة بين الأسطر والكلمات' },
    { key: 'links', label: 'إبراز الروابط والأزرار', hint: 'خط سفلي وإطار حول العناصر القابلة للنقر' },
    { key: 'reduceMotion', label: 'تقليل الحركة', hint: 'إيقاف الحركات والتمرير التلقائي' },
  ];
  var CVD_MODES = [
    { id: 'none', label: 'بدون تصحيح' },
    { id: 'protanopia', label: 'ضعف رؤية اللون الأحمر', hint: 'Protanopia' },
    { id: 'deuteranopia', label: 'ضعف رؤية اللون الأخضر', hint: 'Deuteranopia' },
    { id: 'tritanopia', label: 'ضعف رؤية اللون الأزرق', hint: 'Tritanopia' },
    { id: 'monochrome', label: 'أحادي اللون (تدرّج رمادي)', hint: 'Monochrome' },
  ];

  var panelEl = null;
  var panelClosing = false;
  var closeFallback;
  var opener = null;

  function panelTemplate() {
    var themeBtns = THEMES.map(function (t) {
      return (
        '<button type="button" role="radio" data-theme="' + t.id + '" class="flex h-11 items-center justify-center gap-1.5 rounded-[10px] text-[length:calc(13px*var(--ts))] font-medium transition-colors">' +
        escapeHtml(t.label) +
        '</button>'
      );
    }).join('');

    var toggles = TOGGLES.map(function (t) {
      return (
        '<div class="flex items-center justify-between gap-4 px-4 py-3.5">' +
        '<span class="flex flex-col">' +
        '<span id="lbl-' + t.key + '" class="text-[length:calc(13px*var(--ts))] font-medium text-heading">' + escapeHtml(t.label) + '</span>' +
        '<span id="hint-' + t.key + '" class="text-[length:calc(11px*var(--ts))] leading-[calc(20px*var(--ts))] text-secondary-100">' + escapeHtml(t.hint) + '</span>' +
        '</span>' +
        '<button type="button" role="switch" data-toggle="' + t.key + '" aria-labelledby="lbl-' + t.key + '" aria-describedby="hint-' + t.key + '" class="relative h-7 w-12 shrink-0 rounded-full transition-colors">' +
        SWITCH_KNOB +
        '</button>' +
        '</div>'
      );
    }).join('');

    var rates = READER_RATES.map(function (r) {
      return (
        '<button type="button" role="radio" dir="ltr" data-rate="' + r + '" class="h-8 min-w-[48px] rounded-[9px] px-2 text-[length:calc(11px*var(--ts))] font-bold transition-colors">' +
        '<bdi dir="ltr">' + r + '×</bdi>' +
        '</button>'
      );
    }).join('');

    var cvd = CVD_MODES.map(function (m) {
      return (
        '<button type="button" role="radio" data-cvd="' + m.id + '" class="flex items-center justify-between gap-3 rounded-[12px] border px-4 py-3 text-start transition-colors">' +
        '<span class="flex flex-col">' +
        '<span class="text-[length:calc(13px*var(--ts))] font-medium text-heading">' + escapeHtml(m.label) + '</span>' +
        (m.hint ? '<span class="text-[length:calc(10px*var(--ts))] text-secondary-100" lang="en" dir="ltr">' + escapeHtml(m.hint) + '</span>' : '') +
        '</span>' +
        '<span aria-hidden="true" class="flex size-5 shrink-0 items-center justify-center rounded-full border-2" data-ring>' +
        '<span class="size-2.5 rounded-full bg-primary" data-dot></span>' +
        '</span>' +
        '</button>'
      );
    }).join('');

    return (
      '<div class="a11y-ui fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-labelledby="a11y-title">' +
      '<div class="absolute inset-0 bg-black/40" data-backdrop></div>' +
      '<section class="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-[24px] bg-canvas shadow-[0_-8px_30px_rgba(0,0,0,0.18)] md:inset-x-auto md:top-4 md:bottom-4 md:left-4 md:max-h-none md:w-[400px] md:rounded-[20px]" data-panel>' +
      '<header class="flex shrink-0 items-center justify-between border-b border-line px-5 py-4">' +
      '<h2 id="a11y-title" class="flex items-center gap-2 text-[length:calc(18px*var(--ts))] leading-[calc(28px*var(--ts))] font-bold text-heading">' +
      '<img src="assets/icon-eye.svg" alt="" class="block size-6" />' +
      'إمكانية الوصول' +
      '</h2>' +
      '<button type="button" class="flex size-10 items-center justify-center rounded-full hover:bg-secondary-10" aria-label="إغلاق إعدادات إمكانية الوصول" data-close>' +
      '<img src="assets/modal-close.svg" alt="" class="block size-8" />' +
      '</button>' +
      '</header>' +

      '<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">' +
      '<div class="flex flex-col gap-6">' +

      // Theme
      '<fieldset class="flex flex-col gap-3">' +
      '<legend class="mb-3 text-[length:calc(14px*var(--ts))] font-bold text-heading">المظهر</legend>' +
      '<div class="grid grid-cols-3 gap-2 rounded-[14px] bg-surface p-1" role="radiogroup" aria-label="المظهر">' + themeBtns + '</div>' +
      '</fieldset>' +

      // Text size
      '<fieldset class="flex flex-col gap-3">' +
      '<legend class="mb-3 text-[length:calc(14px*var(--ts))] font-bold text-heading">حجم الخط</legend>' +
      '<div class="flex items-center gap-2">' +
      '<button type="button" class="flex h-12 flex-1 items-center justify-center rounded-[12px] border border-secondary-40 text-[length:calc(16px*var(--ts))] font-bold text-heading transition-colors hover:border-primary disabled:opacity-40" aria-label="تصغير الخط" data-text-dec>' +
      '<svg aria-hidden="true" viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round"><path d="M5 12h14" /></svg>' +
      '</button>' +
      '<output class="flex h-12 min-w-[88px] items-center justify-center rounded-[12px] bg-surface text-[length:calc(14px*var(--ts))] font-bold text-heading" aria-live="off" data-text-out></output>' +
      '<button type="button" class="flex h-12 flex-1 items-center justify-center rounded-[12px] border border-secondary-40 text-[length:calc(20px*var(--ts))] font-bold text-heading transition-colors hover:border-primary disabled:opacity-40" aria-label="تكبير الخط" data-text-inc>' +
      '<svg aria-hidden="true" viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>' +
      '</button>' +
      '</div>' +
      '<button type="button" class="self-start text-[length:calc(12px*var(--ts))] font-medium text-primary underline underline-offset-4" data-text-reset>إعادة الحجم الافتراضي</button>' +
      '</fieldset>' +

      // Toggles
      '<div class="flex flex-col divide-y divide-line rounded-[14px] border border-line">' + toggles + '</div>' +

      // Screen reader
      '<div class="flex flex-col gap-3 rounded-[14px] border border-line px-4 py-3.5">' +
      '<div class="flex items-center justify-between gap-4">' +
      '<span class="flex items-center gap-2">' +
      '<svg aria-hidden="true" viewBox="0 0 24 24" class="size-5 shrink-0 text-primary" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICON_SPEAKER + '</svg>' +
      '<span id="lbl-reader" class="text-[length:calc(13px*var(--ts))] font-medium text-heading">قارئ الشاشة</span>' +
      '</span>' +
      '<button type="button" role="switch" aria-labelledby="lbl-reader" aria-describedby="hint-reader" class="relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50" data-reader-switch>' + SWITCH_KNOB + '</button>' +
      '</div>' +
      '<p id="hint-reader" class="text-[length:calc(11px*var(--ts))] leading-[calc(20px*var(--ts))] text-secondary-100">' +
      (reader.supported ? 'يقرأ محتوى الصفحة بصوت عربي، ويقرأ كل عنصر عند التنقل بزر التبويب أو عند النقر على أي نص.' : 'القراءة الصوتية غير مدعومة في هذا المتصفح.') +
      '</p>' +
      '<div class="flex flex-wrap items-center gap-2" data-reader-extra>' +
      '<button type="button" class="flex h-10 items-center gap-2 rounded-[12px] bg-primary px-4 text-[length:calc(12px*var(--ts))] font-medium text-white hover:bg-primary-200" data-read-page>' +
      '<svg aria-hidden="true" viewBox="0 0 24 24" class="size-4" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>' +
      'قراءة الصفحة' +
      '</button>' +
      '<div class="flex items-center gap-1 rounded-[12px] bg-surface p-1" role="radiogroup" aria-label="سرعة القراءة">' + rates + '</div>' +
      '</div>' +
      '<label class="flex cursor-pointer items-center gap-2 text-[length:calc(12px*var(--ts))] text-secondary-200" data-reader-extra>' +
      '<input type="checkbox" class="size-4 accent-[rgb(var(--c-primary))]" data-reader-hover />' +
      'القراءة عند تمرير المؤشر فوق العناصر' +
      '</label>' +
      '</div>' +

      // Voice control
      '<div class="flex flex-col gap-2 rounded-[14px] border border-line px-4 py-3.5">' +
      '<div class="flex items-center justify-between gap-4">' +
      '<span class="flex items-center gap-2">' +
      '<svg aria-hidden="true" viewBox="0 0 24 24" class="size-5 shrink-0 text-primary" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICON_MIC + '</svg>' +
      '<span id="lbl-voice" class="text-[length:calc(13px*var(--ts))] font-medium text-heading">التحكم الصوتي</span>' +
      '</span>' +
      '<button type="button" role="switch" aria-labelledby="lbl-voice" aria-describedby="hint-voice" class="relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50" data-voice-switch>' + SWITCH_KNOB + '</button>' +
      '</div>' +
      '<p id="hint-voice" class="text-[length:calc(11px*var(--ts))] leading-[calc(20px*var(--ts))] text-secondary-100">' +
      (voice.supported
        ? 'تنقّل في الموقع بصوتك، مثل: «الخدمات» أو «تكبير الخط» أو «انزل». قل «مساعدة» لعرض كل الأوامر. يستخدم خدمة التعرف على الكلام في المتصفح وقد يُرسل الصوت إلى مزوّد المتصفح.'
        : 'التحكم الصوتي غير مدعوم في هذا المتصفح. استخدم Chrome أو Edge أو Safari.') +
      '</p>' +
      '<button type="button" class="self-start text-[length:calc(12px*var(--ts))] font-medium text-primary underline underline-offset-4" data-voice-help>عرض الأوامر الصوتية</button>' +
      '</div>' +

      // Colour vision
      '<fieldset class="flex flex-col gap-3">' +
      '<legend class="mb-1 text-[length:calc(14px*var(--ts))] font-bold text-heading">تصحيح الألوان (عمى الألوان)</legend>' +
      '<p class="mb-2 text-[length:calc(11px*var(--ts))] leading-[calc(20px*var(--ts))] text-secondary-100">يعدّل ألوان الصفحة لتمييزها بشكل أوضح حسب نوع ضعف رؤية الألوان.</p>' +
      '<div class="flex flex-col gap-2" role="radiogroup" aria-label="تصحيح الألوان">' + cvd + '</div>' +
      '</fieldset>' +

      '</div>' +
      '</div>' +

      '<footer class="shrink-0 border-t border-line px-5 py-4">' +
      '<button type="button" class="flex h-12 w-full items-center justify-center rounded-[14px] bg-primary-20 text-[length:calc(14px*var(--ts))] font-medium text-primary-200 transition-colors hover:bg-primary-10" data-reset-all>' +
      'إعادة ضبط جميع الإعدادات' +
      '</button>' +
      '</footer>' +
      '</section>' +
      '</div>'
    );
  }

  function buildPanel() {
    var root = create(panelTemplate());
    var q = function (sel) { return root.querySelector(sel); };
    var qa = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };

    q('[data-backdrop]').addEventListener('click', closePanel);
    q('[data-close]').addEventListener('click', closePanel);
    qa('[data-theme]').forEach(function (b) {
      b.addEventListener('click', function () { a11y.setTheme(b.dataset.theme); });
    });
    q('[data-text-dec]').addEventListener('click', function () { a11y.decreaseText(); });
    q('[data-text-inc]').addEventListener('click', function () { a11y.increaseText(); });
    q('[data-text-reset]').addEventListener('click', function () { a11y.resetText(); });
    qa('[data-toggle]').forEach(function (b) {
      var t = TOGGLES.find(function (x) { return x.key === b.dataset.toggle; });
      b.addEventListener('click', function () { a11y.toggle(t.key, t.label); });
    });
    q('[data-reader-switch]').addEventListener('click', function () { reader.setEnabled(!reader.enabled); });
    q('[data-read-page]').addEventListener('click', function () {
      reader.readPage();
      closePanel();
    });
    qa('[data-rate]').forEach(function (b) {
      b.addEventListener('click', function () { reader.setRate(+b.dataset.rate); });
    });
    q('[data-reader-hover]').addEventListener('change', function (e) { reader.setHover(e.target.checked); });
    q('[data-voice-switch]').addEventListener('click', function () { voice.setActive(!voice.active); });
    q('[data-voice-help]').addEventListener('click', function () { voice.setHelpOpen(true); });
    qa('[data-cvd]').forEach(function (b) {
      var m = CVD_MODES.find(function (x) { return x.id === b.dataset.cvd; });
      b.addEventListener('click', function () { a11y.setCvd(m.id, m.label); });
    });
    q('[data-reset-all]').addEventListener('click', function () { a11y.resetAll(); });

    var section = q('[data-panel]');
    section.addEventListener('animationend', function (event) {
      if (event.target !== event.currentTarget || event.animationName !== 'sheet-down') return;
      finishClose();
    });
    root.addEventListener('keydown', onPanelKeydown);
    return root;
  }

  function updateSwitch(btn, on) {
    btn.setAttribute('aria-checked', String(on));
    variant(btn, on, 'bg-primary', 'bg-secondary-40');
    btn.querySelector('[data-knob]').classList.toggle('-translate-x-5', on);
  }

  function updatePanel() {
    var root = panelEl;
    var q = function (sel) { return root.querySelector(sel); };
    var qa = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };

    variant(q('[data-backdrop]'), panelClosing, 'fade-out', 'fade-in');
    var section = q('[data-panel]');
    section.classList.toggle('sheet-up', !panelClosing);
    section.classList.toggle('sheet-down', panelClosing);

    qa('[data-theme]').forEach(function (b) {
      var on = a11y.theme === b.dataset.theme;
      b.setAttribute('aria-checked', String(on));
      variant(b, on, 'bg-primary text-white', 'text-secondary-200 hover:bg-secondary-10');
    });

    q('[data-text-dec]').disabled = !a11y.canDecrease;
    q('[data-text-inc]').disabled = !a11y.canIncrease;
    q('[data-text-out]').textContent = a11y.textPercent + '%';
    setHidden(q('[data-text-reset]'), a11y.textScale === 1);

    qa('[data-toggle]').forEach(function (b) {
      updateSwitch(b, !!a11y[b.dataset.toggle]);
    });

    var rs = q('[data-reader-switch]');
    rs.disabled = !reader.supported;
    updateSwitch(rs, reader.enabled);
    qa('[data-reader-extra]').forEach(function (n) { setHidden(n, !reader.enabled); });
    qa('[data-rate]').forEach(function (b) {
      var on = reader.rate === +b.dataset.rate;
      b.setAttribute('aria-checked', String(on));
      variant(b, on, 'bg-primary text-white', 'text-secondary-200 hover:bg-secondary-10');
    });
    q('[data-reader-hover]').checked = reader.hover;

    var vs = q('[data-voice-switch]');
    vs.disabled = !voice.supported;
    updateSwitch(vs, voice.active);
    setHidden(q('[data-voice-help]'), !voice.active);

    qa('[data-cvd]').forEach(function (b) {
      var on = a11y.cvd === b.dataset.cvd;
      b.setAttribute('aria-checked', String(on));
      variant(b, on, 'border-primary bg-primary-10', 'border-line hover:border-primary');
      variant(b.querySelector('[data-ring]'), on, 'border-primary', 'border-secondary-40');
      setHidden(b.querySelector('[data-dot]'), !on);
    });
  }

  function openPanel() {
    a11y.panelOpen = true;
    changed();
  }

  function closePanel() {
    if (panelClosing) return;
    panelClosing = true;
    // Animations don't run in background tabs — never leave the panel stuck open.
    clearTimeout(closeFallback);
    closeFallback = setTimeout(finishClose, 450);
    changed();
  }

  function finishClose() {
    clearTimeout(closeFallback);
    panelClosing = false;
    a11y.panelOpen = false;
    changed();
  }

  function onPanelKeydown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closePanel();
      return;
    }
    if (event.key !== 'Tab') return;
    // Keep keyboard focus inside the dialog.
    var root = panelEl && panelEl.querySelector('[data-panel]');
    if (!root) return;
    var items = Array.prototype.slice.call(root.querySelectorAll('button:not([disabled]), [href], input, select, [tabindex]:not([tabindex="-1"])')).filter(function (n) {
      return !n.closest('[hidden]');
    });
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function renderPanel() {
    if (a11y.panelOpen && !panelEl) {
      // Move focus into the dialog on open…
      opener = document.activeElement;
      document.body.style.overflow = 'hidden';
      panelEl = buildPanel();
      document.body.appendChild(panelEl);
      updatePanel();
      var closeBtn = panelEl.querySelector('[data-close]');
      queueMicrotask(function () { closeBtn.focus({ preventScroll: true }); });
      return;
    }
    if (!a11y.panelOpen && panelEl) {
      // …and give it back to the opener on close.
      panelEl.remove();
      panelEl = null;
      panelClosing = false;
      clearTimeout(closeFallback);
      document.body.style.overflow = '';
      if (opener && opener.focus) opener.focus();
      opener = null;
      return;
    }
    if (panelEl) updatePanel();
  }

  // ---------------------------------------------------------------------------
  // ReaderBar — floating screen-reader controls (visible while the reader is on)
  // ---------------------------------------------------------------------------
  var readerBarEl = null;

  function readerBarTemplate() {
    var ctrl = 'flex size-9 items-center justify-center rounded-full text-secondary-200 enabled:hover:bg-secondary-10 disabled:cursor-not-allowed disabled:opacity-[0.35]';
    return (
      '<div class="a11y-ui fixed right-4 z-[66] flex w-[min(400px,calc(100vw-32px))] flex-col gap-2 rounded-[18px] border border-line bg-canvas p-3 shadow-[0_8px_24px_rgba(0,0,0,0.18)]" role="region" aria-label="قارئ الشاشة">' +
        '<div class="flex items-center gap-2">' +
        '<span class="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-white">' +
        '<span aria-hidden="true" class="absolute inset-0 animate-ping rounded-full bg-primary/40" data-ping></span>' +
        '<svg aria-hidden="true" viewBox="0 0 24 24" class="relative size-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICON_SPEAKER + '</svg>' +
        '</span>' +
        '<span class="flex min-w-0 flex-1 flex-col">' +
        '<span class="text-[length:calc(11px*var(--ts))] font-bold text-heading">قارئ الشاشة<span class="font-medium text-secondary-100" data-count></span></span>' +
        '<span class="truncate text-[length:calc(11px*var(--ts))] text-secondary-100" data-current></span>' +
        '</span>' +
        '<button type="button" class="flex size-8 shrink-0 items-center justify-center rounded-full text-secondary-100 hover:bg-secondary-10" aria-label="إيقاف قارئ الشاشة" data-off>' + ICON_CLOSE + '</button>' +
        '</div>' +
        '<div class="flex items-center justify-between gap-2" role="toolbar" aria-label="عناصر التحكم في القراءة">' +
        '<div class="flex items-center gap-1.5">' +
        // RTL: "previous" sits on the right, "next" on the left
        '<button type="button" class="' + ctrl + '" aria-label="الفقرة السابقة" data-prev>' +
        '<svg aria-hidden="true" viewBox="0 0 24 24" class="size-5" fill="currentColor"><path d="M6 6v12h2V6zm3.5 6 8.5 6V6z" transform="scale(-1,1) translate(-24,0)" /></svg>' +
        '</button>' +
        '<button type="button" class="flex size-11 items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-primary-200" data-play></button>' +
        '<button type="button" class="' + ctrl + '" aria-label="الفقرة التالية" data-next>' +
        '<svg aria-hidden="true" viewBox="0 0 24 24" class="size-5" fill="currentColor"><path d="M6 6v12h2V6zm3.5 6 8.5 6V6z" /></svg>' +
        '</button>' +
        '<button type="button" class="' + ctrl + '" aria-label="إيقاف القراءة" data-stop>' +
        '<svg aria-hidden="true" viewBox="0 0 24 24" class="size-4" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>' +
        '</button>' +
        '</div>' +
        '<button type="button" class="h-9 min-w-[64px] rounded-full border border-line px-3 text-[length:calc(12px*var(--ts))] font-bold text-heading hover:border-primary" dir="ltr" data-rate-cycle><bdi dir="ltr"></bdi></button>' +
        '</div>' +
        '<p class="rounded-[10px] bg-warning-10 px-3 py-2 text-[length:calc(10px*var(--ts))] text-warning-250" data-no-voice>' +
        'لا يتوفر صوت عربي في جهازك؛ قد تكون القراءة غير دقيقة. يمكنك إضافة صوت عربي من إعدادات النظام.' +
        '</p>' +
        '</div>'
    );
  }

  function buildReaderBar() {
    var root = create(readerBarTemplate());
    var q = function (sel) { return root.querySelector(sel); };
    q('[data-off]').addEventListener('click', function () { reader.setEnabled(false); });
    q('[data-prev]').addEventListener('click', function () { reader.previous(); });
    q('[data-next]').addEventListener('click', function () { reader.next(); });
    q('[data-stop]').addEventListener('click', function () { reader.stop(); });
    q('[data-play]').addEventListener('click', function () {
      if (reader.state === 'reading') reader.pause();
      else reader.readPage();
    });
    q('[data-rate-cycle]').addEventListener('click', function () {
      var i = READER_RATES.indexOf(reader.rate);
      reader.setRate(READER_RATES[(i + 1) % READER_RATES.length]);
    });
    return root;
  }

  function renderReaderBar() {
    if (!reader.enabled) {
      if (readerBarEl) readerBarEl.remove();
      readerBarEl = null;
      return;
    }
    if (!readerBarEl) {
      readerBarEl = buildReaderBar();
      document.body.appendChild(readerBarEl);
    }
    var root = readerBarEl;
    var q = function (sel) { return root.querySelector(sel); };
    variant(root, voice.active, 'bottom-[84px]', 'bottom-4');
    setHidden(q('[data-ping]'), !reader.speaking);
    q('[data-count]').textContent = reader.state !== 'idle' ? ' · ' + (reader.position + 1) + ' / ' + reader.total : '';
    q('[data-current]').textContent = reader.current || 'اضغط تشغيل لقراءة الصفحة، أو تنقّل بزر التبويب';
    q('[data-prev]').disabled = reader.state === 'idle';
    q('[data-next]').disabled = reader.state === 'idle';
    q('[data-stop]').disabled = reader.state === 'idle' && !reader.speaking;
    var play = q('[data-play]');
    var reading = reader.state === 'reading';
    play.setAttribute('aria-label', reading ? 'إيقاف مؤقت' : reader.state === 'paused' ? 'استئناف القراءة' : 'قراءة الصفحة');
    if (play.dataset.icon !== String(reading)) {
      play.innerHTML = reading ? ICON_PAUSE : ICON_PLAY;
      play.dataset.icon = String(reading);
    }
    var rate = q('[data-rate-cycle]');
    rate.setAttribute('aria-label', 'سرعة القراءة ' + reader.rateLabel + '، اضغط للتغيير');
    rate.firstElementChild.textContent = reader.rateLabel;
    setHidden(q('[data-no-voice]'), reader.hasArabicVoice);
  }

  // ---------------------------------------------------------------------------
  // VoiceIndicator — docked status bar while voice control is on
  // ---------------------------------------------------------------------------
  var voiceBarEl = null;

  function voiceBarTemplate() {
    var commands = VOICE_COMMANDS.map(function (c) {
      return (
        '<div class="flex flex-col rounded-[10px] bg-surface px-3 py-2">' +
        '<dt class="text-[length:calc(12px*var(--ts))] font-bold text-primary">«' + escapeHtml(c.say) + '»</dt>' +
        '<dd class="text-[length:calc(11px*var(--ts))] text-secondary-100">' + escapeHtml(c.does) + '</dd>' +
        '</div>'
      );
    }).join('');
    // Full-width bar docked to the bottom edge; the commands list opens above it
    return (
      '<div class="a11y-ui fixed inset-x-0 bottom-0 z-[66] flex flex-col" role="region" aria-label="التحكم الصوتي">' +
        '<div class="panel-in mx-auto mb-2 max-h-[50vh] w-[min(560px,calc(100vw-32px))] overflow-y-auto rounded-[16px] border border-line bg-canvas p-4 shadow-[0_8px_24px_rgba(0,0,0,0.18)]" data-help>' +
        '<div class="mb-2 flex items-center justify-between">' +
        '<h2 class="text-[length:calc(14px*var(--ts))] font-bold text-heading">الأوامر الصوتية</h2>' +
        '<button type="button" class="flex size-8 items-center justify-center rounded-full hover:bg-secondary-10" aria-label="إخفاء قائمة الأوامر" data-help-close>' +
        '<svg aria-hidden="true" viewBox="0 0 24 24" class="size-4 text-secondary-100" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>' +
        '</button>' +
        '</div>' +
        '<dl class="flex flex-col gap-2">' + commands + '</dl>' +
        '</div>' +
        '<div class="w-full border-t border-line bg-canvas pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_20px_rgba(0,0,0,0.10)]">' +
        '<div class="mx-auto flex h-[68px] max-w-[1440px] items-center gap-3 px-4 md:px-10 xl:px-20">' +
        '<span class="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-white">' +
        '<span aria-hidden="true" class="absolute inset-0 animate-ping rounded-full bg-primary/40" data-ping></span>' +
        '<svg aria-hidden="true" viewBox="0 0 24 24" class="relative size-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICON_MIC + '</svg>' +
        '</span>' +
        '<span class="flex min-w-0 flex-1 flex-col">' +
        '<span class="text-[length:calc(11px*var(--ts))] font-bold text-heading" data-status></span>' +
        '<span class="truncate text-[length:calc(11px*var(--ts))] text-secondary-100" data-heard></span>' +
        '</span>' +
        '<button type="button" class="shrink-0 rounded-full px-2 py-1 text-[length:calc(11px*var(--ts))] font-medium text-primary hover:text-primary-200" data-help-toggle>الأوامر</button>' +
        '<button type="button" class="flex size-9 shrink-0 items-center justify-center rounded-full bg-error-10 text-error-200 hover:opacity-80" aria-label="إيقاف التحكم الصوتي" data-voice-off>' +
        '<svg aria-hidden="true" viewBox="0 0 24 24" class="size-4" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>' +
        '</button>' +
        '</div>' +
        '</div>' +
        '</div>'
    );
  }

  function buildVoiceBar() {
    var root = create(voiceBarTemplate());
    var q = function (sel) { return root.querySelector(sel); };
    q('[data-help-close]').addEventListener('click', function () { voice.setHelpOpen(false); });
    q('[data-help-toggle]').addEventListener('click', function () { voice.setHelpOpen(!voice.helpOpen); });
    q('[data-voice-off]').addEventListener('click', function () { voice.setActive(false); });
    return root;
  }

  function renderVoiceBar() {
    // Reserve space at the bottom of the page so the docked bar never covers content.
    document.documentElement.classList.toggle('voice-docked', voice.active);
    if (!voice.active) {
      if (voiceBarEl) voiceBarEl.remove();
      voiceBarEl = null;
      return;
    }
    if (!voiceBarEl) {
      voiceBarEl = buildVoiceBar();
      document.body.appendChild(voiceBarEl);
    }
    var q = function (sel) { return voiceBarEl.querySelector(sel); };
    setHidden(q('[data-help]'), !voice.helpOpen);
    setHidden(q('[data-ping]'), !voice.listening);
    q('[data-status]').textContent = voice.listening ? 'جارٍ الاستماع…' : 'التحكم الصوتي';
    q('[data-heard]').textContent = voice.transcript || voice.feedback;
    q('[data-help-toggle]').setAttribute('aria-expanded', String(voice.helpOpen));
  }

  // ---------------------------------------------------------------------------
  // Page integration: header trigger
  // ---------------------------------------------------------------------------
  function render() {
    renderPanel();
    renderReaderBar();
    renderVoiceBar();
  }

  /**
   * The Tailwind CDN generates CSS for classes when it first sees them in the DOM. Render every
   * tool template (plus the state classes swapped in at runtime) once, hidden, so the panel and
   * bars are fully styled the moment they open — then drop the copies.
   */
  function warmUpStyles() {
    var states =
      'bg-primary text-white text-secondary-200 hover:bg-secondary-10 border-primary bg-primary-10 border-line ' +
      'hover:border-primary border-secondary-40 bg-secondary-40 -translate-x-5 bottom-[84px] bottom-4';
    var warm = document.createElement('div');
    warm.hidden = true;
    warm.setAttribute('aria-hidden', 'true');
    warm.innerHTML = panelTemplate().replace(/\sid="[^"]*"/g, '') + readerBarTemplate() + voiceBarTemplate() + '<span class="' + states + '"></span>';
    document.body.appendChild(warm);
    setTimeout(function () { warm.remove(); }, 1500);
  }

  function init() {
    warmUpStyles();
    // Screen-reader confirmations for every setting change (always present)
    liveRegion = create('<p class="sr-only" role="status" aria-live="polite"></p>');
    document.body.appendChild(liveRegion);

    document.querySelectorAll('[data-a11y-open]').forEach(function (btn) {
      btn.addEventListener('click', openPanel);
    });

    a11y.apply();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.NajmA11y = { a11y: a11y, reader: reader, voice: voice, open: openPanel };
})();

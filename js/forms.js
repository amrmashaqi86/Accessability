/**
 * Login & registration forms: show/hide password, live password rules, client-side validation
 * with accessible error messages (aria-invalid + aria-describedby, focus moves to the first error).
 * There is no backend: a valid submit only confirms the data passed validation.
 */
(function () {
  'use strict';

  // --- Show / hide password (Figma "Show/Hide password": eye ↔ eye-slash) -------------------------
  document.querySelectorAll('[data-toggle-password]').forEach(function (btn) {
    var input = document.getElementById(btn.dataset.togglePassword);
    var icon = btn.querySelector('img');
    btn.addEventListener('click', function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
      icon.src = show ? 'assets/ic-eye-slash-pw.svg' : 'assets/ic-eye-pw.svg';
    });
  });

  // --- Field helpers ------------------------------------------------------------------------------
  function fieldOf(input) {
    return input.closest('[data-field]');
  }

  function errorOf(input) {
    var ids = (input.getAttribute('aria-describedby') || '').split(/\s+/);
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el && el.classList.contains('field-error')) return el;
    }
    return null;
  }

  function setError(input, message) {
    var field = fieldOf(input);
    var error = errorOf(input);
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      if (field) field.classList.add('is-invalid');
      if (error) {
        error.textContent = message;
        error.hidden = false;
      }
    } else {
      input.removeAttribute('aria-invalid');
      if (field) field.classList.remove('is-invalid');
      if (error) {
        error.textContent = '';
        error.hidden = true;
      }
    }
  }

  var digitsOnly = function (v) { return v.replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); }).replace(/\s+/g, ''); };

  var VALIDATORS = {
    nationalId: function (v) {
      v = digitsOnly(v);
      if (!v) return 'الرجاء إدخال رقم الهوية أو الإقامة';
      if (!/^[12]\d{9}$/.test(v)) return 'رقم الهوية أو الإقامة يتكون من 10 أرقام ويبدأ بالرقم 1 أو 2';
      return '';
    },
    mobile: function (v) {
      v = digitsOnly(v);
      if (!v) return 'الرجاء إدخال رقم الجوال';
      if (!/^05\d{8}$/.test(v)) return 'رقم الجوال يجب أن يكون بصيغة 05XXXXXXXX';
      return '';
    },
    email: function (v) {
      v = v.trim();
      if (!v) return 'الرجاء إدخال البريد الإلكتروني';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'الرجاء إدخال بريد إلكتروني صحيح، مثل name@example.com';
      return '';
    },
  };

  // --- Password rules (registration) ---------------------------------------------------------------
  var RULES = {
    length: function (v) { return v.length >= 8; },
    digit: function (v) { return /\d/.test(v); },
    lower: function (v) { return /[a-z]/.test(v); },
    upper: function (v) { return /[A-Z]/.test(v); },
    symbol: function (v) { return /[^A-Za-z0-9\s]/.test(v); },
  };

  function checkRules(value) {
    var allOk = true;
    document.querySelectorAll('[data-rule]').forEach(function (li) {
      var ok = RULES[li.dataset.rule](value);
      allOk = allOk && ok;
      li.querySelector('[data-rule-icon]').src = ok ? 'assets/rule-pass.svg' : 'assets/rule-fail.svg';
      li.querySelector('[data-rule-state]').textContent = ok ? '، مستوفى' : '، غير مستوفى';
    });
    return allOk;
  }

  // --- Forms ---------------------------------------------------------------------------------------
  function showStatus(form, message) {
    var status = form.querySelector('.form-status');
    status.hidden = false;
    status.textContent = '';
    setTimeout(function () { status.textContent = message; }, 30);
  }

  function hideStatus(form) {
    var status = form.querySelector('.form-status');
    if (status) status.hidden = true;
  }

  /** Validate on blur once touched, and live while correcting an error. */
  function wireLiveValidation(form, validate) {
    form.querySelectorAll('input').forEach(function (input) {
      input.addEventListener('blur', function () {
        if (input.value || input.getAttribute('aria-invalid')) validate(input);
      });
      input.addEventListener('input', function () {
        hideStatus(form);
        if (input.getAttribute('aria-invalid')) validate(input);
      });
      input.addEventListener('change', function () {
        if (input.type === 'checkbox' && input.getAttribute('aria-invalid')) validate(input);
      });
    });
  }

  function submitWith(form, inputs, validate, successMessage) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      hideStatus(form);
      var firstInvalid = null;
      inputs.forEach(function (input) {
        if (!validate(input) && !firstInvalid) firstInvalid = input;
      });
      if (firstInvalid) {
        firstInvalid.focus();
        return;
      }
      showStatus(form, successMessage);
    });
  }

  // Login
  var login = document.getElementById('login-form');
  if (login) {
    var loginInputs = [login.elements.nationalId, login.elements.password];
    var validateLogin = function (input) {
      var msg = input.name === 'nationalId' ? VALIDATORS.nationalId(input.value) : input.value ? '' : 'الرجاء إدخال كلمة المرور';
      setError(input, msg);
      return !msg;
    };
    wireLiveValidation(login, validateLogin);
    submitWith(login, loginInputs, validateLogin, 'تم التحقق من بيانات الدخول بنجاح.');
  }

  // Registration
  var register = document.getElementById('register-form');
  if (register) {
    var el = register.elements;
    var regInputs = [el.nationalId, el.mobile, el.email, el.password, el.confirmPassword, el.consentUpdates, el.consentPrivacy];
    var validateRegister = function (input) {
      var msg = '';
      switch (input.name) {
        case 'nationalId':
        case 'mobile':
        case 'email':
          msg = VALIDATORS[input.name](input.value);
          break;
        case 'password':
          msg = !input.value ? 'الرجاء إدخال كلمة المرور' : checkRules(input.value) ? '' : 'كلمة المرور لا تستوفي جميع الشروط الموضحة أدناه';
          break;
        case 'confirmPassword':
          msg = !input.value ? 'الرجاء إعادة كتابة كلمة المرور' : input.value !== el.password.value ? 'كلمتا المرور غير متطابقتين' : '';
          break;
        case 'consentUpdates':
        case 'consentPrivacy':
          // Both consents share one message.
          var missing = !el.consentUpdates.checked || !el.consentPrivacy.checked;
          [el.consentUpdates, el.consentPrivacy].forEach(function (cb) {
            cb.setAttribute('aria-invalid', String(missing && !cb.checked));
            if (!missing || cb.checked) cb.removeAttribute('aria-invalid');
          });
          var consents = fieldOf(el.consentUpdates);
          var error = document.getElementById('reg-consents-error');
          consents.classList.toggle('is-invalid', missing);
          error.hidden = !missing;
          error.textContent = missing ? 'يجب الموافقة على الإقرارين للمتابعة' : '';
          return input.checked;
      }
      setError(input, msg);
      return !msg;
    };
    el.password.addEventListener('input', function () {
      checkRules(el.password.value);
      if (el.confirmPassword.getAttribute('aria-invalid')) validateRegister(el.confirmPassword);
    });
    checkRules('');
    wireLiveValidation(register, validateRegister);
    submitWith(register, regInputs, validateRegister, 'تم التحقق من البيانات بنجاح، وأصبح الحساب جاهزاً للإنشاء.');
  }
})();

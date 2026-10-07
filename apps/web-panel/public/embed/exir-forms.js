/*!
 * Exir Forms embed script — v1 (framework-free, no dependencies)
 *
 * <div data-exir-form="<publicKey>/<formSlug>"></div>
 * <script src="https://YOUR-PANEL/embed/exir-forms.js" async></script>
 *
 * Optional attributes on the <div>:
 *   data-theme="light|dark|auto"     data-lang="fa|en"        data-primary="#2563eb"
 *   data-redirect="https://…"        (go there after a successful submit)
 *   data-success-message="…"         (replaces the default thank-you text)
 *   data-min-height="320"            data-hide-title="1"
 *   data-host="https://panel.example" (only if the script is proxied from another origin)
 *
 * Events (bubble from the <div>): `exir-form:ready`, `exir-form:submitted`.
 * API: window.ExirForms.scan() — re-scan the page after injecting new <div data-exir-form>.
 */
(function () {
  'use strict';
  if (window.ExirForms && window.ExirForms.version) return;

  var VERSION = '1';
  var script = document.currentScript;
  var scriptHost = '';
  try {
    if (script && script.src) scriptHost = new URL(script.src).origin;
  } catch (e) {}

  function isHttpUrl(u) {
    return typeof u === 'string' && /^https?:\/\//i.test(u);
  }
  function safeHex(c) {
    return /^#?[0-9a-f]{3,8}$/i.test(c || '') ? String(c).replace('#', '') : '';
  }
  function emit(el, name, detail) {
    try {
      el.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail || {} }));
    } catch (e) {}
  }

  function mount(el) {
    if (!el || el.getAttribute('data-exir-mounted')) return;
    var ref = (el.getAttribute('data-exir-form') || '').trim();
    if (!ref) return;
    var host = (el.getAttribute('data-host') || scriptHost || '').replace(/\/$/, '');
    var path;
    if (isHttpUrl(ref)) {
      // اجازه‌ی آدرس کامل: https://panel/f/<key>/<slug>
      try {
        var u = new URL(ref);
        host = u.origin;
        path = u.pathname;
      } catch (e) {
        return;
      }
    } else {
      if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(ref)) return;
      path = '/f/' + ref;
    }
    if (!host) return;
    el.setAttribute('data-exir-mounted', '1');

    var q = [];
    q.push('embed=1');
    var theme = el.getAttribute('data-theme');
    if (theme === 'light' || theme === 'dark' || theme === 'auto') q.push('theme=' + theme);
    var lang = el.getAttribute('data-lang');
    if (lang === 'fa' || lang === 'en') q.push('lang=' + lang);
    var primary = safeHex(el.getAttribute('data-primary'));
    if (primary) q.push('primary=' + primary);
    var sm = el.getAttribute('data-success-message');
    if (sm) q.push('sm=' + encodeURIComponent(sm.slice(0, 300)));
    if (el.getAttribute('data-hide-title')) q.push('hideTitle=1');
    // منبع ثبت: صفحه‌ای که فرم در آن است + utm
    q.push('src=' + encodeURIComponent(location.href.slice(0, 500)));
    if (document.referrer) q.push('ref=' + encodeURIComponent(document.referrer.slice(0, 500)));
    var params = new URLSearchParams(location.search);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (k) {
      if (params.get(k)) q.push(k + '=' + encodeURIComponent(params.get(k).slice(0, 200)));
    });

    var frame = document.createElement('iframe');
    frame.src = host + path + '?' + q.join('&');
    frame.title = el.getAttribute('data-title') || 'Form';
    frame.loading = 'lazy';
    frame.setAttribute('scrolling', 'no');
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    var minH = parseInt(el.getAttribute('data-min-height') || '320', 10) || 320;
    frame.style.cssText = 'display:block;width:100%;border:0;overflow:hidden;background:transparent;height:' + minH + 'px';
    el.appendChild(frame);

    var redirect = el.getAttribute('data-redirect');

    window.addEventListener('message', function (e) {
      if (e.source !== frame.contentWindow || e.origin !== host) return;
      var d = e.data;
      if (!d || d.source !== 'exir-forms') return;
      if (d.type === 'resize' && typeof d.height === 'number') {
        frame.style.height = Math.max(minH, Math.min(20000, Math.ceil(d.height))) + 'px';
      } else if (d.type === 'ready') {
        emit(el, 'exir-form:ready');
      } else if (d.type === 'submitted') {
        emit(el, 'exir-form:submitted', { submissionId: d.submissionId || null });
        if (isHttpUrl(redirect)) setTimeout(function () { window.location.href = redirect; }, 1200);
      }
    });
  }

  function scan(root) {
    var list = (root || document).querySelectorAll('[data-exir-form]');
    for (var i = 0; i < list.length; i++) mount(list[i]);
  }

  window.ExirForms = { version: VERSION, scan: scan, mount: mount };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { scan(); });
  else scan();
})();

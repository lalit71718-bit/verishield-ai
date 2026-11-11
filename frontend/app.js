/* VeriShield AI — shared client helpers (session, API, nav, toasts, gauges).
   Loaded synchronously in <head> so the theme and auth guard apply before paint. */
(function () {
  'use strict';

  const TOKEN_KEYS = ['verishield_token', 'token'];
  const USER_KEYS = ['verishield_user', 'user'];

  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, val) { try { localStorage.setItem(key, val); } catch (e) { /* storage blocked */ } },
    del(key) { try { localStorage.removeItem(key); } catch (e) { /* storage blocked */ } }
  };

  // Backend origin. Override with `window.VERISHIELD_API_BASE` or the
  // `verishield_api` localStorage key when the API is not on localhost:5000.
  const API_BASE = (window.VERISHIELD_API_BASE || store.get('verishield_api') || 'http://localhost:5000')
    .replace(/\/+$/, '') + '/api';

  /* ---------- Theme ---------- */

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  }
  applyTheme(store.get('verishield_theme'));

  /* ---------- Utilities ---------- */

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

  const ICONS = {
    shield: '<path d="M12 3 4.5 6v5.6c0 4.4 3.1 8.2 7.5 9.4 4.4-1.2 7.5-5 7.5-9.4V6L12 3Z"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-8 8"/>',
    video: '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
    text: '<path d="M5 6h14M5 11h14M5 16h9"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
    vault: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="12" cy="12" r="3.2"/><path d="M12 8.8V7M12 17v-1.8M7 20v1.5M17 20v1.5"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4L12 4Z"/><path d="M12 10v4.5M12 17.2v.3"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
    eyeOff: '<path d="M4 4l16 16M10 6a9 9 0 0 1 2-.5c6 0 9.5 6.500 9.500 6.500a17 17 0 0 1-2.800 3.500M6.300 7.700A17 17 0 0 0 2.500 12S6 18.500 12 18.500a9 9 0 0 0 3.700-.800M9.900 9.900a2.800 2.800 0 0 0 4 4"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10"/>'
  };

  function icon(name, cls) {
    return `<svg class="icon${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  }

  const LOGO = '<svg class="brand__mark" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 3 5.500 7v8c0 6.300 4.400 11.500 10.500 13.500C22.100 26.500 26.500 21.300 26.500 15V7L16 3Z" fill="currentColor" fill-opacity=".16" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="m11 15.500 3.600 3.600L21.500 12" stroke="currentColor" stroke-width="2.400" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatDate(value) {
    const d = value ? new Date(value) : null;
    if (!d || Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Session ---------- */

  const getToken = () => TOKEN_KEYS.map(store.get).find(Boolean) || null;

  function getUser() {
    for (const key of USER_KEYS) {
      try {
        const parsed = JSON.parse(store.get(key) || 'null');
        if (parsed && (parsed.name || parsed.email)) return parsed;
      } catch (e) { /* ignore malformed entry */ }
    }
    return null;
  }

  function setSession(token, user) {
    TOKEN_KEYS.forEach((k) => store.set(k, token));
    USER_KEYS.forEach((k) => store.set(k, JSON.stringify(user || {})));
  }

  function clearSession() {
    [...TOKEN_KEYS, ...USER_KEYS].forEach(store.del);
  }

  const currentPage = () => (location.pathname.split('/').pop() || 'index.html') + location.search;

  function toAuth(message) {
    if (message) { try { sessionStorage.setItem('verishield_flash', message); } catch (e) { /* ignore */ } }
    location.replace(`auth.html?next=${encodeURIComponent(currentPage())}`);
  }

  /** Call in <head> on protected pages: bounces signed-out visitors to auth. */
  function requireAuth() {
    if (!getToken()) toAuth();
  }

  function logout() {
    clearSession();
    location.href = 'index.html';
  }

  function initials(user) {
    const source = (user && (user.name || user.email)) || '';
    const parts = source.trim().split(/[\s@._-]+/).filter(Boolean);
    return ((parts[0] || 'V')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  /* ---------- API ---------- */

  async function api(path, { method = 'GET', body, formData } = {}) {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    let payload = formData;
    if (!formData && body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(API_BASE + path, { method, headers, body: payload });
    } catch (e) {
      const err = new Error("Can't reach the VeriShield server. Make sure the backend is running, then try again.");
      err.status = 0;
      throw err;
    }

    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON response */ }

    if (!res.ok) {
      // A rejected token on a protected route means the session is stale.
      if (res.status === 401 && token && !path.startsWith('/auth/login') && !path.startsWith('/auth/register')) {
        clearSession();
        toAuth('Your session expired. Please sign in again.');
      }
      const err = new Error((data && data.error) || `Request failed (${res.status}).`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* ---------- Toasts ---------- */

  function toast(message, tone) {
    let host = document.querySelector('.toasts');
    if (!host) {
      host = document.createElement('div');
      host.className = 'toasts';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'toast';
    if (tone) el.dataset.tone = tone;
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 260);
    }, 4200);
  }

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label || 'Copied'} to clipboard`, 'safe');
    } catch (e) {
      toast('Copy failed — select the text and copy it manually.', 'danger');
    }
  }

  /* ---------- Nav & footer ---------- */

  const LINKS = [
    { id: 'scanner', href: 'scanner.html', label: 'Workbench' },
    { id: 'urlcheck', href: 'urlcheck.html', label: 'URL Intel' },
    { id: 'profile', href: 'profile.html', label: 'Vault' }
  ];

  function mountNav(active) {
    const host = document.getElementById('nav');
    if (!host) return;
    const user = getUser();
    const signedIn = !!getToken();

    const links = LINKS.map((l) =>
      `<a class="nav__link" href="${l.href}"${l.id === active ? ' aria-current="page"' : ''}>${l.label}</a>`
    ).join('');

    const account = signedIn
      ? `<a class="nav__user" href="profile.html" title="Open your vault"><span class="avatar">${esc(initials(user))}</span><span>${esc((user && (user.name || user.email)) || 'Account')}</span></a>
         <button class="btn btn--ghost btn--sm" type="button" data-action="logout">${icon('logout')}Sign out</button>`
      : '<a class="btn btn--primary btn--sm" href="auth.html">Sign in</a>';

    host.className = 'nav';
    host.innerHTML = `
      <div class="shell nav__inner">
        <a class="brand" href="index.html" aria-label="VeriShield AI home">${LOGO}<span>VeriShield <em>AI</em></span></a>
        <button class="icon-btn nav__toggle" type="button" aria-expanded="false" aria-controls="navLinks" aria-label="Toggle menu">${icon('menu')}</button>
        <nav class="nav__links" id="navLinks" aria-label="Primary">
          ${links}
          <span class="nav__spacer"></span>
          <button class="icon-btn" type="button" data-action="theme" aria-label="Switch colour theme"></button>
          ${account}
        </nav>
      </div>`;

    const themeBtn = host.querySelector('[data-action="theme"]');
    const paintTheme = () => {
      themeBtn.innerHTML = icon(document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun');
    };
    paintTheme();
    themeBtn.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      store.set('verishield_theme', next);
      applyTheme(next);
      paintTheme();
    });

    const toggle = host.querySelector('.nav__toggle');
    const panel = host.querySelector('.nav__links');
    toggle.addEventListener('click', () => {
      const open = panel.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });

    const out = host.querySelector('[data-action="logout"]');
    if (out) out.addEventListener('click', logout);
  }

  function mountFooter() {
    const host = document.getElementById('footer');
    if (!host) return;
    host.className = 'footer';
    host.innerHTML = `
      <div class="shell footer__inner">
        <span>VeriShield AI — verdicts are heuristic indicators, not legal proof. Verify independently before you act.</span>
        <nav aria-label="Footer">
          <a href="scanner.html">Workbench</a>
          <a href="urlcheck.html">URL Intel</a>
          <a href="profile.html">Vault</a>
        </nav>
      </div>`;
  }

  /* ---------- Gauges ---------- */

  function gaugeHTML(id, small) {
    return `<div class="gauge${small ? ' gauge--sm' : ''}" id="${id}" data-tone="idle" role="img" aria-label="No score yet">
      <svg viewBox="0 0 120 120"><circle class="gauge__track" cx="60" cy="60" r="52"/><circle class="gauge__arc" cx="60" cy="60" r="52" pathLength="100"/></svg>
      <div class="gauge__val"><span><b>--</b><small>%</small></span></div>
    </div>`;
  }

  /** Higher is worse (AI confidence, risk). Pass invert=true when higher is better (trust). */
  function scoreTone(value, invert) {
    const v = invert ? 100 - value : value;
    if (v >= 60) return 'danger';
    if (v >= 35) return 'warn';
    return 'safe';
  }

  function setGauge(el, value, tone, label) {
    if (!el) return;
    const target = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    el.dataset.tone = tone;
    el.setAttribute('aria-label', `${label || 'Score'}: ${target}%`);
    el.querySelector('.gauge__arc').style.strokeDashoffset = String(100 - target);

    const num = el.querySelector('b');
    if (reducedMotion()) { num.textContent = target; return; }
    const start = performance.now();
    const from = Number(num.textContent) || 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / 900);
      const eased = 1 - Math.pow(1 - t, 3);
      num.textContent = Math.round(from + (target - from) * eased);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function resetGauge(el) {
    if (!el) return;
    el.dataset.tone = 'idle';
    el.setAttribute('aria-label', 'No score yet');
    el.querySelector('.gauge__arc').style.strokeDashoffset = '100';
    el.querySelector('b').textContent = '--';
  }

  /* ---------- Scan record normalisation ---------- */

  /** The API returns the same value under several aliases; read them in one place. */
  function readScan(r) {
    const ai = r.detectionPercentage ?? r.aiProbability ?? r.confidenceScore ?? r.confidence ?? 0;
    const harm = r.riskPercentage ?? r.harmRiskScore ?? r.harmScore ?? r.riskScore ?? 0;
    const flagged = r.isDeepfake ?? r.isSynthetic ?? (r.status === 'MANIPULATED' || ai > 60 || harm > 65);
    const inconclusive = !flagged && (r.isInconclusive ?? r.status === 'INCONCLUSIVE');
    const type = String(r.mediaType || r.fileType || r.inputType || 'media').toLowerCase();
    const fallbackTitle = flagged ? 'Likely manipulated or synthetic' : inconclusive ? "Can't verify this image" : 'No signs of manipulation';
    return {
      ai,
      harm,
      flagged: !!flagged,
      inconclusive: !!inconclusive,
      tone: flagged ? 'danger' : inconclusive ? 'warn' : 'safe',
      label: flagged ? 'Flagged' : inconclusive ? 'Unverified' : 'Clean',
      // Image verdicts from the API say which kind of problem was found.
      title: type === 'image' && r.verdict ? r.verdict : fallbackTitle,
      name: r.contentName || r.fileName || r.originalName || 'Untitled scan',
      type,
      hash: r.sha256Hash || r.fileHash || r.hash || '',
      summary: r.summary || r.explanation || 'Forensic scan complete.',
      artifacts: r.artifacts || r.detectedArtifacts || [],
      actions: r.safetyActions || r.safeActions || [],
      metrics: r.forensicMetrics || null,
      date: r.createdAt || r.scannedAt || null
    };
  }

  /* ---------- Scroll reveal ---------- */

  function initReveal() {
    const nodes = document.querySelectorAll('.reveal');
    if (!nodes.length) return;
    if (reducedMotion() || !('IntersectionObserver' in window)) {
      nodes.forEach((n) => n.classList.add('is-in'));
      return;
    }
    // Motion (vendor/motion.js) drives the reveal when the page loads it:
    // siblings that enter together are staggered. Without it, the CSS
    // transition on .reveal.is-in below does the same job unstaggered.
    const M = window.Motion;
    if (M && M.inView && M.animate) {
      nodes.forEach((n) => { n.style.transition = 'none'; });
      M.inView('.reveal', (el) => {
        const peers = Array.from(el.parentElement.children).filter((c) => c.classList.contains('reveal'));
        M.animate(el, { opacity: [0, 1], y: [18, 0] }, {
          duration: 0.7,
          delay: peers.indexOf(el) * 0.08,
          ease: [0.22, 1, 0.36, 1]
        });
      }, { amount: 0.12 });
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    nodes.forEach((n) => io.observe(n));
  }

  document.addEventListener('DOMContentLoaded', () => {
    mountFooter();
    initReveal();
  });

  window.VS = {
    API_BASE, api, esc, icon, LOGO, formatBytes, formatDate, reducedMotion,
    getToken, getUser, setSession, clearSession, requireAuth, logout, initials,
    toast, copy, mountNav, gaugeHTML, setGauge, resetGauge, scoreTone, readScan
  };
})();

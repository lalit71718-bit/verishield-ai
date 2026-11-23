/* VeriShield AI — landing "dive" stage.
   A live ASCII shield drawn on canvas follows the pointer under the headline.
   The viewport is split into a 2 × 2 grid and the shield prints itself in a
   different glyph mode in each quadrant, glitching where it crosses a line.
   Scrolling is a dive: the water darkens, marine snow drifts past and the
   depth gauge counts metres through the layers a scan inspects. */
(function () {
  'use strict';

  const canvas = document.getElementById('dive');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const layer = document.createElement('canvas');
  const lctx = layer.getContext('2d');

  const shade = document.getElementById('diveShade');
  const depthMarker = document.getElementById('depthMarker');
  const depthValue = document.getElementById('depthValue');
  const depthZone = document.getElementById('depthZone');
  const sinkers = [...document.querySelectorAll('[data-sink]')];

  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const SHIELD = new Path2D('M16 3 5.5 7v8c0 6.3 4.4 11.5 10.5 13.5C22.1 26.5 26.5 21.3 26.5 15V7L16 3Z');
  const CHECK = new Path2D('m11 15.5 3.6 3.6L21.5 12');
  const RAMP = ' .:-=+*#%@';
  const HEX = '0123456789abcdef';
  const ZONES = [
    [0, 'Surface'],
    [40, 'Metadata'],
    [90, 'Structure'],
    [140, 'Wording'],
    [180, 'Fingerprint']
  ];

  let W = 0, H = 0, DPR = 1;
  let cell = 12;
  let cols = 0, rows = 0;
  let mask = [];           // 0 = water, 1 = shield body, 2 = edge, 3 = check mark
  let colors = {};
  let snow = [];

  const pos = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };
  const pointer = { x: 0, y: 0, last: -1e9 };
  let scrollY = window.scrollY;
  let zoneIndex = -1;
  let t0 = performance.now();

  /* ---------- Setup ---------- */

  function readColors() {
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    colors = {
      glyph: v('--accent') || '#44a2c3',
      bright: v('--text') || '#f4f8fb',
      hot: v('--hot') || '#ff7a59',
      line: v('--line-strong') || 'rgba(244,248,251,.26)',
      light: document.documentElement.dataset.theme === 'light'
    };
  }

  function buildMask() {
    const shieldH = Math.min(H * 0.4, 330, W * 0.5);
    cell = Math.max(9, Math.round(shieldH / 34));
    rows = Math.ceil(shieldH / cell);
    cols = Math.ceil(rows * 0.86);

    const m = document.createElement('canvas');
    m.width = cols; m.height = rows;
    const mc = m.getContext('2d');
    const sx = cols / 22, sy = rows / 26.5;     // shield path spans x 5.5→26.5, y 3→28.5
    mc.setTransform(sx, 0, 0, sy, -5.5 * sx + 0.5, -3 * sy);
    mc.fillStyle = '#f00';
    mc.fill(SHIELD);
    mc.strokeStyle = '#0f0';
    mc.lineWidth = 2.4;
    mc.lineCap = 'round';
    mc.lineJoin = 'round';
    mc.stroke(CHECK);

    const px = mc.getImageData(0, 0, cols, rows).data;
    const inside = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows && px[(r * cols + c) * 4 + 3] > 90;
    mask = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = (r * cols + c) * 4;
        if (!inside(c, r)) { mask.push(0); continue; }
        if (px[i + 1] > 120 && px[i] < 140) { mask.push(3); continue; }
        const edge = !inside(c - 1, r) || !inside(c + 1, r) || !inside(c, r - 1) || !inside(c, r + 1);
        mask.push(edge ? 2 : 1);
      }
    }
  }

  function seedSnow() {
    const n = Math.round(Math.min(160, (W * H) / 9000));
    snow = Array.from({ length: n }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.4 + 0.3,
      vy: Math.random() * 0.25 + 0.05,
      vx: (Math.random() - 0.5) * 0.12,
      ring: Math.random() < 0.08,
      a: Math.random() * 0.5 + 0.15
    }));
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    for (const c of [canvas, layer]) {
      c.width = Math.round(W * DPR);
      c.height = Math.round(H * DPR);
    }
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    buildMask();
    seedSnow();
    home();
    pos.x = target.x; pos.y = target.y;
  }

  // Resting place: low and to the right, under the headline.
  function home() {
    const narrow = W < 720;
    target.x = W * (narrow ? 0.5 : 0.78);
    target.y = H * (narrow ? 0.9 : 0.7);
  }

  /* ---------- Glyph modes, one per quadrant ---------- */

  const rand = (n) => Math.floor(Math.random() * n);

  function glyphFor(q, c, r, kind, t) {
    switch (q) {
      case 0: { // top-left: density ramp, shaded like a lit body
        const v = 0.55 + 0.45 * Math.sin(c * 0.45 + t * 1.3) * Math.cos(r * 0.3 - t * 0.9);
        const k = kind === 2 ? RAMP.length - 1 : Math.max(2, Math.floor(v * (RAMP.length - 1)));
        return RAMP[k];
      }
      case 1: // top-right: binary
        return ((c * 7 + r * 13 + Math.floor(t * 6)) % 5) < 2 ? '1' : '0';
      case 2: // bottom-left: SHA-256 hex
        return HEX[(c * 31 + r * 17 + Math.floor(t * 4)) & 15];
      default: // bottom-right: boxed cells
        return kind === 2 ? '=' : '-';
    }
  }

  /* ---------- Frame ---------- */

  function frame(now) {
    const t = (now - t0) / 1000;

    // Drift toward the pointer, or wander when it has been idle a while.
    if (now - pointer.last < 2600) {
      // Trail just behind and below the pointer so it never sits on the cursor.
      target.x = pointer.x + Math.min(200, W * 0.14);
      target.y = pointer.y + Math.min(150, H * 0.16);
    } else {
      home();
      target.x += Math.sin(t * 0.21) * W * 0.12;
      target.y += Math.sin(t * 0.33) * H * (W < 720 ? 0.02 : 0.05);
    }
    const ease = still ? 1 : 0.035;
    pos.x += (target.x - pos.x) * ease;
    pos.y += (target.y - pos.y) * ease;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    drawSnow(t);
    drawShield(t);
  }

  function drawSnow() {
    ctx.save();
    const lift = still ? 0 : 1;
    for (const p of snow) {
      p.y -= p.vy * lift;
      p.x += p.vx * lift;
      if (p.y < -4) { p.y = H + 4; p.x = Math.random() * W; }
      if (p.x < -4) p.x = W + 4; else if (p.x > W + 4) p.x = -4;
      ctx.globalAlpha = p.a;
      if (p.ring) {
        ctx.strokeStyle = colors.glyph;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 2.6, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = colors.bright;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawShield(t) {
    // Fade the shield as the dive goes past the first screen.
    const sink = Math.min(1, Math.max(0, (scrollY - H * 0.2) / (H * 0.6)));
    const fade = (1 - sink * 0.88) * (W < 720 ? 0.55 : 1);
    if (fade <= 0.02) return;

    const ox = pos.x - (cols * cell) / 2;
    const oy = pos.y - (rows * cell) / 2;
    const cx = W / 2, cy = H / 2;
    const sweep = ((t * 0.32) % 1.4) * rows - rows * 0.2;   // scan line, in rows

    lctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    lctx.clearRect(0, 0, W, H);
    lctx.font = `500 ${Math.round(cell * 0.92)}px 'IBM Plex Mono', ui-monospace, monospace`;
    lctx.textAlign = 'center';
    lctx.textBaseline = 'middle';

    for (let r = 0; r < rows; r++) {
      const sway = still ? 0 : Math.sin(t * 1.8 + r * 0.28) * cell * 0.35;
      const scanned = Math.abs(r - sweep) < 1.6;
      for (let c = 0; c < cols; c++) {
        const kind = mask[r * cols + c];
        if (!kind) continue;

        let x = ox + c * cell + cell / 2 + sway;
        const y = oy + r * cell + cell / 2;
        let q = (x < cx ? 0 : 1) + (y < cy ? 0 : 2);

        // Glitch where the shield crosses a hairline.
        const nearV = Math.abs(x - cx) < cell * 1.6;
        const nearH = Math.abs(y - cy) < cell * 1.6;
        if (!still && (nearV || nearH) && Math.random() < 0.45) {
          q = rand(4);
          x += (Math.random() - 0.5) * cell * 1.4;
        }

        const ch = glyphFor(q, c, r, kind, still ? 0 : t);

        let color = colors.glyph;
        let alpha = kind === 1 ? 0.5 : 0.9;
        if (kind === 3) { color = colors.hot; alpha = 1; }
        else if (scanned) { color = colors.bright; alpha = 1; }
        lctx.globalAlpha = alpha * fade;

        if (q === 3) {
          lctx.strokeStyle = kind === 3 ? colors.hot : colors.glyph;
          lctx.lineWidth = 1;
          lctx.strokeRect(x - cell * 0.42, y - cell * 0.42, cell * 0.84, cell * 0.84);
        }
        lctx.fillStyle = color;
        lctx.fillText(ch, x, y + 0.5);
      }
    }

    // Soft glow under the sharp glyphs.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if ('filter' in ctx && !colors.light) {
      ctx.filter = `blur(${Math.round(7 * DPR)}px)`;
      ctx.globalAlpha = 0.75;
      ctx.drawImage(layer, 0, 0);
      ctx.filter = 'none';
    }
    ctx.globalAlpha = 1;
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  }

  /* ---------- Scroll: depth gauge, darkening water, intro sinks away ---------- */

  function onScroll() {
    scrollY = window.scrollY;
    const max = Math.max(1, document.documentElement.scrollHeight - H);
    const p = Math.min(1, Math.max(0, scrollY / max));
    const metres = Math.round(p * 200);

    if (shade) shade.style.opacity = String(Math.min(0.88, p * 1.1));
    if (depthMarker) depthMarker.style.top = (p * 100).toFixed(2) + '%';
    if (depthValue) depthValue.textContent = String(metres).padStart(3, '0') + ' m';

    let zi = 0;
    ZONES.forEach(([from], i) => { if (metres >= from) zi = i; });
    if (zi !== zoneIndex && depthZone) {
      const span = depthZone.querySelector('span');
      if (zoneIndex < 0 || still) {
        span.textContent = ZONES[zi][1];
      } else {
        const dir = zi > zoneIndex ? -1 : 1;
        span.style.transform = `translateY(${dir * 100}%)`;
        span.style.opacity = '0';
        setTimeout(() => {
          span.textContent = ZONES[zi][1];
          span.style.transition = 'none';
          span.style.transform = `translateY(${-dir * 100}%)`;
          requestAnimationFrame(() => {
            span.style.transition = '';
            span.style.transform = '';
            span.style.opacity = '';
          });
        }, 220);
      }
      zoneIndex = zi;
    }

    // Hero lines blur away one after another as the dive starts.
    if (!still) {
      const h = Math.max(1, H * 0.55);
      sinkers.forEach((el, i) => {
        const k = Math.min(1, Math.max(0, scrollY / h * 1.4 - i * 0.12));
        el.style.opacity = String(1 - k);
        el.style.filter = k > 0.01 ? `blur(${(k * 12).toFixed(1)}px)` : '';
        el.style.transform = k > 0.01 ? `translateY(${(-k * 24).toFixed(1)}px)` : '';
      });
    }
  }

  /* ---------- Wire up ---------- */

  readColors();
  resize();
  onScroll();

  new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resize(); onScroll(); if (still) frame(performance.now()); }, 120);
  });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.last = performance.now();
  }, { passive: true });

  // Staged intro, then the live loop.
  requestAnimationFrame(() => document.body.classList.add('is-ready'));

  if (still) {
    const draw = () => frame(performance.now());
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw); else draw();
    return;
  }

  function loop(now) {
    if (!document.hidden) frame(now);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();

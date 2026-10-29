// 8-bit background: space at the top of the page, fading into ocean, with a coral reef at the bottom.
// Rendered at 1/P resolution into an ImageData buffer and scaled up with pixelated rendering.
(() => {
  const P = 3;              // CSS pixels per art pixel
  const WATERLINE = 0.58;   // fraction of page height where space turns into ocean
  const REEF_H = 72;        // reef height in art pixels
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');

  let W, H, docH, WL, reefTop, img, buf;
  let stars, milky, galaxy, spaceText, spaceBits, oceanText, oceanBits, bubbles, reef, kelp;
  let time = 0;

  // ---------- helpers ----------
  function mulberry32(seed) {
    return () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

  function ramp(stops, k) {
    const out = [];
    for (let i = 0; i < k; i++) {
      const t = i / (k - 1);
      let j = 0;
      while (j < stops.length - 2 && t > stops[j + 1][0]) j++;
      const u = clamp01((t - stops[j][0]) / (stops[j + 1][0] - stops[j][0]));
      const a = hex(stops[j][1]), b = hex(stops[j + 1][1]);
      out.push(a.map((v, n) => Math.round(v + (b[n] - v) * u)));
    }
    return out;
  }

  // Few colour steps + ordered dithering = banded retro gradient
  const SKY = ramp([[0, '#000000'], [0.3, '#01030a'], [0.65, '#040d28'], [1, '#0a2050']], 14);
  const SEA = ramp([[0, '#0a2b5a'], [0.5, '#0b3d6a'], [0.85, '#0d5470'], [1, '#147078']], 12);
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16 + 1 / 32 - 0.5);

  function px(x, y, c, a) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
    const i = (y * W + x) * 4;
    buf[i] += (c[0] - buf[i]) * a;
    buf[i + 1] += (c[1] - buf[i + 1]) * a;
    buf[i + 2] += (c[2] - buf[i + 2]) * a;
  }

  // Render text with the browser, then threshold it into hard pixels
  function textBitmap(segs, cut = 110) {
    const c = document.createElement('canvas');
    c.width = 900; c.height = 60;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    let x = 2;
    for (const [t, size, dy] of segs) {
      g.font = `${size}px Georgia, "Times New Roman", serif`;
      g.fillText(t, x, 40 + dy);
      x += g.measureText(t).width;
    }
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const pts = [];
    let minX = 1e9, minY = 1e9, maxX = 0, maxY = 0;
    for (let y = 0; y < c.height; y++) {
      for (let xx = 0; xx < c.width; xx++) {
        if (d[(y * c.width + xx) * 4 + 3] > cut) {
          pts.push([xx, y]);
          if (xx < minX) minX = xx; if (xx > maxX) maxX = xx;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    return { pts: pts.map(([a, b]) => [a - minX, b - minY]), w: maxX - minX + 1, h: maxY - minY + 1 };
  }
  const euler = s => [['e', s, 0], ['iπ', s * 0.8, -s * 0.5], [' + 1 = 0', s, 0]];
  const ito = s => {
    const sub = ['t', s * 0.65, s * 0.25];
    return [['df(W', s, 0], sub, [') = f′(W', s, 0], sub, [')dW', s, 0], sub, [' + ½f″(W', s, 0], sub, [')dt', s, 0]];
  };
  const blackScholes = s => {
    const sub = n => [n, s * 0.65, s * 0.25];
    return [['C = SN(d', s, 0], sub('1'), [') − Ke', s, 0], ['−rT', s * 0.65, -s * 0.45], ['N(d', s, 0], sub('2'), [')', s, 0]];
  };

  // 3x5 pixel digits for the binary
  const GLYPH = { 0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'] };
  function drawBits(str, x, y, c, a) {
    for (const ch of str) {
      const g = GLYPH[ch];
      if (g) for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) if (g[r][k] === '1') px(x + k, y + r, c, a);
      x += 4;
    }
  }

  // ---------- coral reef sprite ----------
  const CORAL = [
    { c: [58, 92, 214], l: [104, 146, 250], tex: ['LCLC', 'CDCD', 'LCLC', 'CDCD'] },   // tube
    { c: [208, 78, 148], l: [242, 128, 186], tex: ['LCCL', 'CLLC', 'CCLC', 'LCCD'] },  // brain
    { c: [150, 62, 186], l: [196, 112, 226], tex: ['CLCC', 'LDLC', 'CLCL', 'CCLD'] },  // bubble
    { c: [196, 52, 56], l: [238, 98, 88], tex: ['LCDC', 'CLCL', 'DCLC', 'CLCD'] },     // fire
    { c: [212, 184, 62], l: [246, 222, 108], tex: ['LLCC', 'CCLL', 'LLCC', 'CCLD'] },  // horn
  ];
  const PLANTS = [
    ['X..X', 'X.XX', '.XX.', '..X.'],
    ['.X..', '.X.X', 'XXX.', '.X..'],
    ['XX.X', '.XXX', '..X.', '..X.'],
  ];
  const SEAGRASS = ['..X.', 'X.X.', 'X.XX', '.XX.'];
  const SAND = [[178, 165, 122], [166, 152, 110], [190, 178, 134]];
  const TINT = [16, 90, 112];

  function makeReef(r) {
    const B = 4, cols = Math.ceil(W / B);
    const R = new Uint8ClampedArray(W * REEF_H * 4);
    const put = (x, y, c, a = 1, onlyEmpty = false) => {
      if (x < 0 || y < 0 || x >= W || y >= REEF_H) return;
      const i = (y * W + x) * 4;
      if (onlyEmpty && R[i + 3]) return;
      for (let n = 0; n < 3; n++) R[i + n] = c[n] * 0.82 + TINT[n] * 0.18;
      R[i + 3] = a * 255;
    };
    const noise = (s) => {
      const v = Array.from({ length: cols / s + 3 }, r);
      return x => {
        const p = x / s, i = Math.floor(p), t = p - i, e = t * t * (3 - 2 * t);
        return v[i] + (v[i + 1] - v[i]) * e;
      };
    };
    const hN = noise(5), tN = noise(8), sN = noise(3);
    const glow = [];
    kelp = [];

    for (let cx = 0; cx < cols; cx++) {
      const x0 = cx * B;
      const edge = Math.pow(Math.abs(cx / cols - 0.5) * 2, 1.4);
      const h = Math.floor(hN(cx) * 3.4 + edge * 3);
      const sandTop = REEF_H - 8 - (sN(cx) > 0.62 ? 4 : 0);
      for (let y = sandTop; y < REEF_H; y++) for (let x = x0; x < x0 + B; x++) put(x, y, SAND[(r() * 3) | 0]);

      let top = sandTop;
      const base = Math.floor(tN(cx) * CORAL.length * 0.999);
      for (let k = 0; k < h; k++) {
        const t = CORAL[(base + (r() < 0.2 ? 1 : 0)) % CORAL.length];
        top -= B;
        for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
          const m = t.tex[j][i];
          const c = m === 'L' ? t.l : m === 'D' ? t.c.map(v => v * 0.68) : t.c;
          const n = (r() - 0.5) * 22;
          put(x0 + i, top + j, [c[0] + n, c[1] + n, c[2] + n]);
        }
      }

      const d = r();
      if (d < 0.42) {
        const t = CORAL[(base + (r() < 0.5 ? 0 : 2)) % CORAL.length];
        const p = PLANTS[(r() * PLANTS.length) | 0];
        p.forEach((row, j) => [...row].forEach((ch, i) => ch === 'X' && put(x0 + i, top - p.length + j, t.l)));
      } else if (d < 0.6) {
        SEAGRASS.forEach((row, j) => [...row].forEach((ch, i) => ch === 'X' && put(x0 + i, top - 4 + j, [70, 160, 82])));
      } else if (d < 0.7) {
        const n = 1 + ((r() * 3) | 0);
        for (let k = 0; k < n; k++) glow.push([x0 + k, top - 2]);
      }
      if (h <= 1 && r() < 0.3) kelp.push({ x: x0 + 1 + ((r() * 2) | 0), y: top, h: 18 + ((r() * 32) | 0), ph: r() * 6.28 });
    }

    // Sea pickles: small glowing dots with a soft halo
    for (const [x, y] of glow) {
      for (let dy = -3; dy <= 4; dy++) for (let dx = -3; dx <= 3; dx++) {
        const dd = Math.hypot(dx, dy - 0.5);
        if (dd < 3.6) put(x + dx, y + dy, [200, 255, 150], 0.22 * (1 - dd / 3.6), true);
      }
    }
    for (const [x, y] of glow) { put(x, y, [235, 255, 170]); put(x, y + 1, [170, 225, 100]); }
    return R;
  }

  // ---------- cargo hauler ----------
  // Faces right: main engines on the left edge (rows 3-4), long white cargo hull with panel lines,
  // armoured forward section with glowing thruster nozzles, small green skid underneath
  const HAULER = [
    '............KKKKK...',
    '.KKRKKKKKKKKKtttOK..',
    'KGWWWWpWWWWpWOOOOOK.',
    'EGWbbWpWbbWpWOoOOOKN',
    'EGwwwwpwwwwpwOOOOOK.',
    'KKKKKKKKKKKKKooooOKN',
    '.............KggK...',
  ];
  const HAUL_PIVOT = 4;    // sprite row whose top edge is the engine centreline
  const HC = {
    K: [40, 46, 62], G: [84, 90, 106], W: [234, 232, 224], w: [196, 194, 186],
    p: [164, 164, 162], b: [214, 200, 170], g: [56, 112, 70],
  };
  const LIVERY = [
    { O: [232, 128, 58], o: [176, 92, 44], t: [246, 190, 120] },  // orange
    { O: [46, 96, 60], o: [30, 64, 40], t: [84, 136, 90] },        // dark green
  ];
  const HAUL_SLOPES = [0, 0.3, -0.3, 0.55, -0.55]; // flat or diagonal, rising or falling
  const HAUL_F = 0.3;      // parallax layer it flies on
  const HAUL_TRAIL = 1.8;  // seconds of exhaust left behind
  let hauler = null, nextHauler = 6 + Math.random() * 6;

  function updateHauler(si) {
    if (hauler && time - hauler.t0 > hauler.dur + HAUL_TRAIL) {
      hauler = null;
      nextHauler = time + 25 + Math.random() * 35;
    }
    if (hauler || time < nextHauler) return;
    const skyBottom = Math.min(H, WL - si - 30); // keep it above the water
    if (skyBottom < 40) { nextHauler = time + 5; return; }
    const pick = a => a[(Math.random() * a.length) | 0];
    const speed = 51 + Math.random() * 18;
    const slope = pick(HAUL_SLOPES), dx = W + 60, dy = slope * dx;
    // Aim the middle of the run at the visible sky, so diagonals cross the screen
    const mid = 10 + Math.random() * (skyBottom * 0.6);
    hauler = {
      t0: time, speed, dur: Math.hypot(dx, dy) / speed,
      x0: -30, x1: W + 30,
      y: mid - dy / 2 + si * HAUL_F, dy,
      drop: 4 + Math.random() * 8, seed: Math.random() * 100,
      col: { ...HC, ...pick(LIVERY) },
    };
  }

  function drawHauler(si, put) {
    const h = hauler, now = time - h.t0;
    // Gentle downward arc, so the exhaust curves away to the upper left
    const pos = age => {
      const p = (now - age) / h.dur;
      return [h.x0 + (h.x1 - h.x0) * p, h.y + h.dy * p + h.drop * (1 - (1 - p) * (1 - p)) - si * HAUL_F];
    };

    const step = 0.5 / h.speed;
    for (let a = 0.03; a < HAUL_TRAIL && now - a > 0; a += step) {
      const [x, y] = pos(a);
      const k = a / HAUL_TRAIL, fade = Math.pow(1 - k, 1.6);
      const c = k < 0.1 ? [255, 226, 150] : k < 0.45 ? [255, 150, 64] : [214, 86, 44];
      const yy = Math.round(y + Math.sin(a * 23 + h.seed) * k * 1.6);
      put(x, yy, c, 0.85 * fade);
      if (k < 0.1) put(x, yy - 1, c, 0.85 * fade);
    }

    if (now > h.dur) return;
    const [x, y] = pos(0);
    const flick = ((time * 12) | 0) % 2;
    const col = {
      ...h.col,
      E: flick ? [255, 170, 60] : [255, 224, 140],
      N: flick ? [255, 224, 140] : [255, 150, 50],
      R: (time * 1.4) % 1 < 0.18 ? [255, 70, 60] : HC.K,
    };

    // Point the sprite along the direction of travel (snapped to 5° so it doesn't shimmer),
    // rotating about the engine centreline and sampling nearest-neighbour to keep hard pixels
    const p = now / h.dur;
    const step5 = Math.PI / 36;
    const ang = Math.round(Math.atan2(h.dy + 2 * h.drop * (1 - p), h.x1 - h.x0) / step5) * step5;
    const cs = Math.cos(ang), sn = Math.sin(ang);
    const cx = x + 1, cy = Math.round(y), R = HAULER[0].length + 2;
    for (let Y = cy - R; Y <= cy + R; Y++) {
      for (let X = Math.floor(cx) - R; X <= cx + R; X++) {
        const dx = X + 0.5 - cx, dy = Y + 0.5 - cy;
        const u = Math.floor(dx * cs + dy * sn), v = Math.floor(HAUL_PIVOT - dx * sn + dy * cs);
        const ch = HAULER[v] && HAULER[v][u];
        if (ch && ch !== '.') put(X, Y, col[ch], 1);
      }
    }
  }

  // ---------- build (on load and resize) ----------
  function build() {
    W = Math.ceil(innerWidth / P);
    H = Math.ceil(innerHeight / P) + 1;
    canvas.width = W; canvas.height = H;
    canvas.style.width = W * P + 'px';
    canvas.style.height = H * P + 'px';
    img = ctx.createImageData(W, H);
    buf = img.data;
    docH = Math.ceil(document.documentElement.scrollHeight / P);
    WL = Math.round(docH * WATERLINE);
    reefTop = docH - REEF_H;

    const r = mulberry32(20260429);
    const gauss = () => (r() + r() + r() + r() - 2) / 0.577;

    // Parallax star layers: f = scroll speed relative to the page
    stars = [];
    for (const L of [{ f: 0.12, area: 260, amax: 0.45 }, { f: 0.3, area: 700, amax: 0.7 }, { f: 0.55, area: 2200, amax: 0.95 }]) {
      const ext = WL * L.f + H;
      const n = Math.round((W * ext) / L.area);
      for (let i = 0; i < n; i++) {
        const y = r() * ext;
        if (r() > 0.1 + 0.9 * Math.pow(1 - y / ext, 1.6)) continue; // thinner as you go down
        const tint = r();
        stars.push({
          f: L.f, x: (r() * W) | 0, y, a: L.amax * (0.35 + 0.65 * r()),
          c: tint < 0.7 ? [255, 255, 255] : tint < 0.85 ? [200, 222, 255] : [255, 240, 205],
          tw: r() < 0.25 ? r() * 6.28 : -1,
          big: L.f > 0.5 && r() < 0.12,
        });
      }
    }

    // Milky Way: faint diagonal band on the slowest layer
    milky = [];
    const mx0 = -W * 0.1, my0 = H * 0.78, mx1 = W * 1.1, my1 = H * 0.04;
    const len = Math.hypot(mx1 - mx0, my1 - my0);
    const nx = -(my1 - my0) / len, ny = (mx1 - mx0) / len;
    for (let i = 0, n = Math.round(len * 5); i < n; i++) {
      const u = r();
      const sig = H * 0.06 * (0.7 + 0.5 * Math.sin(u * 9 + 1));
      const o = gauss() * sig;
      const haze = r() < 0.55;
      milky.push({
        x: Math.round(mx0 + (mx1 - mx0) * u + nx * o), y: my0 + (my1 - my0) * u + ny * o,
        a: haze ? 0.05 + 0.07 * r() : (0.12 + 0.28 * r()) * Math.exp(-(o * o) / (2 * sig * sig)),
        c: haze ? [150, 175, 230] : r() < 0.5 ? [255, 255, 255] : [215, 228, 255],
      });
    }

    // Small spiral galaxy
    galaxy = [];
    const gx = W * 0.84, gy = H * 0.72;
    for (let i = 0; i < 260; i++) {
      const arm = i % 2, t = r() * 3.2, rad = 1 + t * 4.2 + gauss() * 0.8;
      const ang = t * 1.9 + arm * Math.PI;
      galaxy.push({
        x: Math.round(gx + Math.cos(ang) * rad), y: gy + Math.sin(ang) * rad * 0.45,
        a: 0.5 * (1 - t / 3.6) + 0.05, c: t < 0.6 ? [255, 244, 220] : [190, 210, 255],
      });
    }

    // Formulas and binary
    const S = W < 240 ? 11 : 15, s = W < 240 ? 8 : 9;
    const eb = textBitmap(euler(S)), ib = textBitmap(ito(s), 80), bb = textBitmap(blackScholes(s), 80);
    const fitX = (x, b) => Math.max(2, Math.min(Math.round(x), W - b.w - 2));
    spaceText = [
      { b: eb, f: 0.3, x: fitX(W * 0.7, eb), y: H * 0.1 },
      { b: ib, f: 0.3, x: fitX(W * 0.06, ib), y: H * 1.25 },
      { b: bb, f: 0.3, x: fitX(W * 0.6, bb), y: H * 1.9 },
    ];
    spaceBits = [];
    const BITS = ['1', '0', '10', '01', '101', '1001', '110', '0110'];
    for (let i = 0; i < 9; i++) {
      const f = r() < 0.5 ? 0.3 : 0.55;
      spaceBits.push({ s: BITS[(r() * BITS.length) | 0], f, x: (r() * (W - 20)) | 0, y: r() * (WL * f + H) * 0.7 });
    }

    const oceanH = reefTop - WL;
    oceanText = [
      { b: ib, x: fitX(W * 0.52, ib), y: WL + oceanH * 0.22 },
      { b: bb, x: fitX(W * 0.1, bb), y: WL + oceanH * 0.4 },
      { b: eb, x: fitX(W * 0.08, eb), y: WL + oceanH * 0.6 },
    ];
    oceanBits = [];
    for (let i = 0; i < 6; i++) oceanBits.push({ s: BITS[(r() * BITS.length) | 0], x: (r() * (W - 20)) | 0, y: WL + 20 + r() * (oceanH - 60) });

    bubbles = [];
    for (let i = 0, n = Math.max(6, (W / 28) | 0); i < n; i++) {
      bubbles.push({ x: (r() * W) | 0, sp: 4 + r() * 6, ph: r() * 200, range: 60 + r() * 140, ch: r() < 0.5 ? '0' : '1', ring: r() < 0.4 });
    }

    reef = makeReef(r);
  }

  // ---------- draw ----------
  function draw() {
    const sy = scrollY / P, si = Math.floor(sy);
    if (!reduceMotion) updateHauler(si);
    canvas.style.transform = `translateY(${-(sy - si) * P}px)`;

    // Background gradient + light rays in the water
    for (let y = 0; y < H; y++) {
      const wy = si + y;
      const sea = wy >= WL;
      const pal = sea ? SEA : SKY;
      const t = sea ? clamp01((wy - WL) / (docH - WL)) : clamp01(wy / WL);
      const pos = t * (pal.length - 1), brow = (wy & 3) * 4, last = pal.length - 1;
      const rs = sea ? 9 * (1 - 0.6 * t) : 0;
      for (let x = 0, i = y * W * 4; x < W; x++, i += 4) {
        let k = Math.round(pos + BAYER[brow + (x & 3)]);
        k = k < 0 ? 0 : k > last ? last : k;
        const c = pal[k];
        let add = 0;
        if (rs && ((((x + wy * 0.45 + time * 3) % 64) + 64) % 64) < 8) add = rs;
        buf[i] = c[0] + add * 0.5; buf[i + 1] = c[1] + add; buf[i + 2] = c[2] + add; buf[i + 3] = 255;
      }
    }

    // Space: everything above the waterline, fading out as it nears the water
    if (si < WL) {
      const skyPx = (x, y, c, a) => px(x, y, c, a * clamp01((WL - si - y) / 40));
      // Distant objects fade out over the first part of the descent
      const layer = (pts, f) => {
        const depthFade = clamp01(1 - (si / WL) * 1.8);
        if (!depthFade) return;
        for (const p of pts) {
          const y = Math.round(p.y - si * f);
          if (y >= 0 && y < H) skyPx(p.x, y, p.c, p.a * depthFade);
        }
      };
      layer(milky, 0.12);
      layer(galaxy, 0.3);
      for (const s of stars) {
        const y = Math.round(s.y - si * s.f);
        if (y < 0 || y >= H) continue;
        const a = s.tw >= 0 ? s.a * (0.55 + 0.45 * Math.sin(time * 1.7 + s.tw)) : s.a;
        skyPx(s.x, y, s.c, a);
        if (s.big) {
          skyPx(s.x - 1, y, s.c, a * 0.35); skyPx(s.x + 1, y, s.c, a * 0.35);
          skyPx(s.x, y - 1, s.c, a * 0.35); skyPx(s.x, y + 1, s.c, a * 0.35);
        }
      }
      const shimmer = 0.3 + 0.06 * Math.sin(time * 0.8);
      for (const t of spaceText) {
        const oy = Math.round(t.y - si * t.f);
        if (oy > H || oy + t.b.h < 0) continue;
        for (const [x, y] of t.b.pts) skyPx(t.x + x, oy + y, [190, 225, 255], shimmer);
      }
      for (const b of spaceBits) {
        const oy = Math.round(b.y - si * b.f);
        if (oy > -6 && oy < H) {
          const a = 0.32 * clamp01((WL - si - oy) / 40);
          drawBits(b.s, b.x, oy, [170, 215, 255], a);
        }
      }
      if (hauler) drawHauler(si, skyPx);
    }

    // Water surface
    const surf = WL - si;
    if (surf > -3 && surf < H + 3) {
      for (let x = 0; x < W; x++) {
        const y = surf + Math.round(Math.sin(x * 0.12 + time * 1.3) * 1.2);
        px(x, y, [110, 160, 210], 0.5);
        px(x, y + 1, [70, 120, 180], 0.25);
      }
    }

    // Ocean: faint formulas and binary
    for (const t of oceanText) {
      const oy = Math.round(t.y - si);
      if (oy > H || oy + t.b.h < 0) continue;
      for (const [x, y] of t.b.pts) px(t.x + x, oy + y, [180, 235, 240], 0.12);
    }
    for (const b of oceanBits) drawBits(b.s, b.x, Math.round(b.y - si), [180, 235, 240], 0.2);

    const ry = reefTop - si;
    if (ry < H + 10 && ry > -REEF_H - 260) {
      // Bubbles (some are 0s and 1s) rising from the reef
      for (const b of bubbles) {
        const prog = ((time * b.sp + b.ph) % b.range) / b.range;
        const by = Math.round(ry + 10 - prog * b.range);
        const bx = b.x + Math.round(Math.sin(time * 1.4 + b.ph));
        const a = 0.45 * (1 - prog);
        if (b.ring) {
          const c = [200, 240, 255];
          px(bx, by - 1, c, a); px(bx - 1, by, c, a); px(bx + 1, by, c, a); px(bx, by + 1, c, a);
        } else {
          drawBits(b.ch, bx, by, [200, 240, 255], a);
        }
      }

      // Kelp, swaying
      for (const k of kelp) {
        for (let i = 0; i < k.h; i++) {
          const x = k.x + Math.round(Math.sin(time * 1.1 + i * 0.18 + k.ph) * (i / k.h) * 2);
          const y = ry + k.y - i;
          px(x, y, [42, 128, 66], 1);
          if (i % 4 === 2) px(x + ((i >> 2) % 2 ? 1 : -1), y, [64, 162, 84], 1);
        }
      }

      // Reef sprite
      for (let y = 0; y < REEF_H; y++) {
        const sy2 = ry + y;
        if (sy2 < 0 || sy2 >= H) continue;
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4, a = reef[i + 3];
          if (a) px(x, sy2, [reef[i], reef[i + 1], reef[i + 2]], a / 255);
        }
      }
    }

    ctx.putImageData(img, 0, 0);
  }

  // ---------- loop ----------
  let dirty = true, last = 0, rebuild = false;
  function frame(ts) {
    if (rebuild) { build(); rebuild = false; dirty = true; }
    if (!reduceMotion) time = ts / 1000;
    if (dirty || (!reduceMotion && ts - last > 50)) { draw(); last = ts; dirty = false; }
    requestAnimationFrame(frame);
  }
  addEventListener('scroll', () => { dirty = true; }, { passive: true });
  addEventListener('resize', () => { rebuild = true; });
  new ResizeObserver(() => { rebuild = true; }).observe(document.body);
  build();
  requestAnimationFrame(frame);

  // ---------- thin cursor trail ----------
  if (reduceMotion || !matchMedia('(pointer: fine)').matches) return;
  const tc = document.getElementById('trail');
  const g = tc.getContext('2d');
  const LIFE = 350;
  let pts = [];
  function sizeTrail() {
    const dpr = devicePixelRatio || 1;
    tc.width = innerWidth * dpr; tc.height = innerHeight * dpr;
    tc.style.width = innerWidth + 'px'; tc.style.height = innerHeight + 'px';
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  sizeTrail();
  addEventListener('resize', sizeTrail);
  addEventListener('mousemove', e => pts.push({ x: e.clientX, y: e.clientY, t: performance.now() }));
  (function tick(now) {
    g.clearRect(0, 0, innerWidth, innerHeight);
    pts = pts.filter(p => now - p.t < LIFE);
    g.lineWidth = 1;
    g.lineCap = 'round';
    for (let i = 1; i < pts.length; i++) {
      g.strokeStyle = `rgba(186, 230, 253, ${(1 - (now - pts[i].t) / LIFE) * 0.6})`;
      g.beginPath();
      g.moveTo(pts[i - 1].x, pts[i - 1].y);
      g.lineTo(pts[i].x, pts[i].y);
      g.stroke();
    }
    requestAnimationFrame(tick);
  })(performance.now());
})();

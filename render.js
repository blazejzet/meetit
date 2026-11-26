/* meetit.live – renderer plakatów (Canvas 2D).
 * Wszystkie layouty rysowane są we współrzędnych projektowych (np. 990×1400 dla A3/A4 pion),
 * a kontekst jest skalowany do docelowej rozdzielczości. */
(function () {
  'use strict';

  const BLUE = '#024ca1';
  const UMK_BLUE = '#0a4da2';
  const GREEN = '#aad337';
  const YELLOW = '#ffcc00';
  const ARIAL = "Arial, 'Helvetica Neue', Helvetica, 'Liberation Sans', sans-serif";

  // A3 i A4 mają te same proporcje (1:√2), więc dzielą współrzędne projektowe.
  const PAPERS = {
    a3: { label: 'A3', mm: [297, 420] },
    a4: { label: 'A4', mm: [210, 297] },
  };
  const FORMATS = {
    portrait: { label: 'pion', design: [990, 1400], suffix: 'P', paper: true },
    landscape: { label: 'poziom', design: [1400, 990], suffix: 'L', paper: true },
    banner: { label: 'Baner 1200×630', design: [1400, 735], px: [1200, 630], suffix: 'Z' },
  };

  /** Wymiary wyjściowe: etykieta, piksele (300 dpi dla formatów papierowych) i mm (null dla banera). */
  function formatSize(format, paper) {
    const f = FORMATS[format];
    if (!f.paper) return { label: f.label, px: f.px, mm: null };
    const p = PAPERS[paper] || PAPERS.a3;
    const mm = f.design[0] > f.design[1] ? [p.mm[1], p.mm[0]] : p.mm;
    return { label: `${p.label} ${f.label}`, px: mm.map((v) => Math.ceil(v / 25.4 * 300)), mm };
  }

  const MONTHS = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca',
    'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

  // ---------- helpers ----------
  const FAMILIES = {
    arial: ARIAL,
    serif: "'Old Standard TT', 'Times New Roman', Times, serif",
    script: "Caveat, 'Bradley Hand', cursive",
    narrow: "'Roboto Condensed', 'Arial Narrow', sans-serif",
  };
  function font(weight, size, family, italic) {
    return `${italic ? 'italic ' : ''}${weight} ${size}px ${FAMILIES[family] || 'Lato, sans-serif'}`;
  }

  function poly(ctx, pts, fill, alpha) {
    ctx.save();
    if (alpha != null) ctx.globalAlpha = alpha;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  }

  function rect(ctx, x, y, w, h, fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }

  function setShadow(ctx, R, on, size) {
    if (on) {
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = size * 0.35 * R.k;
      ctx.shadowOffsetY = size * 0.05 * R.k;
    } else {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    }
  }

  function text(ctx, str, x, y, o) {
    if (!str) return;
    ctx.font = font(o.weight || 400, o.size, o.family, o.italic);
    ctx.fillStyle = o.color || '#111';
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(str, x, y);
  }

  function lines(ctx, arr, x, y, lh, o) {
    arr.forEach((s, i) => text(ctx, s, x, y + i * lh, o));
    return y + (arr.length - 1) * lh;
  }

  // ---------- kolory ----------
  function hex(c) {
    let h = c.slice(1);
    if (h.length === 3) h = h.replace(/./g, '$&$&');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(c, a) { return `rgba(${hex(c).join(',')},${a})`; }
  /** Kolor pośredni między a i b (t = 0…1). */
  function mix(a, b, t) {
    const A = hex(a), B = hex(b);
    return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }
  /** Czy na tym kolorze lepiej czytać ciemny tekst (luminancja WCAG). */
  function isLight(c) {
    const [r, g, b] = hex(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.18;
  }
  /** Kolory tekstu i logo pasujące do tła bg. */
  function onColor(bg) {
    return isLight(bg)
      ? { fg: '#111', muted: mix(bg, '#000', 0.7), line: 'rgba(0,0,0,0.2)', tex: 'rgba(0,0,0,0.05)', logo: 'base' }
      : { fg: '#fff', muted: mix(bg, '#fff', 0.8), line: 'rgba(255,255,255,0.3)', tex: 'rgba(255,255,255,0.05)', logo: 'neg' };
  }

  // ---------- rich text (tytuł z *kursywą*) ----------
  function parseRich(src) {
    let italic = false;
    return src.split('\n').map((p) => {
      const words = [];
      let cur = [];
      let buf = '';
      const flush = () => { if (buf) { cur.push({ t: buf, i: italic }); buf = ''; } };
      for (const ch of p) {
        if (ch === '*') { flush(); italic = !italic; continue; }
        if (ch === ' ' || ch === '\t') { flush(); if (cur.length) { words.push(cur); cur = []; } continue; }
        buf += ch;
      }
      flush();
      if (cur.length) words.push(cur);
      return words;
    });
  }

  function wordWidth(ctx, word, size, o) {
    let w = 0;
    for (const seg of word) {
      ctx.font = font(o.weight, size, o.family, seg.i || o.italic);
      w += ctx.measureText(seg.t).width;
    }
    return w;
  }

  function layoutRich(ctx, paras, size, maxW, o) {
    ctx.font = font(o.weight, size, o.family, o.italic);
    const space = ctx.measureText(' ').width;
    const out = [];
    for (const words of paras) {
      let line = [];
      let lw = 0;
      for (const w of words) {
        const ww = wordWidth(ctx, w, size, o);
        if (line.length && lw + space + ww > maxW) {
          out.push({ words: line, w: lw });
          line = [w];
          lw = ww;
        } else {
          lw += (line.length ? space : 0) + ww;
          line.push(w);
        }
      }
      out.push({ words: line, w: lw });
    }
    return { lines: out, space };
  }

  /** Dobiera rozmiar tekstu tak, by zmieścił się w maxW × maxH (lub maxLines). */
  function fitRich(ctx, src, o) {
    const paras = parseRich(o.upper ? src.toLocaleUpperCase('pl-PL') : src);
    let res;
    for (let s = o.size; s >= o.minSize; s -= 0.5) {
      res = layoutRich(ctx, paras, s, o.maxW, o);
      res.size = s;
      res.lh = s * o.lh;
      const widest = Math.max(0, ...res.lines.map((l) => l.w));
      const n = res.lines.length;
      const okH = o.maxH == null || n * res.lh <= o.maxH + 0.01;
      const okL = o.maxLines == null || n <= o.maxLines;
      if (widest <= o.maxW && okH && okL) break;
    }
    res.o = o;
    return res;
  }

  function drawRich(ctx, R, fit, x, y, o) {
    const { lines: ls, size, lh, space } = fit;
    const fo = fit.o;
    ctx.save();
    ctx.fillStyle = o.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    setShadow(ctx, R, o.shadow, size);
    ls.forEach((l, li) => {
      let cx = o.align === 'center' ? x - l.w / 2 : o.align === 'right' ? x - l.w : x;
      const cy = y + li * lh;
      l.words.forEach((w, wi) => {
        if (wi) cx += space;
        for (const seg of w) {
          ctx.font = font(fo.weight, size, fo.family, seg.i || fo.italic);
          ctx.fillText(seg.t, cx, cy);
          if (o.stroke) {
            ctx.lineJoin = 'round';
            ctx.lineWidth = o.strokeW || 1;
            ctx.strokeStyle = o.stroke;
            ctx.strokeText(seg.t, cx, cy);
          }
          cx += ctx.measureText(seg.t).width;
        }
      });
    });
    ctx.restore();
    return y + (ls.length - 1) * lh; // baseline ostatniej linii
  }

  // ---------- elementy marki ----------
  // Oficjalne logo WMiI (pakiet PL) – PNG z przezroczystością, przycięte do zawartości.
  const LOGO_FILES = {
    base: 'assets/wmii-poziom-podstawowe.png', // na jasne tło
    neg: 'assets/wmii-poziom-negatyw.png',     // na ciemne tło
  };
  const logos = {};
  function loadLogos(prefix = '') {
    return Promise.all(Object.entries(LOGO_FILES).map(([k, src]) => new Promise((res) => {
      const i = new Image();
      i.onload = () => { logos[k] = i; res(); };
      i.onerror = () => res(); // brak pliku → zapasowe logo wektorowe
      i.src = prefix + src;
    })));
  }

  /** Logo WMiI; (cx, cy) – środek koła, s – skala (1 = rozmiar z plakatów w pionie). */
  function drawUmk(ctx, cx, cy, s, variant = 'base') {
    const img = logos[variant];
    if (img) {
      const h = 107.5 * s;
      ctx.drawImage(img, cx - 37 * s, cy - 46.3 * s, h * img.width / img.height, h);
      return;
    }
    drawUmkVector(ctx, cx, cy, s, variant === 'neg' ? '#fff' : UMK_BLUE);
  }

  /** Logo WMiI umieszczone lewym górnym rogiem w (x, y), o wysokości h. Zwraca szerokość. */
  function drawLogo(ctx, x, y, h, variant = 'base') {
    const s = h / 107.5;
    drawUmk(ctx, x + 37 * s, y + 46.3 * s, s, variant);
    const img = logos[variant];
    return img ? h * img.width / img.height : 268 * s;
  }

  function drawUmkVector(ctx, cx, cy, s, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    const circle = (x, y, r, c) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); };
    circle(0, 0, 37, color);
    circle(-24.3, -35.1, 11.2, '#ffffff');
    circle(-24.3, -35.1, 6.2, GREEN);
    circle(0, -6, 12.4, YELLOW);
    // tekst dopasowany szerokością do oryginału
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(900, 100);
    const s1 = 100 * 170.4 / ctx.measureText('MIKOŁAJA KOPERNIKA').width;
    ctx.font = font(900, s1);
    ctx.fillText('UNIWERSYTET', 55.7, -20.3);
    ctx.fillText('MIKOŁAJA KOPERNIKA', 55.7, -0.3);
    ctx.fillText('W TORUNIU', 55.7, 19.7);
    ctx.font = font(400, 100);
    const s2 = 100 * 139.3 / ctx.measureText('Wydział Matematyki').width;
    ctx.font = font(400, s2);
    ctx.fillText('Wydział Matematyki', 55.7, 40.8);
    ctx.fillText('i Informatyki', 55.7, 58.7);
    ctx.restore();
  }

  /** Wordmark "meetit.live" o zadanej szerokości. Zwraca rozmiar fontu. */
  function drawWordmark(ctx, R, x, baseline, width, o = {}) {
    const c = o.color || '#fff';
    const parts = [['meet', c], ['it', o.greenIt === false ? c : GREEN], ['.live', c]];
    ctx.save();
    ctx.font = font(900, 100);
    const size = 100 * width / ctx.measureText('meetit.live').width;
    ctx.font = font(900, size);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    if (o.glow) {
      ctx.shadowColor = 'rgba(255,255,255,0.45)';
      ctx.shadowBlur = size * 0.25 * R.k;
    }
    let cx = x;
    for (const [t, c] of parts) {
      ctx.fillStyle = c;
      ctx.fillText(t, cx, baseline);
      cx += ctx.measureText(t).width;
    }
    ctx.restore();
    if (o.tagline) {
      const ts = width * 0.037;
      const ty = baseline + size * 0.36;
      const tc = o.taglineColor || c;
      text(ctx, 'MATEMATYKA', x + width * 0.01, ty, { size: ts, color: tc });
      text(ctx, 'ANALIZA DANYCH', x + width / 2, ty, { size: ts, color: tc, align: 'center' });
      text(ctx, 'INFORMATYKA', x + width * 0.99, ty, { size: ts, color: tc, align: 'right' });
    }
    return size;
  }

  const qrCache = new Map();
  function qrMatrix(data) {
    if (qrCache.has(data)) return qrCache.get(data);
    let m = null;
    try {
      if (window.qrcode) {
        window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs['UTF-8'];
        const q = window.qrcode(0, 'M');
        q.addData(data);
        q.make();
        const n = q.getModuleCount();
        m = [];
        for (let r = 0; r < n; r++) {
          const row = [];
          for (let c = 0; c < n; c++) row.push(q.isDark(r, c));
          m.push(row);
        }
      }
    } catch (e) { m = null; }
    qrCache.set(data, m);
    return m;
  }

  function drawQR(ctx, data, x, y, size, padRatio = 0.06) {
    rect(ctx, x, y, size, size, '#fff');
    const m = data && qrMatrix(data);
    if (!m) return;
    const pad = size * padRatio;
    const cell = (size - 2 * pad) / m.length;
    ctx.fillStyle = '#000';
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m.length; c++) {
        if (m[r][c]) ctx.fillRect(x + pad + c * cell, y + pad + r * cell, cell + 0.03, cell + 0.03);
      }
    }
  }

  /** Blok "Etykieta: / wartość [QR]" – etykieta wyrównana do prawej przy rightX. */
  function qrItem(ctx, q, rightX, qrX, qrY, qrSize, o) {
    const ls = o.labelSize;
    const color = o.color || '#111';
    text(ctx, q.label, rightX, qrY + qrSize * 0.42, { weight: o.labelWeight || 700, size: ls, family: o.family, color, align: 'right' });
    text(ctx, q.text, rightX, qrY + qrSize * 0.42 + ls * 1.1, { weight: 400, size: ls * 0.97, color, align: 'right' });
    drawQR(ctx, q.url, qrX, qrY, qrSize);
  }

  // ---------- zdjęcie ----------
  /**
   * Zdjęcie przycięte do prostokąta r, z korektą (jasność / kontrast / nasycenie)
   * i opcjonalnie przemapowane na dwa kolory (duotone).
   */
  function drawPhoto(ctx, R, r, duo, slot = 0, opt = null) {
    const st = R.st;
    if (!R.imgs[slot] || (!duo && !st.brightness && !st.contrast && !st.saturation)) { drawPhotoRaw(ctx, R, r, slot, opt); return; }
    const k = R.k;
    const w = Math.max(1, Math.round(r.w * k));
    const h = Math.max(1, Math.round(r.h * k));
    const oc = document.createElement('canvas');
    oc.width = w;
    oc.height = h;
    const o = oc.getContext('2d');
    o.setTransform(k, 0, 0, k, -r.x * k, -r.y * k);
    drawPhotoRaw(o, R, r, slot, opt);
    const id = o.getImageData(0, 0, w, h);
    photoFx(id.data, st, duo);
    o.putImageData(id, 0, 0);
    ctx.drawImage(oc, r.x, r.y, r.w, r.h);
  }

  function photoFx(p, st, duo) {
    const b = (st.brightness || 0) / 100;
    const c = (st.contrast || 0) / 100;
    const sat = 1 + (st.saturation || 0) / 100;
    // jasność jako gamma (nie przepala bieli ani nie szarzy czerni), kontrast wokół środka
    const gamma = Math.pow(2, -b * 1.3);
    const cf = c >= 0 ? 1 + c * 1.5 : 1 + c * 0.8;
    const lut = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      lut[i] = Math.min(1, Math.max(0, (Math.pow(i / 255, gamma) - 0.5) * cf + 0.5)) * 255;
    }
    if (duo) {
      const d = hex(st.duoDark), l = hex(st.duoLight);
      for (let i = 0; i < p.length; i += 4) {
        let t = (0.299 * lut[p[i]] + 0.587 * lut[p[i + 1]] + 0.114 * lut[p[i + 2]]) / 255;
        t = t * t * (3 - 2 * t); // lekkie podbicie kontrastu
        p[i] = d[0] + (l[0] - d[0]) * t;
        p[i + 1] = d[1] + (l[1] - d[1]) * t;
        p[i + 2] = d[2] + (l[2] - d[2]) * t;
      }
      return;
    }
    for (let i = 0; i < p.length; i += 4) {
      const r = lut[p[i]], g = lut[p[i + 1]], bl = lut[p[i + 2]];
      const L = 0.299 * r + 0.587 * g + 0.114 * bl;
      p[i] = L + (r - L) * sat; // Uint8ClampedArray sam przycina do 0…255
      p[i + 1] = L + (g - L) * sat;
      p[i + 2] = L + (bl - L) * sat;
    }
  }

  /**
   * Rysuje zdjęcie ze slotu `slot` przycięte do r i zapisuje obszar w R.areas
   * (przeciąganie / zoom w podglądzie). opt: { hit(x, y) – test trafienia dla nieprostokątnych kadrów,
   * label: {x, y} – miejsce podpowiedzi, gdy brak zdjęcia }.
   */
  function drawPhotoRaw(ctx, R, r, slot = 0, opt = null) {
    const img = R.imgs[slot];
    const area = { slot, rect: r, hit: opt && opt.hit, draw: null };
    R.areas.push(area);
    if (!img) {
      if (R.preview) {
        ctx.save();
        const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
        g.addColorStop(0, 'rgba(0,0,0,0.05)');
        g.addColorStop(1, 'rgba(0,0,0,0.12)');
        ctx.fillStyle = g;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        const s = Math.max(16, Math.min(r.w, r.h) * 0.045);
        const multi = R.imgs.length > 1;
        const tx = (opt && opt.label) || { x: r.x + r.w / 2, y: r.y + r.h * 0.62 };
        text(ctx, multi ? `Zdjęcie – prelegent ${slot + 1}` : 'Przeciągnij tu zdjęcie', tx.x, tx.y, { size: s, weight: 700, color: 'rgba(0,0,0,0.35)', align: 'center' });
        text(ctx, multi ? 'przeciągnij je tutaj' : 'lub wybierz je w panelu po lewej', tx.x, tx.y + s * 1.4, { size: s * 0.7, color: 'rgba(0,0,0,0.3)', align: 'center' });
        ctx.restore();
      }
      return;
    }
    const f = R.framings[slot];
    const base = Math.max(r.w / img.width, r.h / img.height);
    const sc = base * f.zoom;
    const dw = img.width * sc;
    const dh = img.height * sc;
    // przytnij środek kadru, żeby zdjęcie zawsze pokrywało obszar
    const minCx = r.w / 2 / dw, minCy = r.h / 2 / dh;
    f.cx = Math.min(1 - minCx, Math.max(minCx, f.cx));
    f.cy = Math.min(1 - minCy, Math.max(minCy, f.cy));
    const dx = r.x + r.w / 2 - f.cx * dw;
    const dy = r.y + r.h / 2 - f.cy * dh;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
    area.draw = { dw, dh };
  }

  // ---------- teksty wspólne ----------
  function names(st) {
    const list = st.speakers.split('\n').map((s) => s.trim()).filter(Boolean);
    if (list.length <= 1) return list[0] || '';
    return list.slice(0, -1).join(', ') + ' i ' + list[list.length - 1];
  }
  function speakerList(st) { return st.speakers.split('\n').map((s) => s.trim()).filter(Boolean); }
  function placeLines(st) { return st.place.split('\n').map((s) => s.trim()).filter(Boolean); }
  /** Adres w jednej linii: zawinięte wiersze nazwy łączone spacją, ostatni (ulica) po przecinku. */
  function placeOneLine(st) {
    const pl = placeLines(st);
    return pl.length > 1 ? pl.slice(0, -1).join(' ') + ', ' + pl[pl.length - 1] : (pl[0] || '');
  }
  /** Tekst zmniejszany tak, by zmieścił się w maxW. */
  function textFit(ctx, str, x, y, maxW, o) {
    ctx.font = font(o.weight || 400, o.size, o.family, o.italic);
    const w = ctx.measureText(str).width;
    text(ctx, str, x, y, Object.assign({}, o, { size: w > maxW ? o.size * maxW / w : o.size }));
  }
  function dateStr(st) {
    if (!st.date) return '';
    const [y, m, d] = st.date.split('-').map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
  }
  function timeStr(st, short) {
    const parts = [];
    if (st.time) parts.push(`${short ? 'godz.' : 'godzina'} ${st.time}`);
    if (st.room) parts.push(`sala ${st.room}`);
    return parts.join(', ');
  }
  function qrs(st, order) {
    if (!st.showQr) return [];
    const a = [st.qr1, st.qr2].filter((q) => q && (q.url || q.label));
    return order === 'rev' ? a.reverse() : a;
  }
  function titleLight(st, defLight) {
    if (st.titleColor === 'light') return true;
    if (st.titleColor === 'dark') return false;
    return defLight;
  }

  // =====================================================================
  //  SZABLON: KLASYCZNY (skośne kształty)
  // =====================================================================
  function classicPortrait(ctx, R) {
    const st = R.st;
    rect(ctx, 0, 0, 990, 1400, st.bgColor);
    drawPhoto(ctx, R, { x: 0, y: 0, w: 990, h: 1400 });
    if (st.band) poly(ctx, [[0, 150], [990, 120], [990, 488], [930, 550], [0, 392]], st.accent, st.bandOpacity);

    poly(ctx, [[0, 0], [285, 0], [553, 219], [472, 276], [0, 200]], '#ffffff');
    poly(ctx, [[285, 0], [990, 0], [990, 164], [600, 257]], BLUE);
    poly(ctx, [[300, 1248], [610, 1152], [990, 1180], [990, 1400], [300, 1400]], st.accent);
    poly(ctx, [[0, 1222], [290, 1143], [730, 1400], [0, 1400]], '#fffffb');

    drawUmk(ctx, 159, 146, 1);
    drawWordmark(ctx, R, 545.8, 165.6, 282.5, { greenIt: st.greenIt });

    const light = titleLight(st, false);
    const tc = light ? '#fff' : '#111';
    const ts = 50 * st.titleScale;
    const fit = fitRich(ctx, st.title, { weight: 900, size: ts, minSize: 24, lh: 1.04, maxW: 870, maxH: 3 * 52 * st.titleScale + 8, upper: st.titleUpper });
    const last = drawRich(ctx, R, fit, 495, 358, { align: 'center', color: tc, shadow: light });
    const aff = st.affiliation ? ` (${st.affiliation})` : '';
    ctx.save();
    setShadow(ctx, R, light, 22);
    text(ctx, names(st) + aff, 495, last + Math.max(44, fit.size * 1.06), { size: 22, family: 'arial', color: light ? '#fff' : '#222', align: 'center' });
    ctx.restore();

    text(ctx, dateStr(st), 140, 1214, { weight: 700, size: 20.5, family: 'arial' });
    text(ctx, timeStr(st), 140, 1236, { weight: 700, size: 20.5, family: 'arial' });
    lines(ctx, placeLines(st), 137, 1276, 20, { weight: 300, size: 19.5, color: '#222' });

    qrs(st).forEach((q, i) => qrItem(ctx, q, 765, 778, 1180 + i * 90, 62, { labelSize: 20, family: 'arial' }));
  }

  function classicLandscape(ctx, R) {
    const st = R.st;
    rect(ctx, 0, 0, 1400, 990, st.bgColor);
    drawPhoto(ctx, R, { x: 0, y: 0, w: 1400, h: 990 });

    poly(ctx, [[600, 0], [905, 0], [1110, 185], [475, 228]], '#2f7bd0', 0.92);
    poly(ctx, [[0, 0], [600, 0], [465, 232], [0, 182]], '#ffffff');
    poly(ctx, [[900, 0], [1400, 0], [1400, 150], [1115, 198]], BLUE);
    poly(ctx, [[390, 990], [780, 745], [1400, 732], [1400, 990]], st.accent);
    poly(ctx, [[640, 990], [760, 760], [1115, 784], [1075, 990]], '#fffffb');

    drawUmk(ctx, 128, 108, 1);
    drawWordmark(ctx, R, 1045, 112, 285, { greenIt: st.greenIt });

    const light = titleLight(st, true);
    const tc = light ? '#fff' : '#111';
    const fit = fitRich(ctx, st.title, { weight: 900, size: 70 * st.titleScale, minSize: 28, lh: 1.08, maxW: 640, maxH: 4 * 76 * st.titleScale, upper: st.titleUpper });
    const firstBl = 885 - (fit.lines.length - 1) * fit.lh;
    drawRich(ctx, R, fit, 85, firstBl, { align: 'left', color: tc, shadow: light });

    // prelegenci nad tytułem
    const sp = names(st) + (st.affiliation ? ` (${st.affiliation})` : '');
    const spFit = fitRich(ctx, sp, { weight: 900, size: 27, minSize: 16, lh: 1.15, maxW: 640, maxLines: 3, upper: st.titleUpper });
    const spFirst = firstBl - fit.size * 0.95 - (spFit.lines.length - 1) * spFit.lh - 12;
    drawRich(ctx, R, spFit, 85, spFirst, { align: 'left', color: tc, shadow: light });

    text(ctx, dateStr(st), 800, 818, { weight: 700, size: 20.5, family: 'arial' });
    text(ctx, timeStr(st), 800, 840, { weight: 700, size: 20.5, family: 'arial' });
    lines(ctx, placeLines(st), 797, 880, 20.5, { weight: 300, size: 20, color: '#222' });

    qrs(st).forEach((q, i) => qrItem(ctx, q, 1268, 1285, 780 + i * 86, 54, { labelSize: 20, family: 'arial' }));
  }

  function classicBanner(ctx, R) {
    const st = R.st;
    rect(ctx, 0, 0, 1400, 735, '#ffffff');
    rect(ctx, 0, 0, 760, 735, st.bgColor);
    drawPhoto(ctx, R, { x: 0, y: 0, w: 760, h: 735 });
    poly(ctx, [[0, 0], [400, 0], [358, 170], [0, 150]], '#ffffff');
    drawLogo(ctx, 60, 50, 88);
    poly(ctx, [[612, 0], [1400, 0], [1400, 97], [760, 160]], BLUE);
    drawWordmark(ctx, R, 818, 97, 292, { greenIt: st.greenIt });

    const sps = speakerList(st);
    const affH = st.affiliation ? 28 : 0;
    const spH = sps.length ? (sps.length - 1) * 32 + affH : 0;
    // tytuł + prelegenci muszą skończyć się nad blokiem daty (~505)
    let fit, gap;
    for (let s = 34 * st.titleScale; s >= 20; s -= 1) {
      fit = fitRich(ctx, st.title, { weight: 900, size: s, minSize: s, lh: 1.17, maxW: 525, upper: st.titleUpper });
      gap = Math.max(52, s * 1.9);
      if (230 + (fit.lines.length - 1) * fit.lh + gap + spH <= 500) break;
    }
    const last = drawRich(ctx, R, fit, 812, 230, { align: 'left', color: '#111' });
    let y = last + gap;
    sps.forEach((n, i) => text(ctx, n, 812, y + i * 32, { size: 28, family: 'arial', color: '#222' }));
    if (st.affiliation) text(ctx, st.affiliation, 812, y + (sps.length - 1) * 32 + (sps.length ? 28 : 0), { size: 22, family: 'arial', color: '#222' });

    text(ctx, dateStr(st), 815, 545, { weight: 700, size: 22, family: 'arial' });
    text(ctx, timeStr(st), 815, 575, { weight: 700, size: 22, family: 'arial' });
    lines(ctx, placeLines(st), 812, 622, 26, { weight: 300, size: 22.5, color: '#333' });

    const q = qrs(st);
    if (q.length) {
      rect(ctx, 1146, 515, 194, q.length > 1 ? 171 : 82, st.accent);
      q.forEach((it, i) => qrItem(ctx, it, 1256, 1266, 520 + i * 92, 62, { labelSize: 21, family: 'arial' }));
    }
  }

  // =====================================================================
  //  SZABLON: CIEMNY (pełne zdjęcie, ciemny pasek u góry)
  // =====================================================================
  function shadeV(ctx, x, y, w, h, a, from, to, color = '#000000') {
    if (a <= 0) return;
    const g = ctx.createLinearGradient(0, from, 0, to);
    g.addColorStop(0, rgba(color, 0));
    g.addColorStop(1, rgba(color, a));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }

  function darkPortrait(ctx, R) {
    const st = R.st;
    rect(ctx, 0, 0, 990, 1400, st.bgColor);
    drawPhoto(ctx, R, { x: 0, y: 0, w: 990, h: 1400 });
    shadeV(ctx, 0, 600, 990, 800, st.shade, 600, 1150, st.shadeColor);
    rect(ctx, 0, 0, 990, 218, rgba(st.shadeColor, 0.88));
    drawLogo(ctx, 60, 60, 102, 'neg');
    drawWordmark(ctx, R, 540, 120, 390, { greenIt: st.greenIt, glow: true, tagline: true, taglineColor: '#ddd' });

    const fit = fitRich(ctx, st.title, { weight: 700, size: 50 * st.titleScale, minSize: 26, lh: 1.05, maxW: 680, maxH: 3 * 53 * st.titleScale, upper: st.titleUpper });
    const firstBl = 1090 - (fit.lines.length - 1) * fit.lh;
    drawRich(ctx, R, fit, 250, firstBl, { align: 'left', color: '#fff', shadow: true });
    ctx.save();
    setShadow(ctx, R, true, 26);
    const nameBl = firstBl - fit.size * 1.18;
    const sp = speakerList(st).join(', ').toLocaleUpperCase('pl-PL');
    text(ctx, sp, 250, nameBl, { weight: 700, size: 26, color: '#fff' });
    text(ctx, (st.affiliation || '').toLocaleUpperCase('pl-PL'), 250, nameBl - 38, { weight: 300, size: 26, color: '#fff' });

    const dl = [dateStr(st), timeStr(st)].filter(Boolean).join(', ');
    text(ctx, dl, 495, 1165, { weight: 700, size: 24, color: '#fff', align: 'center' });
    const pl = placeLines(st);
    const pl2 = pl.length > 2 ? [pl.slice(0, -1).join(' '), pl[pl.length - 1]] : pl;
    lines(ctx, pl2, 495, 1203, 24, { size: 21, color: '#e6e6e6', align: 'center' });
    ctx.restore();

    const q = qrs(st, 'rev');
    const off = q.length === 1 ? 106 : 0; // pojedynczy kod – wyśrodkuj
    q.forEach((it, i) => qrItem(ctx, it, 412 + off + i * 213, 425 + off + i * 210, 1265, 62, { labelSize: 20, labelWeight: 700, color: '#fff' }));
  }

  function darkBanner(ctx, R) {
    const st = R.st;
    rect(ctx, 0, 0, 1400, 735, st.bgColor);
    drawPhoto(ctx, R, { x: 0, y: 0, w: 1400, h: 735 });
    if (st.shade > 0) {
      const g = ctx.createLinearGradient(0, 0, 950, 0);
      g.addColorStop(0, rgba(st.shadeColor, st.shade));
      g.addColorStop(0.55, rgba(st.shadeColor, st.shade * 0.7));
      g.addColorStop(1, rgba(st.shadeColor, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1400, 735);
    }
    const gt = ctx.createLinearGradient(0, 0, 0, 190);
    gt.addColorStop(0, rgba(st.shadeColor, 0.5));
    gt.addColorStop(1, rgba(st.shadeColor, 0));
    ctx.fillStyle = gt;
    ctx.fillRect(0, 0, 1400, 190);
    drawLogo(ctx, 1114, 52, 90, 'neg');
    drawWordmark(ctx, R, 115, 110, 385, { greenIt: st.greenIt, glow: true, tagline: true, taglineColor: '#ddd' });

    ctx.save();
    setShadow(ctx, R, true, 25);
    text(ctx, (st.affiliation || '').toLocaleUpperCase('pl-PL'), 117, 182, { weight: 300, size: 25, color: '#fff' });
    text(ctx, speakerList(st).join(', ').toLocaleUpperCase('pl-PL'), 117, 226, { weight: 700, size: 26, color: '#fff' });
    ctx.restore();

    const pl = placeLines(st);
    let fit;
    for (let s = 46 * st.titleScale; s >= 22; s -= 1) {
      fit = fitRich(ctx, st.title, { weight: 700, size: s, minSize: s, lh: 1.13, maxW: 600, upper: st.titleUpper });
      if (278 + (fit.lines.length - 1) * fit.lh + 73 + 30 + 53 + (pl.length - 1) * 29 <= 570) break;
    }
    const last = drawRich(ctx, R, fit, 115, 278, { align: 'left', color: '#fff', shadow: true });
    ctx.save();
    setShadow(ctx, R, true, 25);
    let y = last + 73;
    text(ctx, dateStr(st), 117, y, { weight: 900, size: 28, color: '#fff' });
    text(ctx, timeStr(st, true), 117, y + 30, { size: 25, color: '#fff' });
    lines(ctx, pl, 117, y + 83, 29, { size: 25, color: '#fff' });
    ctx.restore();

    qrs(st, 'rev').forEach((it, i) => qrItem(ctx, it, 185 + i * 281, 208 + i * 277, 607, 66, { labelSize: 25, labelWeight: 700, color: '#fff' }));
  }

  // =====================================================================
  //  SZABLON: BLOKOWY (prostokątny nagłówek, jasny pas pod tytułem)
  // =====================================================================
  const BLOCK_BLUE = '#0b3fe6';

  function blockPortrait(ctx, R) {
    const st = R.st;
    rect(ctx, 0, 0, 990, 1400, st.bgColor);
    drawPhoto(ctx, R, { x: 0, y: 0, w: 990, h: 1400 });

    const fit = fitRich(ctx, st.title, { weight: 900, size: 58 * st.titleScale, minSize: 28, lh: 1.33, maxW: 820, maxH: 4 * 77 * st.titleScale, upper: st.titleUpper });
    const firstBl = 310;
    const lastBl = firstBl + (fit.lines.length - 1) * fit.lh;
    const spBl = lastBl + Math.max(48, fit.size * 1.1);
    if (st.band) {
      rect(ctx, 0, 232, 990, spBl + 38 - 232, `rgba(255,255,255,${st.bandOpacity})`);
      // jasna poświata pod blokiem daty / QR, żeby ciemny tekst był czytelny
      const g = ctx.createLinearGradient(0, 1110, 0, 1190);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, `rgba(255,255,255,${Math.min(1, st.bandOpacity + 0.15)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 1110, 990, 290);
    }

    rect(ctx, 0, 0, 366, 218, '#ffffff');
    rect(ctx, 366, 0, 624, 218, BLOCK_BLUE);
    drawUmk(ctx, 103, 108, 0.83);
    drawWordmark(ctx, R, 476, 125, 410, { greenIt: st.greenIt, tagline: true });

    const light = titleLight(st, false);
    const tc = light ? '#fff' : '#111';
    drawRich(ctx, R, fit, 495, firstBl, { align: 'center', color: tc, shadow: light });
    const sp = names(st) + (st.affiliation ? ` (${st.affiliation})` : '');
    ctx.save();
    setShadow(ctx, R, light, 30);
    text(ctx, sp, 495, spBl, { weight: 900, size: 30, italic: true, color: tc, align: 'center' });
    ctx.restore();

    const dc = st.titleColor === 'light' ? '#fff' : '#111';
    ctx.save();
    setShadow(ctx, R, st.titleColor === 'light', 26);
    text(ctx, dateStr(st) + (timeStr(st) ? ',' : ''), 512, 1205, { weight: 900, size: 26, color: dc });
    text(ctx, timeStr(st), 512, 1235, { weight: 900, size: 26, color: dc });
    lines(ctx, placeLines(st), 512, 1282, 23, { weight: 700, size: 22, color: dc });
    qrs(st, 'rev').forEach((it, i) => qrItem(ctx, it, 187 + i * 211, 205 + i * 205, 1265, 56, { labelSize: 20, labelWeight: 900, color: dc }));
    ctx.restore();
  }

  function blockBanner(ctx, R) {
    const st = R.st;
    rect(ctx, 0, 0, 1400, 735, st.bgColor);
    drawPhoto(ctx, R, { x: 0, y: 0, w: 1400, h: 735 });
    if (st.band) {
      const g = ctx.createLinearGradient(0, 0, 980, 0);
      g.addColorStop(0, `rgba(255,255,255,${st.bandOpacity})`);
      g.addColorStop(0.65, `rgba(255,255,255,${st.bandOpacity * 0.85})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 178, 1400, 557);
    }
    rect(ctx, 0, 0, 650, 178, BLUE);
    rect(ctx, 650, 0, 750, 178, 'rgba(2,76,161,0.6)');
    drawLogo(ctx, 60, 52, 78, 'neg');
    drawWordmark(ctx, R, 318, 108, 296, { greenIt: st.greenIt, tagline: true });

    qrs(st, 'rev').forEach((it, i) => qrItem(ctx, it, 964 + i * 280, 990 + i * 280, 52, 70, { labelSize: 25, labelWeight: 900, color: '#fff' }));

    const light = titleLight(st, false);
    const tc = light ? '#fff' : '#111';
    const pl = placeLines(st);
    const sp = names(st) + (st.affiliation ? ` (${st.affiliation})` : '');
    ctx.save();
    setShadow(ctx, R, light, 26);
    text(ctx, sp, 115, 244, { weight: 900, size: 26, color: tc });
    ctx.restore();
    let fit;
    for (let s = 46 * st.titleScale; s >= 22; s -= 1) {
      fit = fitRich(ctx, st.title, { weight: 900, size: s, minSize: s, lh: 1.13, maxW: 640, upper: st.titleUpper });
      if (292 + (fit.lines.length - 1) * fit.lh + 79 + 30 + 52 + (pl.length - 1) * 28 <= 680) break;
    }
    const last = drawRich(ctx, R, fit, 115, 292, { align: 'left', color: tc, shadow: light });
    ctx.save();
    setShadow(ctx, R, light, 26);
    const y = last + 79;
    text(ctx, dateStr(st), 115, y, { weight: 900, size: 30, color: tc });
    text(ctx, timeStr(st, true), 115, y + 30, { size: 25, color: tc });
    lines(ctx, pl, 115, y + 82, 28, { size: 25, color: tc });
    ctx.restore();
  }

  // =====================================================================
  //  NOWE PROPOZYCJE
  // =====================================================================
  const NAVY = '#01214f';
  const WEEKDAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];

  function dateParts(st) {
    if (!st.date) return null;
    const [y, m, d] = st.date.split('-').map(Number);
    return {
      d, m, y,
      dd: String(d).padStart(2, '0'),
      mm: String(m).padStart(2, '0'),
      month: MONTHS[m - 1],
      weekday: WEEKDAYS[new Date(y, m - 1, d).getDay()],
    };
  }

  function roundRect(ctx, x, y, w, h, r, fill) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function clipPoly(ctx, pts) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.clip();
  }

  /** Kod QR z podpisem pod spodem (dla nowych szablonów). */
  function qrTile(ctx, q, x, y, size, color) {
    drawQR(ctx, q.url, x, y, size, 0.07);
    const cx = x + size / 2;
    text(ctx, (q.label || '').replace(/:\s*$/, ''), cx, y + size + size * 0.22, { weight: 900, size: size * 0.15, color, align: 'center' });
    text(ctx, q.text, cx, y + size + size * 0.4, { weight: 400, size: size * 0.14, color, align: 'center' });
  }

  function fitTitleUntil(ctx, st, o, maxBottom, extra) {
    let fit;
    for (let s = o.size; s >= o.minSize; s -= 1) {
      fit = fitRich(ctx, st.title, Object.assign({}, o, { size: s, minSize: s, upper: st.titleUpper }));
      if (o.top + (fit.lines.length - 1) * fit.lh + extra(fit) <= maxBottom) break;
    }
    return fit;
  }

  /** Kolor c użyty jako tekst na jasnym papierze – zbyt jasny jest przyciemniany. */
  function onPaper(c) { return isLight(c) ? mix(c, '#000', 0.6) : c; }

  /** Tekst na tle bg w akcentach (pigułka z datą, plakietka) – granat albo biel. */
  function inkOn(bg) { return isLight(bg) ? NAVY : '#fff'; }

  /** „Imię Nazwisko  ·  Firma” – nazwiska pogrubione, afiliacja cieńsza; całość zmniejszana do maxW. */
  function speakerLine(ctx, st, x, y, o) {
    const sps = names(st);
    if (!sps) return;
    const aff = st.affiliation ? (o.sep || '  ·  ') + st.affiliation : '';
    const as = o.size * 0.93;
    ctx.font = font(900, o.size);
    const w1 = ctx.measureText(sps).width;
    ctx.font = font(o.affWeight || 300, as);
    const w2 = ctx.measureText(aff).width;
    const s = Math.min(1, o.maxW / (w1 + w2));
    text(ctx, sps, x, y, { weight: 900, size: o.size * s, color: o.color });
    if (aff) text(ctx, aff, x + w1 * s, y, { weight: o.affWeight || 300, size: as * s, color: o.affColor });
  }

  // ---------- NOWOCZESNY ----------
  function modernPortrait(ctx, R) {
    const st = R.st;
    const P = st.primary, H = st.highlight, on = onColor(P);
    rect(ctx, 0, 0, 990, 1400, P);
    ctx.save();
    clipPoly(ctx, [[0, 0], [990, 0], [990, 760], [0, 880]]);
    rect(ctx, 0, 0, 990, 880, st.bgColor);
    drawPhoto(ctx, R, { x: 0, y: 0, w: 990, h: 880 });
    ctx.restore();
    poly(ctx, [[0, 880], [990, 760], [990, 774], [0, 894]], H);

    poly(ctx, [[0, 0], [415, 0], [385, 192], [0, 192]], '#fff');
    drawLogo(ctx, 60, 60, 92);
    poly(ctx, [[600, 0], [990, 0], [990, 172], [574, 172]], P);
    drawWordmark(ctx, R, 640, 116, 290, { greenIt: st.greenIt, color: on.fg });

    const sps = names(st);
    const fit = fitTitleUntil(ctx, st, { top: 965, size: 66 * st.titleScale, minSize: 30, lh: 1.04, maxW: 850, weight: 900 }, 1150,
      () => (sps ? 58 : 0));
    const last = drawRich(ctx, R, fit, 70, 965, { align: 'left', color: on.fg });
    speakerLine(ctx, st, 72, last + 58, { size: 30, color: H, affColor: on.fg, maxW: 850 });

    rect(ctx, 70, 1192, 850, 2, on.line);
    const dp = dateParts(st);
    if (dp) {
      text(ctx, String(dp.d), 66, 1318, { weight: 900, size: 110, color: on.fg });
      ctx.font = font(900, 110);
      const dx = 66 + ctx.measureText(String(dp.d)).width + 18;
      text(ctx, `${dp.month} ${dp.y}`, dx, 1263, { weight: 900, size: 28, color: on.fg });
      text(ctx, dp.weekday, dx, 1291, { weight: 400, size: 22, color: on.muted });
      text(ctx, timeStr(st, true), dx, 1316, { weight: 400, size: 22, color: on.muted });
    }
    lines(ctx, placeLines(st), 445, 1261, 26, { weight: 400, size: 21, color: on.muted });
    const q = qrs(st);
    q.forEach((it, i) => qrTile(ctx, it, 920 - (q.length - i) * 92 + 12, 1222, 80, on.fg));
  }

  function modernBanner(ctx, R) {
    const st = R.st;
    const P = st.primary, H = st.highlight, on = onColor(P);
    rect(ctx, 0, 0, 1400, 735, P);
    ctx.save();
    clipPoly(ctx, [[660, 0], [1400, 0], [1400, 735], [540, 735]]);
    rect(ctx, 540, 0, 860, 735, st.bgColor);
    drawPhoto(ctx, R, { x: 540, y: 0, w: 860, h: 735 });
    ctx.restore();
    poly(ctx, [[646, 0], [660, 0], [540, 735], [526, 735]], H);
    poly(ctx, [[1060, 0], [1400, 0], [1400, 162], [1034, 162]], '#ffffff');
    drawLogo(ctx, 1114, 52, 90);

    drawWordmark(ctx, R, 70, 95, 270, { greenIt: st.greenIt, tagline: true, color: on.fg, taglineColor: on.muted });
    const sps = names(st);
    const fit = fitTitleUntil(ctx, st, { top: 215, size: 50 * st.titleScale, minSize: 24, lh: 1.08, maxW: 470, weight: 900 }, 545,
      () => (sps ? 50 : 0) + (st.affiliation ? 30 : 0));
    const last = drawRich(ctx, R, fit, 70, 215, { align: 'left', color: on.fg });
    if (sps) textFit(ctx, sps, 72, last + 50, 470, { weight: 900, size: 26, color: H });
    if (st.affiliation) textFit(ctx, st.affiliation, 72, last + 80, 470, { weight: 300, size: 23, color: on.fg });

    const dp = dateParts(st);
    if (dp) {
      text(ctx, String(dp.d), 66, 665, { weight: 900, size: 88, color: on.fg });
      ctx.font = font(900, 88);
      const dx = 66 + ctx.measureText(String(dp.d)).width + 14;
      text(ctx, `${dp.month} ${dp.y}`, dx, 622, { weight: 900, size: 24, color: on.fg });
      text(ctx, `${dp.weekday}, ${timeStr(st, true)}`, dx, 648, { size: 19, color: on.muted });
      textFit(ctx, placeOneLine(st), dx, 672, 500 - dx, { size: 16, color: on.muted });
    }
    const q = qrs(st);
    if (q.length) {
      const w = q.length * 96 + 14;
      const box = mix(P, '#000', 0.45);
      roundRect(ctx, 1340 - w, 535, w, 150, 12, rgba(box, 0.85));
      q.forEach((it, i) => qrTile(ctx, it, 1340 - w + 14 + i * 96, 549, 82, onColor(box).fg));
    }
  }

  // ---------- DUOTONE ----------
  const DUO = {
    bluegreen: ['#011a40', '#c8f07a'],
    blue: ['#011a40', '#8fd3ff'],
    mono: ['#141414', '#f2f2f2'],
    sunset: ['#2a0c4e', '#ff9a4a'],
    forest: ['#0c2a1c', '#d8f5a2'],
    berry: ['#3a0626', '#ffb3c7'],
  };

  function datePill(ctx, st, x, y, size, color, bg, maxW) {
    const dl = [dateStr(st), timeStr(st, true)].filter(Boolean).join('  ·  ');
    if (!dl) return 0;
    ctx.font = font(900, size);
    if (maxW && ctx.measureText(dl).width + size * 1.4 > maxW) {
      size *= maxW / (ctx.measureText(dl).width + size * 1.4);
      ctx.font = font(900, size);
    }
    const w = ctx.measureText(dl).width + size * 1.4;
    roundRect(ctx, x, y, w, size * 1.9, size * 0.95, bg);
    text(ctx, dl, x + size * 0.7, y + size * 1.3, { weight: 900, size, color });
    return w;
  }

  function duoPortrait(ctx, R) {
    const st = R.st;
    const D = st.duoDark, H = st.highlight;
    rect(ctx, 0, 0, 990, 1400, D);
    drawPhoto(ctx, R, { x: 0, y: 0, w: 990, h: 1400 }, true);
    const g = ctx.createLinearGradient(0, 560, 0, 1150);
    g.addColorStop(0, rgba(D, 0));
    g.addColorStop(1, rgba(D, 0.5 + st.shade * 0.5));
    ctx.fillStyle = g;
    ctx.fillRect(0, 560, 990, 840);
    const gt = ctx.createLinearGradient(0, 0, 0, 260);
    gt.addColorStop(0, rgba(D, 0.55));
    gt.addColorStop(1, rgba(D, 0));
    ctx.fillStyle = gt;
    ctx.fillRect(0, 0, 990, 260);

    drawWordmark(ctx, R, 70, 130, 360, { greenIt: st.greenIt, tagline: true, taglineColor: '#e6eef8' });
    drawUmk(ctx, 708, 108, 0.92, 'neg');

    const sp = names(st) + (st.affiliation ? `  ·  ${st.affiliation}` : '');
    const fit = fitRich(ctx, st.title, { weight: 900, size: 68 * st.titleScale, minSize: 30, lh: 1.04, maxW: 850, maxH: 4 * 72 * st.titleScale, upper: st.titleUpper });
    const lastBl = 1105;
    const firstBl = lastBl - (fit.lines.length - 1) * fit.lh;
    ctx.save();
    setShadow(ctx, R, true, 24);
    textFit(ctx, sp.toLocaleUpperCase('pl-PL'), 72, firstBl - fit.size * 1.05, 850, { weight: 900, size: 24, color: H });
    ctx.restore();
    drawRich(ctx, R, fit, 70, firstBl, { align: 'left', color: '#fff', shadow: true });

    datePill(ctx, st, 70, 1150, 26, inkOn(H), H);
    lines(ctx, placeLines(st), 72, 1268, 25, { weight: 400, size: 21, color: '#e6eef8' });
    const q = qrs(st);
    q.forEach((it, i) => qrTile(ctx, it, 920 - (q.length - i) * 94 + 14, 1222, 80, '#fff'));
  }

  function duoBanner(ctx, R) {
    const st = R.st;
    const D = st.duoDark, H = st.highlight;
    rect(ctx, 0, 0, 1400, 735, D);
    drawPhoto(ctx, R, { x: 0, y: 0, w: 1400, h: 735 }, true);
    const g = ctx.createLinearGradient(0, 0, 1000, 0);
    g.addColorStop(0, rgba(D, 0.55 + st.shade * 0.45));
    g.addColorStop(0.6, rgba(D, 0.35 + st.shade * 0.4));
    g.addColorStop(1, rgba(D, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1400, 735);

    const gt = ctx.createLinearGradient(0, 0, 0, 200);
    gt.addColorStop(0, rgba(D, 0.6));
    gt.addColorStop(1, rgba(D, 0));
    ctx.fillStyle = gt;
    ctx.fillRect(0, 0, 1400, 200);
    drawLogo(ctx, 1106, 52, 90, 'neg');
    drawWordmark(ctx, R, 70, 95, 270, { greenIt: st.greenIt, tagline: true, taglineColor: '#e6eef8' });
    const sp = names(st) + (st.affiliation ? `  ·  ${st.affiliation}` : '');
    ctx.save();
    setShadow(ctx, R, true, 22);
    textFit(ctx, sp.toLocaleUpperCase('pl-PL'), 72, 210, 900, { weight: 900, size: 22, color: H });
    ctx.restore();
    const fit = fitTitleUntil(ctx, st, { top: 268, size: 54 * st.titleScale, minSize: 24, lh: 1.06, maxW: 700, weight: 900 }, 545, () => 0);
    drawRich(ctx, R, fit, 70, 268, { align: 'left', color: '#fff', shadow: true });
    datePill(ctx, st, 70, 585, 23, inkOn(H), H);
    textFit(ctx, placeOneLine(st), 72, 676, 1000, { size: 19, color: '#e6eef8' });
    const q = qrs(st);
    q.forEach((it, i) => qrTile(ctx, it, 1340 - (q.length - i) * 94 + 14, 560, 80, '#fff'));
  }

  // ---------- MINIMALNY ----------
  const PAPER = '#fbfbf7';

  function minimalPortrait(ctx, R) {
    const st = R.st;
    const P = st.primary, H = st.highlight, T = onPaper(P);
    rect(ctx, 0, 0, 990, 1400, PAPER);
    rect(ctx, 60, 60, 340, 92, P);
    drawWordmark(ctx, R, 82, 122, 296, { greenIt: st.greenIt, color: onColor(P).fg });
    drawUmk(ctx, 692, 106, 0.85);

    const dp = dateParts(st);
    if (dp) {
      text(ctx, `${dp.dd}.${dp.mm}`, 60, 410, { weight: 900, size: 200, color: T });
      text(ctx, `${dp.weekday}, ${dp.d} ${dp.month} ${dp.y}`, 62, 466, { weight: 700, size: 28, color: '#111' });
      text(ctx, timeStr(st), 62, 500, { weight: 400, size: 26, color: '#444' });
    }

    rect(ctx, 76, 538, 854, 430, H);
    rect(ctx, 60, 522, 854, 430, st.bgColor);
    drawPhoto(ctx, R, { x: 60, y: 522, w: 854, h: 430 });

    const sps = names(st);
    const fit = fitTitleUntil(ctx, st, { top: 1046, size: 58 * st.titleScale, minSize: 26, lh: 1.06, maxW: 870, weight: 900 }, 1196,
      () => (sps ? 50 : 0));
    const last = drawRich(ctx, R, fit, 60, 1046, { align: 'left', color: '#111' });
    speakerLine(ctx, st, 62, last + 50, { size: 28, color: T, affColor: '#555', affWeight: 400, sep: '  —  ', maxW: 870 });

    rect(ctx, 60, 1226, 870, 3, '#111');
    const pl = placeLines(st);
    const pl2 = pl.length > 2 ? [pl.slice(0, -1).join(' '), pl[pl.length - 1]] : pl;
    lines(ctx, pl2, 60, 1268, 25, { weight: 400, size: 20, color: '#333' });
    const q = qrs(st);
    q.forEach((it, i) => qrTile(ctx, it, 930 - (q.length - i) * 82 + 16, 1242, 66, '#333'));
  }

  function minimalBanner(ctx, R) {
    const st = R.st;
    const P = st.primary, H = st.highlight, T = onPaper(P);
    rect(ctx, 0, 0, 1400, 735, PAPER);
    rect(ctx, 936, 66, 388, 600, H);
    rect(ctx, 920, 50, 388, 600, st.bgColor);
    drawPhoto(ctx, R, { x: 920, y: 50, w: 388, h: 600 });

    rect(ctx, 60, 58, 280, 76, P);
    drawWordmark(ctx, R, 78, 110, 244, { greenIt: st.greenIt, color: onColor(P).fg });
    drawLogo(ctx, 384, 50, 90);
    const dp = dateParts(st);
    if (dp) {
      text(ctx, `${dp.dd}.${dp.mm}`, 60, 275, { weight: 900, size: 128, color: T });
      ctx.font = font(900, 128);
      const dx = 60 + ctx.measureText(`${dp.dd}.${dp.mm}`).width + 26;
      text(ctx, `${dp.weekday}, ${dp.d} ${dp.month} ${dp.y}`, dx, 232, { weight: 700, size: 24, color: '#111' });
      text(ctx, timeStr(st), dx, 266, { weight: 400, size: 22, color: '#444' });
    }
    const sps = names(st);
    const fit = fitTitleUntil(ctx, st, { top: 360, size: 46 * st.titleScale, minSize: 22, lh: 1.08, maxW: 800, weight: 900 }, 560,
      () => (sps ? 44 : 0));
    const last = drawRich(ctx, R, fit, 60, 360, { align: 'left', color: '#111' });
    if (sps) textFit(ctx, sps + (st.affiliation ? `  —  ${st.affiliation}` : ''), 62, last + 44, 800, { weight: 900, size: 24, color: T });

    rect(ctx, 60, 590, 820, 3, '#111');
    textFit(ctx, placeOneLine(st), 60, 630, 680, { size: 18, color: '#333' });
    const q = qrs(st);
    q.forEach((it, i) => qrTile(ctx, it, 880 - (q.length - i) * 66 + 12, 604, 54, '#333'));
  }

  // ---------- KOŁO (zdjęcie w kole, data na plakietce) ----------
  function photoCircle(ctx, R, cx, cy, r, slot = 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    rect(ctx, cx - r, cy - r, 2 * r, 2 * r, R.st.bgColor);
    drawPhoto(ctx, R, { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r }, false, slot, {
      hit: (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r,
      label: { x: cx, y: cy },
    });
    ctx.restore();
  }

  function ring(ctx, cx, cy, r, a0, a1, width, color) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1);
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();
  }

  /** Okrągła plakietka: dzień tygodnia / duży dzień / miesiąc i rok. */
  function dateBadge(ctx, st, cx, cy, r, bg) {
    const dp = dateParts(st);
    if (!dp) return;
    const c = inkOn(bg);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();
    text(ctx, dp.weekday, cx, cy - r * 0.42, { weight: 700, size: r * 0.17, color: c, align: 'center' });
    text(ctx, String(dp.d), cx, cy + r * 0.3, { weight: 900, size: r * 0.9, color: c, align: 'center' });
    textFit(ctx, `${dp.month} ${dp.y}`, cx, cy + r * 0.6, r * 1.45, { weight: 700, size: r * 0.19, color: c, align: 'center' });
  }

  function circlePortrait(ctx, R) {
    const st = R.st;
    const P = st.primary, H = st.highlight, on = onColor(P);
    rect(ctx, 0, 0, 990, 1400, P);
    ring(ctx, 600, 520, 440, -2.6, 0.9, 14, H);
    photoCircle(ctx, R, 600, 520, 400);
    dateBadge(ctx, st, 205, 800, 150, H);
    drawLogo(ctx, 60, 60, 90, on.logo);

    const fit = fitTitleUntil(ctx, st, { top: 1035, size: 62 * st.titleScale, minSize: 28, lh: 1.05, maxW: 850, weight: 900 }, 1180,
      () => (names(st) ? 52 : 0));
    const last = drawRich(ctx, R, fit, 70, 1035, { align: 'left', color: on.fg });
    speakerLine(ctx, st, 72, last + 52, { size: 28, color: H, affColor: on.fg, maxW: 850 });

    rect(ctx, 70, 1236, 850, 2, on.line);
    drawWordmark(ctx, R, 70, 1306, 250, { greenIt: st.greenIt, tagline: true, color: on.fg, taglineColor: on.muted });
    text(ctx, timeStr(st, true), 372, 1284, { weight: 900, size: 22, color: on.fg });
    lines(ctx, placeLines(st), 372, 1314, 24, { size: 19, color: on.muted });
    const q = qrs(st);
    q.forEach((it, i) => qrTile(ctx, it, 920 - (q.length - i) * 92 + 12, 1262, 78, on.fg));
  }

  function circleBanner(ctx, R) {
    const st = R.st;
    const P = st.primary, H = st.highlight, on = onColor(P);
    rect(ctx, 0, 0, 1400, 735, P);
    ring(ctx, 1060, 368, 362, -2.5, 1.0, 12, H);
    photoCircle(ctx, R, 1060, 368, 330);
    dateBadge(ctx, st, 770, 590, 108, H);
    drawLogo(ctx, 60, 50, 76, on.logo);
    drawWordmark(ctx, R, 320, 100, 230, { greenIt: st.greenIt, color: on.fg });

    const fit = fitTitleUntil(ctx, st, { top: 238, size: 50 * st.titleScale, minSize: 24, lh: 1.07, maxW: 580, weight: 900 }, 505,
      () => (names(st) ? 46 : 0));
    const last = drawRich(ctx, R, fit, 60, 238, { align: 'left', color: on.fg });
    speakerLine(ctx, st, 62, last + 46, { size: 25, color: H, affColor: on.fg, maxW: 580 });

    const q = qrs(st);
    const qx = 640 - q.length * 84;
    text(ctx, timeStr(st, true), 62, 594, { weight: 900, size: 23, color: on.fg });
    textFit(ctx, placeOneLine(st), 62, 626, qx - 82, { size: 19, color: on.muted });
    q.forEach((it, i) => qrTile(ctx, it, qx + 14 + i * 84, 548, 66, on.fg));
  }

  // ---------- TYPOGRAFICZNY (wielki tytuł, siatka) ----------
  function swissPortrait(ctx, R) {
    const st = R.st;
    const P = st.primary, H = st.highlight, T = onPaper(P);
    rect(ctx, 0, 0, 990, 1400, PAPER);
    drawLogo(ctx, 60, 54, 84);
    drawWordmark(ctx, R, 650, 116, 280, { greenIt: st.greenIt, color: T });
    rect(ctx, 60, 176, 870, 3, '#111');

    const fit = fitTitleUntil(ctx, st, { top: 312, size: 112 * st.titleScale, minSize: 36, lh: 0.98, maxW: 870, weight: 900 }, 700,
      () => (names(st) ? 66 : 0) + (st.affiliation ? 40 : 0));
    const last = drawRich(ctx, R, fit, 56, 312, { align: 'left', color: '#111' });
    if (names(st)) textFit(ctx, names(st), 60, last + 66, 870, { weight: 900, size: 36, color: T });
    if (st.affiliation) textFit(ctx, st.affiliation, 60, last + (names(st) ? 106 : 66), 870, { weight: 400, size: 30, color: '#444' });

    rect(ctx, 495, 790, 495, 610, st.bgColor);
    drawPhoto(ctx, R, { x: 495, y: 790, w: 495, h: 610 });
    rect(ctx, 455, 750, 80, 80, H);

    rect(ctx, 60, 790, 380, 3, '#111');
    const dp = dateParts(st);
    if (dp) {
      textFit(ctx, `${dp.dd}.${dp.mm}`, 52, 968, 390, { weight: 900, size: 150, color: T });
      textFit(ctx, `${dp.weekday}, ${dp.d} ${dp.month} ${dp.y}`, 60, 1024, 390, { weight: 700, size: 24, color: '#111' });
    }
    textFit(ctx, timeStr(st), 60, 1058, 390, { size: 24, color: '#444' });
    lines(ctx, placeLines(st), 60, 1112, 26, { size: 21, color: '#333' });
    qrs(st).forEach((it, i) => qrTile(ctx, it, 60 + i * 104, 1236, 80, '#333'));
  }

  function swissBanner(ctx, R) {
    const st = R.st;
    const P = st.primary, H = st.highlight, T = onPaper(P);
    rect(ctx, 0, 0, 1400, 735, PAPER);
    rect(ctx, 990, 0, 410, 735, st.bgColor);
    drawPhoto(ctx, R, { x: 990, y: 0, w: 410, h: 735 });
    rect(ctx, 952, 40, 76, 76, H);

    drawLogo(ctx, 60, 44, 70);
    drawWordmark(ctx, R, 660, 96, 240, { greenIt: st.greenIt, color: T });
    rect(ctx, 60, 140, 870, 3, '#111');

    const fit = fitTitleUntil(ctx, st, { top: 248, size: 72 * st.titleScale, minSize: 28, lh: 1.0, maxW: 860, weight: 900 }, 505,
      () => (names(st) ? 48 : 0));
    const last = drawRich(ctx, R, fit, 57, 248, { align: 'left', color: '#111' });
    speakerLine(ctx, st, 60, last + 48, { size: 28, color: T, affColor: '#444', affWeight: 400, sep: '  —  ', maxW: 860 });

    rect(ctx, 60, 540, 870, 3, '#111');
    const q = qrs(st);
    const qx = 930 - q.length * 80;
    let dx = 60;
    const dp = dateParts(st);
    if (dp) {
      text(ctx, `${dp.dd}.${dp.mm}`, 55, 660, { weight: 900, size: 92, color: T });
      ctx.font = font(900, 92);
      dx = 55 + ctx.measureText(`${dp.dd}.${dp.mm}`).width + 24;
      textFit(ctx, `${dp.weekday}, ${dp.d} ${dp.month} ${dp.y}`, dx, 598, qx - dx - 10, { weight: 700, size: 23, color: '#111' });
    }
    textFit(ctx, timeStr(st), dx, 630, qx - dx - 10, { size: 21, color: '#444' });
    textFit(ctx, placeOneLine(st), dx, 660, qx - dx - 10, { size: 18, color: '#333' });
    q.forEach((it, i) => qrTile(ctx, it, qx + 16 + i * 80, 566, 64, '#333'));
  }

  // ---------- RAMKA (zdjęcie w ramie, biała karta z treścią) ----------
  function card(ctx, R, x, y, w, h, bar) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 40 * R.k;
    ctx.shadowOffsetY = 10 * R.k;
    rect(ctx, x, y, w, h, '#fff');
    ctx.restore();
    rect(ctx, x, y, w, 12, bar);
  }

  function framePortrait(ctx, R) {
    const st = R.st;
    const P = st.primary, H = st.highlight, on = onColor(P);
    rect(ctx, 0, 0, 990, 1400, P);
    rect(ctx, 40, 40, 910, 1030, st.bgColor);
    drawPhoto(ctx, R, { x: 40, y: 40, w: 910, h: 1030 });
    rect(ctx, 40, 40, 320, 140, '#fff');
    drawLogo(ctx, 72, 66, 88);
    rect(ctx, 610, 40, 340, 124, P);
    drawWordmark(ctx, R, 642, 120, 280, { greenIt: st.greenIt, color: on.fg });

    card(ctx, R, 90, 890, 810, 440, H);
    const fit = fitTitleUntil(ctx, st, { top: 975, size: 54 * st.titleScale, minSize: 26, lh: 1.06, maxW: 720, weight: 900 }, 1152,
      () => (names(st) ? 46 : 0));
    const last = drawRich(ctx, R, fit, 135, 975, { align: 'left', color: '#111' });
    speakerLine(ctx, st, 136, last + 46, { size: 26, color: onPaper(P), affColor: '#555', affWeight: 400, maxW: 720 });

    rect(ctx, 135, 1196, 720, 2, '#e3e3e3');
    const q = qrs(st);
    const qx = 855 - q.length * 80;
    textFit(ctx, dateStr(st), 135, 1240, 310, { weight: 900, size: 24, color: '#111' });
    textFit(ctx, timeStr(st), 135, 1270, 310, { size: 22, color: '#444' });
    placeLines(st).forEach((s, i) => textFit(ctx, s, 465, 1236 + i * 24, qx - 475, { size: 19, color: '#444' }));
    q.forEach((it, i) => qrTile(ctx, it, qx + 16 + i * 80, 1222, 64, '#333'));

    text(ctx, 'MATEMATYKA  ·  ANALIZA DANYCH  ·  INFORMATYKA', 495, 1373, { weight: 700, size: 17, color: on.muted, align: 'center' });
  }

  function frameBanner(ctx, R) {
    const st = R.st;
    const P = st.primary, H = st.highlight, on = onColor(P);
    rect(ctx, 0, 0, 1400, 735, P);
    rect(ctx, 30, 30, 1340, 675, st.bgColor);
    drawPhoto(ctx, R, { x: 30, y: 30, w: 1340, h: 675 });
    rect(ctx, 1030, 30, 340, 112, P);
    drawWordmark(ctx, R, 1062, 104, 276, { greenIt: st.greenIt, color: on.fg });

    card(ctx, R, 60, 60, 640, 615, H);
    drawLogo(ctx, 96, 100, 70);
    const fit = fitTitleUntil(ctx, st, { top: 262, size: 44 * st.titleScale, minSize: 22, lh: 1.08, maxW: 568, weight: 900 }, 472,
      () => (names(st) ? 42 : 0));
    const last = drawRich(ctx, R, fit, 96, 262, { align: 'left', color: '#111' });
    speakerLine(ctx, st, 97, last + 42, { size: 23, color: onPaper(P), affColor: '#555', affWeight: 400, maxW: 568 });

    rect(ctx, 96, 512, 568, 2, '#e3e3e3');
    const q = qrs(st);
    const qx = 664 - q.length * 76;
    textFit(ctx, dateStr(st), 96, 552, qx - 106, { weight: 900, size: 22, color: '#111' });
    textFit(ctx, timeStr(st), 96, 580, qx - 106, { size: 20, color: '#444' });
    textFit(ctx, placeOneLine(st), 96, 608, qx - 106, { size: 17, color: '#444' });
    q.forEach((it, i) => qrTile(ctx, it, qx + 14 + i * 76, 530, 62, '#333'));
  }

  // ---------- POLAROID (przekrzywione zdjęcie z taśmą) ----------
  function stripes(ctx, w, h, color) {
    ctx.save();
    ctx.fillStyle = color;
    for (let x = -h; x < w; x += 120) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 50, 0);
      ctx.lineTo(x + 50 + h, h);
      ctx.lineTo(x + h, h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** Odbitka w×h o środku (cx, cy), obrócona o angle; pod zdjęciem podpis z prelegentami. */
  function polaroid(ctx, R, cx, cy, w, h, pad, capH, angle, tapeColor) {
    const st = R.st;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 36 * R.k;
    ctx.shadowOffsetY = 14 * R.k;
    rect(ctx, -w / 2, -h / 2, w, h, '#fbfaf6');
    ctx.restore();
    const ph = { x: -w / 2 + pad, y: -h / 2 + pad, w: w - 2 * pad, h: h - pad - capH };
    rect(ctx, ph.x, ph.y, ph.w, ph.h, st.bgColor);
    drawPhoto(ctx, R, ph);
    R.areas[R.areas.length - 1].rect = { x: cx + ph.x, y: cy + ph.y, w: ph.w, h: ph.h }; // przybliżenie (bez obrotu)
    const cap = ph.y + ph.h;
    const s = capH / 120;
    const aff = st.affiliation;
    textFit(ctx, names(st), 0, cap + capH * (aff ? 0.46 : 0.58), ph.w, { weight: 900, size: 34 * s, italic: true, color: '#1d1d1d', align: 'center' });
    if (aff) textFit(ctx, aff, 0, cap + capH * 0.76, ph.w, { size: 21 * s, color: '#666', align: 'center' });
    ctx.rotate(0.07);
    ctx.globalAlpha = 0.85;
    rect(ctx, -w * 0.12, -h / 2 - 24 * s, w * 0.24, 46 * s, tapeColor);
    ctx.restore();
  }

  function polaroidPortrait(ctx, R) {
    const st = R.st;
    const P = st.primary, H = st.highlight, on = onColor(P);
    rect(ctx, 0, 0, 990, 1400, P);
    stripes(ctx, 990, 1400, on.tex);
    drawLogo(ctx, 60, 56, 84, on.logo);
    drawWordmark(ctx, R, 650, 118, 280, { greenIt: st.greenIt, color: on.fg });
    polaroid(ctx, R, 495, 620, 700, 790, 30, 120, -0.06, H);

    const fit = fitTitleUntil(ctx, st, { top: 1122, size: 58 * st.titleScale, minSize: 26, lh: 1.05, maxW: 850, weight: 900 }, 1240, () => 0);
    drawRich(ctx, R, fit, 70, 1122, { align: 'left', color: on.fg });

    rect(ctx, 70, 1268, 850, 2, on.line);
    const q = qrs(st);
    const qx = 920 - q.length * 90;
    const dp = dateParts(st);
    textFit(ctx, dp ? `${dp.weekday}, ${dateStr(st)}` : '', 70, 1310, qx - 90, { weight: 900, size: 26, color: on.fg });
    textFit(ctx, timeStr(st), 70, 1342, qx - 90, { size: 22, color: on.muted });
    textFit(ctx, placeOneLine(st), 70, 1372, qx - 90, { size: 19, color: on.muted });
    q.forEach((it, i) => qrTile(ctx, it, qx + 18 + i * 90, 1286, 68, on.fg));
  }

  function polaroidBanner(ctx, R) {
    const st = R.st;
    const P = st.primary, H = st.highlight, on = onColor(P);
    rect(ctx, 0, 0, 1400, 735, P);
    stripes(ctx, 1400, 735, on.tex);
    polaroid(ctx, R, 1060, 372, 430, 560, 22, 92, 0.05, H);
    drawLogo(ctx, 60, 50, 74, on.logo);
    drawWordmark(ctx, R, 320, 100, 230, { greenIt: st.greenIt, color: on.fg });

    const fit = fitTitleUntil(ctx, st, { top: 240, size: 52 * st.titleScale, minSize: 24, lh: 1.07, maxW: 700, weight: 900 }, 485, () => 0);
    drawRich(ctx, R, fit, 60, 240, { align: 'left', color: on.fg });

    rect(ctx, 60, 518, 730, 2, on.line);
    const q = qrs(st);
    const qx = 790 - q.length * 82;
    textFit(ctx, dateStr(st), 60, 564, qx - 80, { weight: 900, size: 24, color: on.fg });
    textFit(ctx, timeStr(st), 60, 596, qx - 80, { size: 22, color: on.muted });
    textFit(ctx, placeOneLine(st), 60, 628, qx - 80, { size: 18, color: on.muted });
    q.forEach((it, i) => qrTile(ctx, it, qx + 16 + i * 82, 542, 66, on.fg));
  }

  // ---------- GRADIENT (zdjęcie barwione gradientem, półprzezroczysta karta) ----------
  /** Zdjęcie w r zabarwione gradientem primary → highlight (tryb „color”, siła = st.tint). */
  function tintedPhoto(ctx, R, r) {
    const st = R.st;
    rect(ctx, r.x, r.y, r.w, r.h, st.bgColor);
    drawPhoto(ctx, R, r);
    if (st.tint <= 0) return;
    ctx.save();
    const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
    g.addColorStop(0, st.primary);
    g.addColorStop(1, st.highlight);
    ctx.globalCompositeOperation = 'color';
    ctx.globalAlpha = st.tint;
    ctx.fillStyle = g;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  function glassCard(ctx, x, y, w, h, r, st) {
    roundRect(ctx, x, y, w, h, r, rgba(mix(st.primary, '#000', 0.6), 0.3 + st.shade * 0.65));
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.stroke(); // ścieżka z roundRect
    ctx.restore();
  }

  function gradientPortrait(ctx, R) {
    const st = R.st;
    const H = st.highlight;
    tintedPhoto(ctx, R, { x: 0, y: 0, w: 990, h: 1400 });
    shadeV(ctx, 0, 0, 990, 260, 0.5, 260, 0);
    drawLogo(ctx, 60, 60, 92, 'neg');
    drawWordmark(ctx, R, 610, 122, 320, { greenIt: st.greenIt });

    glassCard(ctx, 60, 950, 870, 410, 28, st);
    const sp = names(st) + (st.affiliation ? `  ·  ${st.affiliation}` : '');
    textFit(ctx, sp.toLocaleUpperCase('pl-PL'), 102, 1012, 786, { weight: 900, size: 24, color: H });
    const fit = fitTitleUntil(ctx, st, { top: 1080, size: 56 * st.titleScale, minSize: 26, lh: 1.05, maxW: 786, weight: 900 }, 1222, () => 0);
    drawRich(ctx, R, fit, 100, 1080, { align: 'left', color: '#fff' });

    rect(ctx, 102, 1250, 786, 2, 'rgba(255,255,255,0.25)');
    const q = qrs(st);
    const qx = 890 - q.length * 76;
    textFit(ctx, dateStr(st), 102, 1292, 300, { weight: 900, size: 23, color: '#fff' });
    textFit(ctx, timeStr(st), 102, 1320, 300, { size: 21, color: '#e8eef8' });
    placeLines(st).forEach((s, i) => textFit(ctx, s, 420, 1290 + i * 23, qx - 426, { size: 18, color: '#e8eef8' }));
    q.forEach((it, i) => qrTile(ctx, it, qx + 14 + i * 76, 1264, 60, '#fff'));
  }

  function gradientBanner(ctx, R) {
    const st = R.st;
    const H = st.highlight;
    tintedPhoto(ctx, R, { x: 0, y: 0, w: 1400, h: 735 });
    shadeV(ctx, 760, 0, 640, 180, 0.5, 180, 0);
    drawLogo(ctx, 1120, 46, 84, 'neg');

    glassCard(ctx, 50, 50, 700, 635, 26, st);
    drawWordmark(ctx, R, 90, 126, 260, { greenIt: st.greenIt, tagline: true, taglineColor: '#e8eef8' });
    const sp = names(st) + (st.affiliation ? `  ·  ${st.affiliation}` : '');
    textFit(ctx, sp.toLocaleUpperCase('pl-PL'), 92, 228, 620, { weight: 900, size: 22, color: H });
    const fit = fitTitleUntil(ctx, st, { top: 288, size: 48 * st.titleScale, minSize: 22, lh: 1.07, maxW: 620, weight: 900 }, 472, () => 0);
    drawRich(ctx, R, fit, 90, 288, { align: 'left', color: '#fff' });

    rect(ctx, 92, 508, 620, 2, 'rgba(255,255,255,0.25)');
    const q = qrs(st);
    const qx = 712 - q.length * 78;
    textFit(ctx, dateStr(st), 92, 550, qx - 100, { weight: 900, size: 22, color: '#fff' });
    textFit(ctx, timeStr(st), 92, 578, qx - 100, { size: 20, color: '#e8eef8' });
    textFit(ctx, placeOneLine(st), 92, 608, qx - 100, { size: 17, color: '#e8eef8' });
    q.forEach((it, i) => qrTile(ctx, it, qx + 14 + i * 78, 528, 64, '#fff'));
  }

  // =====================================================================
  //  DWÓCH PRELEGENTÓW (jeden tytuł, dwa zdjęcia)
  // =====================================================================
  /** [{ name, aff }, { name, aff }] – prelegent 1 i 2. */
  function people(st) {
    return [
      { name: (st.speakers || '').split('\n')[0].trim(), aff: (st.affiliation || '').trim() },
      { name: (st.speaker2 || '').trim(), aff: (st.affiliation2 || '').trim() },
    ];
  }

  function pointInPoly(pts, x, y) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /** Zdjęcie ze slotu przycięte do wielokąta pts (prostokąt kadru = obwiednia wielokąta). */
  function photoIn(ctx, R, pts, slot, duo) {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const r = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    ctx.save();
    clipPoly(ctx, pts);
    rect(ctx, r.x, r.y, r.w, r.h, duo ? R.st.duoDark : R.st.bgColor);
    drawPhoto(ctx, R, r, duo, slot, {
      hit: (x, y) => pointInPoly(pts, x, y),
      label: { x: xs.reduce((a, b) => a + b, 0) / xs.length, y: r.y + r.h * 0.5 },
    });
    ctx.restore();
    return r;
  }

  /**
   * Plakietka z nazwiskiem i afiliacją. x – lewa (align left) lub prawa krawędź, y – góra (albo dół przy o.bottom).
   * o: { size, maxW, bg, color, affColor, align, bottom, upper }
   */
  function nameTag(ctx, p, x, y, o) {
    if (!p.name && !p.aff) return;
    const name = o.upper ? p.name.toLocaleUpperCase('pl-PL') : p.name;
    let ns = o.size, as = o.size * 0.72;
    const pad = o.bg ? o.size * 0.5 : 0;
    ctx.font = font(900, ns);
    const wn = ctx.measureText(name).width;
    ctx.font = font(400, as);
    const wa = p.aff ? ctx.measureText(p.aff).width : 0;
    const k = Math.min(1, (o.maxW - 2 * pad) / Math.max(1, wn, wa));
    ns *= k; as *= k;
    const w = Math.max(wn, wa) * k + 2 * pad;
    const h = 2 * pad + (name ? ns * 0.74 : 0) + (p.aff ? as * (name ? 1.45 : 0.74) : 0);
    const bx = o.align === 'right' ? x - w : x;
    const by = o.bottom ? y - h : y;
    if (o.bg) rect(ctx, bx, by, w, h, o.bg);
    const tx = o.align === 'right' ? bx + w - pad : bx + pad;
    const nb = by + pad + ns * 0.74;
    ctx.save();
    if (o.shadow) setShadow(ctx, o.R, true, ns);
    if (name) text(ctx, name, tx, nb, { weight: 900, size: ns, color: o.color, align: o.align });
    if (p.aff) text(ctx, p.aff, tx, name ? nb + as * 1.45 : by + pad + as * 0.74, { weight: o.affWeight || 400, size: as, color: o.affColor || o.color, align: o.align });
    ctx.restore();
  }

  /** Dwa nazwiska (z afiliacją) jako kolumny: lewa od x1, prawa wyrównana do x2. Zwraca wysokość bloku. */
  function namePair(ctx, R, st, x1, x2, nameBl, o) {
    const [a, b] = people(st);
    const half = (x2 - x1) / 2 - 20;
    ctx.save();
    if (o.shadow) setShadow(ctx, R, true, o.size);
    [[a, x1, 'left'], [b, x2, 'right']].forEach(([p, x, align]) => {
      if (p.name) textFit(ctx, o.upper ? p.name.toLocaleUpperCase('pl-PL') : p.name, x, nameBl, half, { weight: 900, size: o.size, color: o.color, align });
      if (p.aff) textFit(ctx, p.aff, x, nameBl + o.size * 1.2, half, { weight: 300, size: o.size * 0.85, color: o.affColor, align });
    });
    ctx.restore();
  }

  /** Data / godzina / miejsce i kody QR w dolnej części klasycznego plakatu (wspólne z szablonem Klasyczny). */
  function classicFooterPortrait(ctx, st) {
    text(ctx, dateStr(st), 140, 1214, { weight: 700, size: 20.5, family: 'arial' });
    text(ctx, timeStr(st), 140, 1236, { weight: 700, size: 20.5, family: 'arial' });
    lines(ctx, placeLines(st), 137, 1276, 20, { weight: 300, size: 19.5, color: '#222' });
    qrs(st).forEach((q, i) => qrItem(ctx, q, 765, 778, 1180 + i * 90, 62, { labelSize: 20, family: 'arial' }));
  }

  // ---------- KLASYCZNY ×2 ----------
  function duoClassicPortrait(ctx, R) {
    const st = R.st;
    rect(ctx, 0, 0, 990, 1400, st.bgColor);
    photoIn(ctx, R, [[0, 0], [540, 0], [450, 1400], [0, 1400]], 0);
    photoIn(ctx, R, [[540, 0], [990, 0], [990, 1400], [450, 1400]], 1);
    poly(ctx, [[536, 0], [544, 0], [454, 1400], [446, 1400]], '#ffffff');
    if (st.band) poly(ctx, [[0, 150], [990, 120], [990, 488], [930, 550], [0, 392]], st.accent, st.bandOpacity);

    poly(ctx, [[0, 0], [285, 0], [553, 219], [472, 276], [0, 200]], '#ffffff');
    poly(ctx, [[285, 0], [990, 0], [990, 164], [600, 257]], BLUE);
    poly(ctx, [[300, 1248], [610, 1152], [990, 1180], [990, 1400], [300, 1400]], st.accent);
    poly(ctx, [[0, 1222], [290, 1143], [730, 1400], [0, 1400]], '#fffffb');

    drawUmk(ctx, 159, 146, 1);
    drawWordmark(ctx, R, 545.8, 165.6, 282.5, { greenIt: st.greenIt });

    const light = titleLight(st, false);
    const fit = fitRich(ctx, st.title, { weight: 900, size: 54 * st.titleScale, minSize: 24, lh: 1.04, maxW: 870, maxH: 4 * 56 * st.titleScale + 8, upper: st.titleUpper });
    const n = fit.lines.length;
    const firstBl = 352 - ((n - 1) * fit.lh) / 2 + fit.size * 0.36;
    drawRich(ctx, R, fit, 495, firstBl, { align: 'center', color: light ? '#fff' : '#111', shadow: light });

    const [a, b] = people(st);
    const tag = { size: 30, maxW: 400, bg: '#ffffff', color: '#111', affColor: '#444', bottom: true };
    nameTag(ctx, a, 40, 1110, Object.assign({}, tag, { align: 'left' }));
    nameTag(ctx, b, 950, 1110, Object.assign({}, tag, { align: 'right' }));
    classicFooterPortrait(ctx, st);
  }

  function duoClassicBanner(ctx, R) {
    const st = R.st;
    rect(ctx, 0, 0, 1400, 735, '#ffffff');
    photoIn(ctx, R, [[0, 0], [400, 0], [370, 735], [0, 735]], 0);
    photoIn(ctx, R, [[400, 0], [760, 0], [760, 735], [370, 735]], 1);
    poly(ctx, [[397, 0], [403, 0], [373, 735], [367, 735]], '#ffffff');
    poly(ctx, [[0, 0], [400, 0], [358, 170], [0, 150]], '#ffffff');
    drawLogo(ctx, 60, 50, 88);
    poly(ctx, [[612, 0], [1400, 0], [1400, 97], [760, 160]], BLUE);
    drawWordmark(ctx, R, 818, 97, 292, { greenIt: st.greenIt });

    const [a, b] = people(st);
    const tag = { size: 25, maxW: 330, bg: '#ffffff', color: '#111', affColor: '#444', bottom: true };
    nameTag(ctx, a, 24, 711, Object.assign({}, tag, { align: 'left' }));
    nameTag(ctx, b, 736, 711, Object.assign({}, tag, { align: 'right' }));

    let fit;
    for (let s = 44 * st.titleScale; s >= 20; s -= 1) {
      fit = fitRich(ctx, st.title, { weight: 900, size: s, minSize: s, lh: 1.15, maxW: 525, upper: st.titleUpper });
      if (250 + (fit.lines.length - 1) * fit.lh <= 480) break;
    }
    drawRich(ctx, R, fit, 812, 250, { align: 'left', color: '#111' });

    text(ctx, dateStr(st), 815, 545, { weight: 700, size: 22, family: 'arial' });
    text(ctx, timeStr(st), 815, 575, { weight: 700, size: 22, family: 'arial' });
    lines(ctx, placeLines(st), 812, 622, 26, { weight: 300, size: 22.5, color: '#333' });
    const q = qrs(st);
    if (q.length) {
      rect(ctx, 1146, 515, 194, q.length > 1 ? 171 : 82, st.accent);
      q.forEach((it, i) => qrItem(ctx, it, 1256, 1266, 520 + i * 92, 62, { labelSize: 21, family: 'arial' }));
    }
  }

  // ---------- NOWOCZESNY ×2 ----------
  function modernDate(ctx, st, on, x, base, big, maxW) {
    const dp = dateParts(st);
    if (!dp) return x;
    text(ctx, String(dp.d), x, base, { weight: 900, size: big, color: on.fg });
    ctx.font = font(900, big);
    const dx = x + ctx.measureText(String(dp.d)).width + big * 0.16;
    const s = big / 110;
    textFit(ctx, `${dp.month} ${dp.y}`, dx, base - 55 * s, maxW - dx, { weight: 900, size: 28 * s, color: on.fg });
    textFit(ctx, dp.weekday, dx, base - 27 * s, maxW - dx, { size: 22 * s, color: on.muted });
    textFit(ctx, timeStr(st, true), dx, base - 2 * s, maxW - dx, { size: 22 * s, color: on.muted });
    return dx;
  }

  function duoModernPortrait(ctx, R) {
    const st = R.st;
    const P = st.primary, H = st.highlight, on = onColor(P);
    rect(ctx, 0, 0, 990, 1400, P);
    photoIn(ctx, R, [[0, 0], [520, 0], [470, 823], [0, 880]], 0);
    photoIn(ctx, R, [[520, 0], [990, 0], [990, 760], [470, 823]], 1);
    poly(ctx, [[513, 0], [527, 0], [477, 822], [463, 824]], H);
    poly(ctx, [[0, 880], [990, 760], [990, 774], [0, 894]], H);

    poly(ctx, [[0, 0], [415, 0], [385, 192], [0, 192]], '#fff');
    drawLogo(ctx, 60, 60, 92);
    poly(ctx, [[600, 0], [990, 0], [990, 172], [574, 172]], P);
    drawWordmark(ctx, R, 640, 116, 290, { greenIt: st.greenIt, color: on.fg });

    const [a, b] = people(st);
    const tag = { size: 30, bg: H, color: inkOn(H), bottom: true };
    nameTag(ctx, a, 40, 830, Object.assign({}, tag, { align: 'left', maxW: 400 }));
    nameTag(ctx, b, 950, 730, Object.assign({}, tag, { align: 'right', maxW: 420 }));

    const fit = fitTitleUntil(ctx, st, { top: 990, size: 70 * st.titleScale, minSize: 30, lh: 1.04, maxW: 850, weight: 900 }, 1150, () => 0);
    drawRich(ctx, R, fit, 70, 990, { align: 'left', color: on.fg });

    rect(ctx, 70, 1192, 850, 2, on.line);
    modernDate(ctx, st, on, 66, 1318, 110, 430);
    lines(ctx, placeLines(st), 445, 1261, 26, { weight: 400, size: 21, color: on.muted });
    const q = qrs(st);
    q.forEach((it, i) => qrTile(ctx, it, 920 - (q.length - i) * 92 + 12, 1222, 80, on.fg));
  }

  function duoModernBanner(ctx, R) {
    const st = R.st;
    const P = st.primary, H = st.highlight, on = onColor(P);
    rect(ctx, 0, 0, 1400, 735, P);
    photoIn(ctx, R, [[660, 0], [1040, 0], [960, 735], [540, 735]], 0);
    photoIn(ctx, R, [[1040, 0], [1400, 0], [1400, 735], [960, 735]], 1);
    poly(ctx, [[646, 0], [660, 0], [540, 735], [526, 735]], H);
    poly(ctx, [[1033, 0], [1047, 0], [967, 735], [953, 735]], H);
    poly(ctx, [[1092, 0], [1400, 0], [1400, 150], [1070, 150]], '#ffffff');
    drawLogo(ctx, 1124, 40, 80);

    const [a, b] = people(st);
    const tag = { size: 24, bg: H, color: inkOn(H), bottom: true };
    nameTag(ctx, a, 600, 705, Object.assign({}, tag, { align: 'left', maxW: 340 }));
    nameTag(ctx, b, 1370, 705, Object.assign({}, tag, { align: 'right', maxW: 380 }));

    drawWordmark(ctx, R, 70, 95, 270, { greenIt: st.greenIt, tagline: true, color: on.fg, taglineColor: on.muted });
    const fit = fitTitleUntil(ctx, st, { top: 222, size: 54 * st.titleScale, minSize: 24, lh: 1.08, maxW: 460, weight: 900 }, 520, () => 0);
    drawRich(ctx, R, fit, 70, 222, { align: 'left', color: on.fg });

    const q = qrs(st);
    const qx = 548 - q.length * 80;
    const dx = modernDate(ctx, st, on, 66, 665, 88, qx - 12);
    if (dateParts(st)) textFit(ctx, placeOneLine(st), dx, 690, qx - 12 - dx, { size: 15, color: on.muted });
    else textFit(ctx, placeOneLine(st), 70, 665, qx - 82, { size: 18, color: on.muted });
    q.forEach((it, i) => qrTile(ctx, it, qx + 12 + i * 80, 574, 66, on.fg));
  }

  // ---------- KOŁO ×2 ----------
  function duoCirclePortrait(ctx, R) {
    const st = R.st;
    const P = st.primary, H = st.highlight, on = onColor(P);
    rect(ctx, 0, 0, 990, 1400, P);
    ring(ctx, 290, 470, 262, 2.2, 4.6, 12, H);
    ring(ctx, 700, 650, 262, -0.9, 1.6, 12, H);
    photoCircle(ctx, R, 290, 470, 230, 0);
    ctx.beginPath();
    ctx.arc(700, 650, 242, 0, Math.PI * 2);
    ctx.fillStyle = P;
    ctx.fill();
    photoCircle(ctx, R, 700, 650, 230, 1);
    dateBadge(ctx, st, 850, 900, 96, H);
    drawLogo(ctx, 60, 60, 90, on.logo);

    const [a, b] = people(st);
    const nt = { size: 30, color: H, affColor: on.fg, affWeight: 300 };
    nameTag(ctx, b, 920, 372, Object.assign({}, nt, { align: 'right', maxW: 470, bottom: true }));
    nameTag(ctx, a, 70, 752, Object.assign({}, nt, { align: 'left', maxW: 430 }));

    const fit = fitTitleUntil(ctx, st, { top: 1065, size: 62 * st.titleScale, minSize: 28, lh: 1.05, maxW: 850, weight: 900 }, 1185, () => 0);
    drawRich(ctx, R, fit, 70, 1065, { align: 'left', color: on.fg });

    rect(ctx, 70, 1236, 850, 2, on.line);
    drawWordmark(ctx, R, 70, 1306, 250, { greenIt: st.greenIt, tagline: true, color: on.fg, taglineColor: on.muted });
    const q = qrs(st);
    const qx = 920 - q.length * 92;
    textFit(ctx, timeStr(st, true), 372, 1284, qx - 382, { weight: 900, size: 22, color: on.fg });
    placeLines(st).forEach((s, i) => textFit(ctx, s, 372, 1314 + i * 24, qx - 382, { size: 19, color: on.muted }));
    q.forEach((it, i) => qrTile(ctx, it, qx + 12 + i * 92, 1262, 78, on.fg));
  }

  function duoCircleBanner(ctx, R) {
    const st = R.st;
    const P = st.primary, H = st.highlight, on = onColor(P);
    rect(ctx, 0, 0, 1400, 735, P);
    ring(ctx, 880, 410, 232, 1.9, 4.3, 10, H);
    ring(ctx, 1175, 300, 232, -1.2, 1.3, 10, H);
    photoCircle(ctx, R, 880, 410, 205, 0);
    ctx.beginPath();
    ctx.arc(1175, 300, 215, 0, Math.PI * 2);
    ctx.fillStyle = P;
    ctx.fill();
    photoCircle(ctx, R, 1175, 300, 205, 1);
    dateBadge(ctx, st, 1015, 96, 78, H);
    drawLogo(ctx, 60, 50, 76, on.logo);
    drawWordmark(ctx, R, 320, 100, 230, { greenIt: st.greenIt, color: on.fg });

    const [a, b] = people(st);
    const nt = { size: 24, color: H, affColor: on.fg, affWeight: 300 };
    nameTag(ctx, a, 1050, 646, Object.assign({}, nt, { align: 'right', maxW: 330 }));
    nameTag(ctx, b, 1370, 540, Object.assign({}, nt, { align: 'right', maxW: 300 }));

    const fit = fitTitleUntil(ctx, st, { top: 238, size: 52 * st.titleScale, minSize: 24, lh: 1.07, maxW: 560, weight: 900 }, 505, () => 0);
    drawRich(ctx, R, fit, 60, 238, { align: 'left', color: on.fg });

    const q = qrs(st);
    const qx = 640 - q.length * 84;
    text(ctx, timeStr(st, true), 62, 594, { weight: 900, size: 23, color: on.fg });
    textFit(ctx, placeOneLine(st), 62, 626, qx - 82, { size: 19, color: on.muted });
    q.forEach((it, i) => qrTile(ctx, it, qx + 14 + i * 84, 548, 66, on.fg));
  }

  // ---------- DUOTONE ×2 ----------
  function duoDuoPortrait(ctx, R) {
    const st = R.st;
    const D = st.duoDark, H = st.highlight;
    rect(ctx, 0, 0, 990, 1400, D);
    photoIn(ctx, R, [[0, 0], [535, 0], [455, 1400], [0, 1400]], 0, true);
    photoIn(ctx, R, [[535, 0], [990, 0], [990, 1400], [455, 1400]], 1, true);
    poly(ctx, [[530, 0], [540, 0], [460, 1400], [450, 1400]], H);
    const g = ctx.createLinearGradient(0, 560, 0, 1150);
    g.addColorStop(0, rgba(D, 0));
    g.addColorStop(1, rgba(D, 0.5 + st.shade * 0.5));
    ctx.fillStyle = g;
    ctx.fillRect(0, 560, 990, 840);
    const gt = ctx.createLinearGradient(0, 0, 0, 260);
    gt.addColorStop(0, rgba(D, 0.55));
    gt.addColorStop(1, rgba(D, 0));
    ctx.fillStyle = gt;
    ctx.fillRect(0, 0, 990, 260);

    drawWordmark(ctx, R, 70, 130, 360, { greenIt: st.greenIt, tagline: true, taglineColor: '#e6eef8' });
    drawUmk(ctx, 708, 108, 0.92, 'neg');

    const fit = fitRich(ctx, st.title, { weight: 900, size: 68 * st.titleScale, minSize: 30, lh: 1.04, maxW: 850, maxH: 4 * 72 * st.titleScale, upper: st.titleUpper });
    const firstBl = 1105 - (fit.lines.length - 1) * fit.lh;
    namePair(ctx, R, st, 72, 918, firstBl - fit.size * 1.05 - 32, { size: 26, color: H, affColor: '#fff', upper: true, shadow: true });
    drawRich(ctx, R, fit, 70, firstBl, { align: 'left', color: '#fff', shadow: true });

    datePill(ctx, st, 70, 1150, 26, inkOn(H), H, 850);
    lines(ctx, placeLines(st), 72, 1268, 25, { weight: 400, size: 21, color: '#e6eef8' });
    const q = qrs(st);
    q.forEach((it, i) => qrTile(ctx, it, 920 - (q.length - i) * 94 + 14, 1222, 80, '#fff'));
  }

  function duoDuoBanner(ctx, R) {
    const st = R.st;
    const D = st.duoDark, H = st.highlight;
    rect(ctx, 0, 0, 1400, 735, D);
    photoIn(ctx, R, [[770, 0], [1100, 0], [1060, 735], [730, 735]], 0, true);
    photoIn(ctx, R, [[1100, 0], [1400, 0], [1400, 735], [1060, 735]], 1, true);
    shadeV(ctx, 730, 470, 670, 265, 0.45 + st.shade * 0.5, 470, 735, D);
    poly(ctx, [[763, 0], [773, 0], [733, 735], [723, 735]], H);
    poly(ctx, [[1095, 0], [1105, 0], [1065, 735], [1055, 735]], H);

    const [a, b] = people(st);
    const nt = { size: 23, color: H, affColor: '#fff', upper: true, bottom: true, shadow: true, R };
    nameTag(ctx, a, 760, 700, Object.assign({}, nt, { align: 'left', maxW: 285 }));
    nameTag(ctx, b, 1090, 700, Object.assign({}, nt, { align: 'left', maxW: 285 }));

    drawWordmark(ctx, R, 70, 95, 270, { greenIt: st.greenIt, tagline: true, taglineColor: '#e6eef8' });
    drawLogo(ctx, 420, 44, 76, 'neg');
    const fit = fitTitleUntil(ctx, st, { top: 238, size: 54 * st.titleScale, minSize: 24, lh: 1.06, maxW: 620, weight: 900 }, 500, () => 0);
    drawRich(ctx, R, fit, 70, 238, { align: 'left', color: '#fff' });

    const q = qrs(st);
    const qx = 700 - q.length * 84;
    datePill(ctx, st, 70, 560, 23, inkOn(H), H, qx - 80);
    textFit(ctx, placeOneLine(st), 72, 660, qx - 82, { size: 19, color: '#e6eef8' });
    q.forEach((it, i) => qrTile(ctx, it, qx + 14 + i * 84, 548, 70, '#fff'));
  }

  // =====================================================================
  //  SEMINARIUM WYDZIAŁOWE (kolokwium – na wzór plakatu WMiI)
  // =====================================================================
  // Godło WMiI (wektor z plakatu kolokwium), układ 108×140.
  const EMBLEM = [
    ["M 53.74 117.71C 34 117.71 17.91 96.07 17.91 69.57C 17.91 43.06 34 21.42 53.74 21.42C 73.48 21.42 89.57 43.06 89.57 69.57C 89.57 96.07 73.48 117.71 53.74 117.71ZM 68.58 117.85C 77.24 113.05 84.34 104.05 88.5 92.79L 93.61 96.28C 89.26 108.12 82.08 117.73 73.28 123.49ZM 53.57 122.23C 49.63 122.23 45.9 121.14 42.3 119.61L 40.44 126.89C 44.54 128.64 48.98 129.59 53.66 129.59C 58.34 129.59 62.78 128.64 66.89 126.89L 65.03 119.61C 61.43 121.14 57.5 122.23 53.57 122.23ZM 38.74 117.85C 30.08 113.05 22.99 104.05 18.82 92.79L 13.71 96.28C 18.06 108.12 25.25 117.73 34.05 123.49ZM 98.38 69.55C 98.38 62.79 97.51 56.39 95.94 50.39L 90.01 51.09C 91.66 56.9 92.54 63.12 92.54 69.63C 92.54 76.14 91.66 82.36 90.01 88.17L 95.94 88.87C 97.51 82.87 98.38 76.31 98.38 69.55ZM 68.58 21.41C 77.24 26.21 84.34 35.21 88.5 46.47L 93.61 42.98C 89.26 31.14 82.08 21.53 73.28 15.77ZM 53.57 17.03C 49.63 17.03 45.9 18.12 42.3 19.65L 40.44 12.37C 44.54 10.62 48.98 9.67 53.66 9.67C 58.34 9.67 62.78 10.62 66.89 12.37L 65.03 19.65C 61.43 18.12 57.5 17.03 53.57 17.03ZM 106.03 69.63L 102.41 66.38C 103.56 56.09 103.56 55.87 99.71 47.26L 102.12 43.73L 98.28 42.7C 96.26 32.76 95.35 32.23 89.26 26.18L 90.57 22.28L 86.82 22.61C 81.73 15.31 81.25 15.55 74.24 12.15L 73.52 7.74L 69.75 9.51C 63.62 5.45 62.88 5.28 55.84 6.12L 53.66 1.9L 51.48 6.12C 44.45 5.28 43.7 5.45 37.57 9.51L 33.8 7.74L 33.08 12.15C 26.07 15.55 25.6 15.31 20.5 22.61L 16.75 22.28L 18.06 26.18C 11.97 32.23 11.06 32.76 9.05 42.7L 5.2 43.73L 7.61 47.26C 3.77 55.87 3.77 56.09 4.91 66.38L 1.3 69.63L 4.91 72.88C 3.77 83.17 3.77 83.39 7.61 92L 5.2 95.53L 9.05 96.56C 11.06 106.5 11.97 107.03 18.06 113.08L 16.75 116.99L 20.5 116.65C 25.6 123.95 26.07 123.71 33.08 127.11L 33.8 131.52L 37.57 129.75C 43.7 133.81 44.45 133.98 51.48 133.14L 53.66 137.36L 55.84 133.14C 62.88 133.98 63.62 133.81 69.75 129.75L 73.52 131.52L 74.24 127.11C 81.25 123.71 81.73 123.95 86.82 116.65L 90.57 116.99L 89.26 113.08C 95.35 107.03 96.26 106.5 98.28 96.56L 102.12 95.53L 99.71 92C 103.56 83.39 103.56 83.17 102.41 72.88ZM 14.78 69.63C 14.78 63.12 15.67 56.9 17.31 51.09L 11.38 50.39C 9.81 56.39 8.97 62.87 8.97 69.63C 8.97 76.39 9.81 82.87 11.38 88.87L 17.31 88.17C 15.67 82.36 14.78 76.14 14.78 69.63ZM 38.74 21.41C 30.08 26.21 22.99 35.21 18.82 46.47L 13.71 42.98C 18.06 31.14 25.25 21.53 34.05 15.77Z", false, 1.66135],
    ["M 32.05 71.55L 32 67.28L 30.71 67.36L 30.76 67.22C 31.43 67.06 31.82 66.97 32.35 66.67C 32.88 66.37 32.96 65.8 33.3 65.42C 33.42 65.42 33.46 65.42 33.79 65.43C 33.51 65.99 33.32 66.6 33.26 67.25C 33.16 68.8 33.39 70.3 33.39 71.52C 33.39 71.74 33.47 72.02 33.58 72.15C 33.63 72.19 34.22 72.43 34.23 72.56C 34.25 72.68 33.95 72.53 34.07 72.59C 33.67 72.46 33.49 72.35 33.09 72.27C 32.79 72.21 32.47 72.19 32.05 72.32C 31.78 72.4 31.75 72.46 31.59 72.53C 31.43 72.56 31.41 72.67 31.31 72.49C 31.48 72.35 31.61 72.3 31.73 72.15C 31.85 72 32.05 71.83 32.05 71.55Z", true, 0.216],
    ["M 35.43 71.55L 35.38 67.28L 34.09 67.36L 34.14 67.22C 34.81 67.06 35.2 66.97 35.73 66.67C 36.26 66.37 36.35 65.8 36.68 65.42C 36.81 65.42 36.84 65.42 37.18 65.43C 36.89 65.99 36.7 66.6 36.65 67.25C 36.54 68.8 36.77 70.3 36.77 71.52C 36.77 71.74 36.86 72.02 36.96 72.15C 37.02 72.19 37.6 72.43 37.62 72.56C 37.63 72.68 37.33 72.53 37.46 72.59C 37.05 72.46 36.88 72.35 36.47 72.27C 36.17 72.21 35.85 72.19 35.43 72.32C 35.17 72.4 35.13 72.46 34.97 72.53C 34.81 72.56 34.8 72.67 34.69 72.49C 34.87 72.35 34.99 72.3 35.11 72.15C 35.24 72 35.43 71.83 35.43 71.55Z", true, 0.216],
    ["M 39.1 71.55L 39.05 67.28L 37.76 67.36L 37.82 67.22C 38.49 67.06 38.87 66.97 39.4 66.67C 39.93 66.37 40.02 65.8 40.35 65.42C 40.48 65.42 40.51 65.42 40.85 65.43C 40.57 65.99 40.37 66.6 40.32 67.25C 40.21 68.8 40.44 70.3 40.44 71.52C 40.44 71.74 40.53 72.02 40.64 72.15C 40.69 72.19 41.27 72.43 41.29 72.56C 41.31 72.68 41.01 72.53 41.13 72.59C 40.72 72.46 40.55 72.35 40.14 72.27C 39.84 72.21 39.53 72.19 39.1 72.32C 38.84 72.4 38.8 72.46 38.65 72.53C 38.49 72.56 38.47 72.67 38.36 72.49C 38.54 72.35 38.66 72.3 38.79 72.15C 38.91 72 39.1 71.83 39.1 71.55Z", true, 0.216],
    ["M 42.49 71.55L 42.44 67.28L 41.15 67.36L 41.2 67.22C 41.87 67.06 42.26 66.97 42.79 66.67C 43.32 66.37 43.4 65.8 43.74 65.42C 43.86 65.42 43.9 65.42 44.23 65.43C 43.95 65.99 43.76 66.6 43.7 67.25C 43.6 68.8 43.83 70.3 43.83 71.52C 43.83 71.74 43.91 72.02 44.02 72.15C 44.07 72.19 44.66 72.43 44.67 72.56C 44.69 72.68 44.39 72.53 44.51 72.59C 44.11 72.46 43.93 72.35 43.53 72.27C 43.23 72.21 42.91 72.19 42.49 72.32C 42.22 72.4 42.19 72.46 42.03 72.53C 41.87 72.56 41.85 72.67 41.75 72.49C 41.92 72.35 42.05 72.3 42.17 72.15C 42.29 72 42.49 71.83 42.49 71.55Z", true, 0.216],
    ["M 45.87 71.55L 45.82 67.28L 44.53 67.36L 44.59 67.22C 45.25 67.06 45.64 66.97 46.17 66.67C 46.7 66.37 46.79 65.8 47.12 65.42C 47.25 65.42 47.28 65.42 47.62 65.43C 47.33 65.99 47.14 66.6 47.09 67.25C 46.98 68.8 47.21 70.3 47.21 71.52C 47.21 71.74 47.3 72.02 47.4 72.15C 47.46 72.19 48.04 72.43 48.06 72.56C 48.07 72.68 47.77 72.53 47.9 72.59C 47.49 72.46 47.32 72.35 46.91 72.27C 46.61 72.21 46.29 72.19 45.87 72.32C 45.61 72.4 45.57 72.46 45.41 72.53C 45.25 72.56 45.24 72.67 45.13 72.49C 45.31 72.35 45.43 72.3 45.55 72.15C 45.68 72 45.87 71.83 45.87 71.55Z", true, 0.216],
    ["M 59.84 71.55L 59.79 67.28L 58.5 67.36L 58.55 67.22C 59.22 67.06 59.61 66.97 60.14 66.67C 60.67 66.37 60.76 65.8 61.09 65.42C 61.21 65.42 61.25 65.42 61.58 65.43C 61.3 65.99 61.11 66.6 61.06 67.25C 60.95 68.8 61.18 70.3 61.18 71.52C 61.18 71.74 61.27 72.02 61.37 72.15C 61.43 72.19 62.01 72.43 62.02 72.56C 62.04 72.68 61.74 72.53 61.87 72.59C 61.46 72.46 61.28 72.35 60.88 72.27C 60.58 72.21 60.26 72.19 59.84 72.32C 59.57 72.4 59.54 72.46 59.38 72.53C 59.22 72.56 59.21 72.67 59.1 72.49C 59.28 72.35 59.4 72.3 59.52 72.15C 59.65 72 59.84 71.83 59.84 71.55Z", true, 0.216],
    ["M 74.31 71.55L 74.26 67.28L 72.97 67.36L 73.03 67.22C 73.69 67.06 74.08 66.97 74.61 66.67C 75.14 66.37 75.23 65.8 75.56 65.42C 75.69 65.42 75.72 65.42 76.06 65.43C 75.77 65.99 75.58 66.6 75.53 67.25C 75.42 68.8 75.65 70.3 75.65 71.52C 75.65 71.74 75.74 72.02 75.84 72.15C 75.9 72.19 76.48 72.43 76.5 72.56C 76.51 72.68 76.21 72.53 76.34 72.59C 75.93 72.46 75.76 72.35 75.35 72.27C 75.05 72.21 74.73 72.19 74.31 72.32C 74.05 72.4 74.01 72.46 73.85 72.53C 73.69 72.56 73.68 72.67 73.57 72.49C 73.75 72.35 73.87 72.3 73.99 72.15C 74.12 72 74.31 71.83 74.31 71.55Z", true, 0.216],
    ["M 50.64 72.52C 49.4 72.52 48.4 70.9 48.4 68.95C 48.4 67 49.4 65.39 50.64 65.39C 51.89 65.39 52.89 67 52.89 68.95C 52.89 70.9 51.89 72.52 50.64 72.52ZM 51.23 71.39C 50.49 71.54 49.67 70.52 49.39 69.16C 49.12 67.8 49.47 66.56 50.22 66.41C 50.94 66.26 51.76 67.3 52.03 68.66C 52.31 70.02 51.96 71.24 51.23 71.39Z", true, 0.216],
    ["M 55.9 72.52C 54.66 72.52 53.66 70.9 53.66 68.95C 53.66 67 54.66 65.39 55.9 65.39C 57.14 65.39 58.14 67 58.14 68.95C 58.14 70.9 57.14 72.52 55.9 72.52ZM 56.49 71.39C 55.74 71.54 54.93 70.52 54.64 69.16C 54.37 67.8 54.73 66.56 55.47 66.41C 56.2 66.26 57.01 67.3 57.28 68.66C 57.57 70.02 57.21 71.24 56.49 71.39Z", true, 0.216],
    ["M 64.83 72.52C 63.59 72.52 62.59 70.9 62.59 68.95C 62.59 67 63.59 65.39 64.83 65.39C 66.07 65.39 67.07 67 67.07 68.95C 67.07 70.9 66.07 72.52 64.83 72.52ZM 65.41 71.39C 64.67 71.54 63.86 70.52 63.57 69.16C 63.3 67.8 63.66 66.56 64.4 66.41C 65.13 66.26 65.94 67.3 66.21 68.66C 66.5 70.02 66.14 71.24 65.41 71.39Z", true, 0.216],
    ["M 70.37 72.52C 69.13 72.52 68.13 70.9 68.13 68.95C 68.13 67 69.13 65.39 70.37 65.39C 71.61 65.39 72.61 67 72.61 68.95C 72.61 70.9 71.61 72.52 70.37 72.52ZM 70.96 71.39C 70.22 71.54 69.4 70.52 69.12 69.16C 68.84 67.8 69.2 66.56 69.94 66.41C 70.67 66.26 71.49 67.3 71.76 68.66C 72.04 70.02 71.69 71.24 70.96 71.39Z", true, 0.216],
    ["M 34.44 57.88C 37.51 65.7 48.87 60.83 53.66 55.54C 57.66 51.12 58.57 49.54 60.78 43.43C 62.23 39.43 61.94 24.8 53.66 25.21C 45.38 25.62 45.2 37.74 47.06 43.47C 48.93 49.24 49.3 51.13 53.37 55.82C 59.08 62.41 70.71 65.43 73.66 58.29C 76.6 51.15 68.15 45.27 60.86 43.33C 56.73 42.23 51.89 42.51 47.04 43.47C 42.82 44.31 31.38 50.06 34.44 57.88Z", false, 1.72346],
    ["M 34.44 80.2C 37.51 72.38 48.87 77.25 53.66 82.54C 57.66 86.96 58.57 88.54 60.78 94.65C 62.23 98.65 61.94 113.27 53.66 112.86C 45.38 112.45 45.2 100.34 47.06 94.6C 48.93 88.84 49.3 86.94 53.37 82.25C 59.08 75.67 70.71 72.65 73.66 79.79C 76.6 86.93 68.15 92.8 60.86 94.75C 56.73 95.85 51.89 95.57 47.04 94.6C 42.82 93.77 31.38 88.02 34.44 80.2Z", false, 1.72346],
  ];
  const EMBLEM_PATHS = [];

  /** Godło wysokości h, lewy górny róg w (x, y). Zwraca szerokość. */
  function drawEmblem(ctx, x, y, h, color) {
    if (!EMBLEM_PATHS.length && window.Path2D) EMBLEM.forEach(([d, fill, w]) => EMBLEM_PATHS.push([new Path2D(d), fill, w]));
    const s = h / 140;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineJoin = 'round';
    EMBLEM_PATHS.forEach(([p, fill, w]) => {
      ctx.lineWidth = w;
      if (fill) ctx.fill(p, 'evenodd');
      ctx.stroke(p);
    });
    ctx.restore();
    return 108 * s;
  }

  const SEM = {
    yellow: '#ffec00',
    emblem: '#fff35c',
    script: '#3d6652',
    stops: [[0, '#fff584'], [0.075, '#93b68a'], [0.175, '#007a7f'], [0.35, '#00323b'], [0.575, '#007a7f'],
      [0.7, '#549786'], [0.85, '#a3c08a'], [1, '#fff585']],
  };

  const WEEKDAYS_ACC = ['w niedzielę', 'w poniedziałek', 'we wtorek', 'w środę', 'w czwartek', 'w piątek', 'w sobotę'];

  /** „Kolokwium odbędzie się / w środę 5.11.2025 / o godz. 10:15 w auli WMiI UMK”. */
  function seminarInfo(st) {
    const out = [];
    if (st.announce) out.push(st.announce.trim());
    const dp = dateParts(st);
    if (dp) out.push(`${WEEKDAYS_ACC[new Date(dp.y, dp.m - 1, dp.d).getDay()]} ${dp.d}.${dp.mm}.${dp.y}`);
    const tail = [st.time ? `o godz. ${st.time}` : '', placeOneLine(st)].filter(Boolean).join(' ');
    if (tail) out.push(tail);
    return out;
  }

  function semBackground(ctx, w, h, stops) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    stops.forEach(([t, c]) => g.addColorStop(t, c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  /**
   * Linie tekstu ściskane poziomo (jak w oryginale), by zmieściły się w maxW;
   * poniżej minSq – zmniejszany jest też rozmiar. o: { family, weight, size, lh, align, color, stroke, strokeW, minSq }
   */
  function squeezedLines(ctx, arr, x, y, maxW, o) {
    arr = arr.filter(Boolean);
    if (!arr.length) return;
    ctx.save();
    let size = o.size;
    ctx.font = font(o.weight, size, o.family);
    const widest = Math.max(...arr.map((s) => ctx.measureText(s).width));
    let sq = Math.min(1, maxW / widest);
    if (sq < (o.minSq || 0.75)) { size *= sq / (o.minSq || 0.75); sq = o.minSq || 0.75; }
    ctx.font = font(o.weight, size, o.family);
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.translate(x, y);
    ctx.scale(sq, 1);
    arr.forEach((s, i) => {
      const yy = i * (o.lh || size * 1.2);
      ctx.fillStyle = o.color;
      ctx.fillText(s, 0, yy);
      if (o.stroke) {
        ctx.lineWidth = o.strokeW / sq;
        ctx.strokeStyle = o.stroke;
        ctx.strokeText(s, 0, yy);
      }
    });
    ctx.restore();
  }

  /** Tytuł: szeryfowy, biały z cienkim konturem, wyśrodkowany w pionie wokół cy. */
  function semTitle(ctx, R, cx, cy, o) {
    const st = R.st;
    const SQ = 0.84;
    const fit = fitRich(ctx, st.title, { weight: 400, family: 'serif', size: o.size * st.titleScale, minSize: 22, lh: 1.0, maxW: o.maxW / SQ, maxH: o.maxH, upper: st.titleUpper });
    const n = fit.lines.length;
    const firstBl = cy - ((n - 1) * fit.lh) / 2 + fit.size * 0.3;
    ctx.save();
    ctx.translate(cx, 0);
    ctx.scale(SQ, 1);
    drawRich(ctx, R, fit, 0, firstBl, { align: 'center', color: '#fff', stroke: '#000', strokeW: o.strokeW / SQ });
    ctx.restore();
  }

  function seminarPortrait(ctx, R) {
    const st = R.st;
    semBackground(ctx, 990, 1400, SEM.stops);
    drawEmblem(ctx, 110, 66, 163, SEM.emblem);
    squeezedLines(ctx, (st.series || '').split('\n').slice(0, 2), 268, 135, 620, { family: 'narrow', weight: 700, size: 84, lh: 83, color: SEM.yellow, minSq: 0.7 });
    rect(ctx, 103, 277, 784, 5, '#fefefe');
    rect(ctx, 103, 734, 784, 5, '#fefefe');

    semTitle(ctx, R, 495, 508, { size: 96, maxW: 820, maxH: 430, strokeW: 1.3 });

    const sp = { family: 'narrow', weight: 700, size: 64, align: 'center', color: '#fff', stroke: '#000', strokeW: 1.4, minSq: 0.8 };
    squeezedLines(ctx, [speakerList(st)[0] || ''], 495, 840, 860, sp);
    squeezedLines(ctx, [st.affiliation], 495, 906, 860, sp);
    squeezedLines(ctx, seminarInfo(st), 495, 976, 860, { family: 'arial', weight: 700, size: 42, lh: 49.5, align: 'center', color: SEM.yellow, minSq: 0.8 });

    const sc = { weight: 700, size: 40, family: 'script', color: SEM.script, align: 'right' };
    if (st.invite) textFit(ctx, st.invite, 885, 1165, 780, sc);
    if (st.host) textFit(ctx, st.host, 885, 1222, 780, sc);
  }

  function seminarBanner(ctx, R) {
    const st = R.st;
    semBackground(ctx, 1400, 735, [[0, '#fff584'], [0.1, '#93b68a'], [0.24, '#007a7f'], [0.45, '#00323b'],
      [0.68, '#007a7f'], [0.8, '#549786'], [0.92, '#a3c08a'], [1, '#fff585']]);
    drawEmblem(ctx, 62, 24, 140, SEM.emblem);
    squeezedLines(ctx, (st.series || '').split('\n').slice(0, 2), 200, 86, 760, { family: 'narrow', weight: 700, size: 66, lh: 66, color: SEM.yellow, minSq: 0.7 });
    rect(ctx, 60, 186, 1280, 4, '#fefefe');
    rect(ctx, 60, 476, 1280, 4, '#fefefe');

    semTitle(ctx, R, 700, 332, { size: 76, maxW: 1240, maxH: 262, strokeW: 1.1 });

    const sp = { family: 'narrow', weight: 700, size: 50, align: 'left', color: '#fff', stroke: '#000', strokeW: 1.2, minSq: 0.8 };
    squeezedLines(ctx, [speakerList(st)[0] || ''], 62, 548, 600, sp);
    squeezedLines(ctx, [st.affiliation], 62, 602, 600, sp);
    squeezedLines(ctx, seminarInfo(st), 1338, 530, 660, { family: 'arial', weight: 700, size: 27, lh: 33, align: 'right', color: SEM.yellow, minSq: 0.8 });

    const sc = { weight: 700, size: 30, family: 'script', color: SEM.script, align: 'right' };
    if (st.invite) textFit(ctx, st.invite, 1338, 665, 640, sc);
    if (st.host) textFit(ctx, st.host, 1338, 705, 640, sc);
  }

  // Kontrolki wyglądu używane przez szablon (app.js pokazuje tylko te).
  const TEMPLATES = {
    classic: { label: 'Klasyczny', group: 'orig', uses: ['accent', 'band', 'titleColor'], formats: { portrait: classicPortrait, landscape: classicLandscape, banner: classicBanner } },
    dark: { label: 'Ciemny', group: 'orig', uses: ['shade', 'shadeColor'], formats: { portrait: darkPortrait, banner: darkBanner } },
    block: { label: 'Blokowy', group: 'orig', uses: ['band', 'titleColor'], formats: { portrait: blockPortrait, banner: blockBanner } },
    modern: { label: 'Nowoczesny', group: 'new', uses: ['primary', 'highlight'], formats: { portrait: modernPortrait, banner: modernBanner } },
    duo: { label: 'Duotone', group: 'new', uses: ['duo', 'highlight', 'shade'], formats: { portrait: duoPortrait, banner: duoBanner } },
    minimal: { label: 'Minimalny', group: 'new', uses: ['primary', 'highlight'], formats: { portrait: minimalPortrait, banner: minimalBanner } },
    circle: { label: 'Koło', group: 'new', uses: ['primary', 'highlight'], formats: { portrait: circlePortrait, banner: circleBanner } },
    swiss: { label: 'Typograficzny', group: 'new', uses: ['primary', 'highlight'], formats: { portrait: swissPortrait, banner: swissBanner } },
    frame: { label: 'Ramka', group: 'new', uses: ['primary', 'highlight'], formats: { portrait: framePortrait, banner: frameBanner } },
    polaroid: { label: 'Polaroid', group: 'new', uses: ['primary', 'highlight'], formats: { portrait: polaroidPortrait, banner: polaroidBanner } },
    gradient: { label: 'Gradient', group: 'new', uses: ['primary', 'highlight', 'tint', 'shade'], formats: { portrait: gradientPortrait, banner: gradientBanner } },
    // dwóch prelegentów
    duoClassic: { label: 'Klasyczny', mode: 'duo2', group: 'duo2', uses: ['accent', 'band', 'titleColor'], formats: { portrait: duoClassicPortrait, banner: duoClassicBanner } },
    duoModern: { label: 'Nowoczesny', mode: 'duo2', group: 'duo2', uses: ['primary', 'highlight'], formats: { portrait: duoModernPortrait, banner: duoModernBanner } },
    duoCircle: { label: 'Koło', mode: 'duo2', group: 'duo2', uses: ['primary', 'highlight'], formats: { portrait: duoCirclePortrait, banner: duoCircleBanner } },
    duoDuo: { label: 'Duotone', mode: 'duo2', group: 'duo2', uses: ['duo', 'highlight', 'shade'], formats: { portrait: duoDuoPortrait, banner: duoDuoBanner } },
    // seminarium wydziałowe
    seminar: { label: 'Kolokwium', mode: 'seminar', group: 'seminar', uses: [], formats: { portrait: seminarPortrait, banner: seminarBanner } },
  };
  Object.values(TEMPLATES).forEach((t) => { t.mode = t.mode || 'single'; });

  /**
   * Renderuje plakat na canvasie.
   * @param canvas  docelowy canvas (rozmiar ustawiany tutaj)
   * @param st      stan projektu
   * @param o       { format, img, framing, scale (px na jednostkę projektu), preview }
   * @returns obiekt R z informacjami o kadrze zdjęcia (dla przeciągania)
   */
  function render(canvas, st, o) {
    const fmt = FORMATS[o.format];
    const [dw, dh] = fmt.design;
    const k = o.scale;
    canvas.width = Math.round(dw * k);
    canvas.height = Math.round(dh * k);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const R = { st, imgs: o.imgs, framings: o.framings, k, preview: !!o.preview, areas: [] };
    const fn = TEMPLATES[st.template].formats[o.format];
    fn(ctx, R);
    return R;
  }

  window.Poster = { render, loadLogos, FORMATS, PAPERS, formatSize, TEMPLATES, MONTHS, DUO, fontsToLoad: [
    font(300, 20), font(400, 20), font(700, 20), font(900, 20), font(700, 20, null, true), font(900, 20, null, true),
    font(400, 20, 'serif'), font(700, 20, 'script'), font(700, 20, 'narrow'),
  ] };
})();

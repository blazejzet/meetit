/* meetit.live – renderer plakatów (Canvas 2D).
 * Wszystkie layouty rysowane są we współrzędnych projektowych (np. 990×1400 dla A4),
 * a kontekst jest skalowany do docelowej rozdzielczości. */
(function () {
  'use strict';

  const BLUE = '#024ca1';
  const UMK_BLUE = '#0a4da2';
  const GREEN = '#aad337';
  const YELLOW = '#ffcc00';
  const ARIAL = "Arial, 'Helvetica Neue', Helvetica, 'Liberation Sans', sans-serif";

  const FORMATS = {
    a4p: { label: 'A4 pion', design: [990, 1400], px: [2481, 3508], suffix: 'P', pdf: 'a4p' },
    a4l: { label: 'A4 poziom', design: [1400, 990], px: [3508, 2481], suffix: 'L', pdf: 'a4l' },
    banner: { label: 'Baner 1200×630', design: [1400, 735], px: [1200, 630], suffix: 'Z', pdf: null },
  };

  const MONTHS = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca',
    'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

  // ---------- helpers ----------
  function font(weight, size, family, italic) {
    return `${italic ? 'italic ' : ''}${weight} ${size}px ${family === 'arial' ? ARIAL : 'Lato, sans-serif'}`;
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

  /** Logo WMiI; (cx, cy) – środek koła, s – skala (1 = rozmiar z plakatów A4). */
  function drawUmk(ctx, cx, cy, s, variant = 'base') {
    const img = logos[variant];
    if (img) {
      const h = 107.5 * s;
      ctx.drawImage(img, cx - 37 * s, cy - 46.3 * s, h * img.width / img.height, h);
      return;
    }
    drawUmkVector(ctx, cx, cy, s, variant === 'neg' ? '#fff' : UMK_BLUE);
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
    const parts = [['meet', '#fff'], ['it', o.greenIt === false ? '#fff' : GREEN], ['.live', '#fff']];
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
      const c = o.taglineColor || '#fff';
      text(ctx, 'MATEMATYKA', x + width * 0.01, ty, { size: ts, color: c });
      text(ctx, 'ANALIZA DANYCH', x + width / 2, ty, { size: ts, color: c, align: 'center' });
      text(ctx, 'INFORMATYKA', x + width * 0.99, ty, { size: ts, color: c, align: 'right' });
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
  function drawPhoto(ctx, R, r) {
    const st = R.st;
    const img = R.img;
    R.photoRect = r;
    if (!img) {
      if (R.preview) {
        ctx.save();
        const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
        g.addColorStop(0, 'rgba(0,0,0,0.05)');
        g.addColorStop(1, 'rgba(0,0,0,0.12)');
        ctx.fillStyle = g;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        const s = Math.min(r.w, r.h) * 0.045;
        text(ctx, 'Przeciągnij tu zdjęcie', r.x + r.w / 2, r.y + r.h * 0.62, { size: s, weight: 700, color: 'rgba(0,0,0,0.35)', align: 'center' });
        text(ctx, 'lub wybierz je w panelu po lewej', r.x + r.w / 2, r.y + r.h * 0.62 + s * 1.4, { size: s * 0.7, color: 'rgba(0,0,0,0.3)', align: 'center' });
        ctx.restore();
      }
      R.photoDraw = null;
      return;
    }
    const f = R.framing;
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
    R.photoDraw = { dw, dh };
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
  function classicA4p(ctx, R) {
    const st = R.st;
    rect(ctx, 0, 0, 990, 1400, st.bgColor);
    drawPhoto(ctx, R, { x: 0, y: 0, w: 990, h: 1400 });
    if (st.band) poly(ctx, [[0, 150], [990, 120], [990, 488], [930, 550], [0, 392]], st.accent, st.bandOpacity);

    poly(ctx, [[0, 0], [285, 0], [553, 219], [472, 276], [0, 200]], '#ffffff');
    poly(ctx, [[285, 0], [990, 0], [990, 164], [600, 257]], BLUE);
    poly(ctx, [[300, 1248], [610, 1152], [990, 1180], [990, 1400], [300, 1400]], st.accent);
    poly(ctx, [[0, 1222], [290, 1143], [730, 1400], [0, 1400]], '#fffffb');

    if (st.showUmk) drawUmk(ctx, 159, 146, 1);
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

  function classicA4l(ctx, R) {
    const st = R.st;
    rect(ctx, 0, 0, 1400, 990, st.bgColor);
    drawPhoto(ctx, R, { x: 0, y: 0, w: 1400, h: 990 });

    poly(ctx, [[565, 0], [880, 0], [1090, 168], [440, 200]], '#2f7bd0', 0.92);
    poly(ctx, [[0, 0], [565, 0], [430, 205], [0, 140]], '#ffffff');
    poly(ctx, [[875, 0], [1400, 0], [1400, 140], [1100, 190]], BLUE);
    poly(ctx, [[400, 990], [790, 772], [1400, 758], [1400, 990]], st.accent);
    poly(ctx, [[655, 990], [770, 788], [1115, 812], [1075, 990]], '#fffffb');

    if (st.showUmk) drawUmk(ctx, 115, 73, 1);
    drawWordmark(ctx, R, 1070, 100, 285, { greenIt: st.greenIt });

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

    text(ctx, dateStr(st), 806, 840, { weight: 700, size: 20.5, family: 'arial' });
    text(ctx, timeStr(st), 806, 862, { weight: 700, size: 20.5, family: 'arial' });
    lines(ctx, placeLines(st), 803, 902, 20.5, { weight: 300, size: 20, color: '#222' });

    qrs(st).forEach((q, i) => qrItem(ctx, q, 1268, 1285, 802 + i * 92, 54, { labelSize: 20, family: 'arial' }));
  }

  function classicBanner(ctx, R) {
    const st = R.st;
    rect(ctx, 0, 0, 1400, 735, '#ffffff');
    rect(ctx, 0, 0, 760, 735, st.bgColor);
    drawPhoto(ctx, R, { x: 0, y: 0, w: 760, h: 735 });
    poly(ctx, [[612, 0], [1400, 0], [1400, 97], [760, 160]], BLUE);
    drawWordmark(ctx, R, 818, 93, 292, { greenIt: st.greenIt });

    const sps = speakerList(st);
    const affH = st.affiliation ? 28 : 0;
    const spH = sps.length ? (sps.length - 1) * 32 + affH : 0;
    // tytuł + prelegenci muszą skończyć się nad blokiem daty (~505)
    let fit, gap;
    for (let s = 34 * st.titleScale; s >= 20; s -= 1) {
      fit = fitRich(ctx, st.title, { weight: 900, size: s, minSize: s, lh: 1.17, maxW: 545, upper: st.titleUpper });
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
      rect(ctx, 1158, 515, 194, q.length > 1 ? 171 : 82, st.accent);
      q.forEach((it, i) => qrItem(ctx, it, 1268, 1278, 520 + i * 92, 62, { labelSize: 21, family: 'arial' }));
    }
  }

  // =====================================================================
  //  SZABLON: CIEMNY (pełne zdjęcie, ciemny pasek u góry)
  // =====================================================================
  function shadeV(ctx, x, y, w, h, a, from, to) {
    if (a <= 0) return;
    const g = ctx.createLinearGradient(0, from, 0, to);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }

  function darkA4p(ctx, R) {
    const st = R.st;
    rect(ctx, 0, 0, 990, 1400, st.bgColor);
    drawPhoto(ctx, R, { x: 0, y: 0, w: 990, h: 1400 });
    shadeV(ctx, 0, 600, 990, 800, st.shade, 600, 1150);
    rect(ctx, 0, 0, 990, 218, 'rgba(28,28,28,0.88)');
    drawWordmark(ctx, R, 290, 125, 410, { greenIt: st.greenIt, glow: true, tagline: true, taglineColor: '#ddd' });

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
      g.addColorStop(0, `rgba(0,0,0,${st.shade})`);
      g.addColorStop(0.55, `rgba(0,0,0,${st.shade * 0.7})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1400, 735);
    }
    drawWordmark(ctx, R, 115, 90, 385, { greenIt: st.greenIt, glow: true, tagline: true, taglineColor: '#ddd' });

    ctx.save();
    setShadow(ctx, R, true, 25);
    text(ctx, (st.affiliation || '').toLocaleUpperCase('pl-PL'), 117, 172, { weight: 300, size: 25, color: '#fff' });
    text(ctx, speakerList(st).join(', ').toLocaleUpperCase('pl-PL'), 117, 218, { weight: 700, size: 26, color: '#fff' });
    ctx.restore();

    const pl = placeLines(st);
    let fit;
    for (let s = 46 * st.titleScale; s >= 22; s -= 1) {
      fit = fitRich(ctx, st.title, { weight: 700, size: s, minSize: s, lh: 1.13, maxW: 600, upper: st.titleUpper });
      if (270 + (fit.lines.length - 1) * fit.lh + 73 + 30 + 53 + (pl.length - 1) * 29 <= 565) break;
    }
    const last = drawRich(ctx, R, fit, 115, 270, { align: 'left', color: '#fff', shadow: true });
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

  function blockA4p(ctx, R) {
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
    if (st.showUmk) drawUmk(ctx, 103, 108, 0.83);
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
      ctx.fillRect(0, 145, 1400, 590);
    }
    rect(ctx, 0, 0, 650, 145, BLUE);
    rect(ctx, 650, 0, 750, 145, 'rgba(2,76,161,0.6)');
    drawWordmark(ctx, R, 115, 90, 385, { greenIt: st.greenIt, tagline: true });

    qrs(st, 'rev').forEach((it, i) => qrItem(ctx, it, 978 + i * 282, 1003 + i * 277, 45, 66, { labelSize: 25, labelWeight: 900, color: '#fff' }));

    const light = titleLight(st, false);
    const tc = light ? '#fff' : '#111';
    const pl = placeLines(st);
    const sp = names(st) + (st.affiliation ? ` (${st.affiliation})` : '');
    ctx.save();
    setShadow(ctx, R, light, 26);
    text(ctx, sp, 115, 220, { weight: 900, size: 26, color: tc });
    ctx.restore();
    let fit;
    for (let s = 46 * st.titleScale; s >= 22; s -= 1) {
      fit = fitRich(ctx, st.title, { weight: 900, size: s, minSize: s, lh: 1.13, maxW: 640, upper: st.titleUpper });
      if (270 + (fit.lines.length - 1) * fit.lh + 79 + 30 + 52 + (pl.length - 1) * 28 <= 705) break;
    }
    const last = drawRich(ctx, R, fit, 115, 270, { align: 'left', color: tc, shadow: light });
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

  // ---------- NOWOCZESNY ----------
  function modernA4p(ctx, R) {
    const st = R.st;
    rect(ctx, 0, 0, 990, 1400, BLUE);
    ctx.save();
    clipPoly(ctx, [[0, 0], [990, 0], [990, 760], [0, 880]]);
    rect(ctx, 0, 0, 990, 880, st.bgColor);
    drawPhoto(ctx, R, { x: 0, y: 0, w: 990, h: 880 });
    ctx.restore();
    poly(ctx, [[0, 880], [990, 760], [990, 774], [0, 894]], GREEN);

    if (st.showUmk) {
      poly(ctx, [[0, 0], [400, 0], [372, 170], [0, 170]], '#fff');
      drawUmk(ctx, 95, 88, 0.88);
    }
    poly(ctx, [[640, 0], [990, 0], [990, 140], [616, 140]], BLUE);
    drawWordmark(ctx, R, 665, 88, 285, { greenIt: st.greenIt });

    const sps = names(st);
    const fit = fitTitleUntil(ctx, st, { top: 965, size: 66 * st.titleScale, minSize: 30, lh: 1.04, maxW: 850, weight: 900 }, 1170,
      () => (sps ? 58 : 0));
    const last = drawRich(ctx, R, fit, 70, 965, { align: 'left', color: '#fff' });
    if (sps) {
      text(ctx, sps, 72, last + 58, { weight: 900, size: 30, color: GREEN });
      if (st.affiliation) {
        ctx.font = font(900, 30);
        const w = ctx.measureText(sps).width;
        text(ctx, '  ·  ' + st.affiliation, 72 + w, last + 58, { weight: 300, size: 28, color: '#fff' });
      }
    }

    rect(ctx, 70, 1215, 850, 2, 'rgba(255,255,255,0.3)');
    const dp = dateParts(st);
    if (dp) {
      text(ctx, String(dp.d), 66, 1340, { weight: 900, size: 110, color: '#fff' });
      ctx.font = font(900, 110);
      const dx = 66 + ctx.measureText(String(dp.d)).width + 18;
      text(ctx, `${dp.month} ${dp.y}`, dx, 1285, { weight: 900, size: 28, color: '#fff' });
      text(ctx, dp.weekday, dx, 1313, { weight: 400, size: 22, color: '#cfe0f5' });
      text(ctx, timeStr(st, true), dx, 1338, { weight: 400, size: 22, color: '#cfe0f5' });
    }
    lines(ctx, placeLines(st), 445, 1283, 26, { weight: 400, size: 21, color: '#cfe0f5' });
    const q = qrs(st);
    q.forEach((it, i) => qrTile(ctx, it, 920 - (q.length - i) * 96 + 6, 1245, 86, '#fff'));
  }

  function modernBanner(ctx, R) {
    const st = R.st;
    rect(ctx, 0, 0, 1400, 735, BLUE);
    ctx.save();
    clipPoly(ctx, [[660, 0], [1400, 0], [1400, 735], [540, 735]]);
    rect(ctx, 540, 0, 860, 735, st.bgColor);
    drawPhoto(ctx, R, { x: 540, y: 0, w: 860, h: 735 });
    ctx.restore();
    poly(ctx, [[646, 0], [660, 0], [540, 735], [526, 735]], GREEN);

    drawWordmark(ctx, R, 70, 95, 270, { greenIt: st.greenIt, tagline: true, taglineColor: '#cfe0f5' });
    const sps = names(st);
    const fit = fitTitleUntil(ctx, st, { top: 215, size: 50 * st.titleScale, minSize: 24, lh: 1.08, maxW: 470, weight: 900 }, 545,
      () => (sps ? 50 : 0) + (st.affiliation ? 30 : 0));
    const last = drawRich(ctx, R, fit, 70, 215, { align: 'left', color: '#fff' });
    if (sps) text(ctx, sps, 72, last + 50, { weight: 900, size: 26, color: GREEN });
    if (st.affiliation) text(ctx, st.affiliation, 72, last + 80, { weight: 300, size: 23, color: '#fff' });

    const dp = dateParts(st);
    if (dp) {
      text(ctx, String(dp.d), 66, 665, { weight: 900, size: 88, color: '#fff' });
      ctx.font = font(900, 88);
      const dx = 66 + ctx.measureText(String(dp.d)).width + 14;
      text(ctx, `${dp.month} ${dp.y}`, dx, 622, { weight: 900, size: 24, color: '#fff' });
      text(ctx, `${dp.weekday}, ${timeStr(st, true)}`, dx, 648, { size: 19, color: '#cfe0f5' });
      textFit(ctx, placeOneLine(st), dx, 672, 500 - dx, { size: 16, color: '#cfe0f5' });
    }
    const q = qrs(st);
    if (q.length) {
      const w = q.length * 96 + 14;
      roundRect(ctx, 1370 - w, 560, w, 150, 12, 'rgba(1,33,79,0.82)');
      q.forEach((it, i) => qrTile(ctx, it, 1370 - w + 14 + i * 96, 574, 82, '#fff'));
    }
  }

  // ---------- DUOTONE ----------
  const DUO = {
    bluegreen: ['#011a40', '#c8f07a'],
    blue: ['#011a40', '#8fd3ff'],
    mono: ['#141414', '#f2f2f2'],
    sunset: ['#2a0c4e', '#ff9a4a'],
  };
  function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

  function drawPhotoDuo(ctx, R, r) {
    if (!R.img) { drawPhoto(ctx, R, r); return; }
    const k = R.k;
    const w = Math.max(1, Math.round(r.w * k));
    const h = Math.max(1, Math.round(r.h * k));
    const oc = document.createElement('canvas');
    oc.width = w;
    oc.height = h;
    const o = oc.getContext('2d');
    o.setTransform(k, 0, 0, k, -r.x * k, -r.y * k);
    drawPhoto(o, R, r);
    const [d, l] = (DUO[R.st.duo] || DUO.bluegreen).map(hex);
    const id = o.getImageData(0, 0, w, h);
    const p = id.data;
    for (let i = 0; i < p.length; i += 4) {
      let t = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255;
      t = t * t * (3 - 2 * t); // lekkie podbicie kontrastu
      p[i] = d[0] + (l[0] - d[0]) * t;
      p[i + 1] = d[1] + (l[1] - d[1]) * t;
      p[i + 2] = d[2] + (l[2] - d[2]) * t;
    }
    o.putImageData(id, 0, 0);
    ctx.drawImage(oc, r.x, r.y, r.w, r.h);
  }

  function datePill(ctx, st, x, y, size, color, bg) {
    const dl = [dateStr(st), timeStr(st, true)].filter(Boolean).join('  ·  ');
    if (!dl) return 0;
    ctx.font = font(900, size);
    const w = ctx.measureText(dl).width + size * 1.4;
    roundRect(ctx, x, y, w, size * 1.9, size * 0.95, bg);
    text(ctx, dl, x + size * 0.7, y + size * 1.3, { weight: 900, size, color });
    return w;
  }

  function duoA4p(ctx, R) {
    const st = R.st;
    const dark = (DUO[st.duo] || DUO.bluegreen)[0];
    rect(ctx, 0, 0, 990, 1400, dark);
    drawPhotoDuo(ctx, R, { x: 0, y: 0, w: 990, h: 1400 });
    const g = ctx.createLinearGradient(0, 560, 0, 1150);
    g.addColorStop(0, 'rgba(1,20,50,0)');
    g.addColorStop(1, `rgba(1,20,50,${0.5 + st.shade * 0.5})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 560, 990, 840);
    const gt = ctx.createLinearGradient(0, 0, 0, 260);
    gt.addColorStop(0, 'rgba(1,20,50,0.55)');
    gt.addColorStop(1, 'rgba(1,20,50,0)');
    ctx.fillStyle = gt;
    ctx.fillRect(0, 0, 990, 260);

    drawWordmark(ctx, R, 70, 130, 360, { greenIt: st.greenIt, tagline: true, taglineColor: '#e6eef8' });
    if (st.showUmk) {
      drawUmk(ctx, 708, 108, 0.92, 'neg');
    }

    const sp = names(st) + (st.affiliation ? `  ·  ${st.affiliation}` : '');
    const fit = fitRich(ctx, st.title, { weight: 900, size: 68 * st.titleScale, minSize: 30, lh: 1.04, maxW: 850, maxH: 4 * 72 * st.titleScale, upper: st.titleUpper });
    const lastBl = 1105;
    const firstBl = lastBl - (fit.lines.length - 1) * fit.lh;
    ctx.save();
    setShadow(ctx, R, true, 24);
    text(ctx, sp.toLocaleUpperCase('pl-PL'), 72, firstBl - fit.size * 1.05, { weight: 900, size: 24, color: GREEN });
    ctx.restore();
    drawRich(ctx, R, fit, 70, firstBl, { align: 'left', color: '#fff', shadow: true });

    datePill(ctx, st, 70, 1150, 26, NAVY, GREEN);
    lines(ctx, placeLines(st), 72, 1268, 25, { weight: 400, size: 21, color: '#e6eef8' });
    const q = qrs(st);
    q.forEach((it, i) => qrTile(ctx, it, 920 - (q.length - i) * 100 + 14, 1232, 86, '#fff'));
  }

  function duoBanner(ctx, R) {
    const st = R.st;
    const dark = (DUO[st.duo] || DUO.bluegreen)[0];
    rect(ctx, 0, 0, 1400, 735, dark);
    drawPhotoDuo(ctx, R, { x: 0, y: 0, w: 1400, h: 735 });
    const g = ctx.createLinearGradient(0, 0, 1000, 0);
    g.addColorStop(0, `rgba(1,20,50,${0.55 + st.shade * 0.45})`);
    g.addColorStop(0.6, `rgba(1,20,50,${0.35 + st.shade * 0.4})`);
    g.addColorStop(1, 'rgba(1,20,50,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1400, 735);

    drawWordmark(ctx, R, 70, 95, 270, { greenIt: st.greenIt, tagline: true, taglineColor: '#e6eef8' });
    const sp = names(st) + (st.affiliation ? `  ·  ${st.affiliation}` : '');
    ctx.save();
    setShadow(ctx, R, true, 22);
    text(ctx, sp.toLocaleUpperCase('pl-PL'), 72, 210, { weight: 900, size: 22, color: GREEN });
    ctx.restore();
    const fit = fitTitleUntil(ctx, st, { top: 268, size: 54 * st.titleScale, minSize: 24, lh: 1.06, maxW: 700, weight: 900 }, 545, () => 0);
    drawRich(ctx, R, fit, 70, 268, { align: 'left', color: '#fff', shadow: true });
    datePill(ctx, st, 70, 585, 23, NAVY, GREEN);
    textFit(ctx, placeOneLine(st), 72, 676, 1000, { size: 19, color: '#e6eef8' });
    const q = qrs(st);
    q.forEach((it, i) => qrTile(ctx, it, 1340 - (q.length - i) * 98 + 12, 575, 86, '#fff'));
  }

  // ---------- MINIMALNY ----------
  const PAPER = '#fbfbf7';

  function minimalA4p(ctx, R) {
    const st = R.st;
    rect(ctx, 0, 0, 990, 1400, PAPER);
    rect(ctx, 60, 60, 340, 92, BLUE);
    drawWordmark(ctx, R, 82, 122, 296, { greenIt: st.greenIt });
    if (st.showUmk) drawUmk(ctx, 692, 106, 0.85);

    const dp = dateParts(st);
    if (dp) {
      text(ctx, `${dp.dd}.${dp.mm}`, 52, 410, { weight: 900, size: 200, color: BLUE });
      text(ctx, `${dp.weekday}, ${dp.d} ${dp.month} ${dp.y}`, 62, 466, { weight: 700, size: 28, color: '#111' });
      text(ctx, timeStr(st), 62, 500, { weight: 400, size: 26, color: '#444' });
    }

    rect(ctx, 76, 556, 870, 450, GREEN);
    rect(ctx, 60, 540, 870, 450, st.bgColor);
    drawPhoto(ctx, R, { x: 60, y: 540, w: 870, h: 450 });

    const sps = names(st);
    const fit = fitTitleUntil(ctx, st, { top: 1088, size: 58 * st.titleScale, minSize: 26, lh: 1.06, maxW: 870, weight: 900 }, 1268,
      () => (sps ? 50 : 0));
    const last = drawRich(ctx, R, fit, 60, 1088, { align: 'left', color: '#111' });
    if (sps) {
      text(ctx, sps, 62, last + 50, { weight: 900, size: 28, color: BLUE });
      if (st.affiliation) {
        ctx.font = font(900, 28);
        text(ctx, '  —  ' + st.affiliation, 62 + ctx.measureText(sps).width, last + 50, { weight: 400, size: 26, color: '#555' });
      }
    }

    rect(ctx, 60, 1290, 870, 3, '#111');
    const pl = placeLines(st);
    const pl2 = pl.length > 2 ? [pl.slice(0, -1).join(' '), pl[pl.length - 1]] : pl;
    lines(ctx, pl2, 60, 1330, 25, { weight: 400, size: 20, color: '#333' });
    const q = qrs(st);
    q.forEach((it, i) => qrTile(ctx, it, 930 - (q.length - i) * 84 + 18, 1306, 66, '#333'));
  }

  function minimalBanner(ctx, R) {
    const st = R.st;
    rect(ctx, 0, 0, 1400, 735, PAPER);
    rect(ctx, 946, 74, 400, 600, GREEN);
    rect(ctx, 930, 58, 400, 600, st.bgColor);
    drawPhoto(ctx, R, { x: 930, y: 58, w: 400, h: 600 });

    rect(ctx, 60, 58, 280, 76, BLUE);
    drawWordmark(ctx, R, 78, 110, 244, { greenIt: st.greenIt });
    const dp = dateParts(st);
    if (dp) {
      text(ctx, `${dp.dd}.${dp.mm}`, 54, 275, { weight: 900, size: 128, color: BLUE });
      ctx.font = font(900, 128);
      const dx = 54 + ctx.measureText(`${dp.dd}.${dp.mm}`).width + 26;
      text(ctx, `${dp.weekday}, ${dp.d} ${dp.month} ${dp.y}`, dx, 232, { weight: 700, size: 24, color: '#111' });
      text(ctx, timeStr(st), dx, 266, { weight: 400, size: 22, color: '#444' });
    }
    const sps = names(st);
    const fit = fitTitleUntil(ctx, st, { top: 360, size: 46 * st.titleScale, minSize: 22, lh: 1.08, maxW: 800, weight: 900 }, 585,
      () => (sps ? 44 : 0));
    const last = drawRich(ctx, R, fit, 60, 360, { align: 'left', color: '#111' });
    if (sps) text(ctx, sps + (st.affiliation ? `  —  ${st.affiliation}` : ''), 62, last + 44, { weight: 900, size: 24, color: BLUE });

    rect(ctx, 60, 612, 820, 3, '#111');
    textFit(ctx, placeOneLine(st), 60, 652, 680, { size: 18, color: '#333' });
    const q = qrs(st);
    q.forEach((it, i) => qrTile(ctx, it, 880 - (q.length - i) * 64 + 8, 628, 52, '#333'));
  }

  const TEMPLATES = {
    classic: { label: 'Klasyczny', group: 'orig', formats: { a4p: classicA4p, a4l: classicA4l, banner: classicBanner } },
    dark: { label: 'Ciemny', group: 'orig', formats: { a4p: darkA4p, banner: darkBanner } },
    block: { label: 'Blokowy', group: 'orig', formats: { a4p: blockA4p, banner: blockBanner } },
    modern: { label: 'Nowoczesny', group: 'new', formats: { a4p: modernA4p, banner: modernBanner } },
    duo: { label: 'Duotone', group: 'new', formats: { a4p: duoA4p, banner: duoBanner } },
    minimal: { label: 'Minimalny', group: 'new', formats: { a4p: minimalA4p, banner: minimalBanner } },
  };

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
    const R = { st, img: o.img, framing: o.framing, k, preview: !!o.preview };
    const fn = TEMPLATES[st.template].formats[o.format];
    fn(ctx, R);
    return R;
  }

  window.Poster = { render, loadLogos, FORMATS, TEMPLATES, MONTHS, DUO, fontsToLoad: [
    font(300, 20), font(400, 20), font(700, 20), font(900, 20), font(700, 20, null, true), font(900, 20, null, true),
  ] };
})();

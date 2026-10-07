/* meetit.live – generator plakatów: UI, podgląd, eksport, zapis projektu. */
(function () {
  'use strict';

  const { render, FORMATS, TEMPLATES } = window.Poster;
  const $ = (id) => document.getElementById(id);

  const DEFAULTS = {
    template: 'classic',
    format: 'a4p',
    title: 'Jak AI korzysta\nz wiedzy, którą\njej dostarczasz?',
    titleUpper: false,
    speakers: 'Imię Nazwisko',
    affiliation: 'Firma',
    date: '2026-06-10',
    time: '18:00',
    room: 'S9',
    place: 'Wydział Matematyki\ni Informatyki UMK\nul. Chopina 12/18, Toruń',
    accent: '#d6f1fc',
    bgColor: '#e9edf2',
    band: true,
    bandOpacity: 0.6,
    shade: 0.45,
    titleColor: 'auto',
    titleScale: 1,
    greenIt: true,
    showQr: true,
    duo: 'bluegreen',
    qr1: { label: 'Więcej:', text: 'meetit.live', url: 'https://meetit.live' },
    qr2: { label: 'Zapisy:', text: 'evenea.pl', url: 'https://evenea.pl' },
    framing: {},
  };

  const ACCENTS = [
    ['#d6f1fc', 'jasnoniebieski'], ['#48c4e6', 'turkusowy'], ['#a1b465', 'oliwkowy'],
    ['#ff7c44', 'pomarańczowy'], ['#f6dd6a', 'żółty'], ['#d9d9d9', 'szary'],
  ];
  const BGS = [
    ['#e9edf2', 'jasnoszary'], ['#ffffff', 'biały'], ['#ff4f00', 'pomarańczowy'],
    ['#0d1b2a', 'granatowy'], ['#2b2b2b', 'grafitowy'],
  ];

  const LS_KEY = 'meetit-gen:v1';
  const clone = (o) => JSON.parse(JSON.stringify(o));

  let st = clone(DEFAULTS);
  let photoURL = null; // dataURL oryginalnego zdjęcia
  let img = null;      // HTMLImageElement
  let lastR = null;    // wynik ostatniego renderu podglądu
  let cssW = 0;
  let cssH = 0;

  // ---------------------------------------------------------------- storage
  const idb = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => {
        try {
          const r = indexedDB.open('meetit-gen', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('kv');
          r.onsuccess = () => { this.db = r.result; res(this.db); };
          r.onerror = () => rej(r.error);
        } catch (e) { rej(e); }
      });
    },
    async get(k) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const q = db.transaction('kv').objectStore('kv').get(k);
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      });
    },
    async set(k, v) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const t = db.transaction('kv', 'readwrite');
        if (v == null) t.objectStore('kv').delete(k); else t.objectStore('kv').put(v, k);
        t.oncomplete = () => res();
        t.onerror = () => rej(t.error);
      });
    },
  };

  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify(st)); } catch (e) { /* brak miejsca / tryb prywatny */ }
    }, 300);
  }
  function persistPhoto() {
    idb.set('photo', photoURL).catch(() => {});
  }

  function restoreState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) st = Object.assign(clone(DEFAULTS), JSON.parse(raw));
    } catch (e) { /* ignoruj */ }
  }

  async function restorePhoto() {
    try {
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000));
      const p = await Promise.race([idb.get('photo'), timeout]);
      if (p && !img) await setPhoto(p, { keepFraming: true, silent: true });
    } catch (e) { /* ignoruj */ }
  }

  // ---------------------------------------------------------------- helpers
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function framingFor(format, template = st.template) {
    const key = `${template}:${format}`;
    if (!st.framing[key]) st.framing[key] = { cx: 0.5, cy: 0.4, zoom: 1 };
    return st.framing[key];
  }

  function fileBase(format) {
    let d = 'meetit';
    if (st.date) {
      const [y, m, day] = st.date.split('-');
      d = `${day}${m}${y.slice(2)}`;
    }
    return d + FORMATS[format].suffix;
  }

  function loadImage(src) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = src;
    });
  }

  function readFile(file, as) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      if (as === 'text') r.readAsText(file); else r.readAsDataURL(file);
    });
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ---------------------------------------------------------------- photo
  async function setPhoto(dataURL, o = {}) {
    try {
      img = await loadImage(dataURL);
    } catch (e) {
      toast('Nie udało się wczytać obrazu');
      return;
    }
    photoURL = dataURL;
    if (!o.keepFraming) st.framing = {};
    if (!o.silent) persistPhoto();
    syncPhotoUI();
    draw();
    persist();
  }

  function removePhoto() {
    img = null;
    photoURL = null;
    st.framing = {};
    persistPhoto();
    syncPhotoUI();
    draw();
    persist();
  }

  function syncPhotoUI() {
    const dz = $('dropzone');
    const t = $('dropText');
    $('photoControls').hidden = !img;
    dz.classList.toggle('has', !!img);
    dz.querySelectorAll('img').forEach((n) => n.remove());
    if (img) {
      const th = document.createElement('img');
      th.src = photoURL;
      th.alt = '';
      dz.insertBefore(th, t);
      t.textContent = `${img.naturalWidth}×${img.naturalHeight} px – kliknij, aby zmienić`;
    } else {
      t.textContent = 'Wybierz plik lub przeciągnij zdjęcie';
    }
    $('preview').classList.toggle('nophoto', !img);
  }

  async function handlePhotoFile(file) {
    if (!file || !file.type.startsWith('image/')) { toast('To nie jest plik graficzny'); return; }
    await setPhoto(await readFile(file));
    toast('Zdjęcie wczytane – przeciągnij podgląd, by ustawić kadr');
  }

  // ---------------------------------------------------------------- render
  function fitPreview() {
    const wrap = $('canvasWrap');
    const [dw, dh] = FORMATS[st.format].design;
    const cs = getComputedStyle(wrap);
    const aw = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const ah = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    // na wąskim ekranie podgląd zajmuje pełną szerokość, wysokość wynika z proporcji
    const narrow = window.matchMedia('(max-width: 900px)').matches;
    const s = Math.max(0.05, narrow ? aw / dw : Math.min(aw / dw, ah / dh));
    cssW = Math.floor(dw * s);
    cssH = Math.floor(dh * s);
  }

  let raf = 0;
  function draw() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(drawNow);
  }
  function drawNow() {
    fitPreview();
    const cv = $('preview');
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const [dw] = FORMATS[st.format].design;
    lastR = render(cv, st, { format: st.format, img, framing: framingFor(st.format), scale: (cssW / dw) * dpr, preview: true });
    cv.style.width = cssW + 'px';
    cv.style.height = cssH + 'px';
    const f = FORMATS[st.format];
    $('meta').textContent = `${TEMPLATES[st.template].label} · ${f.label} · ${f.px[0]}×${f.px[1]} px` +
      (st.format !== 'banner' ? ' (300 dpi)' : '') + ` · plik: ${fileBase(st.format)}`;
    $('zoom').value = framingFor(st.format).zoom;
    $('zoomOut').textContent = Math.round(framingFor(st.format).zoom * 100) + '%';
  }

  // ---------------------------------------------------------------- export
  function renderExport(format) {
    const fmt = FORMATS[format];
    const q = Number($('quality').value) || 1;
    const c = document.createElement('canvas');
    render(c, st, { format, img, framing: clone(framingFor(format)), scale: (fmt.px[0] / fmt.design[0]) * q });
    return c;
  }

  function canvasBlob(c, type, quality) {
    return new Promise((res) => c.toBlob(res, type, quality));
  }

  async function exportAs(format, kind) {
    const base = fileBase(format);
    const c = renderExport(format);
    if (kind === 'png') {
      download(await canvasBlob(c, 'image/png'), base + '.png');
    } else if (kind === 'jpg') {
      download(await canvasBlob(c, 'image/jpeg', 0.93), base + '.jpg');
    } else if (kind === 'pdf') {
      const JsPDF = window.jspdf && window.jspdf.jsPDF;
      if (!JsPDF) { toast('Biblioteka PDF jeszcze się ładuje – spróbuj za chwilę'); return; }
      const data = c.toDataURL('image/jpeg', 0.95);
      let doc;
      if (format === 'a4p') {
        doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        doc.addImage(data, 'JPEG', 0, 0, 210, 297);
      } else if (format === 'a4l') {
        doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        doc.addImage(data, 'JPEG', 0, 0, 297, 210);
      } else {
        const [w, h] = FORMATS[format].px;
        doc = new JsPDF({ orientation: 'landscape', unit: 'pt', format: [w, h] });
        doc.addImage(data, 'JPEG', 0, 0, w, h);
      }
      download(doc.output('blob'), base + '.pdf');
    }
  }

  async function withBusy(btn, fn) {
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '…';
    await new Promise((r) => setTimeout(r, 30));
    try { await fn(); } catch (e) { console.error(e); toast('Błąd eksportu: ' + e.message); }
    btn.disabled = false;
    btn.textContent = old;
  }

  // ---------------------------------------------------------------- bindings
  const TEXT_FIELDS = ['title', 'speakers', 'affiliation', 'date', 'time', 'room', 'place', 'titleColor', 'duo'];
  const CHECKS = ['titleUpper', 'band', 'greenIt', 'showQr'];
  const RANGES = [
    ['bandOpacity', (v) => Math.round(v * 100) + '%'],
    ['shade', (v) => Math.round(v * 100) + '%'],
    ['titleScale', (v) => Math.round(v * 100) + '%'],
  ];
  const QR_FIELDS = ['label', 'text', 'url'];

  function syncForm() {
    TEXT_FIELDS.forEach((k) => { $(k).value = st[k] ?? ''; });
    CHECKS.forEach((k) => { $(k).checked = !!st[k]; });
    RANGES.forEach(([k, f]) => { $(k).value = st[k]; $(k + 'Out').textContent = f(st[k]); });
    ['qr1', 'qr2'].forEach((q) => QR_FIELDS.forEach((f) => { $(q + f).value = st[q][f] || ''; }));
    buildSegs();
    buildSwatches();
    syncVisibility();
    syncPhotoUI();
  }

  function syncVisibility() {
    const t = st.template;
    const hasBand = t === 'classic' || t === 'block';
    $('accentSwatches').parentElement.hidden = t !== 'classic';
    $('band').parentElement.hidden = !hasBand;
    $('bandOpacityField').hidden = !hasBand || !st.band;
    $('bandLabel').textContent = t === 'block' ? 'Jasny pas pod tytułem' : 'Półprzezroczysty pas pod tytułem';
    $('shadeField').hidden = t !== 'dark' && t !== 'duo';
    $('duo').parentElement.hidden = t !== 'duo';
    $('titleColor').parentElement.hidden = !hasBand;
    $('qrFields').hidden = !st.showQr;
    $('btnPdf').disabled = st.format === 'banner';
    $('btnPdf').title = st.format === 'banner' ? 'PDF dostępny dla formatów A4' : '';
  }

  function buildSegs() {
    const tw = $('templates');
    tw.innerHTML = '';
    const groups = { orig: 'Na wzór dotychczasowych plakatów', new: 'Nowe propozycje' };
    Object.entries(groups).forEach(([g, label]) => {
      const cap = document.createElement('div');
      cap.className = 'seg-caption';
      cap.textContent = label;
      const seg = document.createElement('div');
      seg.className = 'seg';
      tw.append(cap, seg);
      groups[g] = seg;
    });
    Object.entries(TEMPLATES).forEach(([k, t]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = t.label;
      b.setAttribute('aria-pressed', String(st.template === k));
      b.onclick = () => {
        st.template = k;
        if (!TEMPLATES[k].formats[st.format]) st.format = 'a4p';
        buildSegs();
        syncVisibility();
        draw();
        persist();
      };
      groups[t.group].appendChild(b);
    });
    const fw = $('formats');
    fw.innerHTML = '';
    Object.entries(FORMATS).forEach(([k, f]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = f.label;
      const ok = !!TEMPLATES[st.template].formats[k];
      b.disabled = !ok;
      if (!ok) b.title = 'Niedostępny w tym szablonie';
      b.setAttribute('aria-pressed', String(st.format === k));
      b.onclick = () => {
        st.format = k;
        buildSegs();
        syncVisibility();
        draw();
        persist();
      };
      fw.appendChild(b);
    });
  }

  function buildSwatches() {
    const make = (wrapId, list, key) => {
      const w = $(wrapId);
      w.innerHTML = '';
      list.forEach(([c, name]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch';
        b.style.background = c;
        b.title = name;
        b.setAttribute('aria-label', name);
        b.setAttribute('aria-pressed', String(st[key].toLowerCase() === c));
        b.onclick = () => { st[key] = c; buildSwatches(); draw(); persist(); };
        w.appendChild(b);
      });
      const inp = document.createElement('input');
      inp.type = 'color';
      inp.value = st[key];
      inp.title = 'Własny kolor';
      inp.oninput = () => {
        st[key] = inp.value;
        w.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-pressed', 'false'));
        draw();
        persist();
      };
      w.appendChild(inp);
    };
    make('accentSwatches', ACCENTS, 'accent');
    make('bgSwatches', BGS, 'bgColor');
  }

  function bind() {
    TEXT_FIELDS.forEach((k) => $(k).addEventListener('input', () => { st[k] = $(k).value; draw(); persist(); }));
    CHECKS.forEach((k) => $(k).addEventListener('change', () => { st[k] = $(k).checked; syncVisibility(); draw(); persist(); }));
    RANGES.forEach(([k, f]) => $(k).addEventListener('input', () => {
      st[k] = Number($(k).value);
      $(k + 'Out').textContent = f(st[k]);
      draw();
      persist();
    }));
    ['qr1', 'qr2'].forEach((q) => QR_FIELDS.forEach((f) => $(q + f).addEventListener('input', () => {
      st[q][f] = $(q + f).value;
      draw();
      persist();
    })));

    // zdjęcie
    $('filePhoto').addEventListener('change', (e) => { handlePhotoFile(e.target.files[0]); e.target.value = ''; });
    $('zoom').addEventListener('input', () => {
      framingFor(st.format).zoom = Number($('zoom').value);
      draw();
      persist();
    });
    $('btnFit').onclick = () => { delete st.framing[`${st.template}:${st.format}`]; draw(); persist(); };
    $('btnRemovePhoto').onclick = removePhoto;

    const dz = $('dropzone');
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('over')));
    dz.addEventListener('drop', (e) => { e.preventDefault(); handlePhotoFile(e.dataTransfer.files[0]); });

    const wrap = $('canvasWrap');
    wrap.addEventListener('dragover', (e) => e.preventDefault());
    wrap.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handlePhotoFile(e.dataTransfer.files[0]); });
    window.addEventListener('paste', (e) => {
      const it = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (it) handlePhotoFile(it.getAsFile());
    });

    bindCanvasPan();

    // eksport
    document.querySelectorAll('[data-export]').forEach((b) => {
      b.addEventListener('click', () => withBusy(b, () => exportAs(st.format, b.dataset.export)));
    });
    $('btnAll').addEventListener('click', () => withBusy($('btnAll'), async () => {
      for (const f of Object.keys(TEMPLATES[st.template].formats)) {
        await exportAs(f, 'png');
        await new Promise((r) => setTimeout(r, 400));
      }
    }));

    // projekt
    $('btnSave').onclick = () => {
      const data = { app: 'meetit-gen', version: 1, state: st, photo: photoURL };
      download(new Blob([JSON.stringify(data)], { type: 'application/json' }), fileBase(st.format).replace(/[A-Z]$/, '') + '-projekt.json');
    };
    $('fileProject').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const data = JSON.parse(await readFile(f, 'text'));
        if (data.app !== 'meetit-gen') throw new Error('nieznany format');
        st = Object.assign(clone(DEFAULTS), data.state);
        syncForm();
        if (data.photo) await setPhoto(data.photo, { keepFraming: true }); else removePhoto();
        draw();
        persist();
        toast('Projekt wczytany');
      } catch (err) {
        toast('Nie udało się wczytać projektu: ' + err.message);
      }
    });
    $('btnReset').onclick = () => {
      if (!confirm('Wyczyścić bieżący projekt i wrócić do przykładowych danych?')) return;
      st = clone(DEFAULTS);
      removePhoto();
      syncForm();
      draw();
    };

    window.addEventListener('resize', draw);
  }

  function bindCanvasPan() {
    const cv = $('preview');
    let drag = null;
    const toDesign = (dxCss) => dxCss * FORMATS[st.format].design[0] / cssW;

    cv.addEventListener('pointerdown', (e) => {
      if (!img || !lastR || !lastR.photoDraw) return;
      drag = { x: e.clientX, y: e.clientY };
      cv.setPointerCapture(e.pointerId);
      cv.classList.add('dragging');
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drag || !lastR.photoDraw) return;
      const f = framingFor(st.format);
      f.cx -= toDesign(e.clientX - drag.x) / lastR.photoDraw.dw;
      f.cy -= toDesign(e.clientY - drag.y) / lastR.photoDraw.dh;
      drag = { x: e.clientX, y: e.clientY };
      drawNow();
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      cv.classList.remove('dragging');
      persist();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);

    cv.addEventListener('wheel', (e) => {
      if (!img || !lastR || !lastR.photoDraw) return;
      e.preventDefault();
      const f = framingFor(st.format);
      const r = lastR.photoRect;
      const box = cv.getBoundingClientRect();
      const px = toDesign(e.clientX - box.left);
      const py = toDesign(e.clientY - box.top);
      const { dw, dh } = lastR.photoDraw;
      const u = f.cx + (px - (r.x + r.w / 2)) / dw;
      const v = f.cy + (py - (r.y + r.h / 2)) / dh;
      const z = Math.min(4, Math.max(1, f.zoom * Math.exp(-e.deltaY * 0.0015)));
      const k = z / f.zoom;
      f.zoom = z;
      f.cx = u - (px - (r.x + r.w / 2)) / (dw * k);
      f.cy = v - (py - (r.y + r.h / 2)) / (dh * k);
      drawNow();
      persist();
    }, { passive: false });
  }

  // ---------------------------------------------------------------- init
  function init() {
    restoreState();
    syncForm();
    bind();
    draw();
    // przerysuj po załadowaniu fontów (canvas nie robi tego sam)
    Promise.all(window.Poster.fontsToLoad.map((f) => document.fonts.load(f, 'AaĄąĘęŁłŃńÓóŚśŹźŻż')))
      .catch(() => {})
      .then(draw);
    if (document.fonts) document.fonts.addEventListener('loadingdone', draw);
    window.Poster.loadLogos().then(draw);
    restorePhoto();
  }

  init();
})();

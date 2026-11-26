/* meetit.live – generator plakatów: UI, podgląd, eksport, zapis projektu. */
(function () {
  'use strict';

  const { render, FORMATS, PAPERS, formatSize, TEMPLATES, DUO } = window.Poster;
  const $ = (id) => document.getElementById(id);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // wartości wspólne dla wszystkich trybów
  const BASE = {
    template: 'classic',
    format: 'portrait',
    paper: 'a3',
    title: 'Jak AI korzysta\nz wiedzy, którą\njej dostarczasz?',
    titleUpper: false,
    speakers: 'Imię Nazwisko',
    affiliation: 'Firma',
    speaker2: '',
    affiliation2: '',
    series: '',
    announce: '',
    invite: '',
    host: '',
    date: '2026-06-10',
    time: '18:00',
    room: 'S9',
    place: 'Wydział Matematyki\ni Informatyki UMK\nul. Chopina 12/18, Toruń',
    accent: '#d6f1fc',
    bgColor: '#e9edf2',
    band: true,
    bandOpacity: 0.6,
    shade: 0.45,
    shadeColor: '#141414',
    titleColor: 'auto',
    titleScale: 1,
    greenIt: true,
    showQr: true,
    duo: 'bluegreen',
    duoDark: '#011a40',
    duoLight: '#c8f07a',
    primary: '#024ca1',
    highlight: '#aad337',
    tint: 0.85,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    qr1: { label: 'Więcej:', text: 'meetit.live', url: 'https://meetit.live' },
    qr2: { label: 'Zapisy:', text: 'evenea.pl', url: 'https://evenea.pl' },
    framing: {},
  };

  /** Typy generatora (zakładki). slots – liczba zdjęć; każdy tryb ma własny stan i zdjęcia. */
  const MODES = {
    single: {
      slots: 1,
      lsKey: 'meetit-gen:v1',
      photoKeys: ['photo'],
      defaults: { template: 'classic' },
    },
    duo2: {
      slots: 2,
      lsKey: 'meetit-gen:v1:duo2',
      photoKeys: ['duo2:photo0', 'duo2:photo1'],
      defaults: {
        template: 'duoClassic',
        title: 'Człowiek kontra AI:\nmatematyczny pojedynek',
        speakers: 'Imię Nazwisko',
        affiliation: 'Firma',
        speaker2: 'Imię Nazwisko',
        affiliation2: 'Uczelnia',
      },
    },
    seminar: {
      slots: 0,
      lsKey: 'meetit-gen:v1:seminar',
      photoKeys: [],
      filePrefix: 'kolokwium-',
      defaults: {
        template: 'seminar',
        series: 'Kolokwium Wydziału\nMatematyki i Informatyki',
        title: 'On certain Hecke algebras\narising as deformations\nof group algebras\nof Coxeter groups',
        speakers: 'prof. dr hab. Adam Skalski',
        affiliation: 'IM PAN',
        date: '2025-11-05',
        time: '10:15',
        room: '',
        place: 'w auli WMiI UMK',
        announce: 'Kolokwium odbędzie się',
        invite: 'Serdecznie zapraszam',
        host: 'dr hab. Joanna Kułaga-Przymus, prof. UMK',
        showQr: false,
      },
    },
  };
  const defaultsFor = (m) => Object.assign(clone(BASE), clone(MODES[m].defaults));

  const ACCENTS = [
    ['#d6f1fc', 'jasnoniebieski'], ['#48c4e6', 'turkusowy'], ['#a1b465', 'oliwkowy'],
    ['#ff7c44', 'pomarańczowy'], ['#f6dd6a', 'żółty'], ['#d9d9d9', 'szary'],
  ];
  const BGS = [
    ['#e9edf2', 'jasnoszary'], ['#ffffff', 'biały'], ['#ff4f00', 'pomarańczowy'],
    ['#0d1b2a', 'granatowy'], ['#2b2b2b', 'grafitowy'],
  ];
  const PRIMARIES = [
    ['#024ca1', 'granat WMiI'], ['#0b3fe6', 'niebieski'], ['#01214f', 'ciemny granat'], ['#1c1c1c', 'grafit'],
    ['#5b2bd1', 'fiolet'], ['#b0174f', 'malinowy'], ['#00695c', 'morski'], ['#ff4f00', 'pomarańczowy'],
  ];
  const HIGHLIGHTS = [
    ['#aad337', 'limonkowy'], ['#ffcc00', 'żółty'], ['#48c4e6', 'turkusowy'], ['#ff7c44', 'pomarańczowy'],
    ['#ff6b9a', 'różowy'], ['#ffffff', 'biały'],
  ];
  const SHADES = [
    ['#141414', 'grafitowy'], ['#000000', 'czarny'], ['#01214f', 'granatowy'], ['#2a0c4e', 'fioletowy'], ['#0c2a1c', 'butelkowa zieleń'],
  ];

  const LS_MODE = 'meetit-gen:mode';
  // adres zakładki (#…) – można podlinkować konkretny typ generatora
  const HASH = { single: 'meetit', duo2: 'dwoch-prelegentow', seminar: 'seminarium' };
  const modeFromHash = () => Object.keys(HASH).find((m) => `#${HASH[m]}` === location.hash);
  function setHash() {
    try { history.replaceState(null, '', `#${HASH[mode]}`); } catch (e) { /* ignoruj */ }
  }

  let mode = 'single';
  const states = {};   // tryb → stan projektu
  const photos = {};   // tryb → [{ url, img } | null, …]
  Object.keys(MODES).forEach((m) => { states[m] = defaultsFor(m); photos[m] = []; });
  let st = states[mode];
  let lastR = null;    // wynik ostatniego renderu podglądu
  let cssW = 0;
  let cssH = 0;

  const slotCount = () => MODES[mode].slots;
  const slotImgs = (m = mode) => Array.from({ length: MODES[m].slots }, (_, i) => (photos[m][i] ? photos[m][i].img : null));
  const hasAnyPhoto = () => slotImgs().some(Boolean);

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

  const dirty = new Set();
  let saveTimer = null;
  function flush() {
    clearTimeout(saveTimer);
    dirty.forEach((m) => {
      try { localStorage.setItem(MODES[m].lsKey, JSON.stringify(states[m])); } catch (e) { /* brak miejsca / tryb prywatny */ }
    });
    dirty.clear();
  }
  function persist() {
    dirty.add(mode);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 300);
  }
  function persistPhoto(m, slot) {
    const p = photos[m][slot];
    idb.set(MODES[m].photoKeys[slot], p ? p.url : null).catch(() => {});
  }

  /** Stan z domyślnymi wartościami; zgodność ze starszymi projektami (formaty a4p/a4l, duotone z presetu). */
  function loadState(s, m) {
    const ren = { a4p: 'portrait', a4l: 'landscape' };
    if (ren[s.format]) s.format = ren[s.format];
    Object.keys(s.framing || {}).forEach((key) => {
      const [t, f] = key.split(':');
      if (ren[f]) { s.framing[`${t}:${ren[f]}`] = s.framing[key]; delete s.framing[key]; }
    });
    if (!s.duoDark && DUO[s.duo]) [s.duoDark, s.duoLight] = DUO[s.duo];
    const out = Object.assign(defaultsFor(m), s);
    delete out.mode;
    if (!TEMPLATES[out.template] || TEMPLATES[out.template].mode !== m) out.template = MODES[m].defaults.template;
    if (!TEMPLATES[out.template].formats[out.format]) out.format = 'portrait';
    if (!PAPERS[out.paper]) out.paper = BASE.paper;
    return out;
  }

  function restoreState() {
    Object.keys(MODES).forEach((m) => {
      try {
        const raw = localStorage.getItem(MODES[m].lsKey);
        if (raw) states[m] = loadState(JSON.parse(raw), m);
      } catch (e) { /* ignoruj */ }
    });
    try {
      const m = localStorage.getItem(LS_MODE);
      if (MODES[m]) mode = m;
    } catch (e) { /* ignoruj */ }
    mode = modeFromHash() || mode;
    st = states[mode];
  }

  async function restorePhotos() {
    const timeout = () => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000));
    for (const m of Object.keys(MODES)) {
      for (let i = 0; i < MODES[m].slots; i++) {
        try {
          const p = await Promise.race([idb.get(MODES[m].photoKeys[i]), timeout()]);
          if (p && !photos[m][i]) await setPhoto(m, i, p, { keepFraming: true, silent: true });
        } catch (e) { /* ignoruj */ }
      }
    }
  }

  // ---------------------------------------------------------------- helpers
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  const framingKey = (format, slot, template = st.template) => `${template}:${format}` + (slot ? `#${slot}` : '');
  function framingFor(format, slot = 0, s = st) {
    const key = framingKey(format, slot, s.template);
    if (!s.framing[key]) s.framing[key] = { cx: 0.5, cy: 0.4, zoom: 1 };
    return s.framing[key];
  }
  const framingsFor = (format) => Array.from({ length: slotCount() }, (_, i) => framingFor(format, i));

  function fileBase(format) {
    let d = 'meetit';
    if (st.date) {
      const [y, m, day] = st.date.split('-');
      d = `${day}${m}${y.slice(2)}`;
    }
    return (MODES[mode].filePrefix || '') + d + FORMATS[format].suffix;
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
  /** Usuwa zapamiętane kadry danego slotu (we wszystkich szablonach i formatach). */
  function clearFraming(s, slot) {
    Object.keys(s.framing).forEach((k) => {
      const ks = k.includes('#') ? Number(k.split('#')[1]) : 0;
      if (ks === slot) delete s.framing[k];
    });
  }

  async function setPhoto(m, slot, dataURL, o = {}) {
    let img;
    try {
      img = await loadImage(dataURL);
    } catch (e) {
      toast('Nie udało się wczytać obrazu');
      return;
    }
    photos[m][slot] = { url: dataURL, img };
    if (!o.keepFraming) clearFraming(states[m], slot);
    if (!o.silent) persistPhoto(m, slot);
    if (m === mode) {
      syncPhotoUI();
      draw();
      persist();
    }
  }

  function removePhoto(slot) {
    photos[mode][slot] = null;
    clearFraming(st, slot);
    persistPhoto(mode, slot);
    syncPhotoUI();
    draw();
    persist();
  }

  function removeAllPhotos(m) {
    for (let i = 0; i < MODES[m].slots; i++) {
      photos[m][i] = null;
      persistPhoto(m, i);
    }
  }

  async function handlePhotoFile(file, slot) {
    if (!slotCount()) { toast('Ten typ plakatu nie używa zdjęć'); return; }
    if (!file || !file.type.startsWith('image/')) { toast('To nie jest plik graficzny'); return; }
    if (slot == null) {
      slot = slotImgs().findIndex((x) => !x);
      if (slot < 0) slot = 0;
    }
    await setPhoto(mode, slot, await readFile(file));
    toast(slotCount() > 1
      ? `Zdjęcie prelegenta ${slot + 1} wczytane – przeciągnij je na podglądzie, by ustawić kadr`
      : 'Zdjęcie wczytane – przeciągnij podgląd, by ustawić kadr');
  }

  const slotEls = [];
  function buildPhotoSlots() {
    const wrap = $('photoSlots');
    wrap.innerHTML = '';
    for (let i = 0; i < 2; i++) {
      const el = document.createElement('div');
      el.className = 'photo-slot';
      el.innerHTML = `
        <div class="slot-title"></div>
        <label class="drop">
          <input type="file" accept="image/*" hidden>
          <span class="drop-text"></span>
        </label>
        <div class="slot-ctrl" hidden>
          <label class="field slim">Powiększenie <output></output>
            <input type="range" min="1" max="4" step="0.01">
          </label>
          <div class="btns">
            <button type="button" data-act="fit">Reset kadru</button>
            <button type="button" data-act="remove" class="danger">Usuń zdjęcie</button>
          </div>
        </div>`;
      const s = {
        root: el,
        title: el.querySelector('.slot-title'),
        drop: el.querySelector('.drop'),
        file: el.querySelector('input[type=file]'),
        text: el.querySelector('.drop-text'),
        ctrl: el.querySelector('.slot-ctrl'),
        zoom: el.querySelector('input[type=range]'),
        zoomOut: el.querySelector('output'),
      };
      s.file.addEventListener('change', (e) => { handlePhotoFile(e.target.files[0], i); e.target.value = ''; });
      ['dragenter', 'dragover'].forEach((ev) => s.drop.addEventListener(ev, (e) => { e.preventDefault(); s.drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((ev) => s.drop.addEventListener(ev, () => s.drop.classList.remove('over')));
      s.drop.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); handlePhotoFile(e.dataTransfer.files[0], i); });
      s.zoom.addEventListener('input', () => {
        framingFor(st.format, i).zoom = Number(s.zoom.value);
        draw();
        persist();
      });
      el.querySelector('[data-act=fit]').onclick = () => { delete st.framing[framingKey(st.format, i)]; draw(); persist(); };
      el.querySelector('[data-act=remove]').onclick = () => removePhoto(i);
      slotEls.push(s);
      wrap.appendChild(el);
    }
  }

  function syncPhotoUI() {
    const n = slotCount();
    const imgs = slotImgs();
    $('photoTitle').textContent = n > 1 ? 'Zdjęcia' : 'Zdjęcie';
    slotEls.forEach((s, i) => {
      s.root.hidden = i >= n;
      const img = imgs[i];
      const p = photos[mode][i];
      s.title.hidden = n < 2;
      s.title.textContent = `Prelegent ${i + 1}`;
      s.ctrl.hidden = !img;
      s.drop.classList.toggle('has', !!img);
      s.drop.querySelectorAll('img').forEach((x) => x.remove());
      if (img) {
        const th = document.createElement('img');
        th.src = p.url;
        th.alt = '';
        s.drop.insertBefore(th, s.text);
        s.text.textContent = `${img.naturalWidth}×${img.naturalHeight} px – kliknij, aby zmienić`;
      } else {
        s.text.textContent = 'Wybierz plik lub przeciągnij zdjęcie';
      }
    });
    $('photoControls').hidden = !imgs.some(Boolean);
    $('preview').classList.toggle('nophoto', !imgs.some(Boolean));
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
    lastR = render(cv, st, { format: st.format, imgs: slotImgs(), framings: framingsFor(st.format), scale: (cssW / dw) * dpr, preview: true });
    cv.style.width = cssW + 'px';
    cv.style.height = cssH + 'px';
    const f = formatSize(st.format, st.paper);
    $('meta').textContent = `${TEMPLATES[st.template].label} · ${f.label} · ${f.px[0]}×${f.px[1]} px` +
      (f.mm ? ' (300 dpi)' : '') + ` · plik: ${fileBase(st.format)}`;
    slotEls.forEach((s, i) => {
      if (i >= slotCount()) return;
      const z = framingFor(st.format, i).zoom;
      s.zoom.value = z;
      s.zoomOut.textContent = Math.round(z * 100) + '%';
    });
  }

  // ---------------------------------------------------------------- export
  function renderExport(format) {
    const q = Number($('quality').value) || 1;
    const c = document.createElement('canvas');
    const scale = (formatSize(format, st.paper).px[0] / FORMATS[format].design[0]) * q;
    render(c, st, { format, imgs: slotImgs(), framings: clone(framingsFor(format)), scale });
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
      const { mm } = formatSize(format, st.paper);
      let doc;
      if (mm) {
        doc = new JsPDF({ orientation: mm[0] > mm[1] ? 'landscape' : 'portrait', unit: 'mm', format: st.paper });
        doc.addImage(data, 'JPEG', 0, 0, mm[0], mm[1]);
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
  const CHECKS = ['titleUpper', 'band', 'greenIt', 'showQr'];
  const pct = (v) => Math.round(v * 100) + '%';
  const signed = (v) => (v > 0 ? '+' : '') + v;
  const RANGES = [
    ['bandOpacity', pct], ['shade', pct], ['tint', pct], ['titleScale', pct],
    ['brightness', signed], ['contrast', signed], ['saturation', signed],
  ];
  const FX = ['brightness', 'contrast', 'saturation'];
  // kontrolka wyglądu (TEMPLATES[...].uses) → element formularza, który ją zawiera
  const LOOK_FIELDS = {
    primary: 'primaryField', highlight: 'highlightField', accent: 'accentField', duo: 'duoField', tint: 'tintField',
    shade: 'shadeField', shadeColor: 'shadeColorField', band: 'bandField', titleColor: 'titleColorField',
  };
  const QR_FIELDS = ['label', 'text', 'url'];
  const keyed = () => document.querySelectorAll('[data-key]');

  function syncForm() {
    keyed().forEach((el) => { el.value = st[el.dataset.key] ?? ''; });
    CHECKS.forEach((k) => { $(k).checked = !!st[k]; });
    RANGES.forEach(([k, f]) => { $(k).value = st[k]; $(k + 'Out').textContent = f(st[k]); });
    ['qr1', 'qr2'].forEach((q) => QR_FIELDS.forEach((f) => { $(q + f).value = st[q][f] || ''; }));
    document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    syncDuo();
    buildSegs();
    buildSwatches();
    syncVisibility();
    syncPhotoUI();
  }

  function syncVisibility() {
    document.querySelectorAll('[data-modes]').forEach((el) => { el.hidden = !el.dataset.modes.split(' ').includes(mode); });
    const t = st.template;
    const uses = TEMPLATES[t].uses;
    Object.entries(LOOK_FIELDS).forEach(([k, id]) => { $(id).hidden = !uses.includes(k); });
    $('bandOpacityField').hidden = !uses.includes('band') || !st.band;
    $('bandLabel').textContent = t === 'block' ? 'Jasny pas pod tytułem' : 'Półprzezroczysty pas pod tytułem';
    $('shadeLabel').textContent = t === 'gradient' ? 'Krycie karty z tekstem' : 'Przyciemnienie zdjęcia';
    $('saturationField').hidden = t === 'duo' || t === 'duoDuo'; // duotone i tak zastępuje kolory zdjęcia
    $('qrFields').hidden = !st.showQr;
    $('btnPdf').disabled = st.format === 'banner';
    $('btnPdf').title = st.format === 'banner' ? 'PDF dostępny dla formatów A3 / A4' : '';
  }

  function syncDuo() {
    const preset = Object.keys(DUO).find((k) => DUO[k][0] === st.duoDark.toLowerCase() && DUO[k][1] === st.duoLight.toLowerCase());
    st.duo = preset || 'custom';
    $('duo').value = st.duo;
    $('duoDark').value = st.duoDark;
    $('duoLight').value = st.duoLight;
  }

  const TEMPLATE_GROUPS = {
    single: { orig: 'Na wzór dotychczasowych plakatów', new: 'Nowe propozycje' },
    duo2: { duo2: 'Szablony dla dwóch prelegentów' },
    seminar: { seminar: '' },
  };

  function buildSegs() {
    const tw = $('templates');
    tw.innerHTML = '';
    const groups = {};
    Object.entries(TEMPLATE_GROUPS[mode]).forEach(([g, label]) => {
      if (label) {
        const cap = document.createElement('div');
        cap.className = 'seg-caption';
        cap.textContent = label;
        tw.appendChild(cap);
      }
      const seg = document.createElement('div');
      seg.className = 'seg';
      tw.appendChild(seg);
      groups[g] = seg;
    });
    const list = Object.entries(TEMPLATES).filter(([, t]) => t.mode === mode);
    $('templateSection').hidden = list.length < 2;
    list.forEach(([k, t]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = t.label;
      b.setAttribute('aria-pressed', String(st.template === k));
      b.onclick = () => {
        st.template = k;
        if (!TEMPLATES[k].formats[st.format]) st.format = 'portrait';
        buildSegs();
        syncVisibility();
        draw();
        persist();
      };
      groups[t.group].appendChild(b);
    });
    const pw = $('papers');
    pw.innerHTML = '';
    Object.entries(PAPERS).forEach(([k, p]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = p.label;
      b.disabled = !FORMATS[st.format].paper;
      b.title = b.disabled ? 'Baner ma stały rozmiar w pikselach' : `${p.mm[0]}×${p.mm[1]} mm`;
      b.setAttribute('aria-pressed', String(st.paper === k));
      b.onclick = () => {
        st.paper = k;
        buildSegs();
        draw();
        persist();
      };
      pw.appendChild(b);
    });
    const fw = $('formats');
    fw.innerHTML = '';
    Object.entries(FORMATS).forEach(([k]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = formatSize(k, st.paper).label;
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
    make('primarySwatches', PRIMARIES, 'primary');
    make('highlightSwatches', HIGHLIGHTS, 'highlight');
    make('accentSwatches', ACCENTS, 'accent');
    make('shadeSwatches', SHADES, 'shadeColor');
    make('bgSwatches', BGS, 'bgColor');
  }

  function switchMode(m) {
    if (m === mode || !MODES[m]) return;
    flush();
    mode = m;
    st = states[m];
    try { localStorage.setItem(LS_MODE, m); } catch (e) { /* ignoruj */ }
    setHash();
    syncForm();
    draw();
  }

  function bind() {
    document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => switchMode(b.dataset.mode)));
    keyed().forEach((el) => el.addEventListener('input', () => { st[el.dataset.key] = el.value; draw(); persist(); }));
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

    // duotone: preset ustawia oba kolory, ręczna zmiana koloru przełącza na „Własne”
    $('duo').addEventListener('change', () => {
      if (DUO[$('duo').value]) [st.duoDark, st.duoLight] = DUO[$('duo').value];
      syncDuo();
      draw();
      persist();
    });
    ['duoDark', 'duoLight'].forEach((k) => $(k).addEventListener('input', () => {
      st[k] = $(k).value;
      syncDuo();
      draw();
      persist();
    }));

    // zdjęcia
    $('btnFx').onclick = () => {
      FX.forEach((k) => { st[k] = 0; });
      syncForm();
      draw();
      persist();
    };

    const wrap = $('canvasWrap');
    wrap.addEventListener('dragover', (e) => e.preventDefault());
    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const a = e.target === $('preview') ? areaAt(...toDesign(e)) : null;
      handlePhotoFile(file, a ? a.slot : undefined);
    });
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
      const data = { app: 'meetit-gen', version: 2, mode, state: st, photos: slotImgs().map((x, i) => (x ? photos[mode][i].url : null)) };
      download(new Blob([JSON.stringify(data)], { type: 'application/json' }), fileBase(st.format).replace(/[A-Z]$/, '') + '-projekt.json');
    };
    $('fileProject').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const data = JSON.parse(await readFile(f, 'text'));
        if (data.app !== 'meetit-gen') throw new Error('nieznany format');
        const m = MODES[data.mode] ? data.mode : 'single';
        const list = data.photos || [data.photo];
        flush();
        mode = m;
        try { localStorage.setItem(LS_MODE, m); } catch (err) { /* ignoruj */ }
        setHash();
        states[m] = loadState(data.state, m);
        st = states[m];
        removeAllPhotos(m);
        for (let i = 0; i < MODES[m].slots; i++) {
          if (list[i]) await setPhoto(m, i, list[i], { keepFraming: true });
        }
        syncForm();
        draw();
        persist();
        toast('Projekt wczytany');
      } catch (err) {
        toast('Nie udało się wczytać projektu: ' + err.message);
      }
    });
    $('btnReset').onclick = () => {
      if (!confirm('Wyczyścić bieżący projekt (w tej zakładce) i wrócić do przykładowych danych?')) return;
      states[mode] = defaultsFor(mode);
      st = states[mode];
      removeAllPhotos(mode);
      syncForm();
      draw();
      persist();
    };

    window.addEventListener('resize', draw);
    window.addEventListener('hashchange', () => { const m = modeFromHash(); if (m) switchMode(m); });
  }

  // ---------------------------------------------------------------- kadrowanie na podglądzie
  /** Współrzędne zdarzenia we współrzędnych projektowych szablonu. */
  function toDesign(e) {
    const box = $('preview').getBoundingClientRect();
    const k = FORMATS[st.format].design[0] / box.width;
    return [(e.clientX - box.left) * k, (e.clientY - box.top) * k];
  }

  /** Obszar zdjęcia pod punktem (ostatni narysowany wygrywa); przy jednym zdjęciu – zawsze ono. */
  function areaAt(x, y) {
    if (!lastR) return null;
    const as = lastR.areas;
    for (let i = as.length - 1; i >= 0; i--) {
      const a = as[i];
      const r = a.rect;
      if (a.hit ? a.hit(x, y) : x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return a;
    }
    return slotCount() === 1 ? as.find((a) => a.slot === 0) || null : null;
  }
  const liveArea = (slot) => lastR && lastR.areas.find((a) => a.slot === slot && a.draw);

  function bindCanvasPan() {
    const cv = $('preview');
    let drag = null;

    cv.addEventListener('pointerdown', (e) => {
      const a = areaAt(...toDesign(e));
      if (!a || !a.draw) return;
      drag = { p: toDesign(e), slot: a.slot };
      cv.setPointerCapture(e.pointerId);
      cv.classList.add('dragging');
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const a = liveArea(drag.slot);
      if (!a) return;
      const p = toDesign(e);
      const f = framingFor(st.format, drag.slot);
      f.cx -= (p[0] - drag.p[0]) / a.draw.dw;
      f.cy -= (p[1] - drag.p[1]) / a.draw.dh;
      drag.p = p;
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
      const [px, py] = toDesign(e);
      const a = areaAt(px, py);
      if (!a || !a.draw) return;
      e.preventDefault();
      const f = framingFor(st.format, a.slot);
      const r = a.rect;
      const { dw, dh } = a.draw;
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
    setHash();
    buildPhotoSlots();
    syncForm();
    bind();
    draw();
    // przerysuj po załadowaniu fontów (canvas nie robi tego sam)
    Promise.all(window.Poster.fontsToLoad.map((f) => document.fonts.load(f, 'AaĄąĘęŁłŃńÓóŚśŹźŻż')))
      .catch(() => {})
      .then(draw);
    if (document.fonts) document.fonts.addEventListener('loadingdone', draw);
    window.Poster.loadLogos().then(draw);
    restorePhotos();
  }

  init();
})();

/* 共通モジュール：データの形・テニスの得点計算・配信パーツの描画。
   control.html（操作用）と overlay.html（配信用）の両方がこれを読み込むので、
   両者の見え方が必ず一致する。試作版のロジックをそのまま移植している。 */

export const CANVAS_W = 1920;
export const CANVAS_H = 1080;

export const PARTS = [
  ['results', '団体戦の結果'],
  ['bug', 'スコア速報'],
  ['player', '選手情報'],
  ['free', '自由テキスト'],
];

/* 各パーツを画面のどの隅から測るか。
   配信の四隅を基準にすることで、セット数が増えてスコア枠が横に伸びても
   画面の外にはみ出さない。x/y は隅からの余白（1920x1080 換算のピクセル）で、
   テレビで端が切れても欠けないよう、やや内側に取ってある。 */
export const ANCHOR = {
  results: { h: 'left', v: 'top', x: 80, y: 80 },
  bug: { h: 'right', v: 'top', x: 80, y: 80 },
  player: { h: 'right', v: 'bottom', x: 80, y: 80 },
  free: { h: 'left', v: 'bottom', x: 80, y: 80 },
};

/* 取り消し（undo）用の履歴の上限。
   履歴は1回の得点ごとに Firebase へ書き込むので、試作版の150より控えめにしている。 */
export const HIST_MAX = 50;

export const clone = o => JSON.parse(JSON.stringify(o));
export const oth = s => (s === 'a' ? 'b' : 'a');

/* ---------- データの初期値 ---------- */

/* 画面に出る内容（draft と pub が同じ形を持つ） */
export function defaultDisplay(court = 'A') {
  return {
    teams: { a: 'OSG', b: 'LUCENT' },
    m: { code: 'S1', lbl: 'SINGLES 1', pA: '', pB: '', override: '' },
    results: '',
    resBand: false,
    free: `第41回 テニス日本リーグ ｜ コート${court}`,
    freeBand: true,
    freeOn: false,
    /* dx / dy は初期位置からのずれ。0 が初期位置で、
       プラスにすると右・下へ動く（1920x1080 換算のピクセル）。 */
    lay: {
      results: { dx: 0, dy: 0, s: 1, v: true },
      bug: { dx: 0, dy: 0, s: 1, v: true },
      player: { dx: 0, dy: 0, s: 1, v: true },
      free: { dx: 0, dy: 0, s: 1, v: true },
    },
  };
}

/* 0-0 の新しい試合 */
export function emptyScore() {
  return { done: [], g: { a: 0, b: 0 }, p: { a: 0, b: 0 }, tb: false, mtb: false, srv: 'a', tbFirst: 'a', win: null };
}

export function defaultState(court = 'A') {
  return {
    draft: defaultDisplay(court),
    pub: defaultDisplay(court),
    rules: { sets: 3, noAd: false, tb: true, mtb: false },
    sc: emptyScore(),
    hist: [],
  };
}

/* ---------- Firebase から読んだ値の整え ---------- */
/* Realtime Database は null や空配列を保存しないので、
   読み込んだ値に初期値を埋め戻してから使う。 */

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/* {"0":x,"1":y} の形で返ってくることがあるので配列に直す */
function toArray(v) {
  if (Array.isArray(v)) return v.filter(x => x !== null && x !== undefined);
  if (isObj(v)) {
    return Object.keys(v)
      .sort((a, b) => Number(a) - Number(b))
      .map(k => v[k])
      .filter(x => x !== null && x !== undefined);
  }
  return [];
}

function fill(src, def) {
  const out = clone(def);
  if (!isObj(src)) return out;
  for (const k of Object.keys(def)) {
    const v = src[k];
    if (v === undefined || v === null) continue;
    out[k] = isObj(def[k]) ? fill(v, def[k]) : v;
  }
  return out;
}

export function normalize(raw, court = 'A') {
  const def = defaultState(court);
  const st = {
    draft: fill(raw && raw.draft, def.draft),
    pub: fill(raw && raw.pub, def.pub),
    rules: fill(raw && raw.rules, def.rules),
    sc: fill(raw && raw.sc, def.sc),
    hist: toArray(raw && raw.hist),
  };
  st.sc.done = toArray(raw && raw.sc && raw.sc.done).map(r => ({
    a: Number(r.a) || 0,
    b: Number(r.b) || 0,
    tb: isObj(r.tb) ? { a: Number(r.tb.a) || 0, b: Number(r.tb.b) || 0 } : null,
    mtb: !!r.mtb,
  }));
  st.sc.win = raw && raw.sc && raw.sc.win ? raw.sc.win : null;
  st.rules.sets = Number(st.rules.sets) || 3;
  fixLay(st.draft);
  fixLay(st.pub);
  return st;
}

/* 位置・大きさを数値に直す。古い形式（x / y を持つもの）は初期位置に戻る */
function fixLay(d) {
  for (const [id] of PARTS) {
    const L = d.lay[id];
    L.dx = Math.round(Number(L.dx) || 0);
    L.dy = Math.round(Number(L.dy) || 0);
    L.s = Math.min(3, Math.max(0.3, Number(L.s) || 1));
    L.v = !!L.v;
  }
  return d;
}

/* ---------- テニスの得点計算 ---------- */

const toWin = st => Math.ceil(st.rules.sets / 2);
const wins = (st, s) => st.sc.done.filter(r => r[s] > r[oth(s)]).length;

export function addPoint(st, side) {
  const sc = st.sc;
  if (sc.win) return false;
  st.hist.push(JSON.stringify(sc));
  if (st.hist.length > HIST_MAX) st.hist.shift();
  const o = oth(side);
  sc.p[side]++;
  if (sc.tb) {
    const target = sc.mtb ? 10 : 7;
    if (sc.p[side] >= target && sc.p[side] - sc.p[o] >= 2) endSet(st, side, true);
    else if ((sc.p.a + sc.p.b) % 2 === 1) sc.srv = oth(sc.srv);
  } else {
    const won = st.rules.noAd ? sc.p[side] >= 4 : sc.p[side] >= 4 && sc.p[side] - sc.p[o] >= 2;
    if (won) {
      sc.g[side]++;
      sc.p = { a: 0, b: 0 };
      sc.srv = oth(sc.srv);
      if (sc.g[side] >= 6 && sc.g[side] - sc.g[o] >= 2) endSet(st, side, false);
      else if (sc.g.a === 6 && sc.g.b === 6 && st.rules.tb) {
        sc.tb = true;
        sc.tbFirst = sc.srv;
      }
    } else {
      while (sc.p.a > 3 && sc.p.b > 3) {
        sc.p.a--;
        sc.p.b--;
      }
    }
  }
  return true;
}

function endSet(st, side, wasTB) {
  const sc = st.sc;
  // Firebase から読み戻した形（normalize の結果）と同じキーを持たせておく
  const rec = { a: sc.g.a, b: sc.g.b, tb: null, mtb: false };
  if (wasTB) {
    rec.tb = { a: sc.p.a, b: sc.p.b };
    if (sc.mtb) {
      rec.a = side === 'a' ? 1 : 0;
      rec.b = side === 'b' ? 1 : 0;
      rec.mtb = true;
    } else rec[side] = sc.g[side] + 1;
    sc.srv = oth(sc.tbFirst);
  }
  sc.done.push(rec);
  sc.g = { a: 0, b: 0 };
  sc.p = { a: 0, b: 0 };
  sc.tb = false;
  sc.mtb = false;
  if (wins(st, side) >= toWin(st)) {
    sc.win = side;
    return;
  }
  if (st.rules.mtb && wins(st, 'a') === toWin(st) - 1 && wins(st, 'b') === toWin(st) - 1) {
    sc.tb = true;
    sc.mtb = true;
    sc.tbFirst = sc.srv;
  }
}

export function ptText(st, s) {
  const sc = st.sc;
  if (sc.win) return '';
  if (sc.tb) return String(sc.p[s]);
  const a = sc.p[s],
    b = sc.p[oth(s)];
  if (a >= 3 && b >= 3) return a === b ? '40' : a > b ? 'AD' : '40';
  return ['0', '15', '30', '40'][a];
}

export function setStr(r) {
  if (r.mtb) return `[${r.tb.a}-${r.tb.b}]`;
  return `${r.a}-${r.b}` + (r.tb ? `(${r.tb.a}-${r.tb.b})` : '');
}

export function resultLine(st, d) {
  const sc = st.sc,
    m = d.m,
    t = d.teams;
  const parts = sc.done.map(setStr);
  if (!sc.win && (sc.g.a || sc.g.b)) parts.push(`${sc.g.a}-${sc.g.b}`);
  return `${m.code} ${m.pA}(${t.a}) ${parts.length ? parts.join(' ') : 'vs'} ${m.pB}(${t.b})`;
}

/* ---------- 描画 ---------- */

const COURT_SVG = `
<svg class="court" viewBox="0 0 1920 1080" preserveAspectRatio="none" aria-hidden="true">
  <rect width="1920" height="380" fill="#1b2340"/>
  <rect y="380" width="1920" height="700" fill="#5d8f73"/>
  <g fill="none" stroke="#f4f4f4" stroke-width="6">
    <polygon points="560,470 1360,470 1740,1000 180,1000"/>
    <line x1="660" y1="470" x2="370" y2="1000"/><line x1="1260" y1="470" x2="1550" y2="1000"/>
    <line x1="500" y1="780" x2="1420" y2="780"/><line x1="960" y1="530" x2="960" y2="780"/>
  </g>
  <rect x="370" y="540" width="1180" height="90" fill="rgba(20,20,20,.35)" stroke="#eee" stroke-width="4"/>
</svg>
<img class="bgimg" alt="" hidden>`;

/* stage（.stage 要素）の中に 1920x1080 のキャンバスを作る。
   opt.court … 背景のコート絵を入れる（操作画面のプレビューだけ）
   opt.editable … ドラッグ用のつまみとラベルを入れる（下書き画面だけ） */
export function mountCanvas(stage, opt = {}) {
  const cv = document.createElement('div');
  cv.className = 'cv';
  if (opt.court) cv.innerHTML = COURT_SVG;
  for (const [id, name] of PARTS) {
    const a = ANCHOR[id];
    const w = document.createElement('div');
    // a-tl / a-tr / a-br / a-bl … どの隅を基準にしているか（編集用のつまみの向きに使う）
    w.className = 'w a-' + (a.v === 'top' ? 't' : 'b') + (a.h === 'left' ? 'l' : 'r');
    w.dataset.id = id;
    if (opt.editable) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = name;
      w.appendChild(tag);
    }
    const inner = document.createElement('div');
    inner.className = id === 'bug' ? 'bug' : id + ' outl';
    w.appendChild(inner);
    if (opt.editable) {
      const h = document.createElement('div');
      h.className = 'hdl';
      w.appendChild(h);
    }
    cv.appendChild(w);
  }
  stage.appendChild(cv);
  stage.S = 1;
  new ResizeObserver(() => fit(stage)).observe(stage);
  fit(stage);
  return cv;
}

/* 枠の大きさに合わせてキャンバス全体を拡大・縮小して中央に置く */
export function fit(stage) {
  const cv = stage.querySelector('.cv');
  if (!cv) return;
  const W = stage.clientWidth,
    H = stage.clientHeight;
  if (!W || !H) return;
  const S = Math.min(W / CANVAS_W, H / CANVAS_H);
  stage.S = S;
  cv.style.transform = `translate(${(W - CANVAS_W * S) / 2}px,${(H - CANVAS_H * S) / 2}px) scale(${S})`;
}

function cell(cls, txt, sup) {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = txt;
  if (sup != null) {
    const s = document.createElement('sup');
    s.textContent = sup;
    d.appendChild(s);
  }
  return d;
}

function renderBug(el, d, sc) {
  el.textContent = '';
  const cols = sc.done.map(r => ({ r }));
  if (!sc.win) cols.push({ cur: true, mtb: sc.mtb });
  el.style.gridTemplateColumns = `190px 112px ${cols.map(() => '72px').join(' ')}`;
  for (const row of ['a', 'mid', 'b']) {
    if (row === 'mid') {
      el.appendChild(cell('lbl', d.m.lbl || ' '));
      el.appendChild(cell('', ''));
      cols.forEach((c, i) => el.appendChild(cell('sh', c.mtb || (c.r && c.r.mtb) ? 'TB' : 'SET ' + (i + 1))));
      continue;
    }
    const nm = cell('nm' + (sc.win === row ? ' win' : ''), d.teams[row]);
    if (!sc.win && sc.srv === row) nm.appendChild(cell('srv', ''));
    el.appendChild(nm);
    el.appendChild(cell('pt', ptText({ sc }, row)));
    cols.forEach(c => {
      if (c.r) {
        const r = c.r;
        const lose = r.tb && !r.mtb && r[row] < r[oth(row)] ? r.tb[row] : null;
        el.appendChild(cell('st', r.mtb ? r.tb[row] : r[row], lose));
      } else el.appendChild(cell('st cur', c.mtb ? sc.p[row] : sc.g[row]));
    });
  }
}

/* 選手情報の表示文。両選手が空欄のときは空文字を返し、パーツを隠す */
export function playerText(d) {
  const o = (d.m.override || '').trim();
  if (o) return o;
  if (!(d.m.pA || '').trim() && !(d.m.pB || '').trim()) return '';
  return `${d.m.code} ${d.m.pA}(${d.teams.a}) vs ${d.m.pB}(${d.teams.b})`;
}

/* パーツを「基準の隅からの余白 ± ずれ」で置く。
   拡大の基準点も同じ隅にするので、大きくしても画面の外へ出ていかない。 */
export function place(w, L) {
  const a = ANCHOR[w.dataset.id];
  const dx = L.dx || 0,
    dy = L.dy || 0;
  w.style.left = w.style.right = w.style.top = w.style.bottom = '';
  if (a.h === 'left') w.style.left = a.x + dx + 'px';
  else w.style.right = a.x - dx + 'px';
  if (a.v === 'top') w.style.top = a.y + dy + 'px';
  else w.style.bottom = a.y - dy + 'px';
  w.style.transformOrigin = `${a.h} ${a.v}`;
  w.style.transform = `scale(${L.s})`;
}

/* d … 表示内容（draft か pub）、sc … スコア */
export function renderCanvas(stage, d, sc) {
  const q = s => stage.querySelector(s);
  renderBug(q('.bug'), d, sc);

  const r = q('.results');
  r.textContent = '';
  r.classList.toggle('band', !!d.resBand);
  d.results
    .split('\n')
    .filter(l => l.trim())
    .forEach(l => {
      const x = document.createElement('div');
      x.textContent = l;
      r.appendChild(x);
    });

  const ptxt = playerText(d);
  q('.player').textContent = ptxt;

  const f = q('.free');
  f.textContent = d.free;
  f.classList.toggle('band', !!d.freeBand);

  stage.querySelectorAll('.w').forEach(w => {
    const id = w.dataset.id,
      L = d.lay[id];
    let on = L.v;
    if (id === 'free') on = on && d.freeOn && !!d.free.trim();
    if (id === 'player') on = on && !!ptxt;
    w.hidden = !on;
    place(w, L);
  });
}

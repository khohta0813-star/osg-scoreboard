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
  results: { h: 'left', v: 'top', x: 48, y: 48 },
  bug: { h: 'right', v: 'top', x: 48, y: 48 },
  player: { h: 'right', v: 'bottom', x: 48, y: 48 },
  free: { h: 'left', v: 'bottom', x: 48, y: 48 },
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
    bugNameSize: 48, // スコア速報のチーム名の文字サイズ
    bugNameW: 190, //   同じくチーム名の枠の幅
    results: '',
    resBand: false,
    playerBand: false,
    playerBandOpa: 100, // 帯の濃さ（100 で透過なし）
    playerBandH: 10, //   帯の上下の余白＝縦の長さ
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
  return {
    done: [], g: { a: 0, b: 0 }, p: { a: 0, b: 0 },
    tb: false, mtb: false, srv: 'a', tbFirst: 'a', win: null,
    fault: false, // ファーストサーブがフォルト＝いまセカンドサーブ
    n: 0, //         この試合で何ポイント行われたか（取り消しの巻き戻しに使う）
  };
}

export function defaultState(court = 'A') {
  return {
    draft: defaultDisplay(court),
    pub: defaultDisplay(court),
    rules: { sets: 3, games: 6, noAd: false, tb: true, mtb: false },
    sc: emptyScore(),
    hist: [],
    name: '', // コート表示名。空欄なら「COURT 〇」と出る
    matchId: '', // 分析用の記録をためている試合のID（「試合をリセット」で新しくなる）
    /* ダブルスの分析用。配信の表示には使わない。
       srvFirst … いまのセットで先にサーブする人（0 or 1）
       deuce   … デュースサイドでリターンする人（0 or 1） */
    dbl: {
      on: false,
      names: { a1: '', a2: '', b1: '', b2: '' },
      srvFirst: { a: 0, b: 0 },
      deuce: { a: 0, b: 0 },
    },
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
    name: raw && typeof raw.name === 'string' ? raw.name : '',
    matchId: raw && typeof raw.matchId === 'string' ? raw.matchId : '',
    dbl: fill(raw && raw.dbl, def.dbl),
  };
  st.sc.done = toArray(raw && raw.sc && raw.sc.done).map(r => ({
    a: Number(r.a) || 0,
    b: Number(r.b) || 0,
    tb: isObj(r.tb) ? { a: Number(r.tb.a) || 0, b: Number(r.tb.b) || 0 } : null,
    mtb: !!r.mtb,
  }));
  st.sc.win = raw && raw.sc && raw.sc.win ? raw.sc.win : null;
  st.dbl.on = !!st.dbl.on;
  for (const t of ['a', 'b']) {
    st.dbl.srvFirst[t] = Number(st.dbl.srvFirst[t]) === 1 ? 1 : 0;
    st.dbl.deuce[t] = Number(st.dbl.deuce[t]) === 1 ? 1 : 0;
  }
  for (const k of ['a1', 'a2', 'b1', 'b2']) st.dbl.names[k] = String(st.dbl.names[k] || '');
  st.sc.fault = !!st.sc.fault;
  st.sc.n = Math.max(0, Number(st.sc.n) || 0);
  st.rules.sets = [1, 3, 5].includes(Number(st.rules.sets)) ? Number(st.rules.sets) : 3;
  st.rules.games = Number(st.rules.games) === 8 ? 8 : 6;
  fixLay(st.draft);
  fixLay(st.pub);
  return st;
}

/* 位置・大きさを数値に直す。古い形式（x / y を持つもの）は初期位置に戻る */
const clampNum = (v, lo, hi, def) => {
  if (v === '' || v === null || v === undefined) return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};

function fixLay(d) {
  d.playerBandOpa = clampNum(d.playerBandOpa, 0, 100, 100);
  d.playerBandH = clampNum(d.playerBandH, 0, 120, 10);
  d.bugNameSize = Math.min(64, Math.max(20, Number(d.bugNameSize) || 48));
  d.bugNameW = Math.min(480, Math.max(120, Number(d.bugNameW) || 190));
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
  sc.n = (sc.n || 0) + 1;
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
      const need = st.rules.games; // 通常は6ゲーム、8ゲームマッチなら8
      if (sc.g[side] >= need && sc.g[side] - sc.g[o] >= 2) endSet(st, side, false);
      else if (sc.g.a === need && sc.g.b === need && st.rules.tb) {
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

function renderBug(el, d, sc, rules) {
  el.textContent = '';
  const cols = sc.done.map(r => ({ r }));
  if (!sc.win) cols.push({ cur: true, mtb: sc.mtb });
  // 試合形式のセット数ぶんは最初から枠を出す。試合中に幅が変わらない。
  // 最終セットが10ポイントタイブレークのときは、その枠は実際に始まってから出す
  const slots = rules.sets - (rules.mtb ? 1 : 0);
  while (cols.length < slots) cols.push({ empty: true });
  el.style.gridTemplateColumns = `${d.bugNameW}px 112px ${cols.map(() => '72px').join(' ')}`;
  for (const row of ['a', 'mid', 'b']) {
    if (row === 'mid') {
      el.appendChild(cell('lbl', d.m.lbl || ' '));
      el.appendChild(cell('', ''));
      cols.forEach((c, i) => el.appendChild(cell('sh', c.mtb || (c.r && c.r.mtb) ? 'TB' : 'SET ' + (i + 1))));
      continue;
    }
    const nm = cell('nm' + (sc.win === row ? ' win' : ''), '');
    const nmt = cell('nmt', d.teams[row]);
    nmt.style.fontSize = d.bugNameSize + 'px';
    nm.appendChild(nmt);
    if (!sc.win && sc.srv === row) nm.appendChild(cell('srv', ''));
    el.appendChild(nm);
    el.appendChild(cell('pt', ptText({ sc }, row)));
    cols.forEach(c => {
      if (c.r) {
        const r = c.r;
        const lose = r.tb && !r.mtb && r[row] < r[oth(row)] ? r.tb[row] : null;
        el.appendChild(cell('st', r.mtb ? r.tb[row] : r[row], lose));
      } else if (c.empty) el.appendChild(cell('st', ''));
      else el.appendChild(cell('st cur', c.mtb ? sc.p[row] : sc.g[row]));
    });
  }
  fitNames(el, d.bugNameSize);
}

/* チーム名は枠に対して自動で大きさが決まる。収まっていれば指定サイズのまま、
   はみ出すときだけ、はみ出した比率ぶん小さくする。チームごとに別々に計算するので、
   短い名前（OSG など）は大きいまま残る。 */
function fitNames(el, base) {
  for (const t of el.querySelectorAll('.nmt')) {
    const avail = t.parentElement.clientWidth - 32; // 左右の padding ぶん
    if (avail <= 0) continue; // 非表示のときは測れないので触らない
    t.style.fontSize = base + 'px';
    const w = t.offsetWidth;
    if (w > avail) t.style.fontSize = Math.max(14, Math.floor((base * avail) / w)) + 'px';
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

/* d … 表示内容（draft か pub）、sc … スコア、rules … 試合形式（セット枠の数に使う） */
export function renderCanvas(stage, d, sc, rules) {
  const q = s => stage.querySelector(s);
  renderBug(q('.bug'), d, sc, rules);

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

  const p = q('.player');
  const ptxt = playerText(d);
  p.textContent = ptxt;
  p.classList.toggle('band', !!d.playerBand);
  if (d.playerBand) {
    // 濃さ（100 で透過なし）と、上下の余白＝帯の縦の長さ
    p.style.backgroundColor = `rgba(15,31,61,${d.playerBandOpa / 100})`;
    p.style.paddingTop = p.style.paddingBottom = d.playerBandH + 'px';
  } else {
    p.style.backgroundColor = '';
    p.style.paddingTop = p.style.paddingBottom = '';
  }

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


/* ---------- ダブルスの「いま誰が打っているか」 ----------
   どちらも規則で決まるので、セットごとに一度だけ順番を決めれば自動で分かる。
     サーブ   … チーム内で1ゲームおきに交代
     リターン … セットを通してコートサイドで固定 */

/* いまサーブしている人（そのチームの 0 か 1） */
export function serverPlayer(sc, dbl) {
  const s = sc.srv;
  if (!sc.tb) {
    // このセットでそのチームが何回サーブ番を終えたか
    return (dbl.srvFirst[s] + Math.floor((sc.g.a + sc.g.b) / 2)) % 2;
  }
  // タイブレーク：最初の1本だけ1ポイント、以降は2ポイントごとに交代していく
  const G = sc.g.a + sc.g.b; // タイブレーク開始時のゲーム数
  const firstGameServer = G % 2 === 0 ? sc.tbFirst : oth(sc.tbFirst);
  const gamesServed = {};
  gamesServed[firstGameServer] = Math.ceil(G / 2);
  gamesServed[oth(firstGameServer)] = Math.floor(G / 2);
  const turn = Math.floor((sc.p.a + sc.p.b + 1) / 2); // 何回目のサーブ番か
  let mine = 0;
  for (let i = 0; i < turn; i++) if ((i % 2 === 0 ? sc.tbFirst : oth(sc.tbFirst)) === s) mine++;
  return (dbl.srvFirst[s] + gamesServed[s] + mine) % 2;
}

/* いまリターンする人（そのチームの 0 か 1） */
export function returnerPlayer(sc, dbl) {
  const r = oth(sc.srv);
  const onDeuceSide = (sc.p.a + sc.p.b) % 2 === 0;
  return onDeuceSide ? dbl.deuce[r] : 1 - dbl.deuce[r];
}

/* 表示用の名前。未入力なら「A1」のような仮の名前を返す */
export function dblName(dbl, team, idx) {
  const key = team + (idx + 1);
  return (dbl.names[key] || '').trim() || team.toUpperCase() + (idx + 1);
}

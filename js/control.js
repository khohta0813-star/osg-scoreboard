/* 操作画面の中身。試作版のスクリプトを、保存先 localStorage から
   Firebase Realtime Database に置き換えたもの。操作の流れは試作版と同じ。

   書き込みの分け方
     スコア操作（得点・取り消し・サーブ交代・リセット） → sc と hist に即時
     得点ルール（セット数・ノーアド・タイブレーク）     → rules に即時
     それ以外（チーム名・選手名・結果・自由テキスト・レイアウト） → draft に保存し、
       「配信に反映」で draft を pub にコピーして初めて視聴者に出る */

import {
  PARTS, ANCHOR, clone, oth, defaultState, emptyScore, normalize, serverPlayer, returnerPlayer, dblName,
  addPoint, ptText, setStr, resultLine,
  mountCanvas, renderCanvas, place, fit,
} from './parts.js';
import {
  app, isConfigured, courtId, watchCourt, watchConnection, writeSub, writeMany, seedIfEmpty,
  newMatchId, writeMatchMeta, updateMatchMeta, appendPoint, removeLastPoints,
} from './db.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  setPersistence, browserLocalPersistence,
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';

const $ = id => document.getElementById(id);
/* 入力欄の数値を範囲内に収める。0 も有効な値なので || は使わない */
const num = (v, lo, hi, def) => {
  if (v === '' || v === null || v === undefined) return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};
const court = courtId();
const D = () => st.draft;

const courtLabel = () => st.name.trim() || 'COURT ' + court;
$('overlayLink').href = `overlay.html?court=${court}`;
document.title = `OSG LIVEスコアボード（コート${court}）`;

/* ---------- 画面右下に出る短いお知らせ ---------- */
const toastBox = document.createElement('div');
toastBox.className = 'toast';
toastBox.hidden = true;
document.body.appendChild(toastBox);
let toastTimer = null;
function toast(msg) {
  toastBox.textContent = msg;
  toastBox.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastBox.hidden = true), 6000);
  console.warn('[control]', msg);
}
/* 書き込みの失敗を拾う */
function send(p) {
  return Promise.resolve(p).catch(err => {
    const m = String(err && err.message || err);
    toast(m.includes('permission_denied') || m.includes('PERMISSION_DENIED')
      ? '書き込みが拒否されました。ログインし直してください。'
      : '保存できませんでした：' + m);
  });
}

if (!isConfigured) {
  toast('js/firebase-config.js に Firebase の接続情報が入っていません。');
}

/* ---------- 状態 ---------- */
let st = defaultState(court);
/* サーバーの内容をまだ一度も受け取っていない間は、手元の初期値で
   サーバーを上書きしてしまわないよう、書き込みを一切しない。 */
let loaded = false;
let signedIn = false;
let courtEmpty = false; // Firebase にこのコートのデータがまだ無い
let seeding = false;

/* ---------- 保存（Firebase への書き込み） ---------- */
/* 下書きは文字入力ごとに書かないよう、少しまとめてから送る */
let draftTimer = null;
let draftPending = false;
let nameTimer = null;
let dblTimer = null;
const dblFields = [['dA1', 'a1'], ['dA2', 'a2'], ['dB1', 'b1'], ['dB2', 'b2']];
/* 読み込みが終わるまでは書き込まない */
function tooEarly() {
  if (loaded) return false;
  toast('読み込み中です。表示が出てから操作してください。');
  return true;
}
function wDraft() {
  if (tooEarly()) return;
  draftPending = true;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    draftTimer = null;
    draftPending = false;
    send(writeSub(court, 'draft', st.draft));
  }, 200);
}
const wPub = () => (tooEarly() ? null : send(writeSub(court, 'pub', st.pub)));
const wName = () => (tooEarly() ? null : send(writeSub(court, 'name', st.name)));
const wDbl = () => (tooEarly() ? null : send(writeSub(court, 'dbl', st.dbl)));
const wRules = () => (tooEarly() ? null : send(writeSub(court, 'rules', st.rules)));
const wSc = () => (tooEarly() ? null : send(writeSub(court, 'sc', st.sc)));
const wScHist = () =>
  tooEarly() ? null : send(writeMany(court, { sc: st.sc, hist: st.hist.length ? st.hist : null }));

/* 画面に反映してから保存する */
const commitDraft = () => { render(); wDraft(); };
const commitRules = () => { render(); wRules(); refreshMatchInfo(); };
const commitScore = () => { render(); wScHist(); };

/* ---------- キャンバス（下書き／配信中） ---------- */
const stages = { draft: $('draftStage'), live: $('liveStage') };
mountCanvas(stages.draft, { court: true, editable: true });
mountCanvas(stages.live, { court: true });

/* ---------- 描画 ---------- */
const dirty = () => JSON.stringify(st.draft) !== JSON.stringify(st.pub);
function render() {
  renderCanvas(stages.draft, st.draft, st.sc, st.rules);
  renderCanvas(stages.live, st.pub, st.sc, st.rules);
  const sc = st.sc, t = st.pub.teams, m = st.pub.m;
  $('ptAn').textContent = t.a; $('ptBn').textContent = t.b;
  $('ptAp').textContent = m.pA; $('ptBp').textContent = m.pB;
  const sets = sc.done.map(setStr).join('  ');
  $('readout').textContent = sc.win
    ? `${t[sc.win]} の勝利　${sets}`
    : `${sets ? sets + '  ｜  ' : ''}${sc.g.a}-${sc.g.b}  ｜  ${ptText(st, 'a')}-${ptText(st, 'b')}${sc.tb ? (sc.mtb ? '  (10pt TB)' : '  (TB)') : ''}${sc.fault ? '  ｜  2ndサーブ' : ''}`;
  $('courtTag').textContent = courtLabel();
  document.title = `OSG LIVEスコアボード（${courtLabel()}）`;
  $('undo').disabled = !st.hist.length;
  $('fault').classList.toggle('on', !!sc.fault);
  $('fault').textContent = sc.fault ? 'もう一度押すとダブルフォールト' : 'フォルト（続けて2回でダブルフォールト）';
  $('fault').disabled = !!sc.win;
  $('dblBox').hidden = !st.dbl.on;
  if (st.dbl.on) {
    const srv = sc.srv, ret = oth(srv);
    $('dblNow').textContent = '';
    if (sc.win) {
      $('dblNow').textContent = '試合終了';
    } else {
      const put = (label, who) => {
        const box = document.createElement('span');
        const i = document.createElement('i');
        i.textContent = label;
        box.append(i, who);
        $('dblNow').appendChild(box);
      };
      put('SERVE', dblName(st.dbl, srv, serverPlayer(sc, st.dbl)));
      put('RETURN', dblName(st.dbl, ret, returnerPlayer(sc, st.dbl)));
    }
  }
  const dt = dirty();
  $('pubBar').classList.toggle('dirty', dt);
  $('pubMsg').textContent = dt
    ? '未反映の変更があります。下書きを確認して「配信に反映」を押してください'
    : '下書きと配信中の表示は同じです';
  $('publish').disabled = !dt;
  $('discard').disabled = !dt;
  renderLay();
}

/* 右上の状態表示。読み込み中はそちらを優先して出す */
let connOk = null;
function paintConn() {
  const el = $('conn');
  if (!loaded) {
    el.className = 'state';
    el.lastElementChild.textContent = '読み込み中…';
    return;
  }
  el.className = 'state ' + (connOk === false ? 'off' : 'ok');
  el.lastElementChild.textContent = connOk === false ? '接続待ち（復帰後に自動で戻ります）' : '同期中';
}

/* 読み込みが終わるまで操作できないようにする */
function setLoaded(v) {
  loaded = v;
  $('app').classList.toggle('locked', !v);
  paintConn();
}
setLoaded(false);

/* ---------- Firebase と同期 ---------- */
if (isConfigured) {
  watchConnection(ok => { connOk = ok; paintConn(); });

  watchCourt(court, raw => {
    courtEmpty = raw === null;
    if (courtEmpty) { maybeSeed(); return; }
    const next = normalize(raw, court);
    // 自分がいま入力している下書きは、送信待ちの間だけ手元の内容を優先する。
    // ただし最初の1回はサーバーの内容をそのまま受け取る（手元はまだ初期値のため）
    if (loaded && draftPending) next.draft = st.draft;
    if (loaded && nameTimer) next.name = st.name;
    if (loaded && dblTimer) next.dbl = st.dbl;
    st = next;
    setLoaded(true);
    fillForm();
    render();
  });
} else {
  setLoaded(true); // Firebase 未設定のときは手元だけで動かす
}


async function maybeSeed() {
  if (!signedIn || !courtEmpty || seeding) return;
  seeding = true;
  try {
    await seedIfEmpty(court, defaultState(court));
  } catch (err) {
    toast('コートの初期データを作れませんでした：' + (err.message || err));
  } finally {
    seeding = false;
  }
}

/* ---------- ログイン ---------- */
const auth = app ? getAuth(app) : null;
if (auth) {
  setPersistence(auth, browserLocalPersistence).catch(() => {});
  onAuthStateChanged(auth, user => {
    signedIn = !!user;
    $('gate').hidden = signedIn;
    if (signedIn) { $('loginErr').textContent = ''; $('pass').value = ''; maybeSeed(); }
  });
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('loginBtn').disabled = true;
    $('loginErr').textContent = '';
    try {
      await signInWithEmailAndPassword(auth, $('email').value.trim(), $('pass').value);
    } catch (err) {
      $('loginErr').textContent = loginError(err);
    } finally {
      $('loginBtn').disabled = false;
    }
  });
  $('logout').onclick = () => signOut(auth);
} else {
  $('gate').hidden = true;
}
function loginError(err) {
  const c = err && err.code || '';
  if (c.includes('invalid-email')) return 'メールアドレスの形式が正しくありません。';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found'))
    return 'メールアドレスかパスワードが違います。';
  if (c.includes('too-many-requests')) return '失敗が続いたため一時的に止められています。少し待ってからもう一度。';
  if (c.includes('network-request-failed')) return 'ネットワークにつながりません。通信を確認してください。';
  if (c.includes('operation-not-allowed')) return 'Firebase でメール／パスワードのログインが有効になっていません。';
  return 'ログインできませんでした：' + (err.message || c);
}

/* ---------- 下書き画面のドラッグ移動・拡大縮小 ---------- */
let editing = false;
stages.draft.querySelectorAll('.w').forEach(w => {
  w.addEventListener('pointerdown', e => {
    if (!editing) return;
    e.preventDefault();
    const id = w.dataset.id, L = D().lay[id], S = stages.draft.S,
      sx = e.clientX, sy = e.clientY, odx = L.dx, ody = L.dy, os = L.s;
    const resize = e.target.classList.contains('hdl'), natW = w.offsetWidth;
    // 右端・下端を基準にしているパーツは、つまみが内側に付くので向きが逆になる
    const grow = ANCHOR[id].h === 'left' ? 1 : -1;
    w.setPointerCapture(e.pointerId);
    const mv = ev => {
      const dx = (ev.clientX - sx) / S, dy = (ev.clientY - sy) / S;
      if (resize) L.s = Math.max(.3, Math.min(3, (natW * os + grow * dx) / natW));
      else {
        L.dx = Math.round(Math.max(-1800, Math.min(1800, odx + dx)));
        L.dy = Math.round(Math.max(-1000, Math.min(1000, ody + dy)));
      }
      place(w, L);
    };
    const up = () => {
      w.removeEventListener('pointermove', mv);
      w.removeEventListener('pointerup', up);
      w.removeEventListener('pointercancel', up);
      commitDraft();
    };
    w.addEventListener('pointermove', mv);
    w.addEventListener('pointerup', up);
    w.addEventListener('pointercancel', up);
  });
});
$('editBtn').onclick = () => {
  editing = !editing;
  stages.draft.classList.toggle('edit', editing);
  $('editBtn').classList.toggle('on', editing);
  $('editBtn').textContent = editing ? '編集を終了' : 'レイアウト編集';
};

/* 位置は「初期位置からのずれ」で持つ。0 が初期位置で、
   プラスにすると右・下へ動く（配信画面 1920x1080 換算のピクセル） */
const CORNER = { results: '左上', bug: '右上', player: '右下', free: '左下' };
const clampOff = (v, max) => Math.round(Math.max(-max, Math.min(max, Number(v) || 0)));

function renderLay() {
  const box = $('lay');
  if (!box.childElementCount) {
    PARTS.forEach(([id, name]) => {
      const row = document.createElement('div');
      row.className = 'lay-row';
      row.innerHTML = `
        <label class="chk"><input type="checkbox" id="v_${id}">${name}<small>${CORNER[id]}が基準</small></label>
        <div class="lay-ctl">
          <label>横のずれ<input type="number" id="x_${id}" step="10" inputmode="numeric"></label>
          <label>縦のずれ<input type="number" id="y_${id}" step="10" inputmode="numeric"></label>
          <label>大きさ %<input type="number" id="p_${id}" step="5" min="30" max="300" inputmode="numeric"></label>
          <button type="button" id="r_${id}">初期位置</button>
        </div>
        <input type="range" class="lay-range" id="s_${id}" min=".3" max="3" step=".01" aria-label="${name}の大きさ">`;
      box.appendChild(row);

      const redraw = () => place(stages.draft.querySelector(`.w[data-id=${id}]`), D().lay[id]);
      $('v_' + id).onchange = e => { D().lay[id].v = e.target.checked; commitDraft(); };
      $('x_' + id).oninput = e => { D().lay[id].dx = clampOff(e.target.value, 1800); redraw(); };
      $('y_' + id).oninput = e => { D().lay[id].dy = clampOff(e.target.value, 1000); redraw(); };
      $('x_' + id).onchange = commitDraft;
      $('y_' + id).onchange = commitDraft;
      const setScale = v => {
        D().lay[id].s = Math.min(3, Math.max(0.3, v));
        $('s_' + id).value = D().lay[id].s;
        $('p_' + id).value = Math.round(D().lay[id].s * 100);
        redraw();
      };
      // スライダーと % の入力欄は同じ値を指す
      $('s_' + id).oninput = e => setScale(+e.target.value);
      $('s_' + id).onchange = commitDraft;
      $('p_' + id).oninput = e => { D().lay[id].s = Math.min(3, Math.max(0.3, (Number(e.target.value) || 100) / 100)); $('s_' + id).value = D().lay[id].s; redraw(); };
      $('p_' + id).onchange = commitDraft;
      $('r_' + id).onclick = () => {
        const L = D().lay[id];
        L.dx = 0; L.dy = 0; L.s = 1;
        commitDraft();
      };
    });
  }
  PARTS.forEach(([id]) => {
    const L = D().lay[id];
    $('v_' + id).checked = L.v;
    $('s_' + id).value = L.s;
    if (document.activeElement !== $('p_' + id)) $('p_' + id).value = Math.round(L.s * 100);
    // 入力中の欄は書き換えない
    if (document.activeElement !== $('x_' + id)) $('x_' + id).value = L.dx;
    if (document.activeElement !== $('y_' + id)) $('y_' + id).value = L.dy;
  });
}

/* ---------- 入力欄との結びつけ ---------- */
const binds = [
  ['tA', v => D().teams.a = v, () => D().teams.a],
  ['tB', v => D().teams.b = v, () => D().teams.b],
  ['pA', v => D().m.pA = v, () => D().m.pA],
  ['pB', v => D().m.pB = v, () => D().m.pB],
  ['code', v => D().m.code = v, () => D().m.code],
  ['lbl', v => D().m.lbl = v, () => D().m.lbl],
  ['bugNameSize', v => (D().bugNameSize = Math.min(64, Math.max(20, Number(v) || 48))), () => D().bugNameSize],
  ['bugNameW', v => (D().bugNameW = Math.min(480, Math.max(120, Number(v) || 190))), () => D().bugNameW],
  ['playerBandOpa', v => (D().playerBandOpa = num(v, 0, 100, 100)), () => D().playerBandOpa],
  ['playerBandH', v => (D().playerBandH = num(v, 0, 120, 10)), () => D().playerBandH],
  ['pOverride', v => D().m.override = v, () => D().m.override],
  ['results', v => D().results = v, () => D().results],
  ['free', v => D().free = v, () => D().free],
];
binds.forEach(([id, set]) => $(id).addEventListener('input', e => { set(e.target.value); commitDraft(); }));

/* ダブルスの設定も配信には出ないので、下書きを通さず即時に保存する */
dblFields.forEach(([id, key]) => {
  $(id).addEventListener('input', e => {
    if (tooEarly()) { e.target.value = st.dbl.names[key]; return; }
    st.dbl.names[key] = e.target.value;
    render();
    clearTimeout(dblTimer);
    dblTimer = setTimeout(() => { dblTimer = null; wDbl(); }, 300);
  });
});
$('dblOn').addEventListener('change', e => {
  if (tooEarly()) { e.target.checked = st.dbl.on; return; }
  st.dbl.on = e.target.checked;
  render();
  wDbl();
});
$('swapSrv').onclick = () => {
  if (tooEarly() || !st.dbl.on) return;
  const t = st.sc.srv;
  st.dbl.srvFirst[t] = st.dbl.srvFirst[t] ? 0 : 1;
  render();
  wDbl();
};
$('swapRet').onclick = () => {
  if (tooEarly() || !st.dbl.on) return;
  const t = oth(st.sc.srv);
  st.dbl.deuce[t] = st.dbl.deuce[t] ? 0 : 1;
  render();
  wDbl();
};

/* コート表示名は配信には出ない表示用のラベルなので、下書きを通さず即時に保存する */
$('courtName').addEventListener('input', e => {
  if (tooEarly()) { e.target.value = st.name; return; }
  st.name = e.target.value;
  render();
  clearTimeout(nameTimer);
  nameTimer = setTimeout(() => { nameTimer = null; wName(); }, 300);
});

const draftChecks = [
  ['resBand', v => D().resBand = v, () => D().resBand],
  ['freeBand', v => D().freeBand = v, () => D().freeBand],
  ['freeOn', v => D().freeOn = v, () => D().freeOn],
  ['playerBand', v => D().playerBand = v, () => D().playerBand],
];
const ruleChecks = [
  ['noAd', v => st.rules.noAd = v, () => st.rules.noAd],
  ['tb', v => st.rules.tb = v, () => st.rules.tb],
  ['mtb', v => st.rules.mtb = v, () => st.rules.mtb],
];
draftChecks.forEach(([id, set]) => $(id).addEventListener('change', e => { set(e.target.checked); commitDraft(); }));
ruleChecks.forEach(([id, set]) => $(id).addEventListener('change', e => { set(e.target.checked); commitRules(); }));
$('fmt').onchange = e => {
  const [sets, games] = e.target.value.split('-').map(Number);
  st.rules.sets = sets;
  st.rules.games = games;
  commitRules();
};

function fillForm() {
  binds.forEach(([id, , get]) => { if (document.activeElement !== $(id)) $(id).value = get(); });
  if (document.activeElement !== $('courtName')) $('courtName').value = st.name;
  $('dblOn').checked = st.dbl.on;
  dblFields.forEach(([id, key]) => { if (document.activeElement !== $(id)) $(id).value = st.dbl.names[key]; });
  draftChecks.concat(ruleChecks).forEach(([id, , get]) => ($(id).checked = get()));
  const fmt = `${st.rules.sets}-${st.rules.games}`;
  if ([...$('fmt').options].some(o => o.value === fmt)) $('fmt').value = fmt;
  $('tbLbl').textContent = `${st.rules.games}-${st.rules.games}でタイブレーク`;
}

/* ---------- ボタン ---------- */
$('publish').onclick = () => {
  st.pub = clone(st.draft);
  render();
  wPub();
  refreshMatchInfo();
  $('pubMsg').textContent = '配信に反映しました';
};
$('discard').onclick = () => { st.draft = clone(st.pub); fillForm(); commitDraft(); };
/* ---------- スコア分析用の記録 ----------
   得点ボタンを押すたび、そのときの状況を1件ずつ残す。操作する側の手間は増えない。
   「試合をリセット」を押すと、そこから新しい試合として記録し直す。 */

function matchInfo() {
  const d = st.pub;
  return {
    court,
    courtName: st.name || '',
    teams: { a: d.teams.a, b: d.teams.b },
    players: { a: d.m.pA, b: d.m.pB },
    code: d.m.code,
    lbl: d.m.lbl,
    rules: { sets: st.rules.sets, games: st.rules.games, noAd: !!st.rules.noAd, tb: !!st.rules.tb, mtb: !!st.rules.mtb },
    dbl: st.dbl.on ? { on: true, names: { ...st.dbl.names } } : { on: false },
  };
}

function ensureMatch() {
  if (st.matchId) return st.matchId;
  const id = newMatchId(court);
  st.matchId = id;
  send(writeSub(court, 'matchId', id));
  send(writeMatchMeta(id, { ...matchInfo(), startedAt: Date.now() }));
  return id;
}

/* 選手名やルールを変えたら、記録側の見出しも合わせておく */
function refreshMatchInfo() {
  if (st.matchId && loaded) send(updateMatchMeta(st.matchId, matchInfo()));
}

function logPoint(before, side, df) {
  const id = ensureMatch();
  const rec = {
    t: Date.now(), // 時刻。配信動画の該当箇所を探すのにも使える
    w: side, //      ポイントを取った側
    s: before.srv, // サーバー
    sv: before.fault ? 2 : 1, // 1st か 2nd か
    set: before.done.length,
    ga: before.g.a, gb: before.g.b, // ポイント開始時のゲームカウント
    pa: before.p.a, pb: before.p.b, // ポイント開始時のポイント
  };
  if (before.tb) rec.tb = true;
  if (before.mtb) rec.mtb = true;
  if (df) rec.df = true;
  if (st.dbl.on) {
    rec.sp = serverPlayer(before, st.dbl); // サーブした人（0 or 1）
    rec.rp = returnerPlayer(before, st.dbl); // リターンした人
  }
  send(appendPoint(id, rec));
}

function scorePoint(side, df) {
  if (tooEarly()) return;
  const before = clone(st.sc);
  if (!addPoint(st, side)) return;
  st.sc.fault = false;
  logPoint(before, side, df);
  const justWon = st.sc.win && !before.win;
  commitScore();
  if (justWon) {
    send(updateMatchMeta(st.matchId, {
      endedAt: Date.now(),
      winner: st.sc.win,
      score: st.sc.done.map(setStr).join(' '),
    }));
  }
}

$('ptA').onclick = () => scorePoint('a');
$('ptB').onclick = () => scorePoint('b');

/* フォルト：1回押すとセカンドサーブ、続けて2回でダブルフォールト（相手に得点） */
$('fault').onclick = () => {
  if (tooEarly() || st.sc.win) return;
  if (!st.sc.fault) {
    st.sc.fault = true;
    render();
    wSc();
    return;
  }
  scorePoint(oth(st.sc.srv), true);
};

$('undo').onclick = () => {
  const h = st.hist.pop();
  if (!h) return;
  const beforeN = st.sc.n || 0;
  st.sc = JSON.parse(h);
  const removed = beforeN - (st.sc.n || 0);
  if (removed > 0) send(removeLastPoints(st.matchId, removed));
  commitScore();
};
$('srv').onclick = () => { st.sc.srv = oth(st.sc.srv); render(); wSc(); };

let armed = null;
$('reset').onclick = () => {
  if (!armed) {
    $('reset').textContent = 'もう一度押すとリセット';
    armed = setTimeout(() => { armed = null; $('reset').textContent = '試合をリセット'; }, 3000);
    return;
  }
  clearTimeout(armed); armed = null; $('reset').textContent = '試合をリセット';
  st.hist.push(JSON.stringify(st.sc));
  // ここまでを1試合として区切り、次のポイントから新しい試合として記録する
  if (st.matchId && (st.sc.n || 0) > 0) send(updateMatchMeta(st.matchId, { endedAt: Date.now() }));
  st.matchId = '';
  send(writeSub(court, 'matchId', ''));
  st.sc = emptyScore();
  commitScore();
};
$('addResult').onclick = () => {
  const d = D(), line = resultLine(st, d), code = d.m.code.trim();
  const lines = d.results.split('\n').filter(l => l.trim());
  const i = lines.findIndex(l => code && l.startsWith(code + ' '));
  if (i >= 0) lines[i] = line; else lines.push(line);
  d.results = lines.join('\n');
  fillForm();
  commitDraft();
};

/* 背景画像は位置合わせの目安。この画面だけのもので、配信には出ない */
$('bgBtn').onclick = () => $('bgFile').click();
$('bgFile').onchange = e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => document.querySelectorAll('.bgimg').forEach(i => { i.src = r.result; i.hidden = false; });
  r.readAsDataURL(f);
};

window.addEventListener('resize', () => { fit(stages.draft); fit(stages.live); });

fillForm();
render();

/* 文字の幅は書体が読み込まれると変わるので、読み込み後にもう一度描き直す */
if (document.fonts && document.fonts.ready) document.fonts.ready.then(render);


/* ---------- タブの切り替え ---------- */
const TAB_KEY = 'osg-control-tab';
const tabBtns = [...document.querySelectorAll('.tabs [role=tab]')];

function showTab(name) {
  for (const b of tabBtns) {
    const on = b.dataset.tab === name;
    b.setAttribute('aria-selected', String(on));
    $('tab-' + b.dataset.tab).hidden = !on;
  }
  try { localStorage.setItem(TAB_KEY, name); } catch (e) { /* 使えなくても困らない */ }
}

tabBtns.forEach((b, i) => {
  b.onclick = () => showTab(b.dataset.tab);
  // 左右キーでも切り替えられるようにする
  b.onkeydown = e => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = tabBtns[(i + d + tabBtns.length) % tabBtns.length];
    showTab(next.dataset.tab);
    next.focus();
  };
});

let startTab = 'live';
try {
  const v = localStorage.getItem(TAB_KEY);
  if (v && tabBtns.some(b => b.dataset.tab === v)) startTab = v;
} catch (e) { /* 既定のまま */ }
showTab(startTab);

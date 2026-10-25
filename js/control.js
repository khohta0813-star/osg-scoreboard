/* 操作画面の中身。試作版のスクリプトを、保存先 localStorage から
   Firebase Realtime Database に置き換えたもの。操作の流れは試作版と同じ。

   書き込みの分け方
     スコア操作（得点・取り消し・サーブ交代・リセット） → sc と hist に即時
     得点ルール（セット数・ノーアド・タイブレーク）     → rules に即時
     それ以外（チーム名・選手名・結果・自由テキスト・レイアウト） → draft に保存し、
       「配信に反映」で draft を pub にコピーして初めて視聴者に出る */

import {
  PARTS, clone, oth, defaultState, defaultDisplay, normalize,
  addPoint, ptText, setStr, resultLine,
  mountCanvas, renderCanvas, place, fit,
} from './parts.js';
import { app, isConfigured, courtId, watchCourt, watchConnection, writeSub, writeMany, seedIfEmpty } from './db.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  setPersistence, browserLocalPersistence,
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';

const $ = id => document.getElementById(id);
const court = courtId();
const D = () => st.draft;

$('courtTag').textContent = 'COURT ' + court;
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
let signedIn = false;
let courtEmpty = false; // Firebase にこのコートのデータがまだ無い
let seeding = false;

/* ---------- 保存（Firebase への書き込み） ---------- */
/* 下書きは文字入力ごとに書かないよう、少しまとめてから送る */
let draftTimer = null;
let draftPending = false;
function wDraft() {
  draftPending = true;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    draftTimer = null;
    draftPending = false;
    send(writeSub(court, 'draft', st.draft));
  }, 200);
}
const wPub = () => send(writeSub(court, 'pub', st.pub));
const wRules = () => send(writeSub(court, 'rules', st.rules));
const wSc = () => send(writeSub(court, 'sc', st.sc));
const wScHist = () => send(writeMany(court, { sc: st.sc, hist: st.hist.length ? st.hist : null }));

/* 画面に反映してから保存する */
const commitDraft = () => { render(); wDraft(); };
const commitRules = () => { render(); wRules(); };
const commitScore = () => { render(); wScHist(); };

/* ---------- キャンバス（下書き／配信中） ---------- */
const stages = { draft: $('draftStage'), live: $('liveStage') };
mountCanvas(stages.draft, { court: true, editable: true });
mountCanvas(stages.live, { court: true });

/* ---------- 描画 ---------- */
const dirty = () => JSON.stringify(st.draft) !== JSON.stringify(st.pub);
function render() {
  renderCanvas(stages.draft, st.draft, st.sc);
  renderCanvas(stages.live, st.pub, st.sc);
  const sc = st.sc, t = st.pub.teams, m = st.pub.m;
  $('ptAn').textContent = t.a; $('ptBn').textContent = t.b;
  $('ptAp').textContent = m.pA; $('ptBp').textContent = m.pB;
  const sets = sc.done.map(setStr).join('  ');
  $('readout').textContent = sc.win
    ? `${t[sc.win]} の勝利　${sets}`
    : `${sets ? sets + '  ｜  ' : ''}${sc.g.a}-${sc.g.b}  ｜  ${ptText(st, 'a')}-${ptText(st, 'b')}${sc.tb ? (sc.mtb ? '  (10pt TB)' : '  (TB)') : ''}`;
  $('undo').disabled = !st.hist.length;
  const dt = dirty();
  $('pubBar').classList.toggle('dirty', dt);
  $('pubMsg').textContent = dt
    ? '未反映の変更があります。下書きを確認して「配信に反映」を押してください'
    : '下書きと配信中の表示は同じです';
  $('publish').disabled = !dt;
  $('discard').disabled = !dt;
  renderLay();
}

/* ---------- Firebase と同期 ---------- */
if (isConfigured) {
  watchConnection(ok => {
    const el = $('conn');
    el.className = 'state ' + (ok ? 'ok' : 'off');
    el.lastElementChild.textContent = ok ? '同期中' : '接続待ち（復帰後に自動で戻ります）';
  });

  watchCourt(court, raw => {
    courtEmpty = raw === null;
    if (courtEmpty) { maybeSeed(); return; }
    const next = normalize(raw, court);
    // 自分がいま入力している下書きは、送信待ちの間だけ手元の内容を優先する
    if (draftPending) next.draft = st.draft;
    st = next;
    fillForm();
    render();
  });
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
    const L = D().lay[w.dataset.id], S = stages.draft.S,
      sx = e.clientX, sy = e.clientY, ox = L.x, oy = L.y, os = L.s;
    const resize = e.target.classList.contains('hdl'), natW = w.offsetWidth;
    w.setPointerCapture(e.pointerId);
    const mv = ev => {
      const dx = (ev.clientX - sx) / S, dy = (ev.clientY - sy) / S;
      if (resize) L.s = Math.max(.3, Math.min(3, (natW * os + dx) / natW));
      else {
        L.x = Math.round(Math.max(-50, Math.min(1900, ox + dx)));
        L.y = Math.round(Math.max(-50, Math.min(1060, oy + dy)));
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

function renderLay() {
  const box = $('lay');
  if (!box.childElementCount) {
    PARTS.forEach(([id, name]) => {
      const c = document.createElement('label'); c.className = 'chk';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'v_' + id;
      c.append(cb, name);
      const r = document.createElement('input');
      r.type = 'range'; r.min = .3; r.max = 3; r.step = .05; r.id = 's_' + id;
      r.setAttribute('aria-label', name + 'の大きさ');
      const b = document.createElement('button'); b.textContent = '初期位置'; b.id = 'r_' + id;
      box.append(c, r, b);
      cb.onchange = e => { D().lay[id].v = e.target.checked; commitDraft(); };
      r.oninput = e => {
        D().lay[id].s = +e.target.value;
        place(stages.draft.querySelector(`.w[data-id=${id}]`), D().lay[id]);
      };
      r.onchange = commitDraft;
      b.onclick = () => { D().lay[id] = clone(defaultDisplay(court).lay[id]); commitDraft(); };
    });
  }
  PARTS.forEach(([id]) => { $('v_' + id).checked = D().lay[id].v; $('s_' + id).value = D().lay[id].s; });
}

/* ---------- 入力欄との結びつけ ---------- */
const binds = [
  ['tA', v => D().teams.a = v, () => D().teams.a],
  ['tB', v => D().teams.b = v, () => D().teams.b],
  ['pA', v => D().m.pA = v, () => D().m.pA],
  ['pB', v => D().m.pB = v, () => D().m.pB],
  ['code', v => D().m.code = v, () => D().m.code],
  ['lbl', v => D().m.lbl = v, () => D().m.lbl],
  ['pOverride', v => D().m.override = v, () => D().m.override],
  ['results', v => D().results = v, () => D().results],
  ['free', v => D().free = v, () => D().free],
];
binds.forEach(([id, set]) => $(id).addEventListener('input', e => { set(e.target.value); commitDraft(); }));

const draftChecks = [
  ['resBand', v => D().resBand = v, () => D().resBand],
  ['freeBand', v => D().freeBand = v, () => D().freeBand],
  ['freeOn', v => D().freeOn = v, () => D().freeOn],
];
const ruleChecks = [
  ['noAd', v => st.rules.noAd = v, () => st.rules.noAd],
  ['tb', v => st.rules.tb = v, () => st.rules.tb],
  ['mtb', v => st.rules.mtb = v, () => st.rules.mtb],
];
draftChecks.forEach(([id, set]) => $(id).addEventListener('change', e => { set(e.target.checked); commitDraft(); }));
ruleChecks.forEach(([id, set]) => $(id).addEventListener('change', e => { set(e.target.checked); commitRules(); }));
$('sets').onchange = e => { st.rules.sets = +e.target.value; commitRules(); };

function fillForm() {
  binds.forEach(([id, , get]) => { if (document.activeElement !== $(id)) $(id).value = get(); });
  draftChecks.concat(ruleChecks).forEach(([id, , get]) => ($(id).checked = get()));
  $('sets').value = String(st.rules.sets);
}

/* ---------- ボタン ---------- */
$('publish').onclick = () => {
  st.pub = clone(st.draft);
  render();
  wPub();
  $('pubMsg').textContent = '配信に反映しました';
};
$('discard').onclick = () => { st.draft = clone(st.pub); fillForm(); commitDraft(); };
$('ptA').onclick = () => { if (addPoint(st, 'a')) commitScore(); };
$('ptB').onclick = () => { if (addPoint(st, 'b')) commitScore(); };
$('undo').onclick = () => {
  const h = st.hist.pop();
  if (h) { st.sc = JSON.parse(h); commitScore(); }
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
  st.sc = { done: [], g: { a: 0, b: 0 }, p: { a: 0, b: 0 }, tb: false, mtb: false, srv: 'a', tbFirst: 'a', win: null };
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

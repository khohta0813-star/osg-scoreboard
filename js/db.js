/* Firebase Realtime Database への接続と読み書き。
   データの置き場所： courts/{コートID}/ の下に draft, pub, sc, rules, hist

     draft … 下書き（操作画面で編集中の内容。視聴者には見えない）
     pub   … 配信中の内容（overlay.html が読む。「配信に反映」で draft からコピー）
     sc    … スコア（即時反映）
     rules … 得点ルール（即時反映）
     hist  … 取り消し用の履歴

   接続が切れても SDK が自動で再接続し、つながった時点で最新状態に戻る。 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  getDatabase, ref, onValue, set, update, get, push, query, orderByChild, limitToLast,
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

/* firebase-config.js がまだ書き換えられていないかどうか */
export const isConfigured = !!(
  firebaseConfig &&
  firebaseConfig.apiKey &&
  firebaseConfig.databaseURL &&
  !String(firebaseConfig.apiKey).startsWith('ここに')
);

export const app = isConfigured ? initializeApp(firebaseConfig) : null;
export const db = app ? getDatabase(app) : null;

/* URL の ?court=A からコートIDを決める。大文字に統一し、使える文字だけ通す */
export function courtId() {
  const raw = (new URLSearchParams(location.search).get('court') || 'A').toUpperCase();
  return /^[A-Z0-9_-]{1,20}$/.test(raw) ? raw : 'A';
}

export function courtRef(court, path) {
  return ref(db, `courts/${court}` + (path ? `/${path}` : ''));
}

/* コートのデータ全体を監視する。変化のたびに cb(値) が呼ばれる */
export function watchCourt(court, cb) {
  return onValue(courtRef(court), snap => cb(snap.val()), err => console.error('[db] 読み込みに失敗', err));
}

/* courts/{court}/{path} だけを監視する（配信用ページは pub と sc だけを読む） */
export function watchSub(court, path, cb) {
  return onValue(courtRef(court, path), snap => cb(snap.val()), err => console.error(`[db] ${path} の読み込みに失敗`, err));
}

/* つながっているかどうかを監視する */
export function watchConnection(cb) {
  return onValue(ref(db, '.info/connected'), snap => cb(!!snap.val()));
}

/* courts/{court}/{path} をまるごと置き換える */
export function writeSub(court, path, value) {
  return set(courtRef(court, path), value);
}

/* 複数の枝を一度に（途中で分かれない形で）書き込む */
export function writeMany(court, obj) {
  return update(courtRef(court), obj);
}

/* コートの表示名だけを読む（入口ページ用） */
export async function readCourtName(court) {
  try {
    const snap = await get(courtRef(court, 'name'));
    return typeof snap.val() === 'string' ? snap.val() : '';
  } catch (e) {
    return '';
  }
}

/* コートのデータがまだ無ければ初期値を入れる（ログイン済みのときだけ成功する） */
export async function seedIfEmpty(court, initial) {
  const snap = await get(courtRef(court));
  if (snap.exists()) return false;
  await set(courtRef(court), initial);
  return true;
}


/* ---------- スコア分析用の記録 ----------
   matchList/{試合ID}        … 試合の見出し（日時・チーム・選手・ルール）。一覧に使う
   matchPoints/{試合ID}/{キー} … 1ポイント1件の記録
   見出しと中身を分けてあるので、一覧を出すときに全ポイントを読み込まずに済む。 */

/* A-20261103-143015 のような、読んで分かる試合ID */
export function newMatchId(court) {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${court}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function writeMatchMeta(matchId, meta) {
  return set(ref(db, `matchList/${matchId}`), meta);
}

export function updateMatchMeta(matchId, patch) {
  return update(ref(db, `matchList/${matchId}`), patch);
}

/* 1ポイント追加。戻り値の key で、取り消しのときに消せる */
export function appendPoint(matchId, rec) {
  return push(ref(db, `matchPoints/${matchId}`), rec);
}

/* 取り消し用に、最後の n ポイントを消す */
export async function removeLastPoints(matchId, n = 1) {
  if (!matchId || n <= 0) return;
  const snap = await get(query(ref(db, `matchPoints/${matchId}`), limitToLast(n)));
  const v = snap.val();
  if (!v) return;
  const patch = {};
  for (const k of Object.keys(v)) patch[k] = null;
  await update(ref(db, `matchPoints/${matchId}`), patch);
}

/* 試合の一覧（新しい順） */
export async function listMatches(limit = 200) {
  const snap = await get(query(ref(db, 'matchList'), orderByChild('startedAt'), limitToLast(limit)));
  const v = snap.val() || {};
  return Object.entries(v)
    .map(([id, m]) => ({ id, ...m }))
    .sort((x, y) => (y.startedAt || 0) - (x.startedAt || 0));
}

/* 1試合ぶんのポイント（古い順） */
export async function readPoints(matchId) {
  const snap = await get(ref(db, `matchPoints/${matchId}`));
  const v = snap.val() || {};
  return Object.keys(v).sort().map(k => v[k]);
}

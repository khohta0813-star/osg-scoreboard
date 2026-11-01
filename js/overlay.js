/* 配信用ページの中身。
   courts/{コート}/pub・sc・rules だけを読んで描画する。書き込みはしない。
   （rules はスコア枠をセット数ぶん出すために必要）
   直前の表示内容をブラウザに控えておき、配信を再起動した直後でもすぐ絵が出るようにしている。 */

import { mountCanvas, renderCanvas, normalize, defaultState } from './parts.js';
import { isConfigured, courtId, watchSub } from './db.js';

const court = courtId();
const stage = document.getElementById('stage');
mountCanvas(stage, {}); // コート絵や編集用のつまみは入れない

const CACHE = 'osg-overlay-' + court;
let raw = {}; // Firebase から届いた生の値（pub と sc）

/* 前回の内容をすぐ描く */
try {
  const cached = localStorage.getItem(CACHE);
  if (cached) raw = JSON.parse(cached) || {};
} catch (e) {
  /* 使えなければ初期値のまま */
}
draw();
/* 文字の幅は書体が読み込まれると変わるので、読み込み後にもう一度描き直す */
if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);

function draw() {
  const st = Object.keys(raw).length ? normalize(raw, court) : defaultState(court);
  renderCanvas(stage, st.pub, st.sc, st.rules);
}

function onChange(key, val) {
  raw[key] = val;
  draw();
  try {
    localStorage.setItem(CACHE, JSON.stringify({ pub: raw.pub, sc: raw.sc, rules: raw.rules }));
  } catch (e) {
    /* 控えに失敗しても表示には影響しない */
  }
}

if (isConfigured) {
  watchSub(court, 'pub', v => onChange('pub', v));
  watchSub(court, 'sc', v => onChange('sc', v));
  watchSub(court, 'rules', v => onChange('rules', v));
} else {
  console.error('[overlay] js/firebase-config.js に Firebase の接続情報が入っていません');
}

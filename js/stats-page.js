/* 分析ページの画面まわり。計算そのものは js/stats.js にある。 */

import { app, isConfigured, listMatches, readPoints } from './db.js';
import { analyse, momentum, toCsv, dblLabel } from './stats.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  setPersistence, browserLocalPersistence,
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n = v => (v == null ? '–' : v);
const p = v => (v == null ? '–' : v + '%');

let matches = [];
let current = null;

/* ---------- ログイン ---------- */
const auth = app ? getAuth(app) : null;
if (auth) {
  setPersistence(auth, browserLocalPersistence).catch(() => {});
  onAuthStateChanged(auth, user => {
    $('gate').hidden = !!user;
    if (user) { $('pass').value = ''; loadList(); }
  });
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('loginBtn').disabled = true;
    $('loginErr').textContent = '';
    try {
      await signInWithEmailAndPassword(auth, $('email').value.trim(), $('pass').value);
    } catch (err) {
      const c = (err && err.code) || '';
      $('loginErr').textContent = c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')
        ? 'メールアドレスかパスワードが違います。'
        : 'ログインできませんでした：' + (err.message || c);
    } finally {
      $('loginBtn').disabled = false;
    }
  });
  $('logout').onclick = () => signOut(auth);
} else {
  $('mlist').innerHTML = '<p class="empty">js/firebase-config.js に Firebase の接続情報が入っていません。</p>';
}

/* ---------- 試合の一覧 ---------- */
async function loadList() {
  if (!isConfigured) return;
  try {
    matches = await listMatches();
  } catch (err) {
    $('mlist').innerHTML = `<p class="empty">一覧を読み込めませんでした：${esc(err.message || err)}</p>`;
    return;
  }
  if (!matches.length) {
    $('mlist').innerHTML = '<p class="empty">まだ記録がありません。操作画面で得点ボタンを押すと、その試合から自動で記録が始まります。</p>';
    return;
  }
  $('mlist').innerHTML = matches
    .map(m => {
      const d = m.startedAt ? new Date(m.startedAt) : null;
      const when = d ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
      const who = `${esc(m.teams ? m.teams.a : 'A')} vs ${esc(m.teams ? m.teams.b : 'B')}`;
      const pl = m.players && (m.players.a || m.players.b) ? `${esc(m.players.a)} / ${esc(m.players.b)}` : '';
      return `<button type="button" class="mitem" data-id="${esc(m.id)}">
        <b>${who}</b>
        <small>${when}　${esc(m.code || '')} ${esc(m.courtName || 'コート' + (m.court || ''))}</small>
        ${pl ? `<small>${pl}</small>` : ''}
        ${m.score ? `<small>${esc(m.score)}</small>` : '<small>記録中</small>'}
      </button>`;
    })
    .join('');
}

$('mlist').addEventListener('click', e => {
  const b = e.target.closest('[data-id]');
  if (b) openMatch(b.dataset.id);
});

/* ---------- 1試合の分析 ---------- */
async function openMatch(id) {
  current = matches.find(m => m.id === id);
  document.querySelectorAll('.mitem').forEach(el => el.setAttribute('aria-current', String(el.dataset.id === id)));
  $('detail').innerHTML = '<section class="card"><p class="empty">読み込み中…</p></section>';
  let points;
  try {
    points = await readPoints(id);
  } catch (err) {
    $('detail').innerHTML = `<section class="card"><p class="empty">読み込めませんでした：${esc(err.message || err)}</p></section>`;
    return;
  }
  if (!points.length) {
    $('detail').innerHTML = '<section class="card"><p class="empty">この試合にはまだポイントの記録がありません。</p></section>';
    return;
  }
  render(points, current);
}

function render(points, meta) {
  const r = analyse(points, meta);
  const A = r.stats.a, B = r.stats.b;
  const na = esc((meta.players && meta.players.a) || (meta.teams && meta.teams.a) || 'A');
  const nb = esc((meta.players && meta.players.b) || (meta.teams && meta.teams.b) || 'B');

  const row = (label, va, vb) => `<tr><td>${label}</td><td><b>${va}</b></td><td><b>${vb}</b></td></tr>`;
  const table = (title, note, rows) => `
    <section class="card">
      <h2>${title}${note ? `<span>${note}</span>` : ''}</h2>
      <table>
        <thead><tr><th></th><th>${na}</th><th>${nb}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;

  $('detail').innerHTML = `
    <section class="card">
      <h2>Summary<span>サマリー</span></h2>
      <div class="sum">
        <div><span>スコア</span><b class="big-num">${esc(meta.score || '記録中')}</b></div>
        <div><span>所要時間</span><b class="big-num">${r.minutes != null ? r.minutes + ' 分' : '–'}</b></div>
        <div><span>総ポイント</span><b class="big-num">${r.total}</b></div>
        <div><span>獲得ポイント</span><b class="big-num">${A.won} - ${B.won}</b></div>
        <div><span>ゲーム数</span><b class="big-num">${r.games.length}</b></div>
      </div>
      <div class="row">
        <button type="button" id="csv" class="ghost">CSVでダウンロード</button>
      </div>
      <p class="note">記録は得点ボタンから自動で作られています。ウィナーやラリー数は含みません。</p>
    </section>

    ${table('Serve', 'サービス', [
      row('ファーストサーブ確率', p(A.serve.firstPct), p(B.serve.firstPct)),
      row('ファーストサーブ獲得率', p(A.serve.firstWonPct), p(B.serve.firstWonPct)),
      row('セカンドサーブ獲得率', p(A.serve.secondWonPct), p(B.serve.secondWonPct)),
      row('サービスポイント獲得率', p(A.serve.wonPct), p(B.serve.wonPct)),
      row('ダブルフォールト', n(A.serve.df), n(B.serve.df)),
      row('サーブを打った数', n(A.serve.total), n(B.serve.total)),
    ].join(''))}

    ${table('Return', 'リターン', [
      row('1stに対する獲得率', p(A.ret.firstPct), p(B.ret.firstPct)),
      row('2ndに対する獲得率', p(A.ret.secondPct), p(B.ret.secondPct)),
      row('リターンポイント獲得率', p(A.ret.wonPct), p(B.ret.wonPct)),
    ].join(''))}

    ${table('Break &amp; Hold', 'ブレークとキープ', [
      row('ブレーク成功 / 機会', `${A.bp.converted} / ${A.bp.chances}`, `${B.bp.converted} / ${B.bp.chances}`),
      row('ブレークポイント獲得率', p(A.bp.convPct), p(B.bp.convPct)),
      row('ブレークポイントセーブ率', p(A.bp.savePct), p(B.bp.savePct)),
      row('サービスゲーム キープ', `${A.hold.held} / ${A.hold.games}`, `${B.hold.held} / ${B.hold.games}`),
      row('キープ率', p(A.hold.pct), p(B.hold.pct)),
    ].join(''))}

    ${playerTables(r, meta)}

    ${table('Court side', 'デュースサイド / アドサイド', [
      row('デュースサイドのサーブ獲得率', p(A.side.deuce.servePct), p(B.side.deuce.servePct)),
      row('アドサイドのサーブ獲得率', p(A.side.ad.servePct), p(B.side.ad.servePct)),
      row('デュースサイドのリターン獲得率', p(A.side.deuce.retPct), p(B.side.deuce.retPct)),
      row('アドサイドのリターン獲得率', p(A.side.ad.retPct), p(B.side.ad.retPct)),
    ].join(''))}

    ${table('Key points', '勝負所', [
      row('デュースでの獲得率', p(A.key.deucePct), p(B.key.deucePct)),
      row('30-30 での獲得率', p(A.key.bp30Pct), p(B.key.bp30Pct)),
      row('ゲームポイントでの決定率', p(A.key.gpPct), p(B.key.gpPct)),
      row('最多連続ポイント', n(A.streak), n(B.streak)),
    ].join(''))}

    <section class="card">
      <h2>Momentum<span>試合の流れ（上が${na}優勢）</span></h2>
      ${chart(points)}
      <p class="note">1ポイントごとの得点差の累計です。線が上に伸びているほど${na}が連取しています。</p>
    </section>`;

  $('csv').onclick = () => {
    const blob = new Blob(['﻿' + toCsv(points, meta)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${meta.id || 'match'}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
}

/* ダブルスのとき、選手ごとの表を出す */
function playerTables(r, meta) {
  if (!r.players) return '';
  const cell = v => `<b>${v}</b>`;
  const teamTable = t => {
    const label = esc((meta.teams && meta.teams[t]) || t.toUpperCase());
    const n0 = esc(dblLabel(meta, t, 0)), n1 = esc(dblLabel(meta, t, 1));
    const v0 = r.players[t][0], v1 = r.players[t][1];
    const row = (k, f) => `<tr><td>${k}</td><td>${cell(f(v0))}</td><td>${cell(f(v1))}</td></tr>`;
    return `<section class="card">
      <h2>Players<span>${label} の選手別</span></h2>
      <table>
        <thead><tr><th></th><th>${n0}</th><th>${n1}</th></tr></thead>
        <tbody>
          ${row('サーブを打った数', v => n(v.serve.total))}
          ${row('ファーストサーブ確率', v => p(v.serve.firstPct))}
          ${row('ファーストサーブ獲得率', v => p(v.serve.firstWonPct))}
          ${row('セカンドサーブ獲得率', v => p(v.serve.secondWonPct))}
          ${row('サービスポイント獲得率', v => p(v.serve.wonPct))}
          ${row('ダブルフォールト', v => n(v.serve.df))}
          ${row('リターンした数', v => n(v.ret.faced))}
          ${row('リターンポイント獲得率', v => p(v.ret.wonPct))}
          ${row('デュースサイドのリターン獲得率', v => p(v.ret.deucePct))}
          ${row('アドサイドのリターン獲得率', v => p(v.ret.adPct))}
        </tbody>
      </table>
    </section>`;
  };
  return teamTable('a') + teamTable('b');
}

/* 得点差の推移を折れ線にする */
function chart(points) {
  const m = momentum(points);
  const W = 900, H = 200, pad = 10;
  const max = Math.max(4, ...m.map(v => Math.abs(v)));
  const x = i => pad + (i * (W - pad * 2)) / Math.max(1, m.length - 1);
  const y = v => H / 2 - (v / max) * (H / 2 - pad);
  const d = m.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="得点差の推移">
    <rect width="${W}" height="${H}" fill="rgba(255,255,255,.03)" rx="8"/>
    <line x1="${pad}" y1="${H / 2}" x2="${W - pad}" y2="${H / 2}" stroke="#2a4170" stroke-width="2"/>
    <path d="${d}" fill="none" stroke="#d4ef3a" stroke-width="3" stroke-linejoin="round"/>
  </svg>`;
}

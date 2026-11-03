/* スコア分析の計算。
   操作画面が残した1ポイントずつの記録から、追加入力なしで出せる項目を計算する。

   1件の記録（matchPoints/{試合ID}/{キー}）
     t   時刻
     w   ポイントを取った側 'a' / 'b'
     s   サーバー 'a' / 'b'
     sv  1 … ファーストサーブが入った / 2 … セカンドサーブ
     df  ダブルフォールトなら true
     set 何セット目（0始まり）
     ga,gb ポイント開始時のゲームカウント
     pa,pb ポイント開始時のポイント
     tb,mtb タイブレーク中なら true */

export const OTHER = s => (s === 'a' ? 'b' : 'a');

/* そのポイントをどちらのコートから打つか。
   ポイント開始時の合計が偶数ならデュースサイド、奇数ならアドサイド。
   タイブレークも1ポイントごとに入れ替わるので同じ規則でよい。
   ダブルスでは、リターンする人はセットを通してサイドで固定される。 */
export const courtSide = pt => ((pt.pa + pt.pb) % 2 === 0 ? 'deuce' : 'ad');

/* そのポイントを取ったら side がそのゲーム（タイブレーク）を取るか */
export function winsGameIf(side, pt, rules) {
  const me = (side === 'a' ? pt.pa : pt.pb) + 1;
  const you = side === 'a' ? pt.pb : pt.pa;
  if (pt.tb) {
    const target = pt.mtb ? 10 : 7;
    return me >= target && me - you >= 2;
  }
  if (rules.noAd) return me >= 4;
  return me >= 4 && me - you >= 2;
}

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

/* ポイントの並びから、1ゲーム（タイブレーク含む）ごとにまとめる */
export function groupGames(points) {
  const games = [];
  let cur = null;
  for (const p of points) {
    const key = `${p.set}-${p.ga}-${p.gb}`;
    if (!cur || cur.key !== key) {
      cur = { key, set: p.set, ga: p.ga, gb: p.gb, server: p.s, tb: !!p.tb, points: [] };
      games.push(cur);
    }
    cur.points.push(p);
  }
  for (const g of games) {
    g.winner = g.points[g.points.length - 1].w; // ゲームを決めたポイントを取った側
    g.a = g.points.filter(p => p.w === 'a').length;
    g.b = g.points.filter(p => p.w === 'b').length;
  }
  return games;
}

export function analyse(points, meta) {
  const rules = (meta && meta.rules) || { sets: 3, games: 6, noAd: false, tb: true, mtb: false };
  const sides = ['a', 'b'];
  const blank = () => ({
    won: 0,
    serve: { total: 0, first: 0, firstWon: 0, secondWon: 0, df: 0 },
    ret: { firstFaced: 0, firstWon: 0, secondFaced: 0, secondWon: 0 },
    bp: { faced: 0, lost: 0, chances: 0, converted: 0 },
    hold: { games: 0, held: 0 },
    key: { deuce: 0, deuceWon: 0, gp: 0, gpWon: 0, bp30: 0, bp30Won: 0 },
    side: { deuce: { served: 0, servedWon: 0, ret: 0, retWon: 0 }, ad: { served: 0, servedWon: 0, ret: 0, retWon: 0 } },
    streak: 0,
  });
  const S = { a: blank(), b: blank() };

  /* ダブルスで、記録にサーブ／リターンした人が入っているとき用 */
  const blankP = () => ({
    serve: { total: 0, first: 0, firstWon: 0, secondWon: 0, df: 0, won: 0 },
    ret: { faced: 0, won: 0, deuce: 0, deuceWon: 0, ad: 0, adWon: 0 },
  });
  const P = { a: [blankP(), blankP()], b: [blankP(), blankP()] };
  let hasPlayers = false;

  let run = { side: null, n: 0 };
  for (const p of points) {
    const srv = p.s, rec = OTHER(srv);
    S[p.w].won++;

    // 連続ポイント
    if (run.side === p.w) run.n++;
    else run = { side: p.w, n: 1 };
    if (run.n > S[p.w].streak) S[p.w].streak = run.n;

    // サーブ・リターン（タイブレークも含める）
    S[srv].serve.total++;
    if (p.sv === 1) {
      S[srv].serve.first++;
      S[rec].ret.firstFaced++;
      if (p.w === srv) S[srv].serve.firstWon++;
      else S[rec].ret.firstWon++;
    } else {
      S[rec].ret.secondFaced++;
      if (p.w === srv) S[srv].serve.secondWon++;
      else S[rec].ret.secondWon++;
    }
    if (p.df) S[srv].serve.df++;

    // デュースサイド / アドサイド
    const cs = courtSide(p);
    S[srv].side[cs].served++;
    S[rec].side[cs].ret++;
    if (p.w === srv) S[srv].side[cs].servedWon++;
    else S[rec].side[cs].retWon++;

    // ダブルス：誰がサーブし、誰がリターンしたか
    if (p.sp === 0 || p.sp === 1) {
      hasPlayers = true;
      const sv = P[srv][p.sp];
      sv.serve.total++;
      if (p.sv === 1) {
        sv.serve.first++;
        if (p.w === srv) sv.serve.firstWon++;
      } else if (p.w === srv) sv.serve.secondWon++;
      if (p.df) sv.serve.df++;
      if (p.w === srv) sv.serve.won++;
    }
    if (p.rp === 0 || p.rp === 1) {
      const rt = P[rec][p.rp];
      rt.ret.faced++;
      if (p.w === rec) rt.ret.won++;
      const side = courtSide(p);
      rt.ret[side]++;
      if (p.w === rec) rt.ret[side + 'Won']++;
    }

    // 勝負所（タイブレーク中は数えない）
    if (!p.tb) {
      const bp = winsGameIf(rec, p, rules);
      if (bp) {
        S[srv].bp.faced++;
        S[rec].bp.chances++;
        if (p.w === rec) {
          S[srv].bp.lost++;
          S[rec].bp.converted++;
        }
      }
      const gp = winsGameIf(srv, p, rules);
      if (gp && !bp) {
        S[srv].key.gp++;
        if (p.w === srv) S[srv].key.gpWon++;
      }
      if (p.pa >= 3 && p.pb >= 3 && p.pa === p.pb) {
        for (const s of sides) {
          S[s].key.deuce++;
          if (p.w === s) S[s].key.deuceWon++;
        }
      }
      if (p.pa === 2 && p.pb === 2) {
        for (const s of sides) {
          S[s].key.bp30++;
          if (p.w === s) S[s].key.bp30Won++;
        }
      }
    }
  }

  // サービスゲームのキープ
  const games = groupGames(points);
  for (const g of games) {
    if (g.tb) continue; // タイブレークはキープの対象外
    S[g.server].hold.games++;
    if (g.winner === g.server) S[g.server].hold.held++;
  }

  // 表示用の率
  for (const s of sides) {
    const v = S[s];
    v.serve.firstPct = pct(v.serve.first, v.serve.total);
    v.serve.firstWonPct = pct(v.serve.firstWon, v.serve.first);
    v.serve.secondWonPct = pct(v.serve.secondWon, v.serve.total - v.serve.first);
    v.serve.wonPct = pct(v.serve.firstWon + v.serve.secondWon, v.serve.total);
    v.ret.firstPct = pct(v.ret.firstWon, v.ret.firstFaced);
    v.ret.secondPct = pct(v.ret.secondWon, v.ret.secondFaced);
    v.ret.wonPct = pct(v.ret.firstWon + v.ret.secondWon, v.ret.firstFaced + v.ret.secondFaced);
    v.bp.convPct = pct(v.bp.converted, v.bp.chances);
    v.bp.savePct = pct(v.bp.faced - v.bp.lost, v.bp.faced);
    v.hold.pct = pct(v.hold.held, v.hold.games);
    v.key.deucePct = pct(v.key.deuceWon, v.key.deuce);
    v.key.gpPct = pct(v.key.gpWon, v.key.gp);
    v.key.bp30Pct = pct(v.key.bp30Won, v.key.bp30);
    for (const cs of ['deuce', 'ad']) {
      v.side[cs].servePct = pct(v.side[cs].servedWon, v.side[cs].served);
      v.side[cs].retPct = pct(v.side[cs].retWon, v.side[cs].ret);
    }
  }

  for (const t of ['a', 'b']) {
    for (const v of P[t]) {
      v.serve.firstPct = pct(v.serve.first, v.serve.total);
      v.serve.firstWonPct = pct(v.serve.firstWon, v.serve.first);
      v.serve.secondWonPct = pct(v.serve.secondWon, v.serve.total - v.serve.first);
      v.serve.wonPct = pct(v.serve.won, v.serve.total);
      v.ret.wonPct = pct(v.ret.won, v.ret.faced);
      v.ret.deucePct = pct(v.ret.deuceWon, v.ret.deuce);
      v.ret.adPct = pct(v.ret.adWon, v.ret.ad);
    }
  }

  const first = points[0], last = points[points.length - 1];
  return {
    rules,
    stats: S,
    players: hasPlayers ? P : null,
    games,
    total: points.length,
    startedAt: first ? first.t : meta && meta.startedAt,
    endedAt: last ? last.t : null,
    minutes: first && last ? Math.round((last.t - first.t) / 60000) : null,
  };
}

/* 得点差の推移（1ポイントごとの累計差。プラスで a 優勢） */
export function momentum(points) {
  let d = 0;
  return points.map(p => (d += p.w === 'a' ? 1 : -1));
}

/* ダブルスの選手名。未入力なら A1 のような仮の名前 */
export function dblLabel(meta, team, idx) {
  const names = meta && meta.dbl && meta.dbl.names;
  const key = team + (idx + 1);
  return (names && (names[key] || '').trim()) || team.toUpperCase() + (idx + 1);
}

/* 表計算ソフトで開けるように CSV にする */
export function toCsv(points, meta) {
  const head = ['順番', '時刻', 'セット', 'ゲーム', 'ポイント', 'サーバー', 'コートサイド', '1st/2nd', 'ダブルフォールト', 'タイブレーク', 'サーブした人', 'リターンした人', '取った側'];
  const rows = points.map((p, i) => [
    i + 1,
    new Date(p.t).toLocaleString('ja-JP'),
    p.set + 1,
    `${p.ga}-${p.gb}`,
    `${p.pa}-${p.pb}`,
    p.s === 'a' ? (meta.teams ? meta.teams.a : 'A') : meta.teams ? meta.teams.b : 'B',
    courtSide(p) === 'deuce' ? 'デュース' : 'アド',
    p.sv === 2 ? '2nd' : '1st',
    p.df ? 'はい' : '',
    p.tb ? 'はい' : '',
    p.sp === 0 || p.sp === 1 ? dblLabel(meta, p.s, p.sp) : '',
    p.rp === 0 || p.rp === 1 ? dblLabel(meta, p.s === 'a' ? 'b' : 'a', p.rp) : '',
    p.w === 'a' ? (meta.teams ? meta.teams.a : 'A') : meta.teams ? meta.teams.b : 'B',
  ]);
  return [head, ...rows]
    .map(r => r.map(c => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(','))
    .join('\n');
}

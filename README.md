# OSG LIVE スコアボード

テニス日本リーグの YouTube 配信用スコアボード。
操作画面でスコアを動かすと、配信用ページ（Prism Live Studio のウェブウィジェットに貼る）へ即時に反映される。

配信チーム向けの手順は **[使い方.md](使い方.md)** を参照。ここは仕組みの説明。

## ページ

| ファイル | 役割 |
| --- | --- |
| `index.html` | 入口。コートを選んで操作画面を開く／配信用URLをコピーする |
| `control.html?court=A` | 操作画面。ログインが必要。スマホ可 |
| `overlay.html?court=A` | 配信用。背景透明・操作UIなし。`pub` と `sc` だけを読む |

コートは URL の `?court=` で切り替える（`A`、`B`、…）。大文字に統一され、コートごとにデータは別々。

## データの置き場所（Firebase Realtime Database）

```
courts/{コートID}/
  draft   下書き。操作画面で編集中の内容。視聴者には見えない
  pub     配信中の内容。overlay.html が読む
  sc      スコア
  rules   得点ルール（セット数・ノーアド・タイブレーク）
  hist    取り消し用の履歴（最大 50 件）
```

反映のしかたは試作版と同じ。

- **即時反映** … スコア操作（得点・取り消し・サーブ交代・リセット）と得点ルール
- **「配信に反映」で反映** … チーム名・選手名・団体戦の結果・自由テキスト・レイアウト
  （`draft` を `pub` にコピーしたときだけ視聴者に出る）

## ファイル構成

```
css/parts.css     配信に映るパーツの見た目（操作画面と配信用で共用）
css/control.css   操作画面だけの見た目
js/parts.js       データの形・得点計算・描画（両ページで共用）
js/db.js          Firebase への接続と読み書き
js/firebase-config.js  Firebase の接続情報
js/control.js     操作画面の動き
js/overlay.js     配信用ページの動き
database.rules.json    セキュリティルール
```

得点計算と描画を `js/parts.js` に集約してあるので、操作画面のプレビューと配信用ページの
見え方は必ず一致する。キャンバスは 1920×1080 固定で、表示枠の大きさに合わせて拡縮する。

## セキュリティ

- 読み取りは誰でも可（配信用ページがログインなしで表示できる必要があるため）
- 書き込みはログイン済みのユーザーのみ（`database.rules.json`）
- `js/firebase-config.js` の値は公開されても問題ないもの。誰が書き込めるかはルールで決まる
- Firebase コンソールで **ユーザーの自己登録（sign-up）を無効** にしておくこと

## 開発

```bash
python -m http.server 8080
```

`http://localhost:8080/control.html?court=A` を開く。
`file://` で直接開くと ES モジュールとログインが動かないので、必ずローカルサーバー経由で開く。

ルールの反映:

```bash
firebase deploy --only database
```

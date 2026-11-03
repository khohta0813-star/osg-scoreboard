"""ローカル確認用の簡易サーバー。

標準の `python -m http.server` だと、CSS や JS を書き換えてもブラウザが
古いものを使い続けることがある（キャッシュのヘッダーが付かないため）。
このサーバーは

  1. すべての応答にキャッシュ無効のヘッダーを付ける
  2. HTML と JS の中の `css/...` `js/...` `./....js` という参照に、
     そのファイルの更新時刻を `?v=` として自動で足す

の2つをやるので、保存してリロードすれば必ず最新が表示される。
手元の確認専用で、公開先（GitHub Pages）には一切関係しない。

    python devserver.py [ポート番号]
"""

import http.server
import io
import os
import re
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
ROOT = os.path.dirname(os.path.abspath(__file__))

# HTML の href="css/..." src="js/..."
HTML_REF = re.compile(rb'((?:href|src)=")((?:css|js)/[^"?#]+\.(?:css|js))(")')
# JS の from './parts.js' や import('./db.js')
JS_REF = re.compile(rb"""((?:from|import)\s*\(?\s*['"])(\./[^'"?#]+\.js)(['"])""")


def stamp(base_dir, match):
    """参照しているファイルの更新時刻を ?v= として足す"""
    head, rel, tail = match.group(1), match.group(2), match.group(3)
    target = os.path.normpath(os.path.join(base_dir, rel.decode("utf-8")))
    try:
        v = str(int(os.path.getmtime(target)))
    except OSError:
        return match.group(0)
    return head + rel + b"?v=" + v.encode() + tail


class DevHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()

        ext = os.path.splitext(path)[1].lower()
        if ext not in (".html", ".js") or not os.path.isfile(path):
            return super().send_head()

        try:
            with open(path, "rb") as f:
                body = f.read()
        except OSError:
            return super().send_head()

        base = os.path.dirname(path)
        pattern = HTML_REF if ext == ".html" else JS_REF
        body = pattern.sub(lambda m: stamp(base, m), body)

        ctype = "text/html; charset=utf-8" if ext == ".html" else "text/javascript; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        return io.BytesIO(body)

    def log_message(self, fmt, *args):  # 余計なログを出さない
        pass


if __name__ == "__main__":
    os.chdir(ROOT)
    # 標準の http.server と同じく、同時アクセスをさばけるスレッド版を使う
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(("", PORT), DevHandler) as httpd:
        print(f"http://localhost:{PORT}/ （キャッシュ無効・自動で最新を読み込みます）", flush=True)
        httpd.serve_forever()

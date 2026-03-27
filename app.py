# app.py — DLHub
# Fase 2: YouTube migrado a Blueprint. routes.py ya no se usa.

import threading
import webbrowser
from flask import Flask, render_template

from utils import BASE_DIR
from platforms.youtube.routes import youtube_bp

app = Flask(
    __name__,
    template_folder=BASE_DIR + '/templates',
    static_folder=BASE_DIR + '/static',
)

# ─── Pantalla de inicio ────────────────────────────────────────────────────────
@app.route('/')
def home():
    return render_template('home.html')

# ─── Plataformas ───────────────────────────────────────────────────────────────
app.register_blueprint(youtube_bp, url_prefix='/youtube')

# ─── Fases futuras (descomentar cuando estén listos) ──────────────────────────
# from platforms.tiktok.routes    import tiktok_bp
# from platforms.instagram.routes import instagram_bp
# from platforms.twitter.routes   import twitter_bp
# app.register_blueprint(tiktok_bp,    url_prefix='/tiktok')
# app.register_blueprint(instagram_bp, url_prefix='/instagram')
# app.register_blueprint(twitter_bp,   url_prefix='/twitter')


def _abrir_navegador():
    webbrowser.open('http://127.0.0.1:8080')


if __name__ == '__main__':
    threading.Timer(1.2, _abrir_navegador).start()
    app.run(debug=False, host='127.0.0.1', port=8080, use_reloader=False)
# platforms/youtube/routes.py
# Blueprint de YouTube — toda la lógica específica de YT vive acá.
# La lógica de descarga/stream se delega a core/downloader.py

import os
import json
import uuid
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

import yt_dlp
from flask import Blueprint, render_template, request, jsonify, Response, stream_with_context

from utils import log, get_download_folder, set_download_folder, FFMPEG_PATH
from core.downloader import generar_stream, cancelar_proceso

youtube_bp = Blueprint(
    'youtube',
    __name__,
    template_folder='templates',   # platforms/youtube/templates/
)


# ── Whitelist de dominios ─────────────────────────────────────────────────────
_WHITELIST_PATH = os.path.join(os.path.dirname(__file__), 'allowed_sites.json')

def _cargar_whitelist():
    try:
        with open(_WHITELIST_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return set(data.get('allowed_domains', []))
    except Exception as e:
        log.error(f'[YT/Whitelist] No se pudo cargar allowed_sites.json: {e}')
        return set()

_DOMINIOS_PERMITIDOS = _cargar_whitelist()
MAX_URL_LEN = 2000

def _url_permitida(url: str) -> bool:
    if not url or len(url) > MAX_URL_LEN:
        return False
    try:
        dominio = urlparse(url).netloc.lower().split(':')[0]
        return dominio in _DOMINIOS_PERMITIDOS
    except Exception:
        return False


# ── Limpieza de URLs (específica de YouTube) ─────────────────────────────────
def _es_radio(url):
    try:
        lista = parse_qs(urlparse(url).query).get('list', [''])[0]
        return lista.startswith('RD') or lista.startswith('RDMM')
    except Exception:
        return False

def _limpiar_url_radio(url):
    parsed = urlparse(url)
    params = parse_qs(parsed.query, keep_blank_values=True)
    for p in ('list', 'start_radio', 'rv'):
        params.pop(p, None)
    return urlunparse(parsed._replace(query=urlencode({k: v[0] for k, v in params.items()})))

def _limpiar_url_video(url):
    parsed = urlparse(url)
    params = parse_qs(parsed.query, keep_blank_values=True)
    for p in ('list', 'start_radio', 'rv', 'index', 'pp'):
        params.pop(p, None)
    return urlunparse(parsed._replace(query=urlencode({k: v[0] for k, v in params.items()})))


# ── Extracción de info ────────────────────────────────────────────────────────
def _procesar_entrada_info(info):
    formatos_video   = []
    mejor_audio_size = None

    for f in info.get('formats', []):
        res    = f.get('height')
        ext    = f.get('ext')
        vcodec = f.get('vcodec', '')
        acodec = f.get('acodec', '')

        if res and vcodec != 'none' and (ext == 'mp4' or 'avc' in vcodec):
            if not any(x['res_num'] == res for x in formatos_video):
                size = f.get('filesize') or f.get('filesize_approx') or None
                formatos_video.append({'id': f.get('format_id'), 'label': f"{res}p",
                                       'res_num': res, 'size': size})

        if vcodec == 'none' and acodec != 'none':
            size_a = f.get('filesize') or f.get('filesize_approx') or 0
            if size_a and (mejor_audio_size is None or size_a > mejor_audio_size):
                mejor_audio_size = size_a

    formatos_video.sort(key=lambda x: x['res_num'], reverse=True)

    return {
        'url':        info.get('webpage_url') or info.get('url', ''),
        'titulo':     info.get('title', 'Sin título'),
        'thumbnail':  info.get('thumbnail', ''),
        'duracion':   info.get('duration'),
        'peso_video': formatos_video[0]['size'] if formatos_video else None,
        'peso_audio': mejor_audio_size,
        'formatos':   formatos_video,
    }

def _procesar_entrada(url):
    with yt_dlp.YoutubeDL({'quiet': True, 'no_warnings': True}) as ydl:
        info = ydl.extract_info(url, download=False)
    return _procesar_entrada_info(info)

def _extraer_info(url):
    if _es_radio(url):
        url = _limpiar_url_radio(url)
        log.info(f'[YT/Analizar] Radio detectada, tratando como video: {url}')
        return [_procesar_entrada(url)]

    ydl_opts = {'quiet': True, 'no_warnings': True, 'extract_flat': 'in_playlist'}
    log.info(f'[YT/Analizar] Extrayendo: {url}')

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)

    if info.get('_type') == 'playlist':
        entries = info.get('entries', [])
        log.info(f'[YT/Analizar] Playlist: {info.get("title")} — {len(entries)} entradas')
        result = []
        for i, entry in enumerate(entries, 1):
            if not entry:
                continue
            entry_url = entry.get('url') or entry.get('webpage_url') or entry.get('id')
            log.debug(f'[YT/Analizar] Entrada {i}/{len(entries)}: {entry_url}')
            try:
                result.append(_procesar_entrada(entry_url))
            except Exception as e:
                log.warning(f'[YT/Analizar] Error entrada {i}: {e}')
        return result

    log.info(f'[YT/Analizar] Video: {info.get("title")}')
    return [_procesar_entrada_info(info)]


# ── Rutas del Blueprint ───────────────────────────────────────────────────────
@youtube_bp.route('/')
def index():
    return render_template('youtube.html')


@youtube_bp.route('/carpeta-actual')
def carpeta_actual():
    return jsonify({'carpeta': get_download_folder()})


@youtube_bp.route('/elegir-carpeta', methods=['POST'])
def elegir_carpeta():
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.wm_attributes('-topmost', True)
        carpeta = filedialog.askdirectory(
            title='Elegir carpeta de descarga',
            initialdir=get_download_folder(),
        )
        root.destroy()
        if not carpeta:
            return jsonify({'ok': False, 'msg': 'Cancelado'})
        set_download_folder(carpeta)
        log.info(f'[YT/Config] Carpeta de descarga cambiada a: {carpeta}')
        return jsonify({'ok': True, 'carpeta': carpeta})
    except Exception as e:
        log.error(f'[YT/Config] Error abriendo diálogo: {e}')
        return jsonify({'ok': False, 'msg': str(e)}), 500


@youtube_bp.route('/analizar', methods=['POST'])
def analizar():
    url = request.json.get('url')
    if not url:
        return jsonify({"error": "No se proporcionó una URL"}), 400
    if not _url_permitida(url):
        log.warning(f'[YT/Analizar] Dominio no permitido: {url}')
        return jsonify({"error": "Solo se permiten URLs de YouTube."}), 403
    try:
        return jsonify(_extraer_info(url)[0])
    except Exception as e:
        log.error(f'[YT/Analizar] {e}')
        return jsonify({"error": str(e)}), 500


@youtube_bp.route('/analizar_multiple', methods=['POST'])
def analizar_multiple():
    urls = request.json.get('urls', [])
    if not urls:
        return jsonify({"error": "No se proporcionaron URLs"}), 400
    resultados, errores = [], []
    for url in urls:
        url = url.strip()
        if not url:
            continue
        if not _url_permitida(url):
            log.warning(f'[YT/AnalMulti] Dominio no permitido: {url}')
            errores.append({'url': url, 'error': 'Dominio no permitido. Solo se aceptan URLs de YouTube.'})
            continue
        try:
            resultados.extend(_extraer_info(url))
        except Exception as e:
            log.error(f'[YT/AnalMulti] {url}: {e}')
            errores.append({'url': url, 'error': str(e)})
    return jsonify({'items': resultados, 'errores': errores})


@youtube_bp.route('/descargar_stream')
def descargar_stream():
    if not os.path.exists(FFMPEG_PATH):
        def err():
            yield "data: ERROR: ffmpeg.exe no encontrado.\n\n"
        return Response(err(), mimetype='text/event-stream')

    url        = request.args.get('url')
    tipo       = request.args.get('tipo')
    formato_id = request.args.get('formato')
    titulo_raw = request.args.get('titulo', '')
    token      = request.args.get('token', uuid.uuid4().hex)

    if not _url_permitida(url):
        log.warning(f'[YT/Stream] Dominio no permitido: {url}')
        def err_dominio():
            yield "data: ERROR: Solo se permiten URLs de YouTube.\n\n"
        return Response(err_dominio(), mimetype='text/event-stream')

    # Limpiar URL antes de pasarla al generador compartido
    url = _limpiar_url_video(url)

    resp = Response(
        stream_with_context(
            generar_stream(url, tipo, formato_id, titulo_raw, token)
        ),
        mimetype='text/event-stream',
    )
    resp.headers['Cache-Control']     = 'no-cache'
    resp.headers['X-Accel-Buffering'] = 'no'
    resp.headers['Connection']        = 'keep-alive'
    return resp


@youtube_bp.route('/cancelar/<token>', methods=['POST'])
def cancelar(token):
    ok, msg = cancelar_proceso(token)
    if not ok:
        return jsonify({'ok': False, 'msg': msg}), 404
    return jsonify({'ok': True})
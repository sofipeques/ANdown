# platforms/tiktok/routes.py
# Blueprint de TikTok.
# Diferencias clave vs YouTube:
#   - Sin selector de calidad (siempre best)
#   - Sin marca de agua: --extractor-args "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com"
#   - Soporta colecciones y perfiles (playlist múltiple)
#   - Audio MP3 igual que YouTube

import os
import json
import uuid
from urllib.parse import urlparse

import yt_dlp
from flask import Blueprint, render_template, request, jsonify, Response, stream_with_context

from utils import log, get_download_folder, set_download_folder, FFMPEG_PATH
from core.downloader import generar_stream, cancelar_proceso

tiktok_bp = Blueprint(
    'tiktok',
    __name__,
    template_folder='templates',
)


# ── Whitelist ─────────────────────────────────────────────────────────────────
_WHITELIST_PATH = os.path.join(os.path.dirname(__file__), 'allowed_sites.json')

def _cargar_whitelist():
    try:
        with open(_WHITELIST_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return set(data.get('allowed_domains', []))
    except Exception as e:
        log.error(f'[TT/Whitelist] No se pudo cargar allowed_sites.json: {e}')
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


# ── Extracción de info ────────────────────────────────────────────────────────
_YDL_OPTS_BASE = {
    'quiet':       True,
    'no_warnings': True,
    'extractor_args': {
        'tiktok': {
            'api_hostname': ['api22-normal-c-useast2a.tiktokv.com'],
        }
    },
}

def _procesar_entrada_info(info):
    """
    Separa peso_video y peso_audio correctamente para TikTok.

    TikTok suele devolver formatos combinados (vcodec + acodec en el mismo
    stream). El campo `abr` en esos formatos es el bitrate TOTAL del stream,
    no el bitrate de audio puro, por lo que NO sirve para estimar el MP3.

    Estrategia para peso_audio, en orden de preferencia:
      1. abr × duración de un stream SOLO-AUDIO (vcodec == 'none')
      2. filesize directo de un stream solo-audio
      3. Fallback: 30% del peso_video (representativo para TikTok)
    """
    peso_video       = None
    duracion         = info.get('duration', 0) or 0
    mejor_audio_abr  = 0   # kbps — solo de streams vcodec=='none'
    mejor_audio_size = 0   # bytes — solo de streams vcodec=='none'

    for f in info.get('formats', []):
        vcodec = f.get('vcodec', 'none')
        acodec = f.get('acodec', 'none')
        s      = f.get('filesize') or f.get('filesize_approx') or 0
        abr    = f.get('abr') or 0

        # Peso del video: mejor formato que tenga imagen
        if vcodec != 'none' and s:
            if peso_video is None or s > peso_video:
                peso_video = s

        # Datos de audio: SOLO de streams sin video
        # Los streams combinados tienen abr = bitrate total, no sirven para MP3
        if vcodec == 'none' and acodec != 'none':
            if abr > mejor_audio_abr:
                mejor_audio_abr = abr
            if s and s > mejor_audio_size:
                mejor_audio_size = s

    # Calcular peso_audio
    if mejor_audio_abr > 0 and duracion > 0:
        # Desde bitrate puro de audio × duración
        peso_audio = int((mejor_audio_abr * 1000 / 8) * duracion)
        log.debug(f'[TT/Info] peso_audio vía abr={mejor_audio_abr}kbps × {duracion}s = {peso_audio}B')
    elif mejor_audio_size > 0:
        # Filesize directo del stream solo-audio
        peso_audio = mejor_audio_size
        log.debug(f'[TT/Info] peso_audio vía filesize = {peso_audio}B')
    elif peso_video:
        # Fallback: 30% del video (más realista que 10% para TikTok)
        peso_audio = int(peso_video * 0.30)
        log.debug(f'[TT/Info] peso_audio vía fallback 30% = {peso_audio}B')
    else:
        peso_audio = None

    formato_best = {
        'id':      'best',
        'label':   'Mejor calidad',
        'res_num': 0,
        'size':    peso_video,
    }

    return {
        'url':        info.get('webpage_url') or info.get('url', ''),
        'titulo':     info.get('title', 'Sin título'),
        'thumbnail':  info.get('thumbnail', ''),
        'duracion':   info.get('duration'),
        'peso':       peso_video,
        'peso_video': peso_video,
        'peso_audio': peso_audio,
        'formatos':   [formato_best],
        'es_multi':   False,
    }

def _procesar_entrada(url):
    opts = dict(_YDL_OPTS_BASE)
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    return _procesar_entrada_info(info)

def _extraer_info(url):
    """
    Soporta:
      - Video individual
      - Colección / playlist (perfil, favoritos, etc.)
    """
    opts = {**_YDL_OPTS_BASE, 'extract_flat': 'in_playlist'}
    log.info(f'[TT/Analizar] Extrayendo: {url}')

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)

    if info.get('_type') == 'playlist':
        entries = info.get('entries', [])
        log.info(f'[TT/Analizar] Colección: {info.get("title")} — {len(entries)} videos')
        result = []
        for i, entry in enumerate(entries, 1):
            if not entry:
                continue
            entry_url = entry.get('url') or entry.get('webpage_url') or entry.get('id')
            log.debug(f'[TT/Analizar] Entrada {i}/{len(entries)}: {entry_url}')
            try:
                item = _procesar_entrada(entry_url)
                item['es_multi'] = True
                result.append(item)
            except Exception as e:
                log.warning(f'[TT/Analizar] Error entrada {i}: {e}')
        return result

    log.info(f'[TT/Analizar] Video: {info.get("title")}')
    return [_procesar_entrada_info(info)]


# ── Comando de descarga sin marca de agua ────────────────────────────────────
def _comando_tiktok(tipo, output_tpl):
    from utils import RUNTIME_DIR
    cmd = [
        'yt-dlp', '--newline', '--no-part', '--no-colors',
        '--ffmpeg-location', RUNTIME_DIR,
        '--extractor-args', 'tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com',
        '--progress-template',
        'DOWNLOAD_DATA:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
    ]
    if tipo == 'audio':
        cmd.extend(['-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', output_tpl])
    else:
        cmd.extend(['-f', 'best', '-o', output_tpl])
    return cmd


# ── Generador SSE propio ─────────────────────────────────────────────────────
import time
import threading
import subprocess
import logging
from queue import Queue, Empty
from werkzeug.utils import secure_filename
from core.downloader import registrar_proceso, quitar_proceso, lector_stdout

def _generar_stream_tiktok(url, tipo, titulo_raw, token):
    def evento(data):
        return f"data: {data}\n\n"

    yield evento("PASO:1|MSG:Preparando|PER:0|VEL:---|ETA:---")

    raw_name = secure_filename(titulo_raw) if titulo_raw else ''
    if not raw_name:
        try:
            opts = dict(_YDL_OPTS_BASE)
            with yt_dlp.YoutubeDL(opts) as ydl:
                info     = ydl.extract_info(url, download=False)
                raw_name = secure_filename(info['title'])
        except Exception as e:
            log.error(f'[TT/Stream] Error título: {e}')
            yield evento(f"ERROR: {e}")
            return

    if not raw_name:
        raw_name = f"tiktok_{int(time.time())}"

    ext_final     = 'mp3' if tipo == 'audio' else 'mp4'
    uid           = uuid.uuid4().hex[:6]
    final_name    = f"{uid}_{raw_name}.{ext_final}"
    output_prefix = f"{uid}_{raw_name}"
    output_tpl    = os.path.join(get_download_folder(), f"{output_prefix}.%(ext)s")
    expected_path = os.path.join(get_download_folder(), final_name)

    log.info(f'[TT/Stream] Iniciando: {raw_name} | tipo={tipo} | token={token}')

    comando = _comando_tiktok(tipo, output_tpl)
    comando.append(url)

    proceso = subprocess.Popen(  # nosec B603
        comando,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        bufsize=1,
        universal_newlines=True,
    )

    registrar_proceso(token, proceso, output_prefix)

    cola        = Queue()
    hilo_lector = threading.Thread(target=lector_stdout, args=(proceso, cola), daemon=True)
    hilo_lector.start()

    ultimo_paso    = 1
    cliente_activo = True

    try:
        while True:
            try:
                linea = cola.get(timeout=0.5)
            except Empty:
                if proceso.poll() is not None:
                    break
                yield ": heartbeat\n\n"
                continue

            if linea is None:
                break

            linea = linea.strip()
            if not linea:
                continue

            log.debug(f'[yt-dlp/tt] {linea}')

            if 'DOWNLOAD_DATA:' in linea:
                try:
                    partes     = linea.split('DOWNLOAD_DATA:')[1].strip().split('|')
                    porcentaje = partes[0].replace('%', '').strip()
                    velocidad  = partes[1].strip()
                    eta        = partes[2].strip()
                    ultimo_paso = 2
                    yield evento(f"PASO:2|MSG:Descargando|FRAG:0|PER:{porcentaje}|VEL:{velocidad}|ETA:{eta}")
                except Exception:
                    logging.debug("No se pudo parsear progreso TikTok")

            elif any(kw in linea for kw in
                     ['[ExtractAudio]', '[Merger]', '[ffmpeg]', 'Converting',
                      '[Fixup', 'Deleting original', 'Post-process']):
                if ultimo_paso != 3:
                    ultimo_paso = 3
                    yield evento("PASO:3|MSG:Procesando archivo|PER:95|VEL:---|ETA:---")

    except GeneratorExit:
        cliente_activo = False
        log.info(f'[TT/Stream] Cliente desconectado: {token}')
    except Exception as e:
        log.error(f'[TT/Stream] Error en generador: {e}')
        cliente_activo = False
    finally:
        try:
            if proceso.poll() is None:
                proceso.kill()
        except Exception as kill_err:
            logging.warning("Error al matar proceso TikTok: %s", kill_err)
        quitar_proceso(token)

    if not cliente_activo:
        return

    proceso.wait()
    log.info(f'[TT/Stream] Código de salida: {proceso.returncode}')

    if proceso.returncode != 0:
        log.error(f'[TT/Stream] Falló: {raw_name}')
        yield evento("ERROR: Falló la descarga del video de TikTok.")
        return

    archivo_final = None
    if os.path.isfile(expected_path) and os.path.getsize(expected_path) > 0:
        archivo_final = expected_path
    else:
        for f in os.listdir(get_download_folder()):
            if f.startswith(output_prefix) and not f.endswith('.part'):
                candidato = os.path.join(get_download_folder(), f)
                if os.path.getsize(candidato) > 0:
                    archivo_final = candidato
                    final_name    = f
                    log.info(f'[TT/Stream] Archivo alternativo: {f}')
                    break

    if not archivo_final:
        log.error(f'[TT/Stream] No se encontró: {output_prefix}.*')
        yield evento("ERROR: El archivo no se generó correctamente.")
        return

    size_final = os.path.getsize(archivo_final)
    log.info(f'[TT/Stream] Listo: {final_name} ({size_final} bytes)')
    yield evento(f"PASO:4|MSG:Descargado|PER:100|VEL:---|ETA:{final_name}|SIZE:{size_final}")


# ── Rutas del Blueprint ───────────────────────────────────────────────────────
@tiktok_bp.route('/')
def index():
    return render_template('tiktok.html')


@tiktok_bp.route('/carpeta-actual')
def carpeta_actual():
    return jsonify({'carpeta': get_download_folder()})


@tiktok_bp.route('/elegir-carpeta', methods=['POST'])
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
        log.info(f'[TT/Config] Carpeta cambiada a: {carpeta}')
        return jsonify({'ok': True, 'carpeta': carpeta})
    except Exception as e:
        log.error(f'[TT/Config] Error: {e}')
        return jsonify({'ok': False, 'msg': str(e)}), 500


@tiktok_bp.route('/analizar', methods=['POST'])
def analizar():
    url = request.json.get('url')
    if not url:
        return jsonify({"error": "No se proporcionó una URL"}), 400
    if not _url_permitida(url):
        log.warning(f'[TT/Analizar] Dominio no permitido: {url}')
        return jsonify({"error": "Solo se permiten URLs de TikTok."}), 403
    try:
        resultados = _extraer_info(url)
        if len(resultados) == 1 and not resultados[0].get('es_multi'):
            return jsonify(resultados[0])
        return jsonify({'items': resultados, 'es_coleccion': True})
    except Exception as e:
        log.error(f'[TT/Analizar] {e}')
        return jsonify({"error": str(e)}), 500


@tiktok_bp.route('/analizar_multiple', methods=['POST'])
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
            errores.append({'url': url, 'error': 'Solo se aceptan URLs de TikTok.'})
            continue
        try:
            resultados.extend(_extraer_info(url))
        except Exception as e:
            log.error(f'[TT/AnalMulti] {url}: {e}')
            errores.append({'url': url, 'error': str(e)})
    return jsonify({'items': resultados, 'errores': errores})


@tiktok_bp.route('/descargar_stream')
def descargar_stream():
    if not os.path.exists(FFMPEG_PATH):
        def err():
            yield "data: ERROR: ffmpeg.exe no encontrado.\n\n"
        return Response(err(), mimetype='text/event-stream')

    url        = request.args.get('url')
    tipo       = request.args.get('tipo', 'video')
    titulo_raw = request.args.get('titulo', '')
    token      = request.args.get('token', uuid.uuid4().hex)

    if not _url_permitida(url):
        log.warning(f'[TT/Stream] Dominio no permitido: {url}')
        def err_dominio():
            yield "data: ERROR: Solo se permiten URLs de TikTok.\n\n"
        return Response(err_dominio(), mimetype='text/event-stream')

    resp = Response(
        stream_with_context(_generar_stream_tiktok(url, tipo, titulo_raw, token)),
        mimetype='text/event-stream',
    )
    resp.headers['Cache-Control']     = 'no-cache'
    resp.headers['X-Accel-Buffering'] = 'no'
    resp.headers['Connection']        = 'keep-alive'
    return resp


@tiktok_bp.route('/cancelar/<token>', methods=['POST'])
def cancelar(token):
    ok, msg = cancelar_proceso(token)
    if not ok:
        return jsonify({'ok': False, 'msg': msg}), 404
    return jsonify({'ok': True})
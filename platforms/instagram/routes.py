# platforms/instagram/routes.py
# Blueprint de Instagram — Fase 2: Reels + Fotos (con carrusel) + Stories
#
# Detección automática por URL:
#   /stories/  → Stories (requiere cookies obligatoriamente)
#   /p/ o /reel/ → Post individual: puede ser video (Reel) o foto/carrusel
#   instagram.com/usuario/ → Perfil completo (multi, via playlist)
#
# Fotos: se descargan directamente como JPG, sin FFmpeg.
# Carruseles: yt-dlp los devuelve como playlist, se bajan todas las imágenes.
# Stories: yt-dlp con cookies, URL tipo /stories/usuario/highlight_id/ o /stories/usuario/

import os
import json
import uuid
import time
import threading
import subprocess
import logging
from queue import Queue, Empty
from urllib.parse import urlparse

import yt_dlp
from flask import Blueprint, render_template, request, jsonify, Response, stream_with_context
from werkzeug.utils import secure_filename

from utils import log, get_download_folder, set_download_folder, FFMPEG_PATH, RUNTIME_DIR
from core.downloader import registrar_proceso, quitar_proceso, lector_stdout, cancelar_proceso

instagram_bp = Blueprint(
    'instagram',
    __name__,
    template_folder='templates',
)

# ── Cookies ───────────────────────────────────────────────────────────────────
COOKIES_PATH = os.path.join(RUNTIME_DIR, 'cookies_instagram.txt')

def _cookies_disponibles():
    return os.path.isfile(COOKIES_PATH) and os.path.getsize(COOKIES_PATH) > 0

def _ydl_opts_base():
    opts = {'quiet': True, 'no_warnings': True}
    if _cookies_disponibles():
        opts['cookiefile'] = COOKIES_PATH
    return opts


# ── Whitelist ─────────────────────────────────────────────────────────────────
_WHITELIST_PATH = os.path.join(os.path.dirname(__file__), 'allowed_sites.json')

def _cargar_whitelist():
    try:
        with open(_WHITELIST_PATH, 'r', encoding='utf-8') as f:
            return set(json.load(f).get('allowed_domains', []))
    except Exception as e:
        log.error(f'[IG/Whitelist] {e}')
        return set()

_DOMINIOS_PERMITIDOS = _cargar_whitelist()
MAX_URL_LEN = 2000

def _url_permitida(url: str) -> bool:
    if not url or len(url) > MAX_URL_LEN:
        return False
    try:
        return urlparse(url).netloc.lower().split(':')[0] in _DOMINIOS_PERMITIDOS
    except Exception:
        return False


# ── Clasificar tipo de URL ────────────────────────────────────────────────────
def _tipo_url(url: str) -> str:
    """Devuelve 'story', 'post', o 'perfil'."""
    path = urlparse(url).path.lower()
    if '/stories/' in path:
        return 'story'
    return 'post'   # /reel/, /p/, /tv/ → tratamos todo como post primero


# ── Detección de contenido foto vs video ─────────────────────────────────────
def _es_foto(info: dict) -> bool:
    """True si el post es imagen (no tiene duración o el ext es imagen)."""
    ext  = (info.get('ext') or '').lower()
    dur  = info.get('duration')
    if ext in ('jpg', 'jpeg', 'png', 'webp'):
        return True
    if not dur and not info.get('formats'):
        return True
    return False

def _es_carrusel(info: dict) -> bool:
    return info.get('_type') == 'playlist' and not info.get('duration')


# ── Procesar info ─────────────────────────────────────────────────────────────
def _procesar_video_info(info: dict) -> dict:
    """Para Reels/Stories con video."""
    peso_video       = None
    duracion         = info.get('duration', 0) or 0
    mejor_audio_abr  = 0
    mejor_audio_size = 0

    for f in info.get('formats', []):
        vcodec = f.get('vcodec', 'none')
        acodec = f.get('acodec', 'none')
        s      = f.get('filesize') or f.get('filesize_approx') or 0
        abr    = f.get('abr') or 0
        if vcodec != 'none' and s:
            if peso_video is None or s > peso_video:
                peso_video = s
        if vcodec == 'none' and acodec != 'none':
            if abr > mejor_audio_abr:
                mejor_audio_abr = abr
            if s and s > mejor_audio_size:
                mejor_audio_size = s

    if mejor_audio_abr > 0 and duracion > 0:
        peso_audio = int((mejor_audio_abr * 1000 / 8) * duracion)
    elif mejor_audio_size > 0:
        peso_audio = mejor_audio_size
    elif peso_video:
        peso_audio = int(peso_video * 0.30)
    else:
        peso_audio = None

    return {
        'tipo_contenido': 'video',
        'url':        info.get('webpage_url') or info.get('url', ''),
        'titulo':     info.get('title', 'Sin título'),
        'thumbnail':  info.get('thumbnail', ''),
        'duracion':   info.get('duration'),
        'peso':       peso_video,
        'peso_video': peso_video,
        'peso_audio': peso_audio,
        'formatos':   [{'id': 'best', 'label': 'Mejor calidad', 'res_num': 0, 'size': peso_video}],
        'es_multi':   False,
    }

def _procesar_foto_info(info: dict) -> dict:
    """Para posts de imagen individual."""
    url_img = info.get('url') or info.get('webpage_url', '')
    size    = info.get('filesize') or info.get('filesize_approx') or None
    ext     = (info.get('ext') or 'jpg').lower()
    return {
        'tipo_contenido': 'foto',
        'url':       info.get('webpage_url') or url_img,
        'url_directa': url_img,
        'titulo':    info.get('title', 'Sin título'),
        'thumbnail': info.get('thumbnail') or url_img,
        'duracion':  None,
        'peso':      size,
        'peso_foto': size,
        'ext':       ext,
        'formatos':  [],
        'es_multi':  False,
    }

def _procesar_carrusel_info(info: dict) -> dict:
    """Para posts con múltiples imágenes."""
    fotos = []
    for entry in info.get('entries', []):
        if not entry:
            continue
        fotos.append({
            'url_directa': entry.get('url', ''),
            'thumbnail':   entry.get('thumbnail') or entry.get('url', ''),
            'ext':         (entry.get('ext') or 'jpg').lower(),
            'peso':        entry.get('filesize') or entry.get('filesize_approx') or None,
        })
    total_peso = sum(f['peso'] or 0 for f in fotos)
    return {
        'tipo_contenido': 'carrusel',
        'url':       info.get('webpage_url', ''),
        'titulo':    info.get('title', 'Carrusel'),
        'thumbnail': fotos[0]['thumbnail'] if fotos else '',
        'fotos':     fotos,
        'cantidad':  len(fotos),
        'peso':      total_peso or None,
        'formatos':  [],
        'es_multi':  False,
    }


# ── Extraer info unificado ────────────────────────────────────────────────────
def _extraer_info(url: str) -> list:
    tipo = _tipo_url(url)

    if tipo == 'story' and not _cookies_disponibles():
        raise ValueError("Las Stories requieren cookies. Agregá cookies_instagram.txt.")

    opts = {**_ydl_opts_base(), 'extract_flat': 'discard_in_playlist'}
    log.info(f'[IG/Analizar] tipo={tipo} url={url}')

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)

    # Carrusel (playlist de imágenes del mismo post)
    if _es_carrusel(info):
        log.info(f'[IG/Analizar] Carrusel: {info.get("title")} — {len(info.get("entries",[]))} fotos')
        return [_procesar_carrusel_info(info)]

    # Playlist de perfil o highlights
    if info.get('_type') == 'playlist':
        entries = info.get('entries', [])
        log.info(f'[IG/Analizar] Playlist: {info.get("title")} — {len(entries)} items')
        result = []
        for i, entry in enumerate(entries, 1):
            if not entry:
                continue
            entry_url = entry.get('url') or entry.get('webpage_url') or entry.get('id')
            try:
                sub = _extraer_info_single(entry_url)
                sub['es_multi'] = True
                result.append(sub)
            except Exception as e:
                log.warning(f'[IG/Analizar] Error entrada {i}: {e}')
        return result

    return [_extraer_info_single_from_info(info)]


def _extraer_info_single(url: str) -> dict:
    with yt_dlp.YoutubeDL(_ydl_opts_base()) as ydl:
        info = ydl.extract_info(url, download=False)
    return _extraer_info_single_from_info(info)


def _extraer_info_single_from_info(info: dict) -> dict:
    if _es_foto(info):
        return _procesar_foto_info(info)
    return _procesar_video_info(info)


# ── Descarga de foto (sin FFmpeg) ─────────────────────────────────────────────
def _generar_stream_foto(url_post, url_directa, titulo_raw, token):
    """Descarga una imagen directamente con yt-dlp."""
    def evento(data):
        return f"data: {data}\n\n"

    yield evento("PASO:1|MSG:Preparando|PER:0|VEL:---|ETA:---")

    raw_name = secure_filename(titulo_raw) if titulo_raw else f"foto_{int(time.time())}"
    uid           = uuid.uuid4().hex[:6]
    output_prefix = f"{uid}_{raw_name}"
    output_tpl    = os.path.join(get_download_folder(), f"{output_prefix}.%(ext)s")

    log.info(f'[IG/Foto] Descargando: {raw_name} | token={token}')

    cmd = ['yt-dlp', '--newline', '--no-part', '--no-colors',
           '--progress-template',
           'DOWNLOAD_DATA:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
           '-o', output_tpl]
    if _cookies_disponibles():
        cmd.extend(['--cookies', COOKIES_PATH])
    cmd.append(url_post)

    proceso = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                bufsize=1, universal_newlines=True)
    registrar_proceso(token, proceso, output_prefix)

    cola = Queue()
    threading.Thread(target=lector_stdout, args=(proceso, cola), daemon=True).start()
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
            log.debug(f'[yt-dlp/ig/foto] {linea}')
            if 'DOWNLOAD_DATA:' in linea:
                try:
                    partes = linea.split('DOWNLOAD_DATA:')[1].strip().split('|')
                    yield evento(f"PASO:2|MSG:Descargando foto|FRAG:0|PER:{partes[0].replace('%','').strip()}|VEL:{partes[1].strip()}|ETA:{partes[2].strip()}")
                except Exception:
                    pass
    except GeneratorExit:
        cliente_activo = False
    finally:
        try:
            if proceso.poll() is None:
                proceso.kill()
        except Exception:
            pass
        quitar_proceso(token)

    if not cliente_activo:
        return

    proceso.wait()
    if proceso.returncode != 0:
        yield evento("ERROR: Falló la descarga de la foto.")
        return

    archivo_final = None
    for f in os.listdir(get_download_folder()):
        if f.startswith(output_prefix) and not f.endswith('.part'):
            candidato = os.path.join(get_download_folder(), f)
            if os.path.getsize(candidato) > 0:
                archivo_final = candidato
                final_name    = f
                break

    if not archivo_final:
        yield evento("ERROR: El archivo no se generó correctamente.")
        return

    size_final = os.path.getsize(archivo_final)
    log.info(f'[IG/Foto] Listo: {final_name} ({size_final} bytes)')
    yield evento(f"PASO:4|MSG:Descargado|PER:100|VEL:---|ETA:{final_name}|SIZE:{size_final}")


# ── Descarga de carrusel ──────────────────────────────────────────────────────
def _generar_stream_carrusel(url_post, titulo_raw, token):
    """Descarga todas las imágenes de un carrusel."""
    def evento(data):
        return f"data: {data}\n\n"

    yield evento("PASO:1|MSG:Preparando carrusel|PER:0|VEL:---|ETA:---")

    raw_name      = secure_filename(titulo_raw) if titulo_raw else f"carrusel_{int(time.time())}"
    uid           = uuid.uuid4().hex[:6]
    output_prefix = f"{uid}_{raw_name}"
    # Para carruseles yt-dlp añade índice automáticamente
    output_tpl    = os.path.join(get_download_folder(), f"{output_prefix}_%(autonumber)s.%(ext)s")

    log.info(f'[IG/Carrusel] Descargando: {raw_name} | token={token}')

    cmd = ['yt-dlp', '--newline', '--no-part', '--no-colors',
           '--progress-template',
           'DOWNLOAD_DATA:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
           '-o', output_tpl]
    if _cookies_disponibles():
        cmd.extend(['--cookies', COOKIES_PATH])
    cmd.append(url_post)

    proceso = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                bufsize=1, universal_newlines=True)
    registrar_proceso(token, proceso, output_prefix)

    cola        = Queue()
    threading.Thread(target=lector_stdout, args=(proceso, cola), daemon=True).start()
    cliente_activo = True
    foto_actual    = 0

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
            if '[download] Destination:' in linea:
                foto_actual += 1
                yield evento(f"PASO:2|MSG:Descargando foto {foto_actual}|FRAG:{foto_actual}|PER:0|VEL:---|ETA:---")
            elif 'DOWNLOAD_DATA:' in linea:
                try:
                    partes = linea.split('DOWNLOAD_DATA:')[1].strip().split('|')
                    yield evento(f"PASO:2|MSG:Descargando foto {foto_actual}|FRAG:{foto_actual}|PER:{partes[0].replace('%','').strip()}|VEL:{partes[1].strip()}|ETA:{partes[2].strip()}")
                except Exception:
                    pass
    except GeneratorExit:
        cliente_activo = False
    finally:
        try:
            if proceso.poll() is None:
                proceso.kill()
        except Exception:
            pass
        quitar_proceso(token)

    if not cliente_activo:
        return

    proceso.wait()
    if proceso.returncode != 0:
        yield evento("ERROR: Falló la descarga del carrusel.")
        return

    # Contar archivos descargados
    archivos = [f for f in os.listdir(get_download_folder())
                if f.startswith(output_prefix) and not f.endswith('.part')]
    if not archivos:
        yield evento("ERROR: No se generaron archivos.")
        return

    total_size = sum(os.path.getsize(os.path.join(get_download_folder(), f)) for f in archivos)
    resumen    = f"{len(archivos)} fotos descargadas"
    log.info(f'[IG/Carrusel] Listo: {resumen} ({total_size} bytes)')
    # Usamos el nombre del primero como referencia para SIZE
    yield evento(f"PASO:4|MSG:{resumen}|PER:100|VEL:---|ETA:{archivos[0]}|SIZE:{total_size}")


# ── Descarga de video/story ───────────────────────────────────────────────────
def _generar_stream_video(url, tipo, titulo_raw, token):
    """Para Reels, Stories con video, y audio MP3."""
    def evento(data):
        return f"data: {data}\n\n"

    yield evento("PASO:1|MSG:Preparando|PER:0|VEL:---|ETA:---")

    raw_name = secure_filename(titulo_raw) if titulo_raw else ''
    if not raw_name:
        try:
            with yt_dlp.YoutubeDL(_ydl_opts_base()) as ydl:
                info     = ydl.extract_info(url, download=False)
                raw_name = secure_filename(info.get('title', '') or '')
        except Exception as e:
            log.error(f'[IG/Stream] Error título: {e}')
            yield evento(f"ERROR: {e}")
            return

    if not raw_name:
        raw_name = f"instagram_{int(time.time())}"

    ext_final     = 'mp3' if tipo == 'audio' else 'mp4'
    uid           = uuid.uuid4().hex[:6]
    final_name    = f"{uid}_{raw_name}.{ext_final}"
    output_prefix = f"{uid}_{raw_name}"
    output_tpl    = os.path.join(get_download_folder(), f"{output_prefix}.%(ext)s")
    expected_path = os.path.join(get_download_folder(), final_name)

    log.info(f'[IG/Stream] Iniciando: {raw_name} | tipo={tipo} | token={token}')

    cmd = ['yt-dlp', '--newline', '--no-part', '--no-colors',
           '--ffmpeg-location', RUNTIME_DIR,
           '--progress-template',
           'DOWNLOAD_DATA:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s']
    if _cookies_disponibles():
        cmd.extend(['--cookies', COOKIES_PATH])
    if tipo == 'audio':
        cmd.extend(['-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', output_tpl])
    else:
        cmd.extend(['-f', 'best', '-o', output_tpl])
    cmd.append(url)

    proceso = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                bufsize=1, universal_newlines=True)
    registrar_proceso(token, proceso, output_prefix)

    cola        = Queue()
    threading.Thread(target=lector_stdout, args=(proceso, cola), daemon=True).start()
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
            log.debug(f'[yt-dlp/ig] {linea}')
            if 'DOWNLOAD_DATA:' in linea:
                try:
                    partes = linea.split('DOWNLOAD_DATA:')[1].strip().split('|')
                    ultimo_paso = 2
                    yield evento(f"PASO:2|MSG:Descargando|FRAG:0|PER:{partes[0].replace('%','').strip()}|VEL:{partes[1].strip()}|ETA:{partes[2].strip()}")
                except Exception:
                    pass
            elif any(kw in linea for kw in ['[ExtractAudio]', '[Merger]', '[ffmpeg]',
                                             'Converting', '[Fixup', 'Deleting original']):
                if ultimo_paso != 3:
                    ultimo_paso = 3
                    yield evento("PASO:3|MSG:Procesando archivo|PER:95|VEL:---|ETA:---")
            elif any(kw in linea.lower() for kw in ['login required', 'private',
                                                      'checkpoint required', 'not available']):
                proceso.kill()
                yield evento("ERROR: Contenido privado o login requerido. Agregá cookies_instagram.txt.")
                quitar_proceso(token)
                return
    except GeneratorExit:
        cliente_activo = False
        log.info(f'[IG/Stream] Cliente desconectado: {token}')
    except Exception as e:
        log.error(f'[IG/Stream] Error: {e}')
        cliente_activo = False
    finally:
        try:
            if proceso.poll() is None:
                proceso.kill()
        except Exception:
            pass
        quitar_proceso(token)

    if not cliente_activo:
        return

    proceso.wait()
    if proceso.returncode != 0:
        yield evento("ERROR: Falló la descarga. Si es privado, agregá cookies_instagram.txt.")
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
                    break

    if not archivo_final:
        yield evento("ERROR: El archivo no se generó correctamente.")
        return

    size_final = os.path.getsize(archivo_final)
    log.info(f'[IG/Stream] Listo: {final_name} ({size_final} bytes)')
    yield evento(f"PASO:4|MSG:Descargado|PER:100|VEL:---|ETA:{final_name}|SIZE:{size_final}")


# ── Rutas ─────────────────────────────────────────────────────────────────────
@instagram_bp.route('/')
def index():
    return render_template('instagram.html')

@instagram_bp.route('/carpeta-actual')
def carpeta_actual():
    return jsonify({'carpeta': get_download_folder()})

@instagram_bp.route('/elegir-carpeta', methods=['POST'])
def elegir_carpeta():
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk(); root.withdraw(); root.wm_attributes('-topmost', True)
        carpeta = filedialog.askdirectory(title='Elegir carpeta', initialdir=get_download_folder())
        root.destroy()
        if not carpeta:
            return jsonify({'ok': False, 'msg': 'Cancelado'})
        set_download_folder(carpeta)
        return jsonify({'ok': True, 'carpeta': carpeta})
    except Exception as e:
        return jsonify({'ok': False, 'msg': str(e)}), 500

@instagram_bp.route('/cookies-estado')
def cookies_estado():
    return jsonify({'activas': _cookies_disponibles()})

@instagram_bp.route('/analizar', methods=['POST'])
def analizar():
    url = request.json.get('url', '').strip()
    if not url:
        return jsonify({"error": "No se proporcionó una URL"}), 400
    if not _url_permitida(url):
        return jsonify({"error": "Solo se permiten URLs de Instagram."}), 403
    try:
        resultados = _extraer_info(url)
        if len(resultados) == 1 and not resultados[0].get('es_multi'):
            return jsonify(resultados[0])
        return jsonify({'items': resultados, 'es_coleccion': True})
    except ValueError as e:
        # Errores "amigables" como el de cookies faltantes
        return jsonify({"error": str(e)}), 403
    except Exception as e:
        msg = str(e)
        log.error(f'[IG/Analizar] {msg}')
        if any(kw in msg.lower() for kw in ['login', 'private', 'checkpoint']):
            return jsonify({"error": "Contenido privado. Necesitás cookies_instagram.txt."}), 403
        return jsonify({"error": msg}), 500

@instagram_bp.route('/analizar_multiple', methods=['POST'])
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
            errores.append({'url': url, 'error': 'Solo se aceptan URLs de Instagram.'})
            continue
        try:
            resultados.extend(_extraer_info(url))
        except Exception as e:
            msg = str(e)
            log.error(f'[IG/AnalMulti] {url}: {msg}')
            amigable = 'Contenido privado. Necesitás cookies_instagram.txt.' \
                if any(kw in msg.lower() for kw in ['login', 'private', 'checkpoint']) \
                else msg
            errores.append({'url': url, 'error': amigable})
    return jsonify({'items': resultados, 'errores': errores})

@instagram_bp.route('/descargar_stream')
def descargar_stream():
    if not os.path.exists(FFMPEG_PATH):
        def err():
            yield "data: ERROR: ffmpeg.exe no encontrado.\n\n"
        return Response(err(), mimetype='text/event-stream')

    url             = request.args.get('url', '')
    tipo            = request.args.get('tipo', 'video')   # video | audio | foto | carrusel
    titulo_raw      = request.args.get('titulo', '')
    token           = request.args.get('token', uuid.uuid4().hex)

    if not _url_permitida(url):
        def err_dom():
            yield "data: ERROR: Solo se permiten URLs de Instagram.\n\n"
        return Response(err_dom(), mimetype='text/event-stream')

    if tipo == 'foto':
        gen = _generar_stream_foto(url, None, titulo_raw, token)
    elif tipo == 'carrusel':
        gen = _generar_stream_carrusel(url, titulo_raw, token)
    else:
        gen = _generar_stream_video(url, tipo, titulo_raw, token)

    resp = Response(stream_with_context(gen), mimetype='text/event-stream')
    resp.headers['Cache-Control']     = 'no-cache'
    resp.headers['X-Accel-Buffering'] = 'no'
    resp.headers['Connection']        = 'keep-alive'
    return resp

@instagram_bp.route('/cancelar/<token>', methods=['POST'])
def cancelar(token):
    ok, msg = cancelar_proceso(token)
    if not ok:
        return jsonify({'ok': False, 'msg': msg}), 404
    return jsonify({'ok': True})
# core/downloader.py
# Lógica compartida de descarga — usada por todos los módulos de plataforma.
# Extraído de routes.py (YouTube) en Fase 2.

import os
import time
import uuid
import threading
import subprocess  # nosec B404
import logging
from queue import Queue, Empty

import yt_dlp
from werkzeug.utils import secure_filename

from utils import RUNTIME_DIR, FFMPEG_PATH, log, get_download_folder


# ── Registro de procesos activos (token → {proceso, prefix}) ─────────────────
_procesos_activos = {}
_procesos_lock    = threading.Lock()


# ── Lector de stdout en thread separado ──────────────────────────────────────
def lector_stdout(proceso, cola):
    try:
        for linea in iter(proceso.stdout.readline, ''):
            cola.put(linea)
    except Exception:
        logging.debug("Error leyendo línea del proceso")
    finally:
        cola.put(None)  # Sentinel: stdout cerrado


# ── Registrar / cancelar proceso ─────────────────────────────────────────────
def registrar_proceso(token, proceso, prefix):
    with _procesos_lock:
        _procesos_activos[token] = {'proceso': proceso, 'prefix': prefix}


def cancelar_proceso(token):
    """Mata el proceso y borra archivos parciales. Retorna (ok, msg)."""
    with _procesos_lock:
        entrada = _procesos_activos.pop(token, None)

    if not entrada:
        return False, 'Token no encontrado'

    proceso = entrada['proceso']
    prefix  = entrada['prefix']

    try:
        if proceso.poll() is None:
            proceso.kill()
            log.info(f'[Cancelar] Proceso matado: {token}')
    except Exception as e:
        log.warning(f'[Cancelar] Error matando proceso: {e}')

    time.sleep(0.5)
    try:
        carpeta = get_download_folder()
        for f in os.listdir(carpeta):
            if f.startswith(prefix):
                ruta = os.path.join(carpeta, f)
                try:
                    os.remove(ruta)
                    log.info(f'[Cancelar] Borrado: {f}')
                except Exception as e:
                    log.warning(f'[Cancelar] No se pudo borrar {f}: {e}')
    except Exception as e:
        log.warning(f'[Cancelar] Error listando carpeta: {e}')

    return True, 'ok'


def quitar_proceso(token):
    """Elimina el token del registro sin matar el proceso (ya terminó)."""
    with _procesos_lock:
        _procesos_activos.pop(token, None)


# ── Generador SSE genérico ────────────────────────────────────────────────────
def generar_stream(url, tipo, formato_id, titulo_raw, token, limpiar_url_fn=None):
    """
    Generador SSE reutilizable por cualquier plataforma.

    Parámetros:
        url          : URL ya validada y permitida por la plataforma.
        tipo         : 'audio' | 'video'
        formato_id   : format_id de yt-dlp (solo para video)
        titulo_raw   : título pre-obtenido del análisis (puede ser vacío)
        token        : identificador único de la descarga
        limpiar_url_fn: función opcional para limpiar la URL antes de descargar
    """
    if limpiar_url_fn:
        url = limpiar_url_fn(url)

    def evento(data):
        return f"data: {data}\n\n"

    yield evento("PASO:1|MSG:Preparando|PER:0|VEL:---|ETA:---")

    raw_name = secure_filename(titulo_raw) if titulo_raw else ''
    if not raw_name:
        try:
            with yt_dlp.YoutubeDL({'quiet': True}) as ydl:
                info     = ydl.extract_info(url, download=False)
                raw_name = secure_filename(info['title'])
        except Exception as e:
            log.error(f'[Stream] Error título: {e}')
            yield evento(f"ERROR: {e}")
            return

    if not raw_name:
        raw_name = f"video_{int(time.time())}"

    ext_final     = 'mp3' if tipo == 'audio' else 'mp4'
    uid           = uuid.uuid4().hex[:6]
    final_name    = f"{uid}_{raw_name}.{ext_final}"
    output_prefix = f"{uid}_{raw_name}"
    output_tpl    = os.path.join(get_download_folder(), f"{output_prefix}.%(ext)s")
    expected_path = os.path.join(get_download_folder(), final_name)

    log.info(f'[Stream] Iniciando: {raw_name} | tipo={tipo} | token={token}')

    comando = [
        'yt-dlp', '--newline', '--no-part', '--no-colors',
        '--ffmpeg-location', RUNTIME_DIR,
        '--progress-template',
        'DOWNLOAD_DATA:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
        url,
    ]

    if tipo == 'audio':
        comando.extend(['-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', output_tpl])
    else:
        f_str = f"{formato_id}+bestaudio[ext=m4a]/bestaudio/best"
        comando.extend(['-f', f_str, '--merge-output-format', 'mp4', '-o', output_tpl])

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

    es_video         = (tipo != 'audio')
    fragmento_actual = 0
    ultimo_paso      = 1
    cliente_activo   = True

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

            log.debug(f'[yt-dlp] {linea}')

            if '[download] Destination:' in linea:
                fragmento_actual += 1
                if fragmento_actual > 1:
                    yield evento(f"PASO:2|MSG:Descargando audio|FRAG:{fragmento_actual}|PER:0|VEL:---|ETA:---")

            if 'DOWNLOAD_DATA:' in linea:
                try:
                    partes     = linea.split('DOWNLOAD_DATA:')[1].strip().split('|')
                    porcentaje = partes[0].replace('%', '').strip()
                    velocidad  = partes[1].strip()
                    eta        = partes[2].strip()

                    if es_video:
                        msg  = "Descargando video" if fragmento_actual <= 1 else "Descargando audio"
                        frag = fragmento_actual
                    else:
                        msg  = "Descargando"
                        frag = 0

                    ultimo_paso = 2
                    yield evento(f"PASO:2|MSG:{msg}|FRAG:{frag}|PER:{porcentaje}|VEL:{velocidad}|ETA:{eta}")
                except Exception:
                    logging.debug("No se pudo parsear fragmento de progreso, se omite")

            elif any(kw in linea for kw in
                     ['[ExtractAudio]', '[Merger]', '[ffmpeg]', 'Converting', '[Fixup',
                      'Deleting original', 'Post-process']):
                if ultimo_paso != 3:
                    ultimo_paso = 3
                    yield evento("PASO:3|MSG:Procesando archivo|PER:95|VEL:---|ETA:---")

    except GeneratorExit:
        cliente_activo = False
        log.info(f'[Stream] Cliente desconectado: {token}')
    except Exception as e:
        log.error(f'[Stream] Error en generador: {e}')
        cliente_activo = False
    finally:
        try:
            if proceso.poll() is None:
                proceso.kill()
                log.info(f'[Stream] Proceso matado en finally: {token}')
        except Exception as kill_err:
            logging.warning("Error al intentar matar el proceso en finally: %s", kill_err)

        quitar_proceso(token)

    if not cliente_activo:
        return

    proceso.wait()
    log.info(f'[Stream] Código de salida: {proceso.returncode}')

    if proceso.returncode != 0:
        log.error(f'[Stream] Falló: {raw_name}')
        yield evento("ERROR: Falló el procesamiento del video.")
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
                    log.info(f'[Stream] Archivo con ext alternativa: {f}')
                    break

    if not archivo_final:
        log.error(f'[Stream] No se encontró el archivo: {output_prefix}.*')
        yield evento("ERROR: El archivo no se generó correctamente.")
        return

    size_final = os.path.getsize(archivo_final)
    log.info(f'[Stream] Listo: {final_name} ({size_final} bytes)')
    yield evento(f"PASO:4|MSG:Descargado|PER:100|VEL:---|ETA:{final_name}|SIZE:{size_final}")
import os
import sys
import logging



# ── Resolución de rutas ───────────────────────────────────────────────────────
def get_base_dir():
    if getattr(sys, 'frozen', False):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))

def get_runtime_dir():
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


BASE_DIR     = get_base_dir()
RUNTIME_DIR  = get_runtime_dir()
FFMPEG_PATH  = os.path.join(RUNTIME_DIR, 'ffmpeg.exe')
LOG_PATH     = os.path.join(RUNTIME_DIR, 'app.log')
CONFIG_PATH  = os.path.join(RUNTIME_DIR, 'config.json')

# ── Carpeta de descarga configurable ─────────────────────────────────────────
def _carpeta_por_defecto():
    """Devuelve la carpeta Descargas del usuario como valor inicial."""
    return os.path.join(os.path.expanduser('~'), 'Downloads')

def cargar_download_folder():
    if os.path.isfile(CONFIG_PATH):
        try:
            import json
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            carpeta = cfg.get('download_folder', '')
            if carpeta and os.path.isdir(carpeta):
                return carpeta
        except Exception as e:
            logging.debug("No se pudo obtener la carpeta, usando la por defecto")
    return _carpeta_por_defecto()

def guardar_download_folder(carpeta):
    import json
    try:
        with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump({'download_folder': carpeta}, f, ensure_ascii=False)
    except Exception as e:
         logging.warning("No se pudo guardar la carpeta de descarga: %s", e)

# Estado mutable en runtime (puede cambiar mientras la app corre)
_state = {'download_folder': cargar_download_folder()}

def get_download_folder():
    return _state['download_folder']

def set_download_folder(carpeta):
    _state['download_folder'] = carpeta
    guardar_download_folder(carpeta)
    os.makedirs(carpeta, exist_ok=True)

DOWNLOAD_FOLDER = get_download_folder()  # valor inicial para compatibilidad
os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)


# ── Sistema de logging ────────────────────────────────────────────────────────
def setup_logger():
    logger = logging.getLogger('ytpro')
    logger.setLevel(logging.DEBUG)

    fmt = logging.Formatter(
        '[%(asctime)s] %(levelname)-7s %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )

    # Handler archivo (app.log) - Se mantiene para guardar el registro
    fh = logging.FileHandler(LOG_PATH, encoding='utf-8')
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(fmt)

    # Handler consola - COMENTADO PARA SILENCIAR LA TERMINAL (cmd)
    # ch = logging.StreamHandler()
    # ch.setLevel(logging.INFO)
    # ch.setFormatter(fmt)

    logger.addHandler(fh)
    # logger.addHandler(ch) # No se añade el handler de consola
    
    return logger

log = setup_logger()



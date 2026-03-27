/* ═══════════════════════════════════════════════════════════════
   CORE — Estado global, flip 3D, helpers compartidos
   ═══════════════════════════════════════════════════════════════ */

// ── Estado global ─────────────────────────────────────────────────────────────
const descargasActivas = {};  // "url|formato|tipo" → true
const eventSources     = {};  // cardId → EventSource

window.addEventListener('beforeunload', () => {
    Object.values(eventSources).forEach(es => { try { es.close(); } catch (_) {} });
});


// ── Flip 3D ───────────────────────────────────────────────────────────────────
let _flipBloqueado = false;

function flipToBack() {
    if (_flipBloqueado) return;
    _flipBloqueado = true;
    document.getElementById('flip-inner').classList.add('flipped');
    _actualizarAlturaWrapper(true);
    setTimeout(() => { _flipBloqueado = false; }, 700);
}

function flipToFront() {
    if (_flipBloqueado) return;
    _flipBloqueado = true;
    document.getElementById('flip-inner').classList.remove('flipped');
    _actualizarAlturaWrapper(false);
    setTimeout(() => { _flipBloqueado = false; }, 700);
}

function sincronizarAlturaFlip() {
    const flipped = document.getElementById('flip-inner').classList.contains('flipped');
    _actualizarAlturaWrapper(flipped);
}

function _actualizarAlturaWrapper(mostrandoBack) {
    const wrapper = document.getElementById('flip-wrapper');
    const front   = document.getElementById('flip-front');
    const back    = document.getElementById('flip-back');
    if (!wrapper || !front || !back) return;

    let h;
    if (mostrandoBack) {
        back.style.position = 'relative';
        h = back.scrollHeight;
        back.style.position = 'absolute';
    } else {
        h = front.scrollHeight;
    }

    wrapper.style.height                              = h + 'px';
    document.getElementById('flip-inner').style.height = h + 'px';
}

window.addEventListener('DOMContentLoaded', () => {
    requestAnimationFrame(() => _actualizarAlturaWrapper(false));
});


// ── Helpers compartidos ───────────────────────────────────────────────────────

/** Parsea un string SSE tipo "PASO:2|MSG:foo|PER:50" en objeto */
function parsearPaso(raw) {
    return raw.split('|').reduce((acc, part) => {
        const idx = part.indexOf(':');
        acc[part.slice(0, idx)] = part.slice(idx + 1);
        return acc;
    }, {});
}

/** "1:23:45" o "3:07" desde segundos */
function formatDuracion(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0
        ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
        : `${m}:${String(sec).padStart(2,'0')}`;
}

/** "1.4 MB", "720 KB", "1.1 GB" desde bytes */
function formatPeso(bytes) {
    if (!bytes) return null;
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
    if (bytes >= 1048576)    return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1024).toFixed(0) + ' KB';
}

/** Escapa HTML para insertar texto en innerHTML */
function escHtml(str) {
    return String(str)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

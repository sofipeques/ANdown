// ── Gestión de carpeta de descarga ───────────────────────────────────────────

window.addEventListener('DOMContentLoaded', async () => {
    await _actualizarMostrarCarpeta();
});

async function _actualizarMostrarCarpeta() {
    try {
        const res  = await fetch(`${window.API_PREFIX}/carpeta-actual`);
        const data = await res.json();
        _setCarpetaUI(data.carpeta);
    } catch (e) {
        console.warn('[folder] No se pudo obtener carpeta actual:', e);
    }
}

function _setCarpetaUI(carpeta) {
    const el = document.getElementById('folder-path');
    if (el) el.innerText = carpeta || '—';
    try { localStorage.setItem('download_folder', carpeta); } catch (_) {}
}

async function elegirCarpeta() {
    const btn = document.getElementById('btn-folder');
    if (btn) { btn.disabled = true; btn.innerText = '⏳'; }

    try {
        const res  = await fetch(`${window.API_PREFIX}/elegir-carpeta`, { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
            _setCarpetaUI(data.carpeta);
        }
    } catch (e) {
        console.error('[folder] Error:', e);
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = '📁'; }
    }
}
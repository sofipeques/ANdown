// ── Gestión de carpeta de descarga ───────────────────────────────────────────

// Mostrar la carpeta actual al cargar la página
window.addEventListener('DOMContentLoaded', async () => {
    await _actualizarMostrarCarpeta();
});

async function _actualizarMostrarCarpeta() {
    try {
        const res  = await fetch('/carpeta-actual');
        const data = await res.json();
        _setCarpetaUI(data.carpeta);
    } catch (e) {
        console.warn('[folder] No se pudo obtener carpeta actual:', e);
    }
}

function _setCarpetaUI(carpeta) {
    const el = document.getElementById('folder-path');
    if (el) el.innerText = carpeta || '—';
    // Guardar en localStorage como caché visual (no autoritativo)
    try { localStorage.setItem('download_folder', carpeta); } catch (_) {}
}

async function elegirCarpeta() {
    const btn = document.getElementById('btn-folder');
    if (btn) { btn.disabled = true; btn.innerText = '⏳'; }

    try {
        const res  = await fetch('/elegir-carpeta', { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
            _setCarpetaUI(data.carpeta);
        }
        // Si data.ok es false el usuario canceló el diálogo — no hacer nada
    } catch (e) {
        console.error('[folder] Error:', e);
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = '📁'; }
    }
}

/* ═══════════════════════════════════════════════════════════════
   SESSION — Contador de descarga de la sesión actual
   
   Arranca en 0 cada vez que se abre el programa.
   Suma bytes y cantidad por cada descarga completada.
   Se resetea automáticamente al cerrar/reabrir la app.
   ═══════════════════════════════════════════════════════════════ */

let _sessionBytes = 0;
let _sessionCount = 0;

// cards.js dispara este evento en window cuando llega PASO:4 con SIZE real
window.addEventListener('descarga-completada', (e) => {
    _sessionBytes += e.detail.bytes || 0;
    _sessionCount += 1;
    _renderSessionBar();
});

function _renderSessionBar() {
    const bar   = document.getElementById('session-bar');
    const size  = document.getElementById('session-size');
    const count = document.getElementById('session-count');
    if (!bar) return;
    bar.style.display = 'flex';
    size.innerText    = formatPeso(_sessionBytes) || '0 KB';
    count.innerText   = `· ${_sessionCount} archivo${_sessionCount !== 1 ? 's' : ''}`;
}

/* ═══════════════════════════════════════════════════════════════
   instagram_simple.js — v2
   Pestañas: Reels · Fotos · Stories
   Multi: acepta perfiles y URLs individuales
   ═══════════════════════════════════════════════════════════════ */

// ── Estado ────────────────────────────────────────────────────────────────────
let videoData      = null;
let collectionData = null;
let simpleMode     = localStorage.getItem('ig_mode') || 'video';  // video | audio (dentro de Reels)
let activeTab      = localStorage.getItem('ig_tab')  || 'reels';  // reels | fotos | stories

(function initSimple() {
    updateSimpleUI();
    _setTab(activeTab, false);
    _cargarEstadoCookies();
})();


// ── Cookies ───────────────────────────────────────────────────────────────────
async function _cargarEstadoCookies() {
    try {
        const res  = await fetch(`${window.API_PREFIX}/cookies-estado`);
        const data = await res.json();
        _renderCookiesBar(data.activas);
    } catch (e) {
        _renderCookiesBar(false);
    }
}

function _renderCookiesBar(activas) {
    const bar   = document.getElementById('ig-cookies-bar');
    const label = document.getElementById('ig-cookies-label');
    if (!bar || !label) return;
    if (activas) {
        bar.classList.add('activas');
        label.innerText = 'Cookies activas · Acceso a contenido privado habilitado';
    } else {
        bar.classList.remove('activas');
        label.innerText = 'Sin cookies · Solo contenido público · Agregá cookies_instagram.txt para privados';
    }
}


// ── Pestañas ──────────────────────────────────────────────────────────────────
function setTab(tab) { _setTab(tab, true); }

function _setTab(tab, guardar) {
    activeTab = tab;
    if (guardar) localStorage.setItem('ig_tab', tab);

    // Botones
    ['reels', 'fotos', 'stories'].forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        if (btn) btn.classList.toggle('active', t === tab);
    });

    // Paneles
    ['reels', 'fotos', 'stories'].forEach(t => {
        const panel = document.getElementById(`panel-${t}`);
        if (panel) panel.style.display = t === tab ? 'block' : 'none';
    });

    // Aviso Stories sin cookies
    const storyWarning = document.getElementById('stories-no-cookies');
    if (storyWarning) {
        storyWarning.style.display =
            (tab === 'stories' && !document.getElementById('ig-cookies-bar')?.classList.contains('activas'))
                ? 'block' : 'none';
    }

    // Limpiar resultado anterior al cambiar pestaña
    _limpiarResultado();
    setTimeout(() => sincronizarAlturaFlip(), 50);
}

function _limpiarResultado() {
    videoData      = null;
    collectionData = null;
    const ids = ['result', 'result-collection', 'result-foto', 'result-carrusel'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}


// ── Modo video/audio (solo en Reels) ──────────────────────────────────────────
function updateSimpleUI() {
    ['mode-video', 'mode-audio'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    });
    const btn = document.getElementById('mode-' + simpleMode);
    if (btn) btn.classList.add('active');
}

function setMode(m) {
    simpleMode = m;
    localStorage.setItem('ig_mode', m);
    updateSimpleUI();
    if (videoData) _actualizarMetaPesoSimple(videoData);
    sincronizarAlturaFlip();
}


// ── Analizar (unificado para las 3 pestañas) ──────────────────────────────────
async function analizar() {
    // Detectar qué input está activo
    const inputId = activeTab === 'reels'   ? 'url-reels'
                  : activeTab === 'fotos'   ? 'url-fotos'
                  : 'url-stories';
    const url = document.getElementById(inputId)?.value.trim();
    if (!url) return;

    // Si es stories y no hay cookies: advertir pero intentar igual
    // (el backend devuelve error amigable)

    const btn = document.getElementById(`btn-analyze-${activeTab}`);
    if (btn) { btn.innerText = 'Buscando...'; btn.disabled = true; }
    const input = document.getElementById(inputId);
    if (input) input.disabled = true;

    _limpiarResultado();

    try {
        const res  = await fetch(`${window.API_PREFIX}/analizar`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ url }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        if (data.es_coleccion && data.items) {
            collectionData = data.items;
            renderColeccion(data.items);
        } else {
            _renderResultado(data, url);
        }
    } catch (e) {
        alert('Error: ' + e.message);
    } finally {
        if (btn) { btn.innerText = 'Buscar'; btn.disabled = false; }
        if (input) input.disabled = false;
    }
}

function _renderResultado(data, url) {
    const tc = data.tipo_contenido;

    if (tc === 'foto') {
        videoData      = data;
        videoData._url = url;
        renderFoto(data);
    } else if (tc === 'carrusel') {
        videoData      = data;
        videoData._url = url;
        renderCarrusel(data);
    } else {
        // video (reel o story)
        videoData      = data;
        videoData._url = url;
        renderVideoData(data);
    }
}


// ── Render: Reel / Story (video) ──────────────────────────────────────────────
function renderVideoData(data) {
    document.getElementById('result').style.display = 'block';
    document.getElementById('thumb').src            = data.thumbnail;
    document.getElementById('thumb').alt            = data.titulo;
    document.getElementById('title').innerText      = data.titulo;

    const durEl = document.getElementById('meta-dur');
    const dur   = data.duracion ? formatDuracion(data.duracion) : null;
    durEl.innerText     = dur ? `⏱ ${dur}` : '';
    durEl.style.display = dur ? '' : 'none';

    _actualizarMetaPesoSimple(data);
    resetBtnDownload();
    updateSimpleUI();
    setTimeout(() => sincronizarAlturaFlip(), 50);
}

function _actualizarMetaPesoSimple(data) {
    const pesoEl = document.getElementById('meta-peso');
    if (!pesoEl || !data) return;
    const bytes = simpleMode === 'audio'
        ? (data.peso_audio || null)
        : (data.peso_video || data.peso || null);
    const peso           = bytes ? formatPeso(bytes) : null;
    pesoEl.innerText     = peso ? `💾 ~${peso}` : '';
    pesoEl.style.display = peso ? '' : 'none';
}

function resetBtnDownload() {
    const btn = document.getElementById('btn-download');
    if (!btn) return;
    btn.style.display    = 'block';
    btn.disabled         = false;
    btn.innerText        = 'Descargar';
    btn.style.background = 'var(--success)';
    btn.onclick          = iniciarDescarga;
    if (videoData) _actualizarMetaPesoSimple(videoData);
    setTimeout(() => sincronizarAlturaFlip(), 50);
}


// ── Render: Foto individual ───────────────────────────────────────────────────
function renderFoto(data) {
    const el = document.getElementById('result-foto');
    if (!el) return;
    el.style.display = 'block';

    document.getElementById('foto-thumb').src      = data.thumbnail;
    document.getElementById('foto-title').innerText = data.titulo || 'Foto de Instagram';

    const pesoEl = document.getElementById('foto-peso');
    if (pesoEl) {
        const p = data.peso_foto || data.peso;
        pesoEl.innerText     = p ? `💾 ~${formatPeso(p)}` : '';
        pesoEl.style.display = p ? '' : 'none';
    }

    const btn = document.getElementById('btn-download-foto');
    if (btn) {
        btn.disabled  = false;
        btn.innerText = 'Descargar foto';
        btn.onclick   = iniciarDescargaFoto;
    }
    setTimeout(() => sincronizarAlturaFlip(), 50);
}


// ── Render: Carrusel ──────────────────────────────────────────────────────────
function renderCarrusel(data) {
    const el = document.getElementById('result-carrusel');
    if (!el) return;
    el.style.display = 'block';

    document.getElementById('carrusel-count').innerText =
        `${data.cantidad} foto${data.cantidad !== 1 ? 's' : ''}`;

    const grid = document.getElementById('carrusel-grid');
    grid.innerHTML = '';
    (data.fotos || []).slice(0, 6).forEach(f => {
        const img = document.createElement('img');
        img.src       = f.thumbnail;
        img.className = 'ig-carrusel-thumb';
        img.alt       = '';
        grid.appendChild(img);
    });
    if ((data.fotos || []).length > 6) {
        const more = document.createElement('div');
        more.className = 'ig-carrusel-more';
        more.innerText = `+${data.fotos.length - 6}`;
        grid.appendChild(more);
    }

    const pesoEl = document.getElementById('carrusel-peso');
    if (pesoEl) {
        const p = data.peso;
        pesoEl.innerText     = p ? `💾 ~${formatPeso(p)} estimado` : '';
        pesoEl.style.display = p ? '' : 'none';
    }

    const btn = document.getElementById('btn-download-carrusel');
    if (btn) {
        btn.disabled  = false;
        btn.innerText = `Descargar ${data.cantidad} fotos`;
        btn.onclick   = iniciarDescargaCarrusel;
    }
    setTimeout(() => sincronizarAlturaFlip(), 50);
}


// ── Render: Colección (perfil) ────────────────────────────────────────────────
function renderColeccion(items) {
    const countEl = document.getElementById('collection-count');
    const listEl  = document.getElementById('collection-list');
    if (!countEl || !listEl) return;

    const videos = items.filter(i => i.tipo_contenido === 'video');
    const fotos  = items.filter(i => i.tipo_contenido === 'foto' || i.tipo_contenido === 'carrusel');
    countEl.innerText = `${items.length} items (${videos.length} videos, ${fotos.length} fotos)`;
    listEl.innerHTML  = '';

    items.slice(0, 5).forEach(item => {
        const row = document.createElement('div');
        row.className = 'ig-collection-item';
        const icono = item.tipo_contenido === 'foto' ? '🖼' :
                      item.tipo_contenido === 'carrusel' ? `🖼×${item.cantidad}` : '▶';
        row.innerHTML = `
            <img class="ig-collection-thumb" src="${escHtml(item.thumbnail)}" alt="">
            <span class="ig-collection-badge">${icono}</span>
            <span class="ig-collection-title">${escHtml(item.titulo)}</span>
            ${item.duracion ? `<span class="ig-collection-dur">${formatDuracion(item.duracion)}</span>` : ''}
        `;
        listEl.appendChild(row);
    });

    if (items.length > 5) {
        const more = document.createElement('div');
        more.className = 'ig-collection-more';
        more.innerText = `+ ${items.length - 5} más`;
        listEl.appendChild(more);
    }

    document.getElementById('result-collection').style.display = 'block';
    setTimeout(() => sincronizarAlturaFlip(), 50);
}


// ── Descargas ─────────────────────────────────────────────────────────────────
function claveSimple() {
    const url = videoData ? (videoData._url || videoData.url || '') : '';
    return `${url}|best|${simpleMode}`;
}

function iniciarDescarga() {
    if (!videoData) return;
    const url = videoData._url || videoData.url;
    const key = claveSimple();
    if (descargasActivas[key]) { alert('Ya hay una descarga en curso.'); return; }

    const badge     = simpleMode === 'audio' ? 'MP3' : 'MP4';
    const sizeBytes = simpleMode === 'audio'
        ? (videoData.peso_audio || 0)
        : (videoData.peso_video || videoData.peso || 0);

    const btn = document.getElementById('btn-download');
    if (btn) { btn.disabled = true; btn.innerText = 'Descargando...'; }

    lanzarDescarga({
        url, tipo: simpleMode, formato: 'best',
        titulo: videoData.titulo, thumbnail: videoData.thumbnail,
        badge, sizeBytes, key,
        onComplete: () => resetBtnDownload(),
    });
}

function iniciarDescargaFoto() {
    if (!videoData) return;
    const url = videoData._url || videoData.url;
    const key = `${url}|foto|foto`;
    if (descargasActivas[key]) { alert('Ya hay una descarga en curso.'); return; }

    const btn = document.getElementById('btn-download-foto');
    if (btn) { btn.disabled = true; btn.innerText = 'Descargando...'; }

    lanzarDescarga({
        url, tipo: 'foto', formato: 'foto',
        titulo: videoData.titulo, thumbnail: videoData.thumbnail,
        badge: 'JPG', sizeBytes: videoData.peso_foto || 0, key,
        onComplete: () => {
            if (btn) { btn.disabled = false; btn.innerText = 'Descargar foto'; }
        },
    });
}

function iniciarDescargaCarrusel() {
    if (!videoData) return;
    const url = videoData._url || videoData.url;
    const key = `${url}|carrusel|carrusel`;
    if (descargasActivas[key]) { alert('Ya hay una descarga en curso.'); return; }

    const btn = document.getElementById('btn-download-carrusel');
    if (btn) { btn.disabled = true; btn.innerText = 'Descargando...'; }

    lanzarDescarga({
        url, tipo: 'carrusel', formato: 'carrusel',
        titulo: videoData.titulo, thumbnail: videoData.thumbnail,
        badge: `×${videoData.cantidad} JPG`, sizeBytes: videoData.peso || 0, key,
        onComplete: () => {
            if (btn) { btn.disabled = false; btn.innerText = `Descargar ${videoData.cantidad} fotos`; }
        },
    });
}

function iniciarDescargaColeccion() {
    if (!collectionData || !collectionData.length) return;
    const btn = document.getElementById('btn-download-collection');
    if (btn) { btn.disabled = true; btn.innerText = 'Iniciando...'; }

    collectionData.forEach((item, i) => {
        const url = item.url;
        const tc  = item.tipo_contenido;
        const tipo = tc === 'foto' ? 'foto'
                   : tc === 'carrusel' ? 'carrusel'
                   : simpleMode;
        const key = `${url}|${tipo}|${tipo}`;
        if (descargasActivas[key]) return;

        const badge = tc === 'foto' ? 'JPG'
                    : tc === 'carrusel' ? `×${item.cantidad} JPG`
                    : simpleMode === 'audio' ? 'MP3' : 'MP4';
        const sizeBytes = tc === 'foto' ? (item.peso || 0)
                        : tc === 'carrusel' ? (item.peso || 0)
                        : simpleMode === 'audio' ? (item.peso_audio || 0) : (item.peso_video || item.peso || 0);

        setTimeout(() => {
            lanzarDescarga({
                url, tipo, formato: 'best',
                titulo: item.titulo, thumbnail: item.thumbnail,
                badge, sizeBytes, key,
            });
        }, i * 400);
    });

    if (btn) { btn.disabled = false; btn.innerText = 'Descargar colección'; }
}


// ══════════════════════════════════════════════════════════════════════════════
// OVERRIDES DE multi.js
// ══════════════════════════════════════════════════════════════════════════════

window.addEventListener('DOMContentLoaded', () => {
    const gq = document.getElementById('global-quality');
    if (gq) gq.style.display = 'none';
});

function _crearItemNormal(i, item) {
    const d   = item.data;
    const dur = d.duracion ? formatDuracion(d.duracion) : '';
    const tc  = d.tipo_contenido || 'video';
    const el  = document.createElement('div');
    el.className = 'multi-item' + (item.selected ? '' : ' deselected');
    el.id        = `mi-${i}`;

    // Badge de tipo
    const tipoBadge = tc === 'foto'     ? '🖼 Foto'
                    : tc === 'carrusel' ? `🖼 ×${d.cantidad}`
                    : '';

    // Para fotos/carruseles: no mostrar toggle video/audio
    const controlesHtml = (tc === 'foto' || tc === 'carrusel')
        ? `<div class="multi-item-size ig-quality-badge">${tipoBadge || 'Mejor calidad'}</div>`
        : `<div class="toggle-group mini">
               <button class="toggle-btn ${item.modo === 'video' ? 'active' : ''}"
                       id="mi-video-${i}" onclick="setItemModo(${i},'video')">VIDEO</button>
               <button class="toggle-btn ${item.modo === 'audio' ? 'active' : ''}"
                       id="mi-audio-${i}" onclick="setItemModo(${i},'audio')">AUDIO</button>
           </div>
           <div class="multi-item-size ig-quality-badge">Mejor calidad</div>`;

    const bytesInit = _calcBytesItem(item);
    const sizeInit  = bytesInit ? `~${formatPeso(bytesInit)}` : '—';

    el.innerHTML = `
        <input type="checkbox" class="multi-item-check" id="mi-check-${i}"
               ${item.selected ? 'checked' : ''}
               onchange="toggleItemSeleccion(${i})">
        <img class="multi-item-thumb" src="${escHtml(d.thumbnail)}" alt="">
        <div class="multi-item-info">
            <div class="multi-item-title" title="${escHtml(d.titulo)}">
                ${escHtml(d.titulo)}${dur ? ' · ' + dur : ''}
            </div>
            <div class="multi-item-controls">
                ${controlesHtml}
                <div class="multi-item-size" id="mi-size-${i}">${sizeInit}</div>
            </div>
        </div>
    `;
    return el;
}

function _calcBytesItem(item) {
    const d  = item.data;
    const tc = d.tipo_contenido || 'video';
    if (tc === 'foto' || tc === 'carrusel') return d.peso || null;
    return item.modo === 'audio' ? (d.peso_audio || null) : (d.peso_video || d.peso || null);
}

function _actualizarSizeItem(i) {
    const item   = multiItems[i];
    const sizeEl = document.getElementById(`mi-size-${i}`);
    if (!sizeEl || !item || !item.data) return;
    const bytes = _calcBytesItem(item);
    sizeEl.innerText = bytes ? `~${formatPeso(bytes)}` : '—';
}

function _actualizarPesoTotalMulti() {
    const el = document.getElementById('multi-peso-total');
    if (!el) return;
    let total = 0, alguno = false;
    multiItems.forEach(item => {
        if (!item.selected || item.error || !item.data) return;
        alguno = true;
        total += _calcBytesItem(item) || 0;
    });
    if (!alguno) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.querySelector('.multi-peso-valor').innerText =
        total > 0 ? `~${formatPeso(total)}` : 'desconocido';
}

function descargarSeleccionados() {
    const seleccionados = multiItems.filter(item => item.selected && !item.error);
    if (!seleccionados.length) { alert('No hay items seleccionados.'); return; }

    seleccionados.forEach(item => {
        const d  = item.data;
        const tc = d.tipo_contenido || 'video';
        const url = d.url;
        const tipo = tc === 'foto' ? 'foto'
                   : tc === 'carrusel' ? 'carrusel'
                   : item.modo;
        const key = `${url}|${tipo}|${tipo}`;
        if (descargasActivas[key]) return;

        const badge = tc === 'foto'     ? 'JPG'
                    : tc === 'carrusel' ? `×${d.cantidad} JPG`
                    : item.modo === 'audio' ? 'MP3' : 'MP4';
        const sizeBytes = _calcBytesItem(item) || 0;

        lanzarDescarga({
            url, tipo, formato: 'best',
            titulo: d.titulo, thumbnail: d.thumbnail,
            badge, sizeBytes, key,
        });
    });
}

function _reconstruirCalidadesGlobal() { /* Instagram no tiene calidades */ }
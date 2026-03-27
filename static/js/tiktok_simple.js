/* ═══════════════════════════════════════════════════════════════
   tiktok_simple.js — Vista simple + overrides de multi.js para TikTok
   Cargado DESPUÉS de multi.js para sobreescribir lo necesario.
   ═══════════════════════════════════════════════════════════════ */

let videoData      = null;
let collectionData = null;
let simpleMode     = localStorage.getItem('tt_mode') || 'video';

(function initSimple() { updateSimpleUI(); })();

// ── Modo ──────────────────────────────────────────────────────────────────────
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
    localStorage.setItem('tt_mode', m);
    updateSimpleUI();
    // Refrescar peso mostrado si ya hay un video analizado
    if (videoData) _actualizarMetaPesoSimple(videoData);
    sincronizarAlturaFlip();
}

// ── Analizar ──────────────────────────────────────────────────────────────────
async function analizar() {
    const url = document.getElementById('video-url').value.trim();
    if (!url) return;

    const btn      = document.getElementById('btn-analyze');
    const urlInput = document.getElementById('video-url');
    btn.innerText     = 'Buscando...';
    btn.disabled      = true;
    urlInput.disabled = true;

    document.getElementById('result').style.display            = 'none';
    document.getElementById('result-collection').style.display = 'none';
    videoData      = null;
    collectionData = null;

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
            videoData      = data;
            videoData._url = url;
            renderVideoData(data);
        }
    } catch (e) {
        alert('Error: ' + e.message);
    } finally {
        btn.innerText     = 'Buscar';
        btn.disabled      = false;
        urlInput.disabled = false;
    }
}

// ── Render video individual ───────────────────────────────────────────────────
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
    const btn         = document.getElementById('btn-download');
    btn.style.display = 'block';
    btn.disabled      = false;
    btn.innerText     = 'Descargar';
    btn.style.background = 'var(--success)';
    btn.onclick       = iniciarDescarga;
    if (videoData) _actualizarMetaPesoSimple(videoData);
    setTimeout(() => sincronizarAlturaFlip(), 50);
}

// ── Render colección ──────────────────────────────────────────────────────────
function renderColeccion(items) {
    const countEl = document.getElementById('collection-count');
    const listEl  = document.getElementById('collection-list');

    countEl.innerText = `${items.length} video${items.length !== 1 ? 's' : ''}`;
    listEl.innerHTML  = '';

    const preview = items.slice(0, 5);
    preview.forEach(item => {
        const row = document.createElement('div');
        row.className = 'tt-collection-item';
        row.innerHTML = `
            <img class="tt-collection-thumb" src="${escHtml(item.thumbnail)}" alt="">
            <span class="tt-collection-title">${escHtml(item.titulo)}</span>
            ${item.duracion ? `<span class="tt-collection-dur">${formatDuracion(item.duracion)}</span>` : ''}
        `;
        listEl.appendChild(row);
    });

    if (items.length > 5) {
        const more = document.createElement('div');
        more.className = 'tt-collection-more';
        more.innerText = `+ ${items.length - 5} más`;
        listEl.appendChild(more);
    }

    document.getElementById('result-collection').style.display = 'block';
    setTimeout(() => sincronizarAlturaFlip(), 50);
}

// ── Descarga individual ───────────────────────────────────────────────────────
function claveSimple() {
    const url = videoData ? (videoData._url || videoData.url || '') : '';
    return `${url}|best|${simpleMode}`;
}

function iniciarDescarga() {
    if (!videoData) return;

    const url = videoData._url || videoData.url;
    const key = claveSimple();

    if (descargasActivas[key]) {
        alert('Ya hay una descarga en curso para este video.');
        return;
    }

    const badge     = simpleMode === 'audio' ? 'MP3' : 'MP4';
    const sizeBytes = simpleMode === 'audio'
        ? (videoData.peso_audio || 0)
        : (videoData.peso_video || videoData.peso || 0);

    const btnDown     = document.getElementById('btn-download');
    btnDown.disabled  = true;
    btnDown.innerText = 'Descargando...';

    lanzarDescarga({
        url,
        tipo:      simpleMode,
        formato:   'best',
        titulo:    videoData.titulo,
        thumbnail: videoData.thumbnail,
        badge, sizeBytes, key,
        onComplete: () => resetBtnDownload(),
    });
}

// ── Descarga colección ────────────────────────────────────────────────────────
function iniciarDescargaColeccion() {
    if (!collectionData || !collectionData.length) return;

    const btn = document.getElementById('btn-download-collection');
    btn.disabled  = true;
    btn.innerText = 'Iniciando...';

    collectionData.forEach((item, i) => {
        const url = item.url;
        const key = `${url}|best|${simpleMode}`;
        if (descargasActivas[key]) return;

        const badge     = simpleMode === 'audio' ? 'MP3' : 'MP4';
        const sizeBytes = simpleMode === 'audio'
            ? (item.peso_audio || 0)
            : (item.peso_video || item.peso || 0);

        setTimeout(() => {
            lanzarDescarga({
                url,
                tipo:      simpleMode,
                formato:   'best',
                titulo:    item.titulo,
                thumbnail: item.thumbnail,
                badge, sizeBytes, key,
            });
        }, i * 400);
    });

    btn.disabled  = false;
    btn.innerText = 'Descargar colección';
}


// ══════════════════════════════════════════════════════════════════════════════
// OVERRIDES DE multi.js PARA TIKTOK
// ══════════════════════════════════════════════════════════════════════════════

window.addEventListener('DOMContentLoaded', () => {
    const gq = document.getElementById('global-quality');
    if (gq) gq.style.display = 'none';
});

function _crearItemNormal(i, item) {
    const d   = item.data;
    const dur = d.duracion ? formatDuracion(d.duracion) : '';

    const el     = document.createElement('div');
    el.className = 'multi-item' + (item.selected ? '' : ' deselected');
    el.id        = `mi-${i}`;

    const bytesVideo = (d.peso_video || d.peso) || null;
    const bytesAudio = d.peso_audio || null;
    const bytesInit  = item.modo === 'audio' ? bytesAudio : bytesVideo;
    const sizeInit   = bytesInit ? `~${formatPeso(bytesInit)}` : '—';

    el.innerHTML = `
        <input type="checkbox" class="multi-item-check" id="mi-check-${i}"
               ${item.selected ? 'checked' : ''}
               onchange="toggleItemSeleccion(${i})">
        <img  class="multi-item-thumb" src="${escHtml(d.thumbnail)}" alt="">
        <div  class="multi-item-info">
            <div class="multi-item-title" title="${escHtml(d.titulo)}">
                ${escHtml(d.titulo)}${dur ? ' · ' + dur : ''}
            </div>
            <div class="multi-item-controls">
                <div class="toggle-group mini">
                    <button class="toggle-btn ${item.modo === 'video' ? 'active' : ''}"
                            id="mi-video-${i}" onclick="setItemModo(${i},'video')">VIDEO</button>
                    <button class="toggle-btn ${item.modo === 'audio' ? 'active' : ''}"
                            id="mi-audio-${i}" onclick="setItemModo(${i},'audio')">AUDIO</button>
                </div>
                <div class="multi-item-size tt-quality-badge">Mejor calidad</div>
                <div class="multi-item-size" id="mi-size-${i}">${sizeInit}</div>
            </div>
        </div>
    `;

    return el;
}

function _actualizarSizeItem(i) {
    const item   = multiItems[i];
    const sizeEl = document.getElementById(`mi-size-${i}`);
    if (!sizeEl || !item || !item.data) return;

    const bytes = item.modo === 'audio'
        ? (item.data.peso_audio || null)
        : (item.data.peso_video || item.data.peso || null);

    sizeEl.innerText = bytes ? `~${formatPeso(bytes)}` : '—';
}

function _actualizarPesoTotalMulti() {
    const el = document.getElementById('multi-peso-total');
    if (!el) return;
    let total  = 0;
    let alguno = false;

    multiItems.forEach(item => {
        if (!item.selected || item.error || !item.data) return;
        alguno = true;
        const bytes = item.modo === 'audio'
            ? (item.data.peso_audio || 0)
            : (item.data.peso_video || item.data.peso || 0);
        total += bytes;
    });

    if (!alguno) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.querySelector('.multi-peso-valor').innerText =
        total > 0 ? `~${formatPeso(total)}` : 'desconocido';
}

function descargarSeleccionados() {
    const seleccionados = multiItems.filter(item => item.selected && !item.error);

    if (!seleccionados.length) {
        alert('No hay items seleccionados.');
        return;
    }

    seleccionados.forEach(item => {
        const d   = item.data;
        const url = d.url;
        const key = `${url}|best|${item.modo}`;

        if (descargasActivas[key]) return;

        const badge     = item.modo === 'audio' ? 'MP3' : 'MP4';
        const sizeBytes = item.modo === 'audio'
            ? (d.peso_audio || 0)
            : (d.peso_video || d.peso || 0);

        lanzarDescarga({
            url,
            tipo:      item.modo,
            formato:   'best',
            titulo:    d.titulo,
            thumbnail: d.thumbnail,
            badge, sizeBytes, key,
        });
    });
}

function _reconstruirCalidadesGlobal() {
    // TikTok no tiene calidades, no hay nada que reconstruir
}
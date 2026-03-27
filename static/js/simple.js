// ── Estado vista simple ───────────────────────────────────────────────────────
let videoData  = null;
let simpleMode = localStorage.getItem('mode') || 'video';

(function initSimple() { updateSimpleUI(); })();

// ── Modo ──────────────────────────────────────────────────────────────────────
function updateSimpleUI() {
    ['mode-video','mode-audio'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    });
    const btn = document.getElementById('mode-' + simpleMode);
    if (btn) btn.classList.add('active');
    const opts = document.getElementById('video-options');
    if (opts) opts.style.display = simpleMode === 'video' ? 'block' : 'none';
}

function setMode(m) {
    simpleMode = m;
    localStorage.setItem('mode', m);
    updateSimpleUI();
    if (videoData) { actualizarMetaPesoSimple(); resetBtnDownload(); }
    sincronizarAlturaFlip();
}

// ── Render resultado ──────────────────────────────────────────────────────────
function renderVideoData(data) {
    document.getElementById('result').style.display = 'block';
    document.getElementById('thumb').src            = data.thumbnail;
    document.getElementById('thumb').alt            = data.titulo;
    document.getElementById('title').innerText      = data.titulo;

    const durEl = document.getElementById('meta-dur');
    const dur   = data.duracion ? formatDuracion(data.duracion) : null;
    durEl.innerText     = dur ? `⏱ ${dur}` : '';
    durEl.style.display = dur ? '' : 'none';

    actualizarMetaPesoSimple();

    const select = document.getElementById('format-select');
    select.innerHTML = '';
    (data.formatos || []).forEach(f => {
        const o        = document.createElement('option');
        o.value        = f.id;
        o.dataset.size = f.size || '';
        o.innerText    = f.size ? `${f.label}  —  ${formatPeso(f.size)}` : f.label;
        select.appendChild(o);
    });

    updateQualitySizeSimple();
    resetBtnDownload();
    updateSimpleUI();
    // FIX: recalcular altura del flip después de mostrar el resultado
    setTimeout(() => sincronizarAlturaFlip(), 50);
}

function actualizarMetaPesoSimple() {
    if (!videoData) return;
    const pesoEl = document.getElementById('meta-peso');
    let bytes = null;
    if (simpleMode === 'audio') {
        bytes = videoData.peso_audio || null;
    } else {
        const select = document.getElementById('format-select');
        const opt    = select.options[select.selectedIndex];
        bytes = opt ? (parseInt(opt.dataset.size) || null) : null;
        if (!bytes && videoData.peso_video) bytes = videoData.peso_video;
    }
    const peso           = bytes ? formatPeso(bytes) : null;
    pesoEl.innerText     = peso ? `💾 ~${peso}` : '';
    pesoEl.style.display = peso ? '' : 'none';
}

function updateQualitySizeSimple() {
    const select  = document.getElementById('format-select');
    const sizeDiv = document.getElementById('quality-size');
    const opt     = select.options[select.selectedIndex];
    if (!opt) { sizeDiv.innerText = '—'; return; }
    const bytes       = parseInt(opt.dataset.size);
    sizeDiv.innerText = bytes ? `~${formatPeso(bytes)}` : '—';
}

function onQualityChange() {
    updateQualitySizeSimple();
    actualizarMetaPesoSimple();
    if (!descargasActivas[claveSimple()]) resetBtnDownload();
}

function resetBtnDownload() {
    const btn            = document.getElementById('btn-download');
    btn.style.display    = 'block';
    btn.disabled         = false;
    btn.innerText        = 'Descargar';
    btn.style.background = 'var(--success)';
    btn.onclick          = iniciarDescarga;
    setTimeout(() => sincronizarAlturaFlip(), 50);
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

    try {
        const res  = await fetch('/analizar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        videoData      = data;
        videoData._url = url;
        renderVideoData(data);
    } catch (e) {
        alert('Error: ' + e.message);
    } finally {
        btn.innerText     = 'Buscar';
        btn.disabled      = false;
        urlInput.disabled = false;
    }
}

// ── Descarga ──────────────────────────────────────────────────────────────────
function claveSimple() {
    const formato = document.getElementById('format-select').value;
    const url     = videoData ? (videoData._url || '') : '';
    return `${url}|${formato}|${simpleMode}`;
}

function iniciarDescarga() {
    if (!videoData) return;

    const url     = document.getElementById('video-url').value.trim();
    const select  = document.getElementById('format-select');
    const formato = select.value;
    const opt     = select.options[select.selectedIndex];
    const tipo    = simpleMode;
    const key     = claveSimple();

    if (descargasActivas[key]) {
        alert('Ya hay una descarga en curso con esta calidad para este video.');
        return;
    }

    const badge     = tipo === 'audio' ? 'MP3' : (opt ? opt.innerText.split('—')[0].trim() : '');
    const sizeBytes = tipo === 'audio'
        ? (videoData.peso_audio || 0)
        : (opt ? parseInt(opt.dataset.size) || 0 : 0);

    const btnDown     = document.getElementById('btn-download');
    btnDown.disabled  = true;
    btnDown.innerText = 'Descargando...';

    lanzarDescarga({
        url, tipo, formato,
        titulo:    videoData.titulo,
        thumbnail: videoData.thumbnail,
        badge, sizeBytes, key,
        onComplete: () => resetBtnDownload(),
    });
}
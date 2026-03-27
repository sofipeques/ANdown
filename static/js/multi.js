// ── Estado vista múltiple ─────────────────────────────────────────────────────
let multiItems    = [];
let globalMode    = 'video';

// ── Modo global ───────────────────────────────────────────────────────────────
function setGlobalMode(m) {
    globalMode = m;
    document.querySelectorAll('#global-mode-video, #global-mode-audio')
        .forEach(b => b.classList.remove('active'));
    document.getElementById('global-mode-' + m).classList.add('active');

    multiItems.forEach((item, i) => {
        item.modo = m;
        _actualizarToggleItem(i, m);
        _toggleSelectAudio(i, m);
        _actualizarSizeItem(i);
    });
    _actualizarPesoTotalMulti();
    _reconstruirCalidadesGlobal();
}

function aplicarCalidadGlobal() {
    const sel = document.getElementById('global-quality');
    const res = parseInt(sel.value);
    if (!res) return;

    multiItems.forEach((item, i) => {
        if (!item.data || item.error) return;
        const formatos = item.data.formatos || [];
        if (!formatos.length) return;

        let fmt = formatos.find(f => f.res_num === res);
        if (!fmt) {
            const menores = formatos.filter(f => f.res_num <= res);
            fmt = menores.length ? menores[0] : formatos[formatos.length - 1];
        }

        item.formatoId = fmt.id;
        const itemSel  = document.getElementById(`mi-select-${i}`);
        if (itemSel) itemSel.value = fmt.id;
        _actualizarSizeItem(i);
    });
    _actualizarPesoTotalMulti();
}


// ── Analizar múltiples URLs ───────────────────────────────────────────────────
async function analizarMulti() {
    const raw  = document.getElementById('multi-urls').value.trim();
    if (!raw) return;

    const urls = raw.split('\n').map(u => u.trim()).filter(Boolean);
    if (!urls.length) return;

    const btn = document.getElementById('btn-analyze-multi');
    btn.innerText = 'Buscando...';
    btn.disabled  = true;

    try {
        const res  = await fetch(`${window.API_PREFIX}/analizar_multiple`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ urls }),
        });
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        multiItems = (data.items || []).map(d => ({
            data:      d,
            modo:      globalMode,
            formatoId: d.formatos && d.formatos.length ? d.formatos[0].id : '',
            selected:  true,
        }));

        if (data.errores && data.errores.length) {
            data.errores.forEach(e => {
                multiItems.push({ error: true, url: e.url, msg: e.error, selected: false });
            });
        }

        _renderMultiList();
        _reconstruirCalidadesGlobal();
        _actualizarPesoTotalMulti();
        document.getElementById('multi-controls').style.display = 'block';
        sincronizarAlturaFlip();

    } catch (e) {
        alert('Error: ' + e.message);
    } finally {
        btn.innerText = 'Buscar';
        btn.disabled  = false;
    }
}


// ── Peso total de items seleccionados ────────────────────────────────────────
function _actualizarPesoTotalMulti() {
    const el = document.getElementById('multi-peso-total');
    if (!el) return;
    let total = 0;
    let alguno = false;
    multiItems.forEach(item => {
        if (!item.selected || item.error || !item.data) return;
        alguno = true;
        if (item.modo === 'audio') {
            total += item.data.peso_audio || 0;
        } else {
            const fmt = (item.data.formatos || []).find(f => f.id === item.formatoId);
            total += (fmt ? fmt.size || 0 : 0);
        }
    });
    if (!alguno) { el.style.display = 'none'; return; }
    el.style.display = '';
    const peso = total > 0 ? `~${formatPeso(total)}` : 'desconocido';
    el.querySelector('.multi-peso-valor').innerText = peso;
}

// ── Render lista de items ─────────────────────────────────────────────────────
function _renderMultiList() {
    const list = document.getElementById('multi-list');
    list.innerHTML = '';

    multiItems.forEach((item, i) => {
        if (item.error) {
            list.appendChild(_crearItemError(i, item));
        } else {
            list.appendChild(_crearItemNormal(i, item));
        }
    });
}

function _crearItemError(i, item) {
    const el       = document.createElement('div');
    el.className   = 'multi-item error-item';
    el.innerHTML   = `
        <input type="checkbox" class="multi-item-check" disabled>
        <div class="multi-item-info">
            <div class="multi-item-title" style="color:#ff7777">${escHtml(item.url)}</div>
            <div class="multi-item-error">${escHtml(item.msg)}</div>
        </div>
    `;
    return el;
}

function _crearItemNormal(i, item) {
    const d   = item.data;
    const dur = d.duracion ? formatDuracion(d.duracion) : '';

    const el     = document.createElement('div');
    el.className = 'multi-item' + (item.selected ? '' : ' deselected');
    el.id        = `mi-${i}`;

    const optsHtml = (d.formatos || []).map(f =>
        `<option value="${escHtml(f.id)}" data-size="${f.size || ''}" data-res="${f.res_num || 0}">
            ${escHtml(f.label)}${f.size ? ' — ' + formatPeso(f.size) : ''}
        </option>`
    ).join('');

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
                <select id="mi-select-${i}" onchange="setItemFormato(${i}, this.value)"
                        style="${item.modo === 'audio' ? 'display:none' : ''}">
                    ${optsHtml}
                </select>
                <div id="mi-audio-label-${i}" class="multi-item-size"
                     style="${item.modo === 'audio' ? '' : 'display:none'}; color:#555; font-style:italic; cursor:default;">
                    Calidad máxima
                </div>
                <div class="multi-item-size" id="mi-size-${i}">—</div>
            </div>
        </div>
    `;

    setTimeout(() => {
        const sel = document.getElementById(`mi-select-${i}`);
        if (sel && item.formatoId) sel.value = item.formatoId;
        _actualizarSizeItem(i);
    }, 0);

    return el;
}


// ── Acciones por item ─────────────────────────────────────────────────────────
function toggleItemSeleccion(i) {
    const chk     = document.getElementById(`mi-check-${i}`);
    multiItems[i].selected = chk.checked;
    const el = document.getElementById(`mi-${i}`);
    if (el) el.classList.toggle('deselected', !chk.checked);
    _actualizarPesoTotalMulti();
}

function setItemModo(i, modo) {
    multiItems[i].modo = modo;
    _actualizarToggleItem(i, modo);
    _toggleSelectAudio(i, modo);
    _actualizarSizeItem(i);
    _actualizarPesoTotalMulti();
}

function _toggleSelectAudio(i, modo) {
    const sel   = document.getElementById(`mi-select-${i}`);
    const label = document.getElementById(`mi-audio-label-${i}`);
    if (sel)   sel.style.display   = (modo === 'audio') ? 'none' : '';
    if (label) label.style.display = (modo === 'audio') ? ''     : 'none';
}

function setItemFormato(i, formatoId) {
    multiItems[i].formatoId = formatoId;
    _actualizarSizeItem(i);
    _actualizarPesoTotalMulti();
}

function seleccionarTodos(val) {
    multiItems.forEach((item, i) => {
        if (item.error) return;
        item.selected = val;
        const chk = document.getElementById(`mi-check-${i}`);
        if (chk) chk.checked = val;
        const el = document.getElementById(`mi-${i}`);
        if (el) el.classList.toggle('deselected', !val);
    });
    _actualizarPesoTotalMulti();
    sincronizarAlturaFlip();
}


// ── Helpers internos ──────────────────────────────────────────────────────────
function _actualizarToggleItem(i, modo) {
    const btnV = document.getElementById(`mi-video-${i}`);
    const btnA = document.getElementById(`mi-audio-${i}`);
    if (!btnV || !btnA) return;
    btnV.classList.toggle('active', modo === 'video');
    btnA.classList.toggle('active', modo === 'audio');
}

function _actualizarSizeItem(i) {
    const item   = multiItems[i];
    const sizeEl = document.getElementById(`mi-size-${i}`);
    if (!sizeEl) return;

    let bytes = null;
    if (item.modo === 'audio') {
        bytes = item.data.peso_audio || null;
    } else {
        const fmt = (item.data.formatos || []).find(f => f.id === item.formatoId);
        bytes = fmt ? fmt.size : null;
    }

    sizeEl.innerText = bytes ? `~${formatPeso(bytes)}` : '—';
}

function _reconstruirCalidadesGlobal() {
    const resSeen = new Set();
    const sel     = document.getElementById('global-quality');
    if (!sel) return;

    multiItems.forEach(item => {
        if (!item.data) return;
        (item.data.formatos || []).forEach(f => {
            if (f.res_num) resSeen.add(f.res_num);
        });
    });

    const sorted = [...resSeen].sort((a, b) => b - a);
    sel.innerHTML = '<option value="">— calidad global —</option>';
    sorted.forEach(res => {
        const o     = document.createElement('option');
        o.value     = res;
        o.innerText = `${res}p`;
        sel.appendChild(o);
    });
}


// ── Descargar seleccionados ───────────────────────────────────────────────────
function descargarSeleccionados() {
    const seleccionados = multiItems.filter(item => item.selected && !item.error);

    if (!seleccionados.length) {
        alert('No hay items seleccionados.');
        return;
    }

    seleccionados.forEach(item => {
        const d         = item.data;
        const tipo      = item.modo;
        const formatoId = item.formatoId;
        const url       = d.url;
        const key       = `${url}|${formatoId}|${tipo}`;

        if (descargasActivas[key]) return;

        const fmt       = (d.formatos || []).find(f => f.id === formatoId);
        const badge     = tipo === 'audio' ? 'MP3' : (fmt ? fmt.label : '');
        const sizeBytes = tipo === 'audio'
            ? (d.peso_audio || 0)
            : (fmt ? fmt.size || 0 : 0);

        lanzarDescarga({
            url, tipo,
            formato:   formatoId,
            titulo:    d.titulo,
            thumbnail: d.thumbnail,
            badge, sizeBytes, key,
        });
    });
}
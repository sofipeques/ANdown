// ── Header / conteo ───────────────────────────────────────────────────────────
function actualizarHeaderDescargas() {
    const stack  = document.getElementById('downloads-stack');
    const header = document.getElementById('downloads-header');
    const count  = document.getElementById('downloads-count');
    const total  = stack.children.length;
    header.style.display = total > 0 ? 'flex' : 'none';
    if (total > 0) count.innerText = `${total} descarga${total !== 1 ? 's' : ''}`;
}

function eliminarTodasTarjetas() {
    Object.keys(eventSources).forEach(id => {
        try { eventSources[id].close(); } catch (_) {}
        delete eventSources[id];
    });
    document.getElementById('downloads-stack').innerHTML = '';
    actualizarHeaderDescargas();
}


// ── Crear tarjeta ─────────────────────────────────────────────────────────────
function crearTarjeta(id, titulo, badge, sizeLabel, thumbnail) {
    const card     = document.createElement('div');
    card.className = 'dl-card';
    card.id        = id;

    // El banner va ANTES del dl-body para que no interfiera con X ni chevron
    card.innerHTML = `
        <div class="dl-expand">
            <img class="dl-expand-thumb" src="${escHtml(thumbnail)}" alt="${escHtml(titulo)}">
        </div>
        <div class="dl-cancel-banner" id="${id}-banner">
            <span class="dl-cancel-text">¿Cancelar y eliminar el archivo?</span>
            <button class="dl-cancel-confirm" onclick="event.stopPropagation(); confirmarCancelar('${id}')">Sí, cancelar</button>
            <button class="dl-cancel-dismiss" onclick="event.stopPropagation(); descartarCancelar('${id}')">No</button>
        </div>
        <div class="dl-body">
            <button class="dl-close" id="${id}-close" onclick="event.stopPropagation(); clickCerrar('${id}')" title="Cerrar">✕</button>
            <span class="dl-chevron">▼</span>
            <div class="dl-card-header">
                <div class="dl-card-title">${escHtml(titulo)}</div>
                <div class="dl-card-badges">
                    <div class="dl-card-badge">${escHtml(badge)}</div>
                    <div class="dl-card-size">${escHtml(sizeLabel)}</div>
                </div>
            </div>
            <div class="dl-progress-header">
                <span class="dl-status" style="color:var(--accent)">Preparando…</span>
                <span class="dl-speed"></span>
            </div>
            <div class="dl-bar-bg"><div class="dl-bar-fill" id="${id}-bar"></div></div>
            <div class="dl-frag" id="${id}-frag"></div>
            <div class="dl-eta"  id="${id}-eta"></div>
        </div>
    `;

    card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        card.classList.toggle('expanded');
    });

    return card;
}


// ── Agregar tarjeta ───────────────────────────────────────────────────────────
function agregarTarjeta(id, titulo, badge, sizeLabel, thumbnail) {
    const card  = crearTarjeta(id, titulo, badge, sizeLabel, thumbnail);
    const stack = document.getElementById('downloads-stack');
    stack.prepend(card);
    actualizarHeaderDescargas();
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return card;
}


// ── Lógica del botón X ────────────────────────────────────────────────────────
function clickCerrar(id) {
    const card = document.getElementById(id);
    if (!card) return;

    // Si ya terminó o tiene error → cerrar directo sin confirmación
    if (card.classList.contains('finished')) {
        _cerrarTarjetaDirecto(id);
        return;
    }

    // En progreso: primer clic abre banner, segundo clic en X confirma cancelación
    const banner    = document.getElementById(id + '-banner');
    const yaAbierto = card.classList.contains('cancel-pending');

    if (yaAbierto) {
        confirmarCancelar(id);
    } else {
        card.classList.add('cancel-pending');
        if (banner) banner.classList.add('visible');
        // Ocultar X y chevron para que no se superpongan con el banner
        const closeBtn = document.getElementById(id + '-close');
        const chevron  = card.querySelector('.dl-chevron');
        if (closeBtn) closeBtn.style.display = 'none';
        if (chevron)  chevron.style.display  = 'none';
    }
}

function descartarCancelar(id) {
    const card    = document.getElementById(id);
    const banner  = document.getElementById(id + '-banner');
    const closeBtn = document.getElementById(id + '-close');
    const chevron = card ? card.querySelector('.dl-chevron') : null;
    if (card)     card.classList.remove('cancel-pending');
    if (banner)   banner.classList.remove('visible');
    if (closeBtn) { closeBtn.classList.remove('danger'); closeBtn.style.display = ''; }
    if (chevron)  chevron.style.display = '';
}

function confirmarCancelar(id) {
    // Notificar al servidor: mata el proceso y borra el archivo parcial
    const token = cancelTokens[id];
    if (token) {
        fetch(`/cancelar/${token}`, { method: 'POST' }).catch(() => {});
        delete cancelTokens[id];
    }
    // Cerrar EventSource
    if (eventSources[id]) {
        try { eventSources[id].close(); } catch (_) {}
        delete eventSources[id];
    }
    // Limpiar clave activa y disparar onComplete para resetear botones
    const cb = _onCompleteCallbacks[id];
    if (cb) { cb(); delete _onCompleteCallbacks[id]; }
    const key = _cardKeys[id];
    if (key) { delete descargasActivas[key]; delete _cardKeys[id]; }

    _cerrarTarjetaDirecto(id);
}

function _cerrarTarjetaDirecto(id) {
    const card = document.getElementById(id);
    if (card) { card.remove(); actualizarHeaderDescargas(); }
}


// ── Actualizar tarjeta vía SSE ────────────────────────────────────────────────
function actualizarTarjeta(id, p, key) {
    const card = document.getElementById(id);
    if (!card) return;

    const colores = { "1":"#3ea6ff", "2":"#ffaa00", "3":"#ff6600", "4":"#2ba640" };
    const color   = colores[p.PASO] || '#3ea6ff';

    card.querySelector('.dl-status').innerText   = p.MSG;
    card.querySelector('.dl-status').style.color = color;
    card.querySelector('.dl-speed').innerText    =
        (p.VEL && p.VEL !== '---' && p.PASO !== '4') ? p.VEL : '';

    const bar = document.getElementById(id + '-bar');
    if (bar) { bar.style.width = p.PER + '%'; bar.style.background = color; }

    const fragEl = document.getElementById(id + '-frag');
    if (fragEl) {
        const frag = parseInt(p.FRAG || '0');
        fragEl.innerText = (p.PASO === '2' && frag > 0)
            ? (frag >= 2 ? 'Fragmento 2/2 (audio)' : 'Fragmento 1/2 (video)')
            : '';
    }

    const etaEl = document.getElementById(id + '-eta');
    if (etaEl) {
        etaEl.innerText = (p.PASO === '2' && p.ETA && p.ETA !== '---')
            ? `Restante: ${p.ETA}` : '';
    }

    if (p.PASO === '4') {
        if (eventSources[id]) { eventSources[id].close(); delete eventSources[id]; }
        if (key) delete descargasActivas[key];

        descartarCancelar(id);
        card.classList.add('finished');

        // Sumar al contador de sesión usando el tamaño real del archivo
        const sizeBytes = parseInt(p.SIZE || '0');
        if (sizeBytes > 0) {
            window.dispatchEvent(new CustomEvent('descarga-completada', { detail: { bytes: sizeBytes } }));
        }

        const body = card.querySelector('.dl-body');
        if (!card.querySelector('.dl-done-label')) {
            const label     = document.createElement('div');
            label.className = 'dl-done-label';
            label.innerText = 'Guardado';
            body.appendChild(label);
        }
    }
}


function mostrarErrorTarjeta(id, msg) {
    const card = document.getElementById(id);
    if (!card) return;
    descartarCancelar(id);
    card.classList.add('finished');
    card.querySelector('.dl-status').innerText   = 'Error';
    card.querySelector('.dl-status').style.color = '#ff5555';
    if (!card.querySelector('.dl-error')) {
        const el     = document.createElement('div');
        el.className = 'dl-error';
        el.innerText = msg;
        card.querySelector('.dl-body').appendChild(el);
    }
}


// ── Estado por tarjeta ────────────────────────────────────────────────────────
const cancelTokens       = {};  // cardId → token servidor
const _onCompleteCallbacks = {}; // cardId → onComplete fn (para resetear botón al cancelar)
const _cardKeys          = {};  // cardId → key de descargasActivas

// ── Lanzar descarga ───────────────────────────────────────────────────────────
function lanzarDescarga({ url, tipo, formato, titulo, thumbnail, badge, sizeBytes, key, onComplete }) {
    const cardId    = 'dl-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
    const sizeLabel = sizeBytes ? `~${formatPeso(sizeBytes)}` : '—';
    const token     = Math.random().toString(36).slice(2) + Date.now().toString(36);

    cancelTokens[cardId]        = token;
    _cardKeys[cardId]           = key;
    if (onComplete) _onCompleteCallbacks[cardId] = onComplete;

    agregarTarjeta(cardId, titulo, badge, sizeLabel, thumbnail);
    descargasActivas[key] = true;

    const query = [
        `url=${encodeURIComponent(url)}`,
        `tipo=${tipo}`,
        `formato=${formato}`,
        `titulo=${encodeURIComponent(titulo)}`,
        `token=${token}`,
    ].join('&');

    const es = new EventSource(`/descargar_stream?${query}`);
    eventSources[cardId] = es;

    let terminadoOk = false;

    es.onmessage = (e) => {
        const raw = e.data;
        if (raw.startsWith('PASO:')) {
            const p = parsearPaso(raw);
            actualizarTarjeta(cardId, p, key);
            if (p.PASO === '4') {
                terminadoOk = true;
                delete cancelTokens[cardId];
                delete _cardKeys[cardId];
                delete _onCompleteCallbacks[cardId];
                if (onComplete) onComplete();
            }
        } else if (raw.startsWith('ERROR:')) {
            mostrarErrorTarjeta(cardId, raw.replace('ERROR:', '').trim());
            es.close();
            delete eventSources[cardId];
            delete descargasActivas[key];
            delete cancelTokens[cardId];
            delete _cardKeys[cardId];
            delete _onCompleteCallbacks[cardId];
            if (onComplete) onComplete();
        }
    };

    es.onerror = () => {
        if (terminadoOk) {
            es.close();
            delete eventSources[cardId];
            return;
        }
        const c = document.getElementById(cardId);
        if (c && !c.querySelector('.dl-done-label') && !c.querySelector('.dl-error')) {
            mostrarErrorTarjeta(cardId, 'Conexión interrumpida.');
        }
        es.close();
        delete eventSources[cardId];
        delete descargasActivas[key];
        delete cancelTokens[cardId];
        delete _cardKeys[cardId];
        delete _onCompleteCallbacks[cardId];
        if (onComplete) onComplete();
    };
}

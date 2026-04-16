'use strict';

// ──────────────────────────────────────────────
// Estado de la app
// ──────────────────────────────────────────────

let tokenClient = null;
let accessToken = null;

// Map: spreadsheetId → { id, name, chartOid, bafoGid }
const sheetsMap = new Map();

// Limpia el nombre del campo: saca el prefijo tipo "7S_BaFo_2627_v01 "
// y deja solo el nombre real (lo que viene después del primer espacio)
function cleanFieldName(rawName) {
  const idx = rawName.indexOf(' ');
  return idx !== -1 ? rawName.slice(idx + 1).trim() : rawName;
}

// Obtener URL para un spreadsheet:
// 1. published-urls.js (compartido, en el repo)
// 2. localStorage (personal, del usuario actual)
function getPublishedUrl(spreadsheetId) {
  return (PUBLISHED_URLS && PUBLISHED_URLS[spreadsheetId])
    || localStorage.getItem(`bafo_url_${spreadsheetId}`)
    || null;
}

function setPublishedUrl(spreadsheetId, url) {
  localStorage.setItem(`bafo_url_${spreadsheetId}`, url);
}

// ──────────────────────────────────────────────
// Auth
// ──────────────────────────────────────────────

function initTokenClient() {
  if (tokenClient) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.clientId,
    scope: CONFIG.scopes,
    callback: onTokenReceived,
  });
}

function handleAuth() {
  if (accessToken) {
    // Cerrar sesión
    google.accounts.oauth2.revoke(accessToken, () => {});
    accessToken = null;
    renderLoggedOut();
    return;
  }
  initTokenClient();
  // Si ya tiene permisos previos, no muestra popup de consentimiento
  tokenClient.requestAccessToken({ prompt: '' });
}

async function onTokenReceived(response) {
  if (response.error) {
    console.error('[BAFO] Auth error:', response.error, response.error_description);
    return;
  }
  accessToken = response.access_token;
  renderLoggedIn();
  await loadSheetList();
}

// ──────────────────────────────────────────────
// UI helpers
// ──────────────────────────────────────────────

function renderLoggedOut() {
  document.getElementById('btn-auth').textContent = 'Ingresar';
  show('section-login');
  hide('section-dashboard');
  hide('btn-export');
}

function renderLoggedIn() {
  document.getElementById('btn-auth').textContent = 'Salir';
  hide('section-login');
  show('section-dashboard');
  show('btn-export');
}

function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

function setStatus(msg) {
  document.getElementById('sheets-status').textContent = msg;
}

function showChartState(state) {
  ['state-placeholder', 'state-loading', 'state-error', 'chart-frame'].forEach(id => hide(id));
  show(state);
}

// ──────────────────────────────────────────────
// Google API calls (fetch directo con access token)
// ──────────────────────────────────────────────

async function gFetch(url) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ──────────────────────────────────────────────
// Cargar lista de spreadsheets de la carpeta
// ──────────────────────────────────────────────

async function loadSheetList() {
  const select = document.getElementById('select-sheet');
  select.disabled = true;
  setStatus('Cargando lotes…');

  try {
    const files = await fetchAllSpreadsheets();

    if (!files.length) {
      setStatus('No se encontraron lotes en la carpeta.');
      return;
    }

    setStatus(`Analizando ${files.length} lotes…`);

    // Fetch chart OIDs in parallel
    const results = await Promise.all(files.map(f => fetchChartInfo(f)));

    // Populate select
    select.innerHTML = '<option value="">— Seleccioná un campo —</option>';
    let found = 0;
    results.forEach(sheet => {
      if (!sheet.chartOid) return;
      sheetsMap.set(sheet.id, sheet);
      const opt = document.createElement('option');
      opt.value = sheet.id;
      opt.textContent = cleanFieldName(sheet.name);
      select.appendChild(opt);
      found++;
    });

    const skipped = results.length - found;
    let statusMsg = `${found} campo${found !== 1 ? 's' : ''} cargado${found !== 1 ? 's' : ''}`;
    if (skipped > 0) statusMsg += ` (${skipped} sin gráfico)`;
    setStatus(statusMsg);
    select.disabled = false;

  } catch (err) {
    console.error('[BAFO] Error cargando lotes:', err);
    setStatus('Error al cargar los lotes. Revisá la consola.');
  }
}

async function fetchAllSpreadsheets() {
  const q = encodeURIComponent(
    `'${CONFIG.folderId}' in parents`
    + ` and mimeType='application/vnd.google-apps.spreadsheet'`
    + ` and trashed=false`
  );
  const url = `https://www.googleapis.com/drive/v3/files`
    + `?q=${q}&fields=files(id,name)&orderBy=name&pageSize=100`;

  const data = await gFetch(url);
  return data.files || [];
}

// ──────────────────────────────────────────────
// Obtener chart OID desde Sheets API
// ──────────────────────────────────────────────

async function fetchChartInfo(file) {
  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${file.id}`
      + `?includeGridData=false`
      + `&fields=sheets(properties(sheetId,title),charts(chartId,spec(title)))`;

    const data = await gFetch(url);

    // Buscar la hoja "BAFO" (case-insensitive)
    const bafoSheet = (data.sheets || []).find(
      s => s.properties?.title?.trim().toUpperCase()
        === CONFIG.sheetName.trim().toUpperCase()
    );

    if (!bafoSheet) {
      console.warn(`[BAFO] Hoja "${CONFIG.sheetName}" no encontrada en: ${file.name}`);
      return { ...file, chartOid: null };
    }

    // Buscar el gráfico "BAFO: GENERAL" (case-insensitive)
    const chart = (bafoSheet.charts || []).find(
      c => c.spec?.title?.trim().toUpperCase()
        === CONFIG.chartTitle.trim().toUpperCase()
    );

    if (!chart) {
      console.warn(`[BAFO] Gráfico "${CONFIG.chartTitle}" no encontrado en: ${file.name}`);
      return { ...file, chartOid: null };
    }

    return {
      id: file.id,
      name: file.name,
      chartOid: chart.chartId,
      bafoGid: bafoSheet.properties.sheetId,
    };

  } catch (err) {
    console.warn(`[BAFO] Error en ${file.name}:`, err.message);
    return { ...file, chartOid: null };
  }
}

// ──────────────────────────────────────────────
// Mostrar gráfico seleccionado
// ──────────────────────────────────────────────

let currentSpreadsheetId = null;

function handleSheetChange(spreadsheetId) {
  currentSpreadsheetId = spreadsheetId;

  const meta      = document.getElementById('chart-meta');
  const metaName  = document.getElementById('chart-meta-name');
  const frame     = document.getElementById('chart-frame');
  const urlSetup  = document.getElementById('url-setup');
  const urlInput  = document.getElementById('url-input');

  if (!spreadsheetId) {
    meta.classList.add('hidden');
    urlSetup.classList.add('hidden');
    showChartState('state-placeholder');
    frame.src = '';
    return;
  }

  const sheet = sheetsMap.get(spreadsheetId);
  if (!sheet) return;

  // Link directo al spreadsheet
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheet.id}/edit#gid=${sheet.bafoGid}`;
  document.getElementById('chart-sheet-link').href = sheetUrl;

  // Nombre del campo (limpio)
  metaName.textContent = cleanFieldName(sheet.name);
  meta.classList.remove('hidden');

  // URL: preferir la guardada en localStorage (formato 2PACX-),
  // si no hay, intentar con el ID directo del spreadsheet.
  const storedUrl = getPublishedUrl(spreadsheetId);
  const chartUrl  = storedUrl
    || `https://docs.google.com/spreadsheets/d/${sheet.id}/pubchart?oid=${sheet.chartOid}&format=interactive`;

  // Pre-cargar el input con la URL guardada
  urlInput.value = storedUrl || '';

  console.log(`[BAFO] ${sheet.name} → ${chartUrl}`);

  // Mostrar spinner, ocultar setup
  showChartState('state-loading');
  urlSetup.classList.add('hidden');
  urlSetup.removeAttribute('open');

  frame.onload = () => {
    showChartState('chart-frame');
    urlSetup.classList.remove('hidden'); // mostrar opción de config al cargar
  };

  frame.src = chartUrl;
}

// Guardar la URL publicada (formato 2PACX-) en localStorage
function savePublishedUrl() {
  const url = document.getElementById('url-input').value.trim();
  if (!currentSpreadsheetId) return;

  if (url && url.includes('pubchart')) {
    setPublishedUrl(currentSpreadsheetId, url);
    console.log(`[BAFO] URL guardada para ${currentSpreadsheetId}`);
  } else if (!url) {
    localStorage.removeItem(`bafo_url_${currentSpreadsheetId}`);
  }

  // Recargar con la nueva URL
  handleSheetChange(currentSpreadsheetId);
}

// ──────────────────────────────────────────────
// Exportar configuración → published-urls.js
// ──────────────────────────────────────────────

function exportConfig() {
  // Recolectar todas las URLs guardadas en localStorage para los lotes conocidos
  const entries = [];
  for (const [id] of sheetsMap) {
    const url = localStorage.getItem(`bafo_url_${id}`);
    if (url) entries.push(`  '${id}': '${url}'`);
  }

  if (!entries.length) {
    alert('No hay URLs configuradas todavía.\nPrimero pegá las URLs publicadas en cada lote.');
    return;
  }

  const content = `const PUBLISHED_URLS = {\n${entries.join(',\n')},\n};`;

  // Copiar al portapapeles
  navigator.clipboard.writeText(content).then(() => {
    alert(
      'Copiado al portapapeles.\n\n' +
      'Pegalo en js/published-urls.js reemplazando la línea "const PUBLISHED_URLS = {...}"\n' +
      'y hacé commit para que todos los usuarios lo tengan.'
    );
  }).catch(() => {
    // Fallback: mostrar en prompt para copiar manual
    prompt('Copiá este contenido y pegalo en js/published-urls.js:', content);
  });
}

// ──────────────────────────────────────────────
// Init: esperar que GIS esté disponible
// ──────────────────────────────────────────────

(function waitForGIS() {
  if (typeof google !== 'undefined' && google.accounts?.oauth2) {
    // GIS listo, no hacemos nada más hasta que el usuario haga click
    return;
  }
  setTimeout(waitForGIS, 80);
})();

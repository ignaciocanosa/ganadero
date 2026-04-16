/**
 * config.js — Configuración del dashboard BAFO
 *
 * PASOS para completar esta configuración:
 *
 * 1. Creá un proyecto en https://console.cloud.google.com
 * 2. Habilitá las APIs: "Google Drive API" y "Google Sheets API"
 * 3. Creá credenciales OAuth 2.0 (tipo: "Aplicación web")
 *    - Orígenes JS autorizados: la URL donde vas a alojar este sitio
 *      (para desarrollo local: http://localhost:PORT)
 * 4. Copiá el Client ID y pegalo abajo
 *
 * Ver SETUP.md para instrucciones detalladas.
 */

const CONFIG = {
  // OAuth 2.0 Client ID de Google Cloud Console
  // Formato: "xxxxxxxxxxxx-xxxx.apps.googleusercontent.com"
  clientId: '181888448427-kg6s1t6o5an36v55ietfhcp9c0fll62i.apps.googleusercontent.com',

  // ID de la carpeta de Google Drive que contiene los spreadsheets
  // (ya está configurado con tu carpeta)
  folderId: '1KDeVi11nYXeGdgfx-5eaY4QFvdCHS40X',

  // Hoja dentro de cada spreadsheet donde está el gráfico
  sheetName: 'BAFO',

  // Título exacto del gráfico a mostrar
  chartTitle: 'BAFO: GENERAL',

  // Permisos que necesita la app (solo lectura)
  scopes: [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/spreadsheets.readonly',
  ].join(' '),
};

// ============================================================
// SE-FS Load — Apps Script Web App
// Pega este código en: Google Sheet → Extensiones → Apps Script
//
// Despliega como Web App:
//   - Ejecutar como: Yo / Tú (tu cuenta de Google)
//   - Quién tiene acceso: Cualquier persona (Anyone)
// ============================================================

const SS = SpreadsheetApp.getActiveSpreadsheet();

// ─── Configuración de Nombres de Hojas ────────────────────────
// Puedes personalizar aquí el nombre de las hojas según tu documento:
const SHEET_RESPONSES = "Respuestas de formulario 1"; // Hoja de respuestas del Formulario (ej: "Respuestas de formulario 1" o "Form Responses 1")
const SHEET_CALLUPS   = "Convocatorias";              // Hoja de convocatorias
const SHEET_SESSIONS  = "Sesiones";                   // Hoja de sesiones
const SHEET_MINUTES   = "Minutos";                    // Hoja de minutos de juego (se crea sola)
const MINUTES_HEADERS = ["id", "convocatoriaId", "sesionId", "fecha", "jugador", "minutos"];


// ─── Selector inteligente de la Hoja de Respuestas ────────────
/**
 * Localiza la hoja de respuestas del formulario de manera flexible:
 * 1. Comprueba si se pasa un nombre personalizado (ej. desde el payload)
 * 2. Busca por el nombre configurado en SHEET_RESPONSES
 * 3. Busca coincidencias parciales típicas ("respuestas", "form response")
 * 4. Si ninguna coincide, utiliza la primera hoja del libro (gid=0)
 */
function getResponsesSheet(customName) {
  const targetName = customName || SHEET_RESPONSES;
  if (targetName) {
    const sheet = SS.getSheetByName(targetName);
    if (sheet) return sheet;
  }

  // Búsqueda aproximada entre todas las pestañas
  const sheets = SS.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const name = sheets[i].getName().toLowerCase();
    if (name.includes("respuestas") || name.includes("form response") || name.includes("formulario")) {
      return sheets[i];
    }
  }

  // Fallback: primera pestaña
  return sheets.length > 0 ? sheets[0] : null;
}

/**
 * Obtiene una hoja por su nombre o la crea automáticamente con sus cabeceras
 * si no existe todavía en el Spreadsheet.
 */
function getOrCreateSheet(sheetName, defaultHeaders) {
  let sheet = SS.getSheetByName(sheetName);
  if (!sheet) {
    sheet = SS.insertSheet(sheetName);
    if (defaultHeaders && defaultHeaders.length > 0) {
      sheet.appendRow(defaultHeaders);
    }
  }
  return sheet;
}


// ─── GET: devuelve todas las convocatorias y sesiones ─────────

function doGet(e) {
  const callUps = sheetToObjects(SHEET_CALLUPS);
  const sessions = sheetToObjects(SHEET_SESSIONS);
  const minutes = sheetToObjects(SHEET_MINUTES);
  const responsesSheet = getResponsesSheet();

  const payload = JSON.stringify({
    ok: true,
    callUps,
    sessions,
    minutes,
    responses: readResponses(responsesSheet),
    responsesSheetName: responsesSheet ? responsesSheet.getName() : null
  });

  return ContentService
    .createTextOutput(payload)
    .setMimeType(ContentService.MimeType.JSON);
}


// ─── POST: guarda o elimina convocatoria, sesión o respuesta ──

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ ok: false, error: "Invalid JSON: " + (err.message || err) });
  }

  const { action, entity, data } = body;
  // action: "upsert" | "delete"
  // entity: "callup" | "session" | "response"

  // 1. Manejo de Respuestas de Jugadores (Google Form)
  if (entity === "response") {
    const customSheetName = (data && data.sheetName) || body.sheetName;
    const sheet = getResponsesSheet(customSheetName);
    if (!sheet) {
      return jsonResponse({ ok: false, error: "No se encontró la hoja de respuestas del formulario" });
    }

    if (action === "upsert") {
      upsertResponseRow(sheet, data);
      return jsonResponse({ ok: true, sheetUsed: sheet.getName() });
    }
    if (action === "delete") {
      deleteResponseRow(sheet, data.jugador, data.fecha);
      return jsonResponse({ ok: true, sheetUsed: sheet.getName() });
    }
  }

  // 2. Minutos de juego (entrada manual desde la app)
  //    data.rows = [{ id, convocatoriaId, sesionId, fecha, jugador, minutos }]
  //    Una fila con "minutos" vacío se elimina.
  if (entity === "minutes") {
    const sheet = getOrCreateSheet(SHEET_MINUTES, MINUTES_HEADERS);
    const rows = (data && data.rows) || [];
    rows.forEach(function (r) {
      if (!r || !r.id) return;
      if (r.minutos === "" || r.minutos === null || r.minutos === undefined) {
        deleteRow(sheet, r.id);
      } else {
        upsertRow(sheet, r);
      }
    });
    return jsonResponse({ ok: true, saved: rows.length });
  }

  if (entity !== "callup" && entity !== "session") {
    return jsonResponse({ ok: false, error: "Entidad no reconocida: " + entity });
  }

  // 3. Manejo de Convocatorias y Sesiones
  const sheetName = entity === "callup" ? SHEET_CALLUPS : SHEET_SESSIONS;
  const defaultHeaders = entity === "callup"
    ? ["id", "nombre", "fechaInicio", "fechaFin", "sede", "estado", "notas"]
    : ["id", "convocatoriaId", "fecha", "diaLabel", "tipo", "duracion"];

  const sheet = getOrCreateSheet(sheetName, defaultHeaders);

  if (action === "upsert") {
    upsertRow(sheet, data);
    return jsonResponse({ ok: true });
  }

  if (action === "delete") {
    deleteRow(sheet, data.id);
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ ok: false, error: "Acción no reconocida: " + action });
}


// ─── Helpers: Lectura / Escritura de Convocatorias y Sesiones ─

function sheetToObjects(name) {
  const sheet = SS.getSheetByName(name);
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(String);
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = String(row[i] ?? ""); });
    return obj;
  }).filter(r => r.id); // omitir filas vacías
}

function upsertRow(sheet, data) {
  let lastCol = sheet.getLastColumn();
  let headers = [];

  if (lastCol > 0) {
    headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  }

  if (headers.length === 0) {
    headers = Object.keys(data);
    sheet.appendRow(headers);
    lastCol = headers.length;
  }

  const lastRow = sheet.getLastRow();

  // Buscar fila existente por id
  if (lastRow > 1) {
    const idCol = headers.indexOf("id") + 1;
    if (idCol > 0) {
      const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues().flat().map(String);
      const idx = ids.indexOf(String(data.id));
      if (idx !== -1) {
        // Actualizar fila existente
        const row = headers.map(h => data[h] ?? "");
        sheet.getRange(idx + 2, 1, 1, headers.length).setValues([row]);
        return;
      }
    }
  }

  // Si no existe, insertar nueva fila
  const row = headers.map(h => data[h] ?? "");
  sheet.appendRow(row);
}

function deleteRow(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return;

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const idCol = headers.indexOf("id") + 1;
  if (idCol === 0) return;

  const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues().flat().map(String);
  const idx = ids.indexOf(String(id));

  if (idx !== -1) {
    sheet.deleteRow(idx + 2);
  }
}


// ─── Helpers: Respuestas de Formulario ────────────────────────

/**
 * Lee la hoja de respuestas y devuelve [{timestamp, jugador, fatigue, rpe, fecha}]
 * con la fecha ya normalizada a yyyy-MM-dd. Así la app no depende de un CSV publicado.
 */
function readResponses(sheet) {
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(h => String(h || "").toLowerCase());
  const find = (pred, fallback) => {
    const i = headers.findIndex(pred);
    return i >= 0 ? i : fallback;
  };
  const jCol = find(h => h.includes("jugador") || h.includes("nombre") || h.includes("player"), 1);
  const fatCol = find(h => h.includes("sientes") || h.includes("fatiga") || h.includes("fatigue") || h.includes("recuperaci"), 2);
  const rpeCol = find(h => h.includes("intenso") || h.includes("intensidad") || h.includes("rpe") || h.includes("esfuerzo"), 3);
  const fCol = find(h => h === "fecha" || h.includes("date"), 4);

  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const jugador = String(r[jCol] || "").trim();
    const fecha = parseIsoDate(r[fCol]) || parseIsoDate(r[0]);
    if (!jugador || !fecha) continue;
    out.push({
      timestamp: r[0] instanceof Date ? r[0].toISOString() : String(r[0] || ""),
      jugador: jugador,
      fatigue: Number(String(r[fatCol]).replace(",", ".")) || 0,
      rpe: Number(String(r[rpeCol]).replace(",", ".")) || 0,
      fecha: fecha
    });
  }
  return out;
}

function upsertResponseRow(sheet, data) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    // Si la hoja está vacía, inicializar cabeceras por defecto
    const defaultHeaders = [
      "Marca temporal",
      "JUGADOR",
      "¿Cómo te sientes después del entrenamiento/partido?",
      "¿Cómo de intenso fue el entrenamiento?",
      "Fecha"
    ];
    if (values.length === 0) {
      sheet.appendRow(defaultHeaders);
    }
    const row = [new Date().toLocaleString("es-ES"), data.jugador, data.fatigue, data.rpe, data.fecha];
    sheet.appendRow(row);
    return;
  }

  const headers = values[0].map(h => String(h || ""));

  // Detección insensible a mayúsculas y acentos
  const jugadorCol = headers.findIndex(h => {
    const l = h.toLowerCase();
    return l.includes("jugador") || l.includes("nombre") || l.includes("player");
  }) + 1;

  const fechaCol = headers.findIndex(h => {
    const l = h.toLowerCase();
    return l.includes("fecha") || l.includes("date");
  }) + 1;

  const fatigueCol = headers.findIndex(h => {
    const l = h.toLowerCase();
    return l.includes("sientes") || l.includes("fatiga") || l.includes("fatigue") || l.includes("recuperaci");
  }) + 1;

  const rpeCol = headers.findIndex(h => {
    const l = h.toLowerCase();
    return l.includes("intenso") || l.includes("intensidad") || l.includes("rpe") || l.includes("esfuerzo");
  }) + 1;

  const jCol = jugadorCol > 0 ? jugadorCol : 2;
  const fCol = fechaCol > 0 ? fechaCol : 5;
  const fatCol = fatigueCol > 0 ? fatigueCol : 3;
  const rpCol = rpeCol > 0 ? rpeCol : 4;

  const playerTarget = String(data.jugador).trim().toUpperCase();
  const dateTarget = String(data.fecha).trim();

  // Buscar si ya existe la respuesta para este jugador y fecha para actualizarla
  for (let i = 1; i < values.length; i++) {
    const rowDate = parseIsoDate(values[i][fCol - 1]);
    const rowPlayer = String(values[i][jCol - 1]).trim().toUpperCase();

    if (rowPlayer === playerTarget && rowDate === dateTarget) {
      sheet.getRange(i + 1, fatCol).setValue(data.fatigue);
      sheet.getRange(i + 1, rpCol).setValue(data.rpe);
      sheet.getRange(i + 1, 1).setValue(new Date().toLocaleString("es-ES"));
      return;
    }
  }

  // Si no existe, insertar nueva fila
  const maxCol = Math.max(headers.length, jCol, fCol, fatCol, rpCol);
  const newRow = new Array(maxCol).fill("");
  newRow[0] = new Date().toLocaleString("es-ES");
  newRow[jCol - 1] = data.jugador;
  newRow[fatCol - 1] = data.fatigue;
  newRow[rpCol - 1] = data.rpe;
  newRow[fCol - 1] = data.fecha;
  sheet.appendRow(newRow);
}

function deleteResponseRow(sheet, jugador, fecha) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return;

  const headers = values[0].map(h => String(h || ""));
  const jugadorCol = headers.findIndex(h => {
    const l = h.toLowerCase();
    return l.includes("jugador") || l.includes("nombre") || l.includes("player");
  }) + 1;

  const fechaCol = headers.findIndex(h => {
    const l = h.toLowerCase();
    return l.includes("fecha") || l.includes("date");
  }) + 1;

  const jCol = jugadorCol > 0 ? jugadorCol : 2;
  const fCol = fechaCol > 0 ? fechaCol : 5;

  const playerTarget = String(jugador).trim().toUpperCase();
  const dateTarget = String(fecha).trim();

  // Iterar de abajo hacia arriba para eliminar sin desfasar los índices
  for (let i = values.length - 1; i >= 1; i--) {
    const rowDate = parseIsoDate(values[i][fCol - 1]);
    const rowPlayer = String(values[i][jCol - 1]).trim().toUpperCase();

    if (rowPlayer === playerTarget && rowDate === dateTarget) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}


// ─── Normalización de Fechas ──────────────────────────────────

function parseIsoDate(val) {
  if (!val) return "";
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }

  let str = String(val).trim();
  // Quitar zona horaria entre paréntesis si existe
  str = str.replace(/\s*\([^)]*\)\s*$/, "");

  // 1. Ya en formato ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }

  // 2. Formato con separadores (DD/MM/YYYY o YYYY/MM/DD)
  const clean = str.split(" ")[0].replace(/[\.\-]/g, "/");
  const parts = clean.split("/");
  if (parts.length === 3) {
    let p0 = parts[0], p1 = parts[1], p2 = parts[2];
    if (p0.length === 4) {
      // YYYY/MM/DD
      return p0 + "-" + padZero(p1) + "-" + padZero(p2);
    }
    // DD/MM/YYYY
    return p2 + "-" + padZero(p1) + "-" + padZero(p0);
  }

  // 3. Fallback a objeto Date
  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
    }
  } catch (e) {}

  return str;
}

function padZero(n) {
  const s = String(n).trim();
  return s.length === 1 ? "0" + s : s;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

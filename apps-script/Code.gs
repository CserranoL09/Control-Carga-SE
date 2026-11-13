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
const MINUTES_HEADERS = ["id", "convocatoriaId", "sesionId", "fecha", "jugador", "minutos", "minutos1", "minutos2"];
const SHEET_NOTES     = "Notas";                      // Observaciones del cuerpo técnico (se crea sola)
const NOTES_HEADERS   = ["id", "convocatoriaId", "jugador", "orden", "titulo", "texto", "enInforme", "actualizado"];

// Cuestionario matinal de recuperación (OTRO Google Sheet, solo lectura)
const RECOVERY_SPREADSHEET_ID = "1XvFrD51I9HY4spyLLwxr0VFJ2jlyrcXjyMTIlUhIvMU";


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
  const p = (e && e.parameter) || {};
  const conv = String(p.convocatoria || "");
  const fresh = p.fresh === "1";
  const key = "get:" + dataVersion_() + ":" + (conv || "todo");

  // Copia en caché (5 min, se invalida al guardar cualquier cosa). "Sincronizar" pide fresh=1.
  if (!fresh) {
    const hit = cacheGet_(key);
    if (hit) return textJson_('{"desdeCache":true,' + hit.slice(1));
  }
  const payload = JSON.stringify(buildPayload_(conv));
  cachePut_(key, payload);
  return textJson_(payload);
}

/**
 * Datos para la app. Con `conv` (id de convocatoria) solo devuelve las sesiones, minutos,
 * notas, recuperación y respuestas de esa convocatoria (las respuestas con un día de
 * margen por cada lado: la app ajusta la fecha de las que no la traen). La lista de
 * convocatorias va siempre completa.
 */
function buildPayload_(conv) {
  const t = {};
  let t0 = Date.now();
  const lap = function (name) { const now = Date.now(); t[name] = now - t0; t0 = now; };

  const callUps = sheetToObjects(SHEET_CALLUPS); lap("convocatorias");
  const cu = conv ? callUps.filter(function (c) { return c.id === conv; })[0] : null;
  const desde = cu ? shiftIso_(parseIsoDate(cu.fechaInicio), -1) : "";
  const hasta = cu ? shiftIso_(parseIsoDate(cu.fechaFin), 1) : "";
  const inRange = function (f) { return !cu || (f >= desde && f <= hasta); };

  let sessions = sheetToObjects(SHEET_SESSIONS); lap("sesiones");
  if (cu) sessions = sessions.filter(function (s) { return s.convocatoriaId === conv; });
  let minutes = readMinutes(); lap("minutos");
  if (cu) minutes = minutes.filter(function (m) { return m.convocatoriaId === conv; });
  let notes = sheetToObjects(SHEET_NOTES); lap("notas");
  if (cu) notes = notes.filter(function (n) { return n.convocatoriaId === conv; });
  const recovery = readRecovery().filter(function (r) { return inRange(r.fecha); }); lap("recuperacion");
  const responsesSheet = getResponsesSheet();
  const responses = readResponses(responsesSheet).filter(function (r) { return inRange(r.fecha); }); lap("respuestas");

  return {
    ok: true,
    callUps: callUps,
    sessions: sessions,
    minutes: minutes,
    notes: notes,
    recovery: recovery,
    responses: responses,
    responsesSheetName: responsesSheet ? responsesSheet.getName() : null,
    convocatoria: cu ? conv : null,
    generado: new Date().toISOString(),
    tiempos: t
  };
}

function textJson_(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

/** aaaa-mm-dd ± días */
function shiftIso_(iso, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + days));
  return d.toISOString().slice(0, 10);
}

// ─── Caché de lectura ─────────────────────────────────────────

/** Versión de los datos: cambia con cada guardado, así la caché anterior deja de usarse */
function dataVersion_() {
  return PropertiesService.getScriptProperties().getProperty("dataVersion") || "0";
}
function bumpDataVersion_() {
  PropertiesService.getScriptProperties().setProperty("dataVersion", String(Date.now()));
}

const CACHE_CHUNK = 40000; // caracteres por trozo (CacheService admite 100 KB por clave)

function cachePut_(key, text) {
  try {
    const cache = CacheService.getScriptCache();
    const parts = {};
    const n = Math.ceil(text.length / CACHE_CHUNK);
    for (let i = 0; i < n; i++) parts[key + ":" + i] = text.slice(i * CACHE_CHUNK, (i + 1) * CACHE_CHUNK);
    parts[key + ":n"] = String(n);
    cache.putAll(parts, 300); // 5 minutos
  } catch (err) {
    console.warn("cachePut_: " + err); // demasiado grande o sin caché: se sigue sin ella
  }
}

function cacheGet_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const n = Number(cache.get(key + ":n"));
    if (!n) return null;
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(key + ":" + i);
    const parts = cache.getAll(keys);
    let text = "";
    for (let i = 0; i < n; i++) {
      if (parts[keys[i]] == null) return null;
      text += parts[keys[i]];
    }
    return text;
  } catch (err) {
    return null;
  }
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

  // Cualquier guardado deja obsoleta la copia en caché de la lectura
  bumpDataVersion_();

  // 0. Varias respuestas de una vez (edición en bloque desde Resumen)
  if (entity === "responses" && action === "batch") {
    const sheet = getResponsesSheet((data && data.sheetName) || body.sheetName);
    if (!sheet) return jsonResponse({ ok: false, error: "No se encontró la hoja de respuestas del formulario" });
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return jsonResponse({ ok: false, error: "La hoja está ocupada con otro guardado. Inténtalo de nuevo." });
    try {
      const results = batchResponses_(sheet, (data && data.rows) || []);
      const out = { ok: true, results: results };
      // Respuestas actualizadas del rango, para que la app no tenga que recargar todo
      if (data && data.desde && data.hasta) {
        // con un día de margen, igual que en la lectura (la app ajusta las que no traen fecha)
        const desde = shiftIso_(data.desde, -1), hasta = shiftIso_(data.hasta, 1);
        out.responses = readResponses(sheet).filter(function (r) {
          return r.fecha >= desde && r.fecha <= hasta;
        });
      }
      return jsonResponse(out);
    } finally {
      lock.releaseLock();
    }
  }
  // Resto: action "upsert" | "delete"; entity "callup" | "session" | "response" | "minutes" | "note"

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
  //    data.rows = [{ id, convocatoriaId, sesionId, fecha, jugador, minutos, minutos1, minutos2 }]
  //    minutos = total del partido. Si llega alguna parte, total = 1ª + 2ª.
  //    Una fila con total, 1ª y 2ª vacíos se elimina.
  if (entity === "minutes") {
    const sheet = getMinutesSheet();
    const rows = (data && data.rows) || [];
    rows.forEach(function (r) {
      if (!r || !r.id) return;
      const m1 = toMinutesNumber(r.minutos1);
      const m2 = toMinutesNumber(r.minutos2);
      const hasParts = m1 !== null || m2 !== null;
      const value = hasParts
        ? Math.round(((m1 || 0) + (m2 || 0)) * 100) / 100
        : toMinutesNumber(r.minutos);
      if (value === null) {
        deleteRow(sheet, r.id);
      } else {
        // Se guarda como NÚMERO: si se guarda como texto, Google Sheets convierte
        // valores como "15.5" o "12.25" en fechas (15 de mayo, 12 de...)
        upsertRow(sheet, {
          id: String(r.id),
          convocatoriaId: String(r.convocatoriaId || ""),
          sesionId: String(r.sesionId || ""),
          fecha: String(r.fecha || ""),
          jugador: String(r.jugador || ""),
          minutos: value,
          minutos1: m1 === null ? "" : m1,
          minutos2: m2 === null ? "" : m2
        });
      }
    });
    return jsonResponse({ ok: true, saved: rows.length });
  }

  // 3. Observaciones del cuerpo técnico por jugador
  if (entity === "note") {
    const sheet = getNotesSheet();
    if (!data || !data.id) return jsonResponse({ ok: false, error: "Falta el id de la nota" });
    if (action === "delete") {
      deleteRow(sheet, data.id);
      return jsonResponse({ ok: true });
    }
    if (action === "upsert") {
      const actualizado = new Date().toISOString();
      upsertRow(sheet, {
        id: String(data.id),
        convocatoriaId: String(data.convocatoriaId || ""),
        jugador: String(data.jugador || ""),
        orden: String(data.orden == null ? 0 : data.orden),
        titulo: String(data.titulo || "").slice(0, 80),
        texto: String(data.texto || "").slice(0, 2000),
        enInforme: data.enInforme === false || data.enInforme === "0" ? "0" : "1",
        actualizado: actualizado
      });
      return jsonResponse({ ok: true, actualizado: actualizado });
    }
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


// ─── Helpers: Notas ───────────────────────────────────────────

/** Hoja "Notas" con todas las columnas como texto (Sheets no convierte nada). */
function getNotesSheet() {
  const sheet = getOrCreateSheet(SHEET_NOTES, NOTES_HEADERS);
  sheet.getRange("A:H").setNumberFormat("@");
  return sheet;
}


// ─── Helpers: Minutos de juego ────────────────────────────────

/**
 * Hoja "Minutos" con formato fijo: columnas A-E como texto (para que Sheets
 * no convierta ids ni fechas) y columna F (minutos) como número con 2 decimales.
 */
function getMinutesSheet() {
  const sheet = getOrCreateSheet(SHEET_MINUTES, MINUTES_HEADERS);
  // Hojas creadas con la versión anterior: añadir "minutos1" y "minutos2" al final
  // (G1 y H1) sin mover ni borrar nada.
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  ["minutos1", "minutos2"].forEach(function (h) {
    if (headers.indexOf(h) === -1) {
      headers.push(h);
      sheet.getRange(1, headers.length).setValue(h);
    }
  });
  sheet.getRange("A:E").setNumberFormat("@");
  sheet.getRange("F:H").setNumberFormat("0.00");
  return sheet;
}

/** "22,5" | "22.5" | 22.5 → 22.5 ; vacío → null ; valor no válido → null */
function toMinutesNumber(v) {
  if (v === "" || v === null || v === undefined) return null;
  if (v instanceof Date) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (!isFinite(n) || n < 0 || n > 300) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Lee la hoja Minutos. Las filas cuyo valor de minutos no es válido
 * (p. ej. celdas que Sheets convirtió en fecha con la versión anterior)
 * se omiten para que la app las muestre vacías y se puedan volver a introducir.
 */
function readMinutes() {
  const sheet = SS.getSheetByName(SHEET_MINUTES);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  const col = function (name) { return headers.indexOf(name); };
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const id = String(r[col("id")] || "");
    if (!id) continue;
    const minutos = toMinutesNumber(r[col("minutos")]);
    if (minutos === null) continue;
    const fechaRaw = r[col("fecha")];
    out.push({
      id: id,
      convocatoriaId: String(r[col("convocatoriaId")] || ""),
      sesionId: String(r[col("sesionId")] || ""),
      fecha: fechaRaw instanceof Date ? parseIsoDate(fechaRaw) : String(fechaRaw || ""),
      jugador: String(r[col("jugador")] || "").trim(),
      minutos: minutos,
      minutos1: col("minutos1") === -1 ? null : toMinutesNumber(r[col("minutos1")]),
      minutos2: col("minutos2") === -1 ? null : toMinutesNumber(r[col("minutos2")])
    });
  }
  return out;
}


// ─── Helpers: Recuperación (cuestionario matinal) ─────────────

/**
 * Lee la primera pestaña del Sheet de recuperación (solo lectura).
 * Columnas: A marca temporal · B jugador · C valor 0-10 · D categoría (se ignora) · E fecha · F hora
 * Salta filas "MEDIA" y vacías; si un jugador responde varias veces el mismo día,
 * se queda con la última respuesta. Si el libro no se puede abrir devuelve [].
 */
function readRecovery() {
  try {
    const sheet = SpreadsheetApp.openById(RECOVERY_SPREADSHEET_ID).getSheets()[0];
    const values = sheet.getDataRange().getValues();
    const latest = {}; // "fecha|JUGADOR" -> { ms, row }
    for (let i = 1; i < values.length; i++) {
      const r = values[i];
      const first = String(r[0] || "").trim().toUpperCase();
      if (!first || first === "MEDIA") continue;
      const jugador = String(r[1] || "").trim();
      if (!jugador) continue;
      const raw = r[2];
      if (raw === "" || raw === null) continue;
      const valor = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
      if (!isFinite(valor) || valor < 0 || valor > 10) continue;
      const fecha = parseIsoDate(r[4]) || parseIsoDate(r[0]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) continue;
      const ms = r[0] instanceof Date ? r[0].getTime() : i; // orden de la hoja si no hay fecha-hora
      const key = fecha + "|" + jugador.toUpperCase();
      if (!latest[key] || ms >= latest[key].ms) {
        latest[key] = {
          ms: ms,
          row: {
            timestamp: r[0] instanceof Date ? r[0].toISOString() : String(r[0] || ""),
            jugador: jugador,
            fecha: fecha,
            valor: Math.round(valor * 100) / 100
          }
        };
      }
    }
    return Object.keys(latest).map(function (k) { return latest[k].row; });
  } catch (err) {
    console.error("readRecovery: " + err);
    return [];
  }
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
      timestamp: tsKey_(r[0]),
      fila: i + 1, // fila de la hoja: permite editar o borrar exactamente esta respuesta
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

// ─── Helpers: respuestas del Form ─────────────────────────────────────────────

/** Marca temporal tal como la devuelve readResponses (para identificar una fila) */
function tsKey_(v) {
  return v instanceof Date ? v.toISOString() : String(v || "");
}

/** Nombre sin tildes, mayúsculas ni espacios extra */
function normName_(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
}

/** Hora actual en formato fijo "dd/MM/yyyy HH:mm:ss" con la zona horaria del script */
function nowStamp_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss");
}

/**
 * Marca temporal como TEXTO (el apóstrofo no se ve en la celda): así Sheets no la
 * reinterpreta con su configuración regional (p. ej. 05/11 como 11 de mayo).
 */
function stampText_(s) {
  return "'" + String(s);
}

/**
 * Índice (en `values`) de la respuesta exacta de un jugador: por `fila` (comprobando que
 * sigue siendo del mismo jugador y fecha) o por su marca temporal. -1 si no está.
 */
function findResponseRow_(values, jCol, fCol, data) {
  const player = normName_(data.jugador);
  const date = String(data.fecha || "").trim();
  const same = function (i) {
    const row = values[i];
    return !!row && normName_(row[jCol - 1]) === player && parseIsoDate(row[fCol - 1]) === date;
  };
  if (data.fila) {
    const i = Number(data.fila) - 1;
    if (i >= 1 && same(i)) return i;
  }
  if (data.timestamp) {
    for (let i = 1; i < values.length; i++) {
      if (same(i) && tsKey_(values[i][0]) === String(data.timestamp)) return i;
    }
  }
  return -1;
}

/** Columnas (1-based) de la hoja de respuestas a partir de las cabeceras */
function responseCols_(headers) {
  const find = function (pred, fallback) {
    const i = headers.findIndex(function (h) { return pred(String(h || "").toLowerCase()); });
    return i >= 0 ? i + 1 : fallback;
  };
  return {
    j: find(function (l) { return l.includes("jugador") || l.includes("nombre") || l.includes("player"); }, 2),
    f: find(function (l) { return l.includes("fecha") || l.includes("date"); }, 5),
    fat: find(function (l) { return l.includes("sientes") || l.includes("fatiga") || l.includes("fatigue") || l.includes("recuperaci"); }, 3),
    rpe: find(function (l) { return l.includes("intenso") || l.includes("intensidad") || l.includes("rpe") || l.includes("esfuerzo"); }, 4)
  };
}

/**
 * Aplica varios cambios de respuestas con UNA lectura de la hoja:
 *   { jugador, fecha, fatigue, rpe, fila?, timestamp?, marcaTemporal?, borrar? }
 * - con fila/timestamp: edita (o borra, si borrar) esa respuesta exacta;
 * - sin ellos: añade una fila nueva con su marca temporal.
 * Devuelve [{ i, ok, error? }] en el mismo orden.
 */
function batchResponses_(sheet, rows) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || ["Marca temporal", "JUGADOR", "Fatiga", "RPE", "Fecha"];
  const c = responseCols_(headers);
  const width = Math.max(headers.length, c.j, c.f, c.fat, c.rpe);
  const results = [];
  const updates = [];
  const deletes = [];
  const appends = [];
  const used = {};

  rows.forEach(function (r, i) {
    try {
      if (r.fila || r.timestamp) {
        const idx = findResponseRow_(values, c.j, c.f, r);
        if (idx < 1 || used[idx]) throw new Error("No se encontró la respuesta (la hoja ha cambiado). Recarga la app.");
        used[idx] = true;
        if (r.borrar) deletes.push(idx);
        else updates.push({ idx: idx, fatigue: r.fatigue, rpe: r.rpe });
      } else {
        if (r.borrar) throw new Error("No hay respuesta que borrar");
        const row = new Array(width).fill("");
        row[0] = stampText_(r.marcaTemporal || nowStamp_());
        row[c.j - 1] = r.jugador;
        row[c.fat - 1] = r.fatigue;
        row[c.rpe - 1] = r.rpe;
        row[c.f - 1] = r.fecha;
        appends.push(row);
      }
      results.push({ i: i, ok: true });
    } catch (err) {
      results.push({ i: i, ok: false, error: String(err.message || err) });
    }
  });

  // 1. Ediciones (fatiga y RPE juntas si están en columnas seguidas)
  updates.forEach(function (u) {
    if (c.rpe === c.fat + 1) sheet.getRange(u.idx + 1, c.fat, 1, 2).setValues([[u.fatigue, u.rpe]]);
    else {
      sheet.getRange(u.idx + 1, c.fat).setValue(u.fatigue);
      sheet.getRange(u.idx + 1, c.rpe).setValue(u.rpe);
    }
  });
  // 2. Borrados, de abajo hacia arriba para no desplazar las filas pendientes
  deletes.sort(function (a, b) { return b - a; }).forEach(function (idx) { sheet.deleteRow(idx + 1); });
  // 3. Filas nuevas, todas de una vez al final
  if (appends.length) sheet.getRange(sheet.getLastRow() + 1, 1, appends.length, width).setValues(appends);
  return results;
}

/**
 * Sheets Store. Los datos se leen de la Google Apps Script Web App; la última
 * lectura correcta se guarda para poder verla sin conexión (ver ./offline.ts).
 * La lectura puede pedirse por convocatoria y el Apps Script guarda 5 min una copia
 * en caché (se invalida al guardar; "Sincronizar" la salta con fresh=1).
 *
 * Hoja "Convocatorias": id | nombre | fechaInicio | fechaFin | sede | estado | notas
 * Hoja "Sesiones":      id | convocatoriaId | fecha | diaLabel | tipo | duracion
 */

import { parseToIsoDate, formatDateShort } from "./date-utils";
import { getAppsScriptUrl } from "./config";
import { fetchAppsScriptJson, isOffline, OFFLINE_SAVE_MSG } from "./offline";
import { mapScriptResponses, type FormResponse } from "./sheets-service";
// ─────────────────────────────────────────────────────────────────────────────

// ─── ⚙️ Umbrales de carga ─────────────────────────────────────────────────────
export interface LoadThresholds {
  optimo: number;
  moderado: number;
}

export function getLoadThresholds(): LoadThresholds {
  try {
    const saved = localStorage.getItem("ignite-load-thresholds");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (typeof parsed.optimo === "number" && typeof parsed.moderado === "number") {
        return parsed;
      }
    }
  } catch (e) {
    console.error("Failed to load thresholds from localStorage", e);
  }
  return { optimo: 400, moderado: 600 };
}

export function saveLoadThresholds(thresholds: LoadThresholds) {
  try {
    localStorage.setItem("ignite-load-thresholds", JSON.stringify(thresholds));
  } catch (e) {
    console.error("Failed to save thresholds to localStorage", e);
  }
}

export type SessionType =
  | "PARTIDO"
  | "TEC-TAC"
  | "FÍSICO"
  | "LIBRE"
  | "GYM+TEC-TAC"
  | "FÍSICO+TEC-TAC"
  | "FÍSICO+PARTIDO"
  | "TEC-TAC+TEC-TAC"
  | "ACTIVACIÓN"
  | "REGENERATIVO";

export const SESSION_TYPES: SessionType[] = [
  "PARTIDO",
  "TEC-TAC",
  "FÍSICO",
  "LIBRE",
  "GYM+TEC-TAC",
  "FÍSICO+TEC-TAC",
  "FÍSICO+PARTIDO",
  "TEC-TAC+TEC-TAC",
  "ACTIVACIÓN",
  "REGENERATIVO",
];

export type DayLabel = "" | "M" | "T" | "M-T";

export interface StoredSession {
  id: string;
  callUpId: string;
  date: string;
  dayLabel: DayLabel;
  type: SessionType;
  duration: number;
}

export interface StoredCallUp {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  location: string;
  status: "En curso" | "Finalizada";
  notes?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export interface StoredMinutes {
  id: string;
  callUpId: string;
  sessionId: string;
  date: string;
  jugador: string;
  /** Total del partido */
  minutes: number;
  /** Minutos de la 1ª parte (null = sin desglose) */
  minutes1?: number | null;
  /** Minutos de la 2ª parte (null = sin desglose) */
  minutes2?: number | null;
}

const toPart = (v: unknown): number | null => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(String(v).replace(",", "."));
  return isFinite(n) && n >= 0 && n <= 300 ? n : null;
};

/** Sesiones en las que se registran minutos de juego */
export function isMatchSession(s: StoredSession): boolean {
  return s.type.includes("PARTIDO");
}

function normalizePlayerKey(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
}

/** id determinista: una fila por jugador y sesión */
export function minutesId(sessionId: string, jugador: string): string {
  return `${sessionId}__${normalizePlayerKey(jugador)}`;
}

export function samePlayer(a: string, b: string): boolean {
  return normalizePlayerKey(a) === normalizePlayerKey(b);
}

export interface StoredNote {
  id: string;
  callUpId: string;
  jugador: string;
  orden: number;
  titulo: string;
  texto: string;
  /** Incluir en el informe PDF */
  enInforme: boolean;
  /** ISO, fecha-hora del último guardado (la pone el servidor) */
  actualizado: string;
}

export interface StoredRecovery {
  jugador: string;
  /** yyyy-MM-dd */
  fecha: string;
  /** 0-10, valor bajo = mejor recuperado */
  valor: number;
  timestamp: string;
}

interface AllData {
  callUps: StoredCallUp[];
  sessions: StoredSession[];
  minutes: StoredMinutes[];
  /** false si el Apps Script desplegado todavía no conoce la hoja "Minutos" */
  minutesSupported: boolean;
  recovery: StoredRecovery[];
  /** false si el Apps Script desplegado todavía no lee el Sheet de recuperación */
  recoverySupported: boolean;
  notes: StoredNote[];
  /** false si el Apps Script desplegado todavía no conoce la hoja "Notas" */
  notesSupported: boolean;
  /** Respuestas del formulario incluidas en la misma petición (null: Apps Script antiguo) */
  responses: FormResponse[] | null;
  /** true si el Apps Script ha respondido con su copia en caché */
  fromCache: boolean;
  /** Milisegundos de cada lectura en el Apps Script (si los da) */
  serverTimes?: Record<string, number>;
}

export interface FetchOptions {
  /** Solo los datos de esta convocatoria (la lista de convocatorias va completa) */
  callUpId?: string;
  /** Leer la hoja sin usar la copia en caché del Apps Script ("Sincronizar") */
  fresh?: boolean;
}

// Peticiones en curso: pulsar varias veces o montar dos vistas a la vez no repite la petición
const inflight = new Map<string, Promise<AllData>>();

function apiGet(opts: FetchOptions = {}): Promise<AllData> {
  const url = new URL(getAppsScriptUrl());
  if (opts.callUpId) url.searchParams.set("convocatoria", opts.callUpId);
  if (opts.fresh) url.searchParams.set("fresh", "1");
  const key = url.toString();
  const running = inflight.get(key);
  if (running) return running;
  const p = apiGetUrl(key).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function apiGetUrl(url: string): Promise<AllData> {
  const label = `[sync] GET ${url.includes("convocatoria=") ? "convocatoria" : "todo"} ${Date.now()}`;
  console.time(label);
  // Con copia sin conexión: si no hay red, se usan los últimos datos guardados
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await fetchAppsScriptJson<Record<string, any>>(url);
  console.timeEnd(label);
  if (data.tiempos) console.info("[sync] tiempos en el Apps Script (ms):", data.tiempos, data.desdeCache ? "(caché)" : "");

  const callUps: StoredCallUp[] = (data.callUps ?? [])
    .map((r: Record<string, string>) => ({
      id: r.id,
      name: r.nombre,
      startDate: r.fechaInicio,
      endDate: r.fechaFin,
      location: r.sede,
      status: (r.estado as StoredCallUp["status"]) || "En curso",
      notes: r.notas ?? "",
    }))
    .filter((c: StoredCallUp) => !!c.id);

  const sessions: StoredSession[] = (data.sessions ?? [])
    .map((r: Record<string, string>) => ({
      id: r.id,
      callUpId: r.convocatoriaId,
      date: r.fecha,
      dayLabel: (r.diaLabel as DayLabel) || "",
      type: (r.tipo as SessionType) || "TEC-TAC",
      duration: parseInt(r.duracion, 10) || 0,
    }))
    .filter((s: StoredSession) => !!s.id);

  const minutesSupported = Array.isArray(data.minutes);
  const minutes: StoredMinutes[] = (data.minutes ?? [])
    .map((r: Record<string, string>) => ({
      id: r.id,
      callUpId: r.convocatoriaId,
      sessionId: r.sesionId,
      date: parseToIsoDate(r.fecha) || r.fecha,
      jugador: (r.jugador ?? "").trim(),
      minutes: Number(String(r.minutos).replace(",", ".")),
      minutes1: toPart(r.minutos1),
      minutes2: toPart(r.minutos2),
    }))
    .filter(
      (m: StoredMinutes) =>
        !!m.id && !!m.jugador && isFinite(m.minutes) && m.minutes >= 0 && m.minutes <= 300,
    );

  const recoverySupported = Array.isArray(data.recovery);
  const recovery: StoredRecovery[] = (data.recovery ?? [])
    .map((r: Record<string, string | number>) => ({
      jugador: String(r.jugador ?? "").trim(),
      fecha: parseToIsoDate(String(r.fecha ?? "")),
      valor: Number(String(r.valor).replace(",", ".")),
      timestamp: String(r.timestamp ?? ""),
    }))
    .filter(
      (r: StoredRecovery) =>
        r.jugador && r.fecha && isFinite(r.valor) && r.valor >= 0 && r.valor <= 10,
    );

  const notesSupported = Array.isArray(data.notes);
  const notes: StoredNote[] = (data.notes ?? [])
    .map((r: Record<string, string>) => ({
      id: String(r.id ?? ""),
      callUpId: String(r.convocatoriaId ?? ""),
      jugador: String(r.jugador ?? "").trim(),
      orden: Number(r.orden) || 0,
      titulo: String(r.titulo ?? ""),
      texto: String(r.texto ?? ""),
      enInforme: String(r.enInforme) !== "0" && String(r.enInforme).toLowerCase() !== "false",
      actualizado: String(r.actualizado ?? ""),
    }))
    .filter((n: StoredNote) => n.id && n.jugador);

  const responses = Array.isArray(data.responses) ? mapScriptResponses(data.responses) : null;

  return {
    callUps,
    sessions,
    minutes,
    minutesSupported,
    recovery,
    recoverySupported,
    notes,
    notesSupported,
    responses,
    fromCache: !!data.desdeCache,
    serverTimes: data.tiempos,
  };
}

async function apiPost(
  action: "upsert" | "delete" | "batch",
  entity: "callup" | "session" | "response" | "responses" | "minutes" | "note",
  data: object,
): Promise<Record<string, unknown>> {
  // Sin conexión no se envía nada (nunca se encola ni se reintenta solo)
  if (isOffline()) throw new Error(OFFLINE_SAVE_MSG);
  const res = await fetch(getAppsScriptUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({ action, entity, data }),
  });
  if (!res.ok) throw new Error(`Apps Script POST falló: HTTP ${res.status}`);
  const result = await res.json();
  if (!result.ok) throw new Error(result.error ?? "Error desconocido en Apps Script");
  return result;
}

// ─── Fetch all data ───────────────────────────────────────────────────────────

export async function fetchAllData(opts: FetchOptions = {}): Promise<AllData> {
  return apiGet(opts);
}

// ─── Notas del cuerpo técnico ─────────────────────────────────────────────────

export function newNoteId(): string {
  return `n-${uid()}`;
}

/** Guarda (crea o actualiza) una nota. Devuelve la fecha-hora de guardado del servidor. */
export async function saveNote(note: Omit<StoredNote, "actualizado">): Promise<string> {
  const res = await apiPost("upsert", "note", {
    id: note.id,
    convocatoriaId: note.callUpId,
    jugador: note.jugador.trim(),
    orden: String(note.orden),
    titulo: note.titulo.slice(0, 80),
    texto: note.texto.slice(0, 2000),
    enInforme: note.enInforme ? "1" : "0",
  });
  return String(res.actualizado ?? new Date().toISOString());
}

export async function deleteNote(id: string): Promise<void> {
  await apiPost("delete", "note", { id });
}

// ─── Minutos de juego ─────────────────────────────────────────────────────────

/**
 * Guarda en bloque los minutos de una convocatoria.
 * `minutes: null` borra la fila de ese jugador en esa sesión.
 */
export async function saveMinutesBatch(
  rows: {
    callUpId: string;
    session: StoredSession;
    jugador: string;
    /** Total (se usa si no hay partes) */
    minutes: number | null;
    minutes1?: number | null;
    minutes2?: number | null;
  }[],
): Promise<void> {
  if (rows.length === 0) return;
  await apiPost("upsert", "minutes", {
    rows: rows.map((r) => ({
      id: minutesId(r.session.id, r.jugador),
      convocatoriaId: r.callUpId,
      sesionId: r.session.id,
      fecha: r.session.date,
      jugador: r.jugador.trim(),
      // Número, no texto: así Google Sheets no lo interpreta como fecha
      minutos: r.minutes === null ? "" : r.minutes,
      minutos1: r.minutes1 == null ? "" : r.minutes1,
      minutos2: r.minutes2 == null ? "" : r.minutes2,
    })),
  });
}

// ─── Call-up CRUD ─────────────────────────────────────────────────────────────

export async function saveCallUp(callUp: Omit<StoredCallUp, "id">): Promise<StoredCallUp> {
  const item: StoredCallUp = { ...callUp, id: uid() };
  await apiPost("upsert", "callup", {
    id: item.id,
    nombre: item.name,
    fechaInicio: item.startDate,
    fechaFin: item.endDate,
    sede: item.location,
    estado: item.status,
    notas: item.notes ?? "",
  });
  return item;
}

export async function updateCallUp(
  id: string,
  patch: Partial<StoredCallUp>,
  current: StoredCallUp,
): Promise<void> {
  const updated = { ...current, ...patch };
  await apiPost("upsert", "callup", {
    id: updated.id,
    nombre: updated.name,
    fechaInicio: updated.startDate,
    fechaFin: updated.endDate,
    sede: updated.location,
    estado: updated.status,
    notas: updated.notes ?? "",
  });
}

export async function deleteCallUp(id: string): Promise<void> {
  await apiPost("delete", "callup", { id });
}

// ─── Session CRUD ─────────────────────────────────────────────────────────────

export async function saveSession(session: Omit<StoredSession, "id">): Promise<StoredSession> {
  const item: StoredSession = { ...session, id: uid() };
  await apiPost("upsert", "session", {
    id: item.id,
    convocatoriaId: item.callUpId,
    fecha: item.date,
    diaLabel: item.dayLabel,
    tipo: item.type,
    duracion: String(item.duration),
  });
  return item;
}

export async function deleteSession(id: string): Promise<void> {
  await apiPost("delete", "session", { id });
}

export async function updateSession(session: StoredSession): Promise<void> {
  await apiPost("upsert", "session", {
    id: session.id,
    convocatoriaId: session.callUpId,
    fecha: session.date,
    diaLabel: session.dayLabel,
    tipo: session.type,
    duracion: String(session.duration),
  });
}

export async function savePlayerResponse(data: {
  jugador: string;
  fecha: string;
  fatigue: number;
  rpe: number;
}): Promise<void> {
  await apiPost("upsert", "response", data);
}

/** Un cambio de la edición en bloque (ver batchResponses_ en el Apps Script) */
export interface ResponseChange {
  jugador: string;
  fecha: string;
  fatigue?: number;
  rpe?: number;
  /** Respuesta existente: fila de la hoja y/o marca temporal */
  fila?: number;
  timestamp?: string;
  /** Respuesta nueva: marca temporal que la coloca en su sesión */
  marcaTemporal?: string;
  borrar?: boolean;
}

export interface BatchResult {
  /** Resultado de cada cambio, en el mismo orden */
  results: { i: number; ok: boolean; error?: string }[];
  /** Respuestas del rango ya actualizadas (para no recargar todo) */
  responses: FormResponse[] | null;
}

/**
 * Guarda varios cambios de respuestas en UNA petición. `desde`/`hasta` (aaaa-mm-dd):
 * rango del que el Apps Script devuelve las respuestas actualizadas.
 */
export async function saveResponsesBatch(
  rows: ResponseChange[],
  rango?: { desde: string; hasta: string },
): Promise<BatchResult> {
  let res: Record<string, unknown>;
  try {
    res = await apiPost("batch", "responses", { rows, ...rango });
  } catch (e) {
    if (/Entidad no reconocida/.test(String(e)))
      throw new Error(
        "El Apps Script publicado no admite guardar en bloque: publica la nueva versión de Code.gs.",
      );
    throw e;
  }
  return {
    results: (res.results as BatchResult["results"]) ?? rows.map((_, i) => ({ i, ok: true })),
    responses: Array.isArray(res.responses) ? mapScriptResponses(res.responses) : null,
  };
}

export async function deletePlayerResponse(data: {
  jugador: string;
  fecha: string;
}): Promise<void> {
  await apiPost("delete", "response", { jugador: data.jugador, fecha: data.fecha });
}

/** Human-readable label for a session */
export function sessionLabel(s: StoredSession): string {
  const dateStr = formatDateShort(s.date);
  const suffix = s.dayLabel ? ` ${s.dayLabel}` : "";
  return `${dateStr}${suffix} — ${s.type}`;
}

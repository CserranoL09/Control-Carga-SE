/**
 * Sheets Store — sin localStorage, sin caché.
 * Todas las operaciones van directamente a la Google Apps Script Web App.
 *
 * Hoja "Convocatorias": id | nombre | fechaInicio | fechaFin | sede | estado | notas
 * Hoja "Sesiones":      id | convocatoriaId | fecha | diaLabel | tipo | duracion
 */

import { parseToIsoDate, formatDateShort } from "./date-utils";
import { getAppsScriptUrl } from "./config";
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
  minutes: number;
}

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
}

async function apiGet(): Promise<AllData> {
  const res = await fetch(getAppsScriptUrl(), { cache: "no-cache" });
  if (!res.ok) throw new Error(`Apps Script GET falló: HTTP ${res.status}`);
  const data = await res.json();

  const callUps: StoredCallUp[] = (data.callUps ?? []).map((r: Record<string, string>) => ({
    id: r.id,
    name: r.nombre,
    startDate: r.fechaInicio,
    endDate: r.fechaFin,
    location: r.sede,
    status: (r.estado as StoredCallUp["status"]) || "En curso",
    notes: r.notas ?? "",
  })).filter((c: StoredCallUp) => !!c.id);

  const sessions: StoredSession[] = (data.sessions ?? []).map((r: Record<string, string>) => ({
    id: r.id,
    callUpId: r.convocatoriaId,
    date: r.fecha,
    dayLabel: (r.diaLabel as DayLabel) || "",
    type: (r.tipo as SessionType) || "TEC-TAC",
    duration: parseInt(r.duracion, 10) || 0,
  })).filter((s: StoredSession) => !!s.id);

  const minutesSupported = Array.isArray(data.minutes);
  const minutes: StoredMinutes[] = (data.minutes ?? []).map((r: Record<string, string>) => ({
    id: r.id,
    callUpId: r.convocatoriaId,
    sessionId: r.sesionId,
    date: parseToIsoDate(r.fecha) || r.fecha,
    jugador: (r.jugador ?? "").trim(),
    minutes: Number(String(r.minutos).replace(",", ".")),
  })).filter((m: StoredMinutes) =>
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
    .filter((r: StoredRecovery) => r.jugador && r.fecha && isFinite(r.valor) && r.valor >= 0 && r.valor <= 10);

  return { callUps, sessions, minutes, minutesSupported, recovery, recoverySupported };
}

async function apiPost(action: "upsert" | "delete", entity: "callup" | "session" | "response" | "minutes", data: object) {
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
}

// ─── Fetch all data ───────────────────────────────────────────────────────────

export async function fetchAllData(): Promise<AllData> {
  return apiGet();
}

// ─── Minutos de juego ─────────────────────────────────────────────────────────

/**
 * Guarda en bloque los minutos de una convocatoria.
 * `minutes: null` borra la fila de ese jugador en esa sesión.
 */
export async function saveMinutesBatch(
  rows: { callUpId: string; session: StoredSession; jugador: string; minutes: number | null }[],
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

export async function updateCallUp(id: string, patch: Partial<StoredCallUp>, current: StoredCallUp): Promise<void> {
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

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

async function apiGet(): Promise<{ callUps: StoredCallUp[]; sessions: StoredSession[] }> {
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

  console.log("Loaded sessions:", sessions);
  console.log("Loaded call-ups:", callUps);

  return { callUps, sessions };
}

async function apiPost(action: "upsert" | "delete", entity: "callup" | "session" | "response", data: object) {
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

export async function fetchAllData(): Promise<{ callUps: StoredCallUp[]; sessions: StoredSession[] }> {
  return apiGet();
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

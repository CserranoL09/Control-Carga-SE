// Mock data for the SE-FS load control MVP
import { getLoadThresholds } from "./store";

export type SessionType = "TEC-TAC" | "PARTIDO" | "LIBRE";

export interface Player {
  id: string;
  name: string;
  number: number;
  position: string;
  /** Ruta opcional a la foto (p. ej. "/jugadores/otra-foto.png") si no sigue la regla del nombre */
  photo?: string;
}

export interface Session {
  id: string;
  callUpId: string;
  date: string; // ISO
  type: SessionType;
  duration: number; // minutes
  label: string;
}

export interface PlayerSessionRecord {
  sessionId: string;
  playerId: string;
  rpe: number; // 1-10
  fatigue: number; // 1-10
}

export interface CallUp {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: "En curso" | "Finalizada";
  location: string;
}

export const players: Player[] = [
  { id: "p1", name: "Didac Plana", number: 1, position: "Portero" },
  { id: "p2", name: "Jesús Herrero", number: 12, position: "Portero" },
  { id: "p3", name: "Raya", number: 2, position: "Cierre" },
  { id: "p4", name: "Cecilio", number: 3, position: "Cierre" },
  { id: "p5", name: "Mellado", number: 4, position: "Ala" },
  { id: "p6", name: "Pol Pacheco", number: 5, position: "Ala" },
  { id: "p7", name: "Adolfo", number: 7, position: "Ala" },
  { id: "p8", name: "Marc Tolrà", number: 8, position: "Ala" },
  { id: "p9", name: "Catela", number: 9, position: "Pívot" },
  { id: "p10", name: "Mati Rosa", number: 10, position: "Pívot" },
  { id: "p11", name: "Sergio Lozano", number: 11, position: "Pívot" },
  { id: "p12", name: "Chino", number: 14, position: "Ala" },
];

export const callUps: CallUp[] = [
  {
    id: "c1",
    name: "Ventana Mundial — Marzo 26",
    startDate: "2026-03-21",
    endDate: "2026-03-29",
    status: "En curso",
    location: "CAR Las Rozas",
  },
  {
    id: "c2",
    name: "Amistosos Internacionales — Enero 26",
    startDate: "2026-01-12",
    endDate: "2026-01-19",
    status: "Finalizada",
    location: "Guadalajara",
  },
  {
    id: "c3",
    name: "Eurocopa Preparación — Nov 25",
    startDate: "2025-11-08",
    endDate: "2025-11-17",
    status: "Finalizada",
    location: "Madrid",
  },
];

function seedRand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function buildSessionsFor(callUp: CallUp): Session[] {
  const start = new Date(callUp.startDate);
  const end = new Date(callUp.endDate);
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const rand = seedRand(callUp.id.charCodeAt(1) * 137);
  const sessions: Session[] = [];
  for (let d = 0; d < days; d++) {
    const day = new Date(start);
    day.setDate(start.getDate() + d);
    const isMatch = d === Math.floor(days / 2) || d === days - 2;
    if (isMatch) {
      sessions.push({
        id: `${callUp.id}-s${d}-m`,
        callUpId: callUp.id,
        date: day.toISOString().slice(0, 10),
        type: "PARTIDO",
        duration: 50,
        label: `Partido ${sessions.filter((s) => s.type === "PARTIDO").length + 1}`,
      });
    } else if (d === 0) {
      sessions.push({
        id: `${callUp.id}-s${d}-l`,
        callUpId: callUp.id,
        date: day.toISOString().slice(0, 10),
        type: "LIBRE",
        duration: 30,
        label: "Activación",
      });
    } else {
      const morning = rand() > 0.4;
      sessions.push({
        id: `${callUp.id}-s${d}-a`,
        callUpId: callUp.id,
        date: day.toISOString().slice(0, 10),
        type: "TEC-TAC",
        duration: 60 + Math.floor(rand() * 30),
        label: `TEC-TAC ${morning ? "AM" : "PM"}`,
      });
      if (rand() > 0.6) {
        sessions.push({
          id: `${callUp.id}-s${d}-b`,
          callUpId: callUp.id,
          date: day.toISOString().slice(0, 10),
          type: "TEC-TAC",
          duration: 45,
          label: "TEC-TAC PM",
        });
      }
    }
  }
  return sessions;
}

export const sessions: Session[] = callUps.flatMap(buildSessionsFor);

export const records: PlayerSessionRecord[] = (() => {
  const out: PlayerSessionRecord[] = [];
  for (const s of sessions) {
    const rand = seedRand(s.id.length * 31 + s.date.charCodeAt(8));
    for (const p of players) {
      // some randomness per player
      const baseRpe = s.type === "PARTIDO" ? 8 : s.type === "LIBRE" ? 3 : 5 + rand() * 2;
      const baseFat = s.type === "PARTIDO" ? 7 : s.type === "LIBRE" ? 2 : 4 + rand() * 2;
      const rpe = Math.max(1, Math.min(10, Math.round(baseRpe + (rand() - 0.5) * 2)));
      const fatigue = Math.max(1, Math.min(10, Math.round(baseFat + (rand() - 0.5) * 2)));
      out.push({ sessionId: s.id, playerId: p.id, rpe, fatigue });
    }
  }
  return out;
})();

// ---- Metric helpers ----
export function getCallUp(id: string) {
  return callUps.find((c) => c.id === id);
}
export function sessionsOf(callUpId: string) {
  return sessions
    .filter((s) => s.callUpId === callUpId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
export function recordsOf(sessionId: string) {
  return records.filter((r) => r.sessionId === sessionId);
}
export function playerRecordsIn(callUpId: string, playerId: string) {
  const sids = new Set(sessionsOf(callUpId).map((s) => s.id));
  return records.filter((r) => r.playerId === playerId && sids.has(r.sessionId));
}

export function ua(rpe: number, duration: number) {
  return rpe * duration;
}

export function avg(arr: number[]) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
export function std(arr: number[]) {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  return Math.sqrt(avg(arr.map((v) => (v - m) ** 2)));
}

export function loadStatus(uaValue: number): "optimo" | "moderado" | "riesgo" {
  const { optimo, moderado } = getLoadThresholds();
  if (uaValue < optimo) return "optimo";
  if (uaValue < moderado) return "moderado";
  return "riesgo";
}

export function acStatus(ratio: number): "optimo" | "moderado" | "riesgo" {
  if (ratio >= 0.8 && ratio <= 1.3) return "optimo";
  if (ratio < 0.8 || (ratio > 1.3 && ratio <= 1.5)) return "moderado";
  return "riesgo";
}

export function statusColor(s: "optimo" | "moderado" | "riesgo") {
  return s === "optimo" ? "var(--success)" : s === "moderado" ? "var(--warning)" : "var(--danger)";
}

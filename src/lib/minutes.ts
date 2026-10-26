/**
 * Utilidades para los minutos de juego introducidos manualmente.
 * Se guardan como minutos decimales (23.75 = 23:45).
 */

import { samePlayer, type StoredMinutes } from "./store";

/** Acepta "23", "23,5", "23.5" o "23:45". Devuelve null si está vacío y NaN si no es válido. */
export function parseMinutesInput(raw: string): number | null {
  const v = raw.trim();
  if (v === "") return null;
  const mmss = v.match(/^(\d{1,3}):([0-5]?\d)$/);
  if (mmss) return +(parseInt(mmss[1], 10) + parseInt(mmss[2], 10) / 60).toFixed(2);
  const n = Number(v.replace(",", "."));
  if (!isFinite(n) || n < 0 || n > 300) return NaN;
  return +n.toFixed(2);
}

/** 23.75 → "23:45" */
export function formatMinutes(value: number): string {
  const totalSec = Math.round(value * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export interface PlayerMinutesSummary {
  total: number;
  matchesPlayed: number;
  average: number;
  bySession: Record<string, number>;
}

export function playerMinutesSummary(jugador: string, minutes: StoredMinutes[]): PlayerMinutesSummary {
  const own = minutes.filter((m) => samePlayer(m.jugador, jugador));
  const bySession: Record<string, number> = {};
  for (const m of own) bySession[m.sessionId] = m.minutes;
  const played = own.filter((m) => m.minutes > 0);
  const total = played.reduce((acc, m) => acc + m.minutes, 0);
  return {
    total,
    matchesPlayed: played.length,
    average: played.length ? total / played.length : 0,
    bySession,
  };
}

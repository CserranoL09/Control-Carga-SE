/**
 * Load metrics engine
 * Calculates all sports-science metrics from raw form responses + session data.
 *
 * Metrics implemented:
 *  - Fatiga media sesión
 *  - UA (Fatiga × Tiempo) por sesión
 *  - Fatiga media semanal
 *  - Desviación estándar
 *  - Índice de Monotonía = UA_media / σ
 *  - Índice de Fatiga = Monotonía × UA_total_semanal
 *  - Fatiga Aguda (rolling 7d window)
 *  - Fatiga Crónica (rolling 28d window)
 *  - Ratio ACWR = Aguda / Crónica
 */

import type { FormResponse } from "./sheets-service";
import { getLoadThresholds, type StoredSession } from "./store";

// ─── Basic math ──────────────────────────────────────────────────────────────

export function avg(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  return Math.sqrt(avg(arr.map((v) => (v - m) ** 2)));
}

export function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

// ─── Per-session metrics ──────────────────────────────────────────────────────

export interface SessionMetrics {
  sessionId: string;
  date: string;
  dayLabel: string;
  type: string;
  duration: number;
  /** Number of responses for this session */
  responseCount: number;
  /** Average fatigue across all players who responded */
  fatigaMedia: number;
  /** Average RPE across all players who responded */
  rpeMedia: number;
  /** Fatiga × Tiempo (UA) using fatigue as the RPE proxy */
  fatigaXTiempo: number;
  /** RPE × Tiempo (UA) */
  rpeXTiempo: number;
  /** Per-player UA values (for heatmap etc.) */
  playerUA: Record<string, number>;
  /** Per-player RPE workload (UA) values */
  playerRpeUA: Record<string, number>;
  /** Per-player fatigue */
  playerFatigue: Record<string, number>;
  /** Per-player RPE */
  playerRPE: Record<string, number>;
  /** Respuesta de cada jugador en la hoja (para editarla o borrarla exactamente) */
  playerRef: Record<string, { fila?: number; timestamp: string }>;
  /** Posición de la sesión en su día (0 = primera) y nº de sesiones ese día */
  slot: { index: number; total: number };
}

/**
 * Computes per-session metrics by joining session data with form responses.
 * Matches responses by date.
 */
export function parseTimestampToMs(ts: string): number {
  if (!ts) return 0;
  // "5/11/2026, 16:54:00" (con coma) → sin coma
  const trimmed = ts.trim().replace(/^(\d{1,2}\/\d{1,2}\/\d{4}),\s*/, "$1 ");
  // ISO con hora ("2026-11-05T15:54:00.000Z"): lo que devuelve el Apps Script para las
  // celdas de fecha. Sin esto quedaban a medianoche y las respuestas nuevas añadidas
  // desde la app se ordenaban mal respecto a las del Form.
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    const ms = Date.parse(trimmed);
    if (!Number.isNaN(ms)) return ms;
  }
  // 1. dd/mm/yyyy hh:mm:ss or d/m/yyyy h:m:s
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (slashMatch) {
    const [, d, m, y, hr = "0", min = "0", sec = "0"] = slashMatch;
    return new Date(
      parseInt(y, 10),
      parseInt(m, 10) - 1,
      parseInt(d, 10),
      parseInt(hr, 10),
      parseInt(min, 10),
      parseInt(sec, 10)
    ).getTime();
  }

  // 2. yyyy-mm-dd hh:mm:ss
  const dashMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (dashMatch) {
    const [, y, m, d, hr = "0", min = "0", sec = "0"] = dashMatch;
    return new Date(
      parseInt(y, 10),
      parseInt(m, 10) - 1,
      parseInt(d, 10),
      parseInt(hr, 10),
      parseInt(min, 10),
      parseInt(sec, 10)
    ).getTime();
  }

  const parsed = new Date(trimmed);
  return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export function sortSessions(sessions: StoredSession[]): StoredSession[] {
  const priority: Record<string, number> = {
    "M": 1,
    "M-T": 2,
    "": 3,
    "T": 4
  };
  return [...sessions].sort((a, b) => {
    const dateComp = a.date.localeCompare(b.date);
    if (dateComp !== 0) return dateComp;
    const priorityA = priority[a.dayLabel] ?? 99;
    const priorityB = priority[b.dayLabel] ?? 99;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Computes per-session metrics by joining session data with form responses.
 * Matches responses chronologically by order of submission on each day.
 */
export function calcSessionMetrics(
  sessions: StoredSession[],
  responses: FormResponse[],
): SessionMetrics[] {
  const sortedSessions = sortSessions(sessions);

  return sortedSessions.map((s) => {
    // Find index of session `s` on its date
    const daySessions = sortedSessions.filter((x) => x.date === s.date);
    const sessionIndex = daySessions.indexOf(s);

    const playerUA: Record<string, number> = {};
    const playerRpeUA: Record<string, number> = {};
    const playerFatigue: Record<string, number> = {};
    const playerRPE: Record<string, number> = {};
    const playerRef: SessionMetrics["playerRef"] = {};

    // Group responses of this day by player
    const dayResponses = responses.filter((r) => r.fecha === s.date);
    const playerResponsesMap: Record<string, FormResponse[]> = {};
    for (const r of dayResponses) {
      if (!playerResponsesMap[r.jugador]) {
        playerResponsesMap[r.jugador] = [];
      }
      playerResponsesMap[r.jugador].push(r);
    }

    const matchedResponses: FormResponse[] = [];
    for (const player in playerResponsesMap) {
      const playerDayResponses = playerResponsesMap[player];
      // Sort responses chronologically by timestamp
      playerDayResponses.sort((a, b) => parseTimestampToMs(a.timestamp) - parseTimestampToMs(b.timestamp));

      // Match by index
      if (sessionIndex < playerDayResponses.length) {
        matchedResponses.push(playerDayResponses[sessionIndex]);
      }
    }

    for (const r of matchedResponses) {
      playerFatigue[r.jugador] = r.fatigue;
      playerRPE[r.jugador] = r.rpe;
      playerUA[r.jugador] = r.fatigue * s.duration;
      playerRpeUA[r.jugador] = r.rpe * s.duration;
      playerRef[r.jugador] = { fila: r.fila, timestamp: r.timestamp };
    }

    const fatigues = matchedResponses.map((r) => r.fatigue);
    const rpes = matchedResponses.map((r) => r.rpe);
    const fatigaMedia = avg(fatigues);
    const rpeMedia = avg(rpes);
    const fatigaXTiempo = fatigaMedia * s.duration;
    const rpeXTiempo = rpeMedia * s.duration;

    return {
      sessionId: s.id,
      date: s.date,
      dayLabel: s.dayLabel,
      type: s.type,
      duration: s.duration,
      responseCount: matchedResponses.length,
      fatigaMedia: +fatigaMedia.toFixed(2),
      rpeMedia: +rpeMedia.toFixed(2),
      fatigaXTiempo: +fatigaXTiempo.toFixed(0),
      rpeXTiempo: +rpeXTiempo.toFixed(0),
      playerUA,
      playerRpeUA,
      playerFatigue,
      playerRPE,
      playerRef,
      slot: { index: sessionIndex, total: daySessions.length },
    };
  });
}

// ─── Weekly aggregate metrics ─────────────────────────────────────────────────

export interface WeeklyMetrics {
  /** UA values for each session in the window */
  uaValues: number[];
  uaTotal: number;
  uaMedia: number;
  desviacionEstandar: number;
  indiceDeMonotonia: number;
  indiceDeFatiga: number;
}

export function calcWeeklyMetrics(uaValuesThisWeek: number[]): WeeklyMetrics {
  const uaTotal = sum(uaValuesThisWeek);
  const uaMedia = avg(uaValuesThisWeek);
  const desviacionEstandar = std(uaValuesThisWeek);
  const indiceDeMonotonia = desviacionEstandar > 0 ? uaMedia / desviacionEstandar : 0;
  const indiceDeFatiga = indiceDeMonotonia * uaTotal;

  return {
    uaValues: uaValuesThisWeek,
    uaTotal: +uaTotal.toFixed(0),
    uaMedia: +uaMedia.toFixed(0),
    desviacionEstandar: +desviacionEstandar.toFixed(0),
    indiceDeMonotonia: +indiceDeMonotonia.toFixed(2),
    indiceDeFatiga: +indiceDeFatiga.toFixed(0),
  };
}

// ─── ACWR (Acute:Chronic Workload Ratio) ──────────────────────────────────────

export interface ACWRMetrics {
  /** Acute workload = avg of last 7 days (or fewer if not enough data) */
  fatigaAguda: number;
  /** Chronic workload = avg of last 28 days (or fewer if not enough data) */
  fatiguaCronica: number;
  /** ACWR ratio */
  ratioACWR: number;
}

/**
 * Computes cumulative ACWR at each session index using Exponential Weighted Moving Average (EWM).
 *
 * Formula (matching Excel = FatigaSesion*(2/(2+1)) + (1-(2/(5+1)))*FatigaCronicaAnterior):
 *   alpha_aguda   = 2 / (5  + 1) = 1/3  → ventana corta  ~5 sesiones
 *   alpha_cronica = 2 / (28 + 1)        → ventana larga  ~28 sesiones
 *
 *   FatigaAguda[i]   = UA[i] * alpha_aguda   + (1 - alpha_aguda)   * FatigaAguda[i-1]
 *   FatigaCronica[i] = UA[i] * alpha_cronica + (1 - alpha_cronica) * FatigaCronica[i-1]
 *   ACWR[i] = FatigaAguda[i] / FatigaCronica[i]
 */
export function calcACWRSeries<T extends { date: string; ua: number }>(
  uaSeries: T[],
): Array<T & { aguda: number; cronica: number; acwr: number }> {
  if (uaSeries.length === 0) return [];

  // EWM smoothing factors
  const alphaAguda = 2 / (2 + 1);   // ≈ 0.333
  const alphaCronica = 2 / (5 + 1);   // ≈ 0.067

  // Use the first session's UA as the initial state for both EMAs.
  // Fallback to the dynamic optimo threshold if the first UA is 0.
  const firstUA = uaSeries[0]?.ua || getLoadThresholds().optimo;

  let emaAguda = firstUA;
  let emaCronica = firstUA;

  return uaSeries.map((item, i) => {
    if (i === 0) {
      // First point: initialise both EMAs with the first real UA value.
      emaAguda = item.ua || firstUA;
      emaCronica = item.ua || firstUA;
    } else {
      emaAguda = item.ua * alphaAguda + (1 - alphaAguda) * emaAguda;
      emaCronica = item.ua * alphaCronica + (1 - alphaCronica) * emaCronica;
    }

    const acwr = emaCronica > 0 ? emaAguda / emaCronica : 0;

    return {
      ...item,
      aguda: +emaAguda.toFixed(0),
      cronica: +emaCronica.toFixed(0),
      acwr: +acwr.toFixed(2),
    };
  });
}

// ─── Per-player metrics ───────────────────────────────────────────────────────

export interface PlayerCallUpMetrics {
  jugador: string;
  responseCount: number;
  fatigaMedia: number;
  rpeMedia: number;
  uaTotal: number;
  uaMax: number;
  uaMedia: number;
  desviacionEstandar: number;
  indiceDeMonotonia: number;
  indiceDeFatiga: number;
  fatigaAguda: number;
  fatiguaCronica: number;
  ratioACWR: number;
}

export function calcPlayerCallUpMetrics(
  jugador: string,
  sessions: StoredSession[],
  responses: FormResponse[],
): PlayerCallUpMetrics {
  const playerResponses = responses.filter((r) => r.jugador === jugador);
  const sortedSessions = sortSessions(sessions);

  // Join with sessions
  const sessionedData = sortedSessions
    .map((s) => {
      // Find index of session `s` on its date
      const daySessions = sortedSessions.filter((x) => x.date === s.date);
      const sessionIndex = daySessions.indexOf(s);

      // Find responses of this player on this date, sort them by timestamp
      const playerDayResponses = playerResponses.filter((r) => r.fecha === s.date);
      playerDayResponses.sort((a, b) => parseTimestampToMs(a.timestamp) - parseTimestampToMs(b.timestamp));

      // Match by index
      const r = playerDayResponses[sessionIndex];
      if (!r) return null;

      return {
        date: s.date,
        fatigue: r.fatigue,
        rpe: r.rpe,
        ua: r.fatigue * s.duration,
        duration: s.duration,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (!sessionedData.length) {
    return {
      jugador,
      responseCount: 0,
      fatigaMedia: 0,
      rpeMedia: 0,
      uaTotal: 0,
      uaMax: 0,
      uaMedia: 0,
      desviacionEstandar: 0,
      indiceDeMonotonia: 0,
      indiceDeFatiga: 0,
      fatigaAguda: 0,
      fatiguaCronica: 0,
      ratioACWR: 0,
    };
  }

  const uaValues = sessionedData.map((d) => d.ua);
  const uaTotal = sum(uaValues);
  const uaMedia = avg(uaValues);
  const desviacionEstandar = std(uaValues);
  const indiceDeMonotonia = desviacionEstandar > 0 ? uaMedia / desviacionEstandar : 0;
  const indiceDeFatiga = indiceDeMonotonia * uaTotal;

  // ACWR using the last element in the series
  const uaSeries = sessionedData.map((d) => ({ date: d.date, ua: d.ua }));
  const acwrSeries = calcACWRSeries(uaSeries);
  const lastACWR = acwrSeries[acwrSeries.length - 1];

  return {
    jugador,
    responseCount: sessionedData.length,
    fatigaMedia: +avg(sessionedData.map((d) => d.fatigue)).toFixed(2),
    rpeMedia: +avg(sessionedData.map((d) => d.rpe)).toFixed(2),
    uaTotal: +uaTotal.toFixed(0),
    uaMax: Math.max(...uaValues),
    uaMedia: +uaMedia.toFixed(0),
    desviacionEstandar: +desviacionEstandar.toFixed(0),
    indiceDeMonotonia: +indiceDeMonotonia.toFixed(2),
    indiceDeFatiga: +indiceDeFatiga.toFixed(0),
    fatigaAguda: lastACWR?.aguda ?? 0,
    fatiguaCronica: lastACWR?.cronica ?? 0,
    ratioACWR: lastACWR?.acwr ?? 0,
  };
}

// ─── Status helpers ───────────────────────────────────────────────────────────

export function acwrStatus(ratio: number): "optimo" | "moderado" | "riesgo" {
  if (ratio >= 0.8 && ratio <= 1.3) return "optimo";
  if (ratio < 0.8 || (ratio > 1.3 && ratio <= 1.5)) return "moderado";
  return "riesgo";
}

export function uaStatus(ua: number): "optimo" | "moderado" | "riesgo" {
  const { optimo, moderado } = getLoadThresholds();
  if (ua < optimo) return "optimo";
  if (ua < moderado) return "moderado";
  return "riesgo";
}

export function statusColor(s: "optimo" | "moderado" | "riesgo"): string {
  return s === "optimo"
    ? "var(--success)"
    : s === "moderado"
      ? "var(--warning)"
      : "var(--danger)";
}

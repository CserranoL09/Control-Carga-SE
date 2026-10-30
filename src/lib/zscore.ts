/**
 * Z-scores de fatiga y carga por sesión (equivalente a la hoja "BBDD FATIGA-CARGA").
 *
 * Para cada sesión se compara a cada jugador con el grupo de esa misma sesión:
 *   z = (valor del jugador − media de la sesión) / desviación estándar muestral (n − 1)
 *
 * Carga individual = RPE × tiempo. En los partidos el tiempo son los minutos jugados
 * (hoja "Minutos"); si un jugador no tiene minutos registrados se usa la duración
 * de la sesión y la fila se marca con `sinMinutos`.
 *
 * Funciones puras, sin React, para poder reutilizarlas (p. ej. en el informe PDF).
 */
import type { SessionMetrics } from "./metrics";
import { samePlayer, type StoredMinutes } from "./store";

/** Mínimo de respuestas en una sesión para calcular z-scores */
export const MIN_RESPONSES_FOR_Z = 3;

export interface ZRow {
  jugador: string;
  rpe: number;
  fatiga: number;
  /** Minutos usados para la carga (duración o minutos jugados) */
  tiempo: number;
  cargaIndividual: number;
  zFatiga: number | null;
  zCarga: number | null;
  /** Partido sin minutos registrados para el jugador: se usó la duración */
  sinMinutos: boolean;
}

export interface ZSession {
  sessionId: string;
  date: string;
  dayLabel: string;
  type: string;
  duration: number;
  isMatch: boolean;
  rows: ZRow[];
  /** Fila PROMEDIO */
  mediaRpe: number;
  mediaFatiga: number;
  /** Carga sesión = media de las cargas individuales */
  cargaSesion: number;
  sdFatiga: number;
  sdCarga: number;
  /** false si hay menos de MIN_RESPONSES_FOR_Z respuestas */
  hasZ: boolean;
}

export interface ZPlayerSummary {
  jugador: string;
  sesiones: number;
  zMedioFatiga: number | null;
  zMedioCarga: number | null;
  fatigaSobre1: number;
  fatigaSobre2: number;
  cargaSobre1: number;
  cargaSobre2: number;
  zUltimaFatiga: number | null;
  zUltimaCarga: number | null;
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** Desviación estándar muestral (n − 1) */
export function sampleSd(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1));
}

export function zScore(value: number, m: number, sd: number): number {
  return sd > 0 ? (value - m) / sd : 0;
}

/** Calcula los z-score de todas las sesiones con duración > 0. */
export function calcZSessions(
  sessionMetrics: SessionMetrics[],
  minutes: StoredMinutes[],
): ZSession[] {
  return sessionMetrics
    .filter((s) => s.duration > 0)
    .map((s) => {
      const isMatch = s.type.includes("PARTIDO"); // mismo criterio que isMatchSession
      const sessionMinutes = minutes.filter((m) => m.sessionId === s.sessionId);

      const players = Object.keys(s.playerRPE).filter((j) => s.playerFatigue[j] !== undefined);
      const base = players.map((jugador) => {
        const rpe = s.playerRPE[jugador];
        const fatiga = s.playerFatigue[jugador];
        const played = isMatch
          ? sessionMinutes.find((m) => samePlayer(m.jugador, jugador))
          : undefined;
        const tiempo = played ? played.minutes : s.duration;
        return {
          jugador,
          rpe,
          fatiga,
          tiempo,
          cargaIndividual: rpe * tiempo,
          sinMinutos: isMatch && !played,
        };
      });

      const fatigas = base.map((r) => r.fatiga);
      const cargas = base.map((r) => r.cargaIndividual);
      const mediaFatiga = mean(fatigas);
      const cargaSesion = mean(cargas);
      const sdFatiga = sampleSd(fatigas);
      const sdCarga = sampleSd(cargas);
      const hasZ = base.length >= MIN_RESPONSES_FOR_Z;

      const rows: ZRow[] = base
        .map((r) => ({
          ...r,
          zFatiga: hasZ ? zScore(r.fatiga, mediaFatiga, sdFatiga) : null,
          zCarga: hasZ ? zScore(r.cargaIndividual, cargaSesion, sdCarga) : null,
        }))
        .sort((a, b) => a.jugador.localeCompare(b.jugador, "es"));

      return {
        sessionId: s.sessionId,
        date: s.date,
        dayLabel: s.dayLabel,
        type: s.type,
        duration: s.duration,
        isMatch,
        rows,
        mediaRpe: mean(base.map((r) => r.rpe)),
        mediaFatiga,
        cargaSesion,
        sdFatiga,
        sdCarga,
        hasZ,
      };
    });
}

/** Resumen por jugador a lo largo de la convocatoria. */
export function calcZPlayerSummary(zSessions: ZSession[], players: string[]): ZPlayerSummary[] {
  return players.map((jugador) => {
    const own = zSessions
      .map((s) => s.rows.find((r) => r.jugador === jugador))
      .filter((r): r is ZRow => !!r);
    const zf = own.map((r) => r.zFatiga).filter((v): v is number => v !== null);
    const zc = own.map((r) => r.zCarga).filter((v): v is number => v !== null);
    const last = [...own].reverse().find((r) => r.zFatiga !== null || r.zCarga !== null);
    return {
      jugador,
      sesiones: own.length,
      zMedioFatiga: zf.length ? mean(zf) : null,
      zMedioCarga: zc.length ? mean(zc) : null,
      fatigaSobre1: zf.filter((v) => v >= 1).length,
      fatigaSobre2: zf.filter((v) => v >= 2).length,
      cargaSobre1: zc.filter((v) => v >= 1).length,
      cargaSobre2: zc.filter((v) => v >= 2).length,
      zUltimaFatiga: last?.zFatiga ?? null,
      zUltimaCarga: last?.zCarga ?? null,
    };
  });
}

/** 1 decimal con coma decimal; "—" si no hay valor */
export function fmtZ(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  const r = Math.round(v * 10) / 10;
  return (Object.is(r, -0) ? 0 : r).toFixed(1).replace(".", ",");
}

export function fmtNum(v: number, decimals = 0): string {
  return v.toFixed(decimals).replace(".", ",");
}

export type ZBand = "muy-bajo" | "bajo" | "normal" | "alto" | "muy-alto";

export function zBand(z: number | null): ZBand | null {
  if (z === null) return null;
  if (z <= -2) return "muy-bajo";
  if (z <= -1) return "bajo";
  if (z < 1) return "normal";
  if (z < 2) return "alto";
  return "muy-alto";
}

/** CSV con separador ";" y coma decimal (Excel en español) */
export function zSessionsToCsv(zSessions: ZSession[], players?: string[]): string {
  const header = [
    "FECHA",
    "TIPO SESION",
    "JUGADOR",
    "RPE (INTENSIDAD)",
    "TIEMPO SESIÓN (min)",
    "FATIGA (1-10)",
    "CARGA sesión (RPE x tiempo)",
    "Carga individual (RPE x tiempo)",
    "Z-SCORE FATIGA INDIVIDUAL",
    "Z-SCORE CARGA INDIVIDUAL (INTENSIDAD)",
  ];
  const fecha = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };
  const cell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [header.join(";")];
  for (const s of zSessions) {
    const label = fecha(s.date) + (s.dayLabel ? ` ${s.dayLabel}` : "");
    const rows = players ? s.rows.filter((r) => players.includes(r.jugador)) : s.rows;
    for (const r of rows) {
      lines.push(
        [
          label,
          s.type,
          r.jugador,
          fmtNum(r.rpe),
          fmtNum(r.tiempo, Number.isInteger(r.tiempo) ? 0 : 2),
          fmtNum(r.fatiga),
          fmtNum(s.cargaSesion),
          fmtNum(r.cargaIndividual),
          r.zFatiga === null ? "" : fmtZ(r.zFatiga),
          r.zCarga === null ? "" : fmtZ(r.zCarga),
        ]
          .map(cell)
          .join(";"),
      );
    }
    lines.push(
      [
        label,
        s.type,
        "PROMEDIO",
        fmtNum(s.mediaRpe),
        fmtNum(s.duration),
        fmtNum(s.mediaFatiga),
        fmtNum(s.cargaSesion),
        fmtNum(s.cargaSesion),
        "",
        "",
      ]
        .map(cell)
        .join(";"),
    );
  }
  return "﻿" + lines.join("\r\n");
}

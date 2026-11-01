/**
 * Readiness (disponibilidad) diaria por jugador, 0-100.
 *
 * Para la mañana del día D combina:
 *   1) Recuperación matinal de D            (S_rec  = (10 − valor) × 10)
 *   2) Fatiga post-sesión de D−1            (S_fat  = (10 − fatiga) / 9 × 100)
 *   3) ACWR individual de carga hasta D−1   (S_acwr: 100 en 0,8-1,3; baja por encima y algo por debajo)
 *   4) Carga de D−1 frente al grupo (z)     (S_z    = 100 − max(0, z) × 25)
 * Media ponderada de los componentes disponibles + reglas de seguridad.
 *
 * Funciones puras, sin React. La configuración (pesos y umbrales) se guarda en localStorage.
 */
import { calcACWRSeries, type SessionMetrics } from "./metrics";
import type { StoredMinutes } from "./store";
import { calcZSessions, mean, sampleSd, zScore } from "./zscore";
import { recoveryCategory, type RecoveryData } from "./recovery";

// ─── Configuración ────────────────────────────────────────────────────────────

export interface ReadinessConfig {
  weights: { rec: number; fat: number; acwr: number; z: number };
  /** Readiness mínimo para verde y para amarillo */
  thresholds: { verde: number; amarillo: number };
  /** Recuperación desde la que el semáforo es rojo / como mucho amarillo */
  rules: { recRojo: number; recAmarillo: number; acwrAmarillo: number };
  /** Caída respecto a la media personal que se marca */
  dropAlert: number;
}

export const DEFAULT_READINESS_CONFIG: ReadinessConfig = {
  weights: { rec: 40, fat: 20, acwr: 25, z: 15 },
  thresholds: { verde: 75, amarillo: 60 },
  rules: { recRojo: 8, recAmarillo: 6, acwrAmarillo: 1.5 },
  dropAlert: 15,
};

const CONFIG_KEY = "readiness-config";

export function getReadinessConfig(): ReadinessConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        weights: { ...DEFAULT_READINESS_CONFIG.weights, ...(p.weights ?? {}) },
        thresholds: { ...DEFAULT_READINESS_CONFIG.thresholds, ...(p.thresholds ?? {}) },
        rules: { ...DEFAULT_READINESS_CONFIG.rules, ...(p.rules ?? {}) },
        dropAlert:
          typeof p.dropAlert === "number" ? p.dropAlert : DEFAULT_READINESS_CONFIG.dropAlert,
      };
    }
  } catch {
    /* sin almacenamiento o valor corrupto */
  }
  return DEFAULT_READINESS_CONFIG;
}

export function saveReadinessConfig(cfg: ReadinessConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    /* sin almacenamiento */
  }
}

export function resetReadinessConfig(): void {
  try {
    localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* sin almacenamiento */
  }
}

// ─── Puntuaciones de cada componente ─────────────────────────────────────────

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

export const scoreRecovery = (valor: number) => clamp((10 - valor) * 10);
export const scoreFatigue = (fatiga: number) => clamp(((10 - fatiga) / 9) * 100);
export function scoreAcwr(ratio: number): number {
  if (ratio >= 0.8 && ratio <= 1.3) return 100;
  if (ratio > 1.3) return clamp(100 - ((ratio - 1.3) / 0.5) * 100);
  return clamp(70 + ((ratio - 0.5) / 0.3) * 30, 70, 100);
}
export const scoreZ = (z: number) => clamp(100 - Math.max(0, z) * 25);

// ─── Tipos de resultado ──────────────────────────────────────────────────────

export type Semaforo = "verde" | "amarillo" | "rojo";

export const SEMAFORO_INFO: Record<Semaforo, { label: string; color: string; cls: string }> = {
  verde: { label: "Disponible", color: "#22c55e", cls: "bg-[#16a34a] text-white" },
  amarillo: { label: "Precaución", color: "#facc15", cls: "bg-[#facc15] text-[#3f2d00]" },
  rojo: { label: "Revisar", color: "#ef4444", cls: "bg-[#dc2626] text-white" },
};

export type ComponentKey = "rec" | "fat" | "acwr" | "z";

export const COMPONENT_LABEL: Record<ComponentKey, string> = {
  rec: "Recuperación",
  fat: "Fatiga ayer",
  acwr: "ACWR",
  z: "Carga ayer (z)",
};

export interface ReadinessComponent {
  key: ComponentKey;
  /** Valor bruto: recuperación 0-10, fatiga 1-10, ratio ACWR o z */
  raw: number;
  score: number;
}

export interface ReadinessEntry {
  jugador: string;
  fecha: string;
  readiness: number;
  semaforo: Semaforo;
  components: ReadinessComponent[];
  /** Falta la recuperación matinal */
  incompleto: boolean;
  /** Regla de seguridad aplicada (texto) */
  regla: string | null;
  factorLimitante: string;
  /** Media del readiness del jugador en días anteriores de la convocatoria */
  mediaPersonal: number | null;
  delta: number | null;
  caida: boolean;
}

export function fmtRaw(key: ComponentKey, raw: number): string {
  const n = (v: number, d: number) => v.toFixed(d).replace(".", ",");
  if (key === "rec") return `${n(raw, Number.isInteger(raw) ? 0 : 1)}/10`;
  if (key === "fat") return `${n(raw, Number.isInteger(raw) ? 0 : 1)}/10`;
  if (key === "acwr") return n(raw, 2);
  return `${raw >= 0 ? "+" : ""}${n(raw, 1)}`;
}

function describe(c: ReadinessComponent): string {
  if (c.key === "rec")
    return `Recuperación ${fmtRaw("rec", c.raw)} (${recoveryCategory(c.raw).label.toLowerCase()})`;
  if (c.key === "fat") return `Fatiga ayer ${fmtRaw("fat", c.raw)}`;
  if (c.key === "acwr") return `ACWR ${fmtRaw("acwr", c.raw)}`;
  return `Carga ayer z ${fmtRaw("z", c.raw)}`;
}

function previousDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

// ─── Cálculo principal ───────────────────────────────────────────────────────

export interface ReadinessResult {
  days: string[];
  players: string[];
  get: (jugador: string, fecha: string) => ReadinessEntry | undefined;
  entries: ReadinessEntry[];
}

export function calcReadiness(
  sessionMetrics: SessionMetrics[],
  minutes: StoredMinutes[],
  recoveryData: RecoveryData,
  config: ReadinessConfig = getReadinessConfig(),
): ReadinessResult {
  const zSessions = calcZSessions(sessionMetrics, minutes); // sesiones con duración > 0, en orden
  const players = recoveryData.roster;
  const normKey = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
  const rowOf = (s: (typeof zSessions)[number], jugador: string) =>
    s.rows.find((r) => normKey(r.jugador) === normKey(jugador));

  // Días: los de recuperación y el día siguiente a cada sesión
  const daySet = new Set<string>(recoveryData.days.map((d) => d.fecha));
  for (const s of zSessions) daySet.add(s.date);
  const days = [...daySet].sort();

  // Serie ACWR individual (ua = carga individual) por jugador
  const acwrByPlayer = new Map<string, { date: string; acwr: number }[]>();
  for (const j of players) {
    const series = zSessions
      .map((s) => ({ date: s.date, ua: rowOf(s, j)?.cargaIndividual }))
      .filter((x): x is { date: string; ua: number } => x.ua !== undefined);
    acwrByPlayer.set(
      j,
      calcACWRSeries(series).map((x) => ({ date: x.date, acwr: x.acwr })),
    );
  }

  const W = config.weights;
  const entries: ReadinessEntry[] = [];
  const map = new Map<string, ReadinessEntry>();

  for (const fecha of days) {
    const prev = previousDay(fecha);
    const prevSessions = zSessions.filter((s) => s.date === prev);

    // z de la carga total del día anterior frente al grupo
    const prevLoad = new Map<string, number>();
    for (const s of prevSessions)
      for (const r of s.rows)
        prevLoad.set(
          normKey(r.jugador),
          (prevLoad.get(normKey(r.jugador)) ?? 0) + r.cargaIndividual,
        );
    const loads = [...prevLoad.values()];
    const loadMean = mean(loads);
    const loadSd = sampleSd(loads);

    for (const jugador of players) {
      const comps: ReadinessComponent[] = [];

      const rec = recoveryData.cell(jugador, fecha)?.valor;
      if (rec !== undefined) comps.push({ key: "rec", raw: rec, score: scoreRecovery(rec) });

      // Fatiga de la última sesión de D−1 con respuesta del jugador
      const lastWithFat = [...prevSessions]
        .reverse()
        .map((s) => rowOf(s, jugador))
        .find((r) => r !== undefined);
      if (lastWithFat)
        comps.push({
          key: "fat",
          raw: lastWithFat.fatiga,
          score: scoreFatigue(lastWithFat.fatiga),
        });

      const acwrPoint = [...(acwrByPlayer.get(jugador) ?? [])]
        .reverse()
        .find((x) => x.date <= prev);
      if (acwrPoint)
        comps.push({ key: "acwr", raw: acwrPoint.acwr, score: scoreAcwr(acwrPoint.acwr) });

      const myLoad = prevLoad.get(normKey(jugador));
      if (myLoad !== undefined && loads.length >= 3) {
        const z = zScore(myLoad, loadMean, loadSd);
        comps.push({ key: "z", raw: z, score: scoreZ(z) });
      }

      if (comps.length === 0) continue;

      const totalW = comps.reduce((a, c) => a + W[c.key], 0);
      const readiness = Math.round(
        totalW > 0
          ? comps.reduce((a, c) => a + c.score * W[c.key], 0) / totalW
          : mean(comps.map((c) => c.score)),
      );

      let semaforo: Semaforo =
        readiness >= config.thresholds.verde
          ? "verde"
          : readiness >= config.thresholds.amarillo
            ? "amarillo"
            : "rojo";
      let regla: string | null = null;
      const acwrRaw = comps.find((c) => c.key === "acwr")?.raw;
      if (rec !== undefined && rec >= config.rules.recRojo) {
        if (semaforo !== "rojo") regla = `Recuperación ${fmtRaw("rec", rec)} → rojo`;
        semaforo = "rojo";
      } else if (rec !== undefined && rec >= config.rules.recAmarillo && semaforo === "verde") {
        semaforo = "amarillo";
        regla = `Recuperación ${fmtRaw("rec", rec)} → máx. amarillo`;
      } else if (
        acwrRaw !== undefined &&
        acwrRaw > config.rules.acwrAmarillo &&
        semaforo === "verde"
      ) {
        semaforo = "amarillo";
        regla = `ACWR ${fmtRaw("acwr", acwrRaw)} → máx. amarillo`;
      }

      const worst = [...comps].sort((a, b) => a.score - b.score)[0];
      const factorLimitante = regla ?? (worst.score >= 100 ? "Sin limitaciones" : describe(worst));

      const entry: ReadinessEntry = {
        jugador,
        fecha,
        readiness,
        semaforo,
        components: comps,
        incompleto: rec === undefined,
        regla,
        factorLimitante,
        mediaPersonal: null,
        delta: null,
        caida: false,
      };
      entries.push(entry);
      map.set(`${jugador}|${fecha}`, entry);
    }
  }

  // Referencia personal: media de días anteriores (solo índices completos)
  for (const e of entries) {
    const prevVals = entries
      .filter((x) => x.jugador === e.jugador && x.fecha < e.fecha && !x.incompleto)
      .map((x) => x.readiness);
    if (prevVals.length) {
      e.mediaPersonal = mean(prevVals);
      e.delta = e.readiness - e.mediaPersonal;
      e.caida = e.delta <= -config.dropAlert;
    }
  }

  return { days, players, entries, get: (j, f) => map.get(`${j}|${f}`) };
}

/** CSV (separador ";" y coma decimal) */
export function readinessToCsv(result: ReadinessResult, players: string[]): string {
  const n = (v: number | undefined, d = 0) =>
    v === undefined ? "" : v.toFixed(d).replace(".", ",");
  const header = [
    "FECHA",
    "JUGADOR",
    "READINESS",
    "SEMAFORO",
    "S_REC",
    "S_FAT",
    "S_ACWR",
    "S_Z",
    "RECUPERACION (0-10)",
    "FATIGA AYER (1-10)",
    "ACWR",
    "Z CARGA AYER",
    "INCOMPLETO",
    "FACTOR LIMITANTE",
  ];
  const lines = [header.join(";")];
  for (const fecha of result.days) {
    for (const j of players) {
      const e = result.get(j, fecha);
      if (!e) continue;
      const c = (k: ComponentKey) => e.components.find((x) => x.key === k);
      const [y, m, d] = fecha.split("-");
      lines.push(
        [
          `${d}/${m}/${y}`,
          j,
          String(e.readiness),
          SEMAFORO_INFO[e.semaforo].label,
          n(c("rec")?.score),
          n(c("fat")?.score),
          n(c("acwr")?.score),
          n(c("z")?.score),
          n(c("rec")?.raw, 1),
          n(c("fat")?.raw, 1),
          n(c("acwr")?.raw, 2),
          n(c("z")?.raw, 2),
          e.incompleto ? "SÍ" : "",
          e.factorLimitante,
        ]
          .map((v) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v))
          .join(";"),
      );
    }
  }
  return "﻿" + lines.join("\r\n");
}

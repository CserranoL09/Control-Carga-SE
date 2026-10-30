/**
 * Cuestionario matinal de recuperación ("¿Cómo te sientes esta mañana?", 0-10).
 * ESCALA INVERTIDA: un valor bajo significa mejor recuperado.
 * Funciones puras, sin React.
 */
import type { SessionMetrics } from "./metrics";
import type { StoredRecovery } from "./store";

export const RECOVERY_ALERT_VALUE = 6;
export const RECOVERY_ALERT_RISE = 2;

export type RecoveryCategoryKey = "total" | "recuperado" | "algo" | "poco" | "muy-poco";

export interface RecoveryCategory {
  key: RecoveryCategoryKey;
  label: string;
  range: string;
  /** Clases Tailwind para celdas y chips */
  cls: string;
  /** Color para gráficas */
  color: string;
}

export const RECOVERY_CATEGORIES: RecoveryCategory[] = [
  {
    key: "total",
    label: "Totalmente recuperado",
    range: "0-1",
    cls: "bg-[#15803d] text-white font-semibold",
    color: "#15803d",
  },
  {
    key: "recuperado",
    label: "Recuperado",
    range: "2-3",
    cls: "bg-[#4ade80] text-[#052e16] font-medium",
    color: "#4ade80",
  },
  {
    key: "algo",
    label: "Algo recuperado",
    range: "4-5",
    cls: "bg-[#facc15] text-[#3f2d00] font-medium",
    color: "#facc15",
  },
  {
    key: "poco",
    label: "Poco recuperado",
    range: "6-7",
    cls: "bg-[#f97316] text-white font-semibold",
    color: "#f97316",
  },
  {
    key: "muy-poco",
    label: "Muy poco recuperado",
    range: "8-10",
    cls: "bg-[#dc2626] text-white font-bold",
    color: "#dc2626",
  },
];

export function recoveryCategory(valor: number): RecoveryCategory {
  if (valor < 2) return RECOVERY_CATEGORIES[0];
  if (valor < 4) return RECOVERY_CATEGORIES[1];
  if (valor < 6) return RECOVERY_CATEGORIES[2];
  if (valor < 8) return RECOVERY_CATEGORIES[3];
  return RECOVERY_CATEGORIES[4];
}

export const normName = (name: string) =>
  name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

export interface RecoveryCell {
  valor: number;
  timestamp: string;
}

export interface RecoveryDay {
  fecha: string;
  media: number;
  respuestas: number;
  alertas: string[];
  /** Suma de RPE × tiempo de las sesiones del día anterior */
  cargaDiaAnterior: number;
}

export interface RecoveryData {
  /** Nombres a mostrar (los del Form de carga cuando coinciden) */
  roster: string[];
  days: RecoveryDay[];
  /** valor por jugador (nombre del roster) y fecha */
  cell: (jugador: string, fecha: string) => RecoveryCell | undefined;
}

function previousDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return dt.toISOString().slice(0, 10);
}

/**
 * Agrupa las respuestas por jugador y día.
 * `formPlayers` son los nombres del Form de carga: se usan como nombre visible
 * cuando coinciden (sin tildes ni mayúsculas) para que todo encaje con el resto de la app.
 */
export function buildRecovery(
  recovery: StoredRecovery[],
  formPlayers: string[],
  sessionMetrics: SessionMetrics[],
): RecoveryData {
  const display = new Map<string, string>();
  for (const p of formPlayers) display.set(normName(p), p);
  for (const r of recovery)
    if (!display.has(normName(r.jugador))) display.set(normName(r.jugador), r.jugador);

  // Última respuesta por jugador y día (por si el Apps Script no lo ha resuelto)
  const cells = new Map<string, RecoveryCell>();
  for (const r of recovery) {
    const key = `${normName(r.jugador)}|${r.fecha}`;
    const prev = cells.get(key);
    if (!prev || r.timestamp >= prev.timestamp)
      cells.set(key, { valor: r.valor, timestamp: r.timestamp });
  }

  const roster = [...display.values()].sort((a, b) => a.localeCompare(b, "es"));
  const fechas = [...new Set(recovery.map((r) => r.fecha))].sort();

  const cargaPorDia = new Map<string, number>();
  for (const s of sessionMetrics)
    cargaPorDia.set(s.date, (cargaPorDia.get(s.date) ?? 0) + s.rpeXTiempo);

  const cell = (jugador: string, fecha: string) => cells.get(`${normName(jugador)}|${fecha}`);

  const days: RecoveryDay[] = fechas.map((fecha) => {
    const vals = roster.map((j) => ({ j, c: cell(j, fecha) })).filter((x) => x.c);
    return {
      fecha,
      media: vals.length ? vals.reduce((a, x) => a + x.c!.valor, 0) / vals.length : 0,
      respuestas: vals.length,
      alertas: vals.filter((x) => x.c!.valor >= RECOVERY_ALERT_VALUE).map((x) => x.j),
      cargaDiaAnterior: cargaPorDia.get(previousDay(fecha)) ?? 0,
    };
  });

  return { roster, days, cell };
}

/** Media personal del jugador en los días anteriores a `fecha` (null si no hay). */
export function personalBaseline(
  data: RecoveryData,
  jugador: string,
  fecha: string,
): number | null {
  const prev = data.days
    .filter((d) => d.fecha < fecha)
    .map((d) => data.cell(jugador, d.fecha)?.valor)
    .filter((v): v is number => v !== undefined);
  return prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : null;
}

export interface RecoveryAlert {
  jugador: string;
  valor: number;
  motivos: string[];
}

export function recoveryAlerts(
  data: RecoveryData,
  fecha: string,
  players: string[],
): RecoveryAlert[] {
  const out: RecoveryAlert[] = [];
  for (const jugador of players) {
    const c = data.cell(jugador, fecha);
    if (!c) continue;
    const motivos: string[] = [];
    if (c.valor >= RECOVERY_ALERT_VALUE)
      motivos.push(`${recoveryCategory(c.valor).label.toLowerCase()} (${fmt1(c.valor)})`);
    const base = personalBaseline(data, jugador, fecha);
    if (base !== null && c.valor - base >= RECOVERY_ALERT_RISE)
      motivos.push(`+${fmt1(c.valor - base)} sobre su media (${fmt1(base)})`);
    if (motivos.length) out.push({ jugador, valor: c.valor, motivos });
  }
  return out.sort((a, b) => b.valor - a.valor);
}

export function fmt1(v: number): string {
  return (Math.round(v * 10) / 10)
    .toFixed(Number.isInteger(Math.round(v * 10) / 10) ? 0 : 1)
    .replace(".", ",");
}

export function fmt2(v: number): string {
  return v.toFixed(2).replace(".", ",");
}

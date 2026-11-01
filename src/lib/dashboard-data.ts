/**
 * Capa de datos del Dashboard: tabla "larga" de métricas por jugador y sesión / día,
 * agregación genérica y correlación. Reutiliza los cálculos existentes
 * (zscore, recovery, readiness, ACWR); no duplica fórmulas.
 */
import { calcACWRSeries, type SessionMetrics } from "./metrics";
import type { StoredMinutes, StoredRecovery } from "./store";
import { calcZSessions } from "./zscore";
import { buildRecovery, normName } from "./recovery";
import { calcReadiness } from "./readiness";

// ─── Catálogo de métricas ─────────────────────────────────────────────────────

export type MetricId =
  | "fatiga"
  | "rpe"
  | "carga"
  | "uaFatiga"
  | "tiempo"
  | "minutos"
  | "zFatiga"
  | "zCarga"
  | "recuperacion"
  | "readiness"
  | "acwr";

export type AggId = "defecto" | "suma" | "media" | "max" | "min";
type BaseAgg = "suma" | "media" | "max" | "min" | "ultimo";

export interface MetricDef {
  id: MetricId;
  label: string;
  short: string;
  unit: string;
  level: "sesion" | "dia";
  defaultAgg: BaseAgg;
  higherIsWorse: boolean;
  decimals: number;
}

export const METRICS: MetricDef[] = [
  {
    id: "carga",
    label: "Carga (RPE × tiempo)",
    short: "Carga",
    unit: "UA",
    level: "sesion",
    defaultAgg: "suma",
    higherIsWorse: true,
    decimals: 0,
  },
  {
    id: "fatiga",
    label: "Fatiga post-sesión",
    short: "Fatiga",
    unit: "1-10",
    level: "sesion",
    defaultAgg: "media",
    higherIsWorse: true,
    decimals: 2,
  },
  {
    id: "rpe",
    label: "RPE",
    short: "RPE",
    unit: "1-10",
    level: "sesion",
    defaultAgg: "media",
    higherIsWorse: true,
    decimals: 2,
  },
  {
    id: "uaFatiga",
    label: "Fatiga × tiempo",
    short: "UA fatiga",
    unit: "UA",
    level: "sesion",
    defaultAgg: "suma",
    higherIsWorse: true,
    decimals: 0,
  },
  {
    id: "minutos",
    label: "Minutos jugados (partidos)",
    short: "Minutos",
    unit: "min",
    level: "sesion",
    defaultAgg: "suma",
    higherIsWorse: false,
    decimals: 2,
  },
  {
    id: "tiempo",
    label: "Tiempo (sesión o minutos jugados)",
    short: "Tiempo",
    unit: "min",
    level: "sesion",
    defaultAgg: "suma",
    higherIsWorse: false,
    decimals: 0,
  },
  {
    id: "zFatiga",
    label: "Z-score de fatiga",
    short: "z fatiga",
    unit: "z",
    level: "sesion",
    defaultAgg: "media",
    higherIsWorse: true,
    decimals: 2,
  },
  {
    id: "zCarga",
    label: "Z-score de carga",
    short: "z carga",
    unit: "z",
    level: "sesion",
    defaultAgg: "media",
    higherIsWorse: true,
    decimals: 2,
  },
  {
    id: "recuperacion",
    label: "Recuperación matinal (más alto = peor)",
    short: "Recuperación",
    unit: "0-10",
    level: "dia",
    defaultAgg: "media",
    higherIsWorse: true,
    decimals: 2,
  },
  {
    id: "readiness",
    label: "Readiness",
    short: "Readiness",
    unit: "0-100",
    level: "dia",
    defaultAgg: "media",
    higherIsWorse: false,
    decimals: 0,
  },
  {
    id: "acwr",
    label: "ACWR individual de carga",
    short: "ACWR",
    unit: "ratio",
    level: "dia",
    defaultAgg: "ultimo",
    higherIsWorse: true,
    decimals: 2,
  },
];

export const METRIC: Record<MetricId, MetricDef> = Object.fromEntries(
  METRICS.map((m) => [m.id, m]),
) as Record<MetricId, MetricDef>;

export const AGG_LABEL: Record<AggId, string> = {
  defecto: "Por defecto",
  suma: "Suma",
  media: "Media",
  max: "Máximo",
  min: "Mínimo",
};

// ─── Tabla de datos ───────────────────────────────────────────────────────────

export interface SessionRow {
  fecha: string;
  sessionId: string;
  sessionLabel: string;
  order: number;
  tipo: string;
  isMatch: boolean;
  jugador: string;
  values: Partial<Record<MetricId, number>>;
}

export interface DayRow {
  fecha: string;
  jugador: string;
  values: Partial<Record<MetricId, number>>;
}

export interface DashboardData {
  sessionRows: SessionRow[];
  dayRows: DayRow[];
  players: string[];
  /** Todas las fechas con datos, ordenadas */
  dates: string[];
  sessionTypes: string[];
  /** Fechas en las que hubo una sesión de cada tipo */
  typesByDate: Map<string, Set<string>>;
  /** Sesiones en orden: id → etiqueta */
  sessions: { id: string; label: string; fecha: string; tipo: string; order: number }[];
}

const dm = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

export function buildDashboardData(
  sessionMetrics: SessionMetrics[],
  minutes: StoredMinutes[],
  recovery: StoredRecovery[],
  formPlayers: string[],
): DashboardData {
  const zSessions = calcZSessions(sessionMetrics, minutes);
  const recoveryData = buildRecovery(recovery, formPlayers, sessionMetrics);
  const readiness = calcReadiness(sessionMetrics, minutes, recoveryData);
  const display = (name: string) =>
    recoveryData.roster.find((r) => normName(r) === normName(name)) ?? name;

  const sessionRows: SessionRow[] = [];
  const sessions: DashboardData["sessions"] = [];
  const typesByDate = new Map<string, Set<string>>();
  zSessions.forEach((s, order) => {
    const label = dm(s.date) + (s.dayLabel ? ` ${s.dayLabel}` : "");
    sessions.push({ id: s.sessionId, label, fecha: s.date, tipo: s.type, order });
    if (!typesByDate.has(s.date)) typesByDate.set(s.date, new Set());
    typesByDate.get(s.date)!.add(s.type);
    for (const r of s.rows) {
      const values: SessionRow["values"] = {
        fatiga: r.fatiga,
        rpe: r.rpe,
        carga: r.cargaIndividual,
        uaFatiga: r.fatiga * r.tiempo,
        tiempo: r.tiempo,
      };
      if (s.isMatch && !r.sinMinutos) values.minutos = r.tiempo;
      if (r.zFatiga !== null) values.zFatiga = r.zFatiga;
      if (r.zCarga !== null) values.zCarga = r.zCarga;
      sessionRows.push({
        fecha: s.date,
        sessionId: s.sessionId,
        sessionLabel: label,
        order,
        tipo: s.type,
        isMatch: s.isMatch,
        jugador: display(r.jugador),
        values,
      });
    }
  });

  // ACWR individual por jugador (último valor de cada día)
  const players = [...new Set([...recoveryData.roster, ...sessionRows.map((r) => r.jugador)])].sort(
    (a, b) => a.localeCompare(b, "es"),
  );
  const acwrByPlayerDay = new Map<string, number>();
  for (const j of players) {
    const series = sessionRows
      .filter((r) => r.jugador === j)
      .map((r) => ({ date: r.fecha, ua: r.values.carga ?? 0 }));
    for (const p of calcACWRSeries(series)) acwrByPlayerDay.set(`${j}|${p.date}`, p.acwr);
  }

  const dates = [
    ...new Set([
      ...sessionRows.map((r) => r.fecha),
      ...recoveryData.days.map((d) => d.fecha),
      ...readiness.days,
    ]),
  ].sort();

  const dayRows: DayRow[] = [];
  for (const fecha of dates) {
    for (const j of players) {
      const values: DayRow["values"] = {};
      const rec = recoveryData.cell(j, fecha)?.valor;
      if (rec !== undefined) values.recuperacion = rec;
      const rd = readiness.get(j, fecha);
      if (rd && !rd.incompleto) values.readiness = rd.readiness;
      const ac = acwrByPlayerDay.get(`${j}|${fecha}`);
      if (ac !== undefined) values.acwr = ac;
      if (Object.keys(values).length) dayRows.push({ fecha, jugador: j, values });
    }
  }

  return {
    sessionRows,
    dayRows,
    players,
    dates,
    sessionTypes: [...new Set(sessions.map((s) => s.tipo))],
    typesByDate,
    sessions,
  };
}

// ─── Filtros ──────────────────────────────────────────────────────────────────

export interface DashboardFilters {
  /** [] = todos */
  players: string[];
  from: string;
  to: string;
  /** [] = todos */
  types: string[];
  onlyMatches: boolean;
}

function playerOk(f: DashboardFilters, j: string) {
  return f.players.length === 0 || f.players.some((p) => normName(p) === normName(j));
}
function dateOk(f: DashboardFilters, d: string) {
  return (!f.from || d >= f.from) && (!f.to || d <= f.to);
}
function sessionOk(f: DashboardFilters, r: SessionRow) {
  if (f.onlyMatches && !r.isMatch) return false;
  return f.types.length === 0 || f.types.includes(r.tipo);
}
function dayTypeOk(f: DashboardFilters, data: DashboardData, fecha: string) {
  if (!f.onlyMatches && f.types.length === 0) return true;
  const types = data.typesByDate.get(fecha);
  if (!types) return false;
  return [...types].some(
    (t) =>
      (!f.onlyMatches || t.includes("PARTIDO")) && (f.types.length === 0 || f.types.includes(t)),
  );
}

// ─── Agregación ───────────────────────────────────────────────────────────────

export type GroupBy = "sesion" | "dia" | "jugador" | "tipo" | "semana";
export type SeriesBy = "equipo" | "jugador";

export const GROUP_LABEL: Record<GroupBy, string> = {
  sesion: "Sesión",
  dia: "Día",
  jugador: "Jugador",
  tipo: "Tipo de sesión",
  semana: "Semana",
};

export interface Observation {
  jugador: string;
  fecha: string;
  sessionId: string | null;
  sessionLabel: string;
  order: number;
  tipo: string;
  value: number;
}

/** Observaciones filtradas de una métrica (sesión o día) */
export function observations(
  data: DashboardData,
  metric: MetricId,
  f: DashboardFilters,
  bySession = false,
): Observation[] {
  const def = METRIC[metric];
  if (def.level === "sesion" || bySession) {
    const dayValue = new Map(data.dayRows.map((r) => [`${r.jugador}|${r.fecha}`, r.values]));
    return data.sessionRows
      .filter((r) => playerOk(f, r.jugador) && dateOk(f, r.fecha) && sessionOk(f, r))
      .map((r): Observation | null => {
        const v =
          def.level === "sesion"
            ? r.values[metric]
            : dayValue.get(`${r.jugador}|${r.fecha}`)?.[metric];
        return v === undefined
          ? null
          : {
              jugador: r.jugador,
              fecha: r.fecha,
              sessionId: r.sessionId,
              sessionLabel: r.sessionLabel,
              order: r.order,
              tipo: r.tipo,
              value: v,
            };
      })
      .filter((o): o is Observation => o !== null);
  }
  return data.dayRows
    .filter(
      (r) =>
        playerOk(f, r.jugador) &&
        dateOk(f, r.fecha) &&
        dayTypeOk(f, data, r.fecha) &&
        r.values[metric] !== undefined,
    )
    .map((r) => ({
      jugador: r.jugador,
      fecha: r.fecha,
      sessionId: null,
      sessionLabel: dm(r.fecha),
      order: 0,
      tipo: "",
      value: r.values[metric]!,
    }));
}

export function reduce(values: number[], agg: BaseAgg): number | null {
  if (values.length === 0) return null;
  switch (agg) {
    case "suma":
      return values.reduce((a, b) => a + b, 0);
    case "media":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "max":
      return Math.max(...values);
    case "min":
      return Math.min(...values);
    case "ultimo":
      return values[values.length - 1];
  }
}

export const resolveAgg = (metric: MetricId, agg: AggId): BaseAgg =>
  agg === "defecto" ? METRIC[metric].defaultAgg : agg;

function mondayOf(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wd = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - wd);
  return dt.toISOString().slice(0, 10);
}

interface XKey {
  key: string;
  label: string;
  sort: string;
}

function xKeyOf(o: Observation, groupBy: GroupBy): XKey {
  switch (groupBy) {
    case "sesion":
      return o.sessionId
        ? {
            key: o.sessionId,
            label: o.sessionLabel,
            sort: `${o.fecha}|${String(o.order).padStart(4, "0")}`,
          }
        : { key: o.fecha, label: dm(o.fecha), sort: o.fecha };
    case "dia":
      return { key: o.fecha, label: dm(o.fecha), sort: o.fecha };
    case "jugador":
      return { key: o.jugador, label: o.jugador, sort: o.jugador };
    case "tipo":
      return { key: o.tipo || "—", label: o.tipo || "—", sort: o.tipo };
    case "semana": {
      const mon = mondayOf(o.fecha);
      return { key: mon, label: `Sem. ${dm(mon)}`, sort: mon };
    }
  }
}

export interface SeriesDef {
  key: string;
  label: string;
  metric: MetricId;
  jugador: string | null;
}

export interface AggregateResult {
  rows: Record<string, string | number | null>[];
  series: SeriesDef[];
}

/**
 * Agrega una o varias métricas.
 * - Cada fila: { x, xLabel, [serie]: valor, [serie__n]: nº de datos }
 * - Con seriesBy "jugador" se agrega primero por jugador y punto del eje X.
 */
export function aggregate(
  data: DashboardData,
  opts: {
    metrics: MetricId[];
    groupBy: GroupBy;
    seriesBy: SeriesBy;
    agg: AggId;
    filters: DashboardFilters;
  },
): AggregateResult {
  const { metrics, groupBy, seriesBy, agg, filters } = opts;
  const xs = new Map<string, XKey>();
  const cells = new Map<string, Map<string, number[]>>(); // x → serie → valores
  const series = new Map<string, SeriesDef>();

  for (const metric of metrics) {
    const obs = observations(data, metric, filters, groupBy === "sesion");
    for (const o of obs) {
      const xk = xKeyOf(o, groupBy);
      xs.set(xk.key, xk);
      const sKey =
        seriesBy === "jugador" && groupBy !== "jugador" ? `${metric}|${o.jugador}` : metric;
      if (!series.has(sKey))
        series.set(sKey, {
          key: sKey,
          metric,
          jugador: seriesBy === "jugador" && groupBy !== "jugador" ? o.jugador : null,
          label:
            seriesBy === "jugador" && groupBy !== "jugador"
              ? metrics.length > 1
                ? `${o.jugador} · ${METRIC[metric].short}`
                : o.jugador
              : METRIC[metric].short,
        });
      if (!cells.has(xk.key)) cells.set(xk.key, new Map());
      const m = cells.get(xk.key)!;
      if (!m.has(sKey)) m.set(sKey, []);
      m.get(sKey)!.push(o.value);
    }
  }

  const sortedX = [...xs.values()].sort((a, b) => a.sort.localeCompare(b.sort, "es"));
  const rows = sortedX.map((xk) => {
    const row: Record<string, string | number | null> = { x: xk.key, xLabel: xk.label };
    for (const s of series.values()) {
      const vals = cells.get(xk.key)?.get(s.key) ?? [];
      row[s.key] = reduce(vals, resolveAgg(s.metric, agg));
      row[`${s.key}__n`] = vals.length;
    }
    return row;
  });

  const ordered = [...series.values()].sort(
    (a, b) =>
      metrics.indexOf(a.metric) - metrics.indexOf(b.metric) ||
      (a.jugador ?? "").localeCompare(b.jugador ?? "", "es"),
  );
  return { rows, series: ordered };
}

/**
 * Media del equipo por punto del eje X: se agrega por jugador y luego se promedia
 * entre jugadores (ignorando el filtro de jugadores).
 */
export function teamReference(
  data: DashboardData,
  metric: MetricId,
  groupBy: GroupBy,
  agg: AggId,
  filters: DashboardFilters,
): Map<string, number> {
  const res = aggregate(data, {
    metrics: [metric],
    groupBy,
    seriesBy: "jugador",
    agg,
    filters: { ...filters, players: [] },
  });
  const out = new Map<string, number>();
  for (const row of res.rows) {
    const vals = res.series
      .map((s) => row[s.key])
      .filter((v): v is number => typeof v === "number");
    if (vals.length) out.set(String(row.x), vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  return out;
}

// ─── Dispersión y correlación ─────────────────────────────────────────────────

export type ScatterUnit = "jugador" | "jugador-dia" | "jugador-sesion";

export interface ScatterPoint {
  jugador: string;
  label: string;
  x: number;
  y: number;
}

function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * Puntos para dispersión. `lagY` = 1 toma Y del día siguiente
 * (p. ej. carga de un día frente a la recuperación de la mañana siguiente).
 */
export function scatterPoints(
  data: DashboardData,
  mx: MetricId,
  my: MetricId,
  unit: ScatterUnit,
  agg: AggId,
  filters: DashboardFilters,
  lagY = 0,
): ScatterPoint[] {
  const group = (
    metric: MetricId,
    keyFn: (o: Observation) => string,
    f: DashboardFilters,
    bySession = false,
  ) => {
    const m = new Map<string, { vals: number[]; jugador: string; label: string }>();
    for (const o of observations(data, metric, f, bySession)) {
      const k = keyFn(o);
      if (!m.has(k)) m.set(k, { vals: [], jugador: o.jugador, label: o.sessionLabel });
      m.get(k)!.vals.push(o.value);
    }
    return new Map(
      [...m].map(([k, v]) => [k, { ...v, value: reduce(v.vals, resolveAgg(metric, agg))! }]),
    );
  };

  if (unit === "jugador") {
    const X = group(mx, (o) => o.jugador, filters);
    const Y = group(my, (o) => o.jugador, filters);
    return [...X]
      .filter(([k]) => Y.has(k))
      .map(([k, v]) => ({ jugador: v.jugador, label: v.jugador, x: v.value, y: Y.get(k)!.value }));
  }
  if (unit === "jugador-sesion") {
    const X = group(mx, (o) => `${o.jugador}|${o.sessionId}`, filters, true);
    const Y = group(my, (o) => `${o.jugador}|${o.sessionId}`, filters, true);
    return [...X]
      .filter(([k]) => Y.has(k))
      .map(([k, v]) => ({
        jugador: v.jugador,
        label: `${v.jugador} · ${v.label}`,
        x: v.value,
        y: Y.get(k)!.value,
      }));
  }
  // jugador-día, con desfase opcional en Y (Y se filtra con el rango desplazado)
  const X = group(mx, (o) => `${o.jugador}|${o.fecha}`, filters);
  const yFilters = lagY
    ? {
        ...filters,
        from: filters.from ? addDays(filters.from, lagY) : "",
        to: filters.to ? addDays(filters.to, lagY) : "",
        types: [],
        onlyMatches: false,
      }
    : filters;
  const Y = group(my, (o) => `${o.jugador}|${o.fecha}`, yFilters);
  return [...X]
    .map(([k, v]) => {
      const [j, fecha] = k.split("|");
      const y = Y.get(`${j}|${addDays(fecha, lagY)}`);
      return y
        ? {
            jugador: v.jugador,
            label: `${v.jugador} · ${dm(fecha)}${lagY ? ` → ${dm(addDays(fecha, lagY))}` : ""}`,
            x: v.value,
            y: y.value,
          }
        : null;
    })
    .filter((p): p is ScatterPoint => p !== null);
}

export function pearson(points: { x: number; y: number }[]): number | null {
  const n = points.length;
  if (n < 3) return null;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (const p of points) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Recta de mínimos cuadrados y = a + b·x */
export function linearFit(points: { x: number; y: number }[]): { a: number; b: number } | null {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  let sxy = 0,
    sxx = 0;
  for (const p of points) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
  }
  if (sxx === 0) return null;
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

// ─── Formato y CSV ────────────────────────────────────────────────────────────

export function fmtValue(
  metric: MetricId,
  v: number | null | undefined,
  decimals?: number,
): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  const d = decimals ?? METRIC[metric].decimals;
  return v.toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: d });
}

export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(Math.round(v * 100) / 100).replace(".", ",") : v;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
}

// ─── Colores por jugador ──────────────────────────────────────────────────────

export const PLAYER_PALETTE = [
  "#60a5fa",
  "#f472b6",
  "#34d399",
  "#fbbf24",
  "#a78bfa",
  "#22d3ee",
  "#fb7185",
  "#a3e635",
  "#f97316",
  "#38bdf8",
  "#e879f9",
  "#4ade80",
  "#facc15",
  "#c084fc",
  "#2dd4bf",
  "#fca5a5",
];

export const METRIC_COLORS: Record<MetricId, string> = {
  carga: "#22c55e",
  fatiga: "#ec4899",
  rpe: "#3b82f6",
  uaFatiga: "#8b5cf6",
  minutos: "#06b6d4",
  tiempo: "#64748b",
  zFatiga: "#f472b6",
  zCarga: "#4ade80",
  recuperacion: "#f97316",
  readiness: "#facc15",
  acwr: "#e2e8f0",
};

export function playerColor(players: string[], jugador: string): string {
  const i = players.findIndex((p) => normName(p) === normName(jugador));
  return PLAYER_PALETTE[(i < 0 ? 0 : i) % PLAYER_PALETTE.length];
}

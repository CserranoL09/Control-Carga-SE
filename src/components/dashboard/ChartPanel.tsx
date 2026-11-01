import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Copy, Download, Filter, Settings2, Trash2 } from "lucide-react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { downloadBlob } from "@/lib/pdf-export";
import {
  AGG_LABEL,
  aggregate,
  fmtValue,
  GROUP_LABEL,
  linearFit,
  METRIC,
  METRIC_COLORS,
  METRICS,
  pearson,
  playerColor,
  resolveAgg,
  scatterPoints,
  teamReference,
  toCsv,
  type AggId,
  type AggregateResult,
  type DashboardData,
  type DashboardFilters,
  type GroupBy,
  type MetricId,
  type ScatterUnit,
  type SeriesBy,
} from "@/lib/dashboard-data";
import { NONE, PlayerMultiSelect } from "./PlayerMultiSelect";

export type ChartType =
  | "barras"
  | "apiladas"
  | "lineas"
  | "area"
  | "combo"
  | "dispersion"
  | "radar"
  | "heatmap"
  | "tabla";

export const CHART_LABEL: Record<ChartType, string> = {
  barras: "Barras",
  apiladas: "Barras apiladas",
  lineas: "Líneas",
  area: "Área",
  combo: "Barras + línea",
  dispersion: "Dispersión",
  radar: "Radar",
  heatmap: "Heatmap",
  tabla: "Tabla",
};

export interface PanelConfig {
  id: string;
  title: string;
  chart: ChartType;
  metric: MetricId;
  metric2: MetricId | null;
  radarMetrics: MetricId[];
  groupBy: GroupBy;
  seriesBy: SeriesBy;
  agg: AggId;
  teamRef: boolean;
  scatterUnit: ScatterUnit;
  lagY: 0 | 1;
  /** Incluir esta gráfica en el informe PDF */
  inReport?: boolean;
  /** Filtros propios del panel (null = usa los globales) */
  own: { players: string[]; onlyMatches: boolean } | null;
}

export function newPanel(partial: Partial<PanelConfig> = {}): PanelConfig {
  return {
    id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    title: "",
    chart: "barras",
    metric: "carga",
    metric2: null,
    radarMetrics: ["carga", "fatiga", "minutos", "recuperacion", "readiness"],
    groupBy: "dia",
    seriesBy: "equipo",
    agg: "defecto",
    teamRef: false,
    scatterUnit: "jugador",
    lagY: 0,
    own: null,
    inReport: true,
    ...partial,
  };
}

const TT_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--popover-foreground)",
};
const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" };
const sel = "bg-background border border-border rounded-md px-2 py-1 text-xs";

export function autoTitle(c: PanelConfig, players: string[]): string {
  const who =
    players.length === 0
      ? ""
      : players.length <= 3
        ? ` — ${players.join(" vs ")}`
        : ` — ${players.length} jugadores`;
  if (c.chart === "dispersion")
    return `${METRIC[c.metric].short}${c.lagY ? " (día)" : ""} vs ${METRIC[c.metric2 ?? "fatiga"].short}${c.lagY ? " (día siguiente)" : ""}${who}`;
  if (c.chart === "radar") return `Perfil de jugadores${who}`;
  const m = `${METRIC[c.metric].short} (${METRIC[c.metric].unit})${c.metric2 ? ` y ${METRIC[c.metric2].short}` : ""}`;
  return `${m} por ${GROUP_LABEL[c.groupBy].toLowerCase()}${who}`;
}

/** Escala divergente verde → amarillo → rojo (invertida si más alto = mejor) */
function heatColor(t: number, higherIsWorse: boolean): string {
  const v = higherIsWorse ? t : 1 - t;
  const stops = [
    [34, 197, 94],
    [250, 204, 21],
    [239, 68, 68],
  ];
  const [a, b, f] = v < 0.5 ? [stops[0], stops[1], v / 0.5] : [stops[1], stops[2], (v - 0.5) / 0.5];
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * f));
  return `rgb(${c.join(",")})`;
}

interface ChartPanelProps {
  config: PanelConfig;
  data: DashboardData;
  globalFilters: DashboardFilters;
  onChange: (c: PanelConfig) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  copyButton: (targetId: string) => ReactNode;
}

export function usePanelComputed(c: PanelConfig, data: DashboardData, filters: DashboardFilters) {
  return useMemo(() => {
    if (c.chart === "dispersion") {
      const my = c.metric2 ?? "fatiga";
      const pts = scatterPoints(
        data,
        c.metric,
        my,
        c.scatterUnit,
        c.agg,
        filters,
        c.scatterUnit === "jugador-dia" ? c.lagY : 0,
      );
      return { kind: "scatter" as const, pts, r: pearson(pts), fit: linearFit(pts), my };
    }
    if (c.chart === "radar") {
      const metrics =
        c.radarMetrics.length >= 3
          ? c.radarMetrics
          : (["carga", "fatiga", "minutos"] as MetricId[]);
      const res = aggregate(data, {
        metrics,
        groupBy: "jugador",
        seriesBy: "equipo",
        agg: c.agg,
        filters,
      });
      const players = res.rows.map((r) => String(r.x)).slice(0, 8);
      const rows = metrics.map((m) => {
        const vals = res.rows.map((r) => r[m]).filter((v): v is number => typeof v === "number");
        const lo = Math.min(...vals);
        const hi = Math.max(...vals);
        const row: Record<string, string | number | null> = { metric: METRIC[m].short, id: m };
        for (const r of res.rows) {
          if (!players.includes(String(r.x))) continue;
          const v = r[m];
          row[String(r.x)] =
            typeof v === "number" ? (hi > lo ? ((v - lo) / (hi - lo)) * 100 : 50) : null;
          row[`${r.x}__raw`] = v;
        }
        return row;
      });
      return { kind: "radar" as const, rows, players, metrics };
    }
    const groupBy: GroupBy =
      c.chart === "heatmap" && !["sesion", "dia"].includes(c.groupBy) ? "dia" : c.groupBy;
    const seriesBy: SeriesBy = c.chart === "heatmap" ? "jugador" : c.seriesBy;
    const metrics: MetricId[] =
      c.metric2 && c.chart !== "heatmap" ? [c.metric, c.metric2] : [c.metric];
    const res = aggregate(data, { metrics, groupBy, seriesBy, agg: c.agg, filters });
    let ref: Map<string, number> | null = null;
    if (c.teamRef && seriesBy === "jugador" && groupBy !== "jugador")
      ref = teamReference(data, c.metric, groupBy, c.agg, filters);
    if (ref) for (const row of res.rows) row.__ref = ref.get(String(row.x)) ?? null;
    let refLine: number | null = null;
    if (c.teamRef && groupBy === "jugador") {
      const vals = res.rows
        .map((r) => r[c.metric])
        .filter((v): v is number => typeof v === "number");
      refLine = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
    return { kind: "series" as const, res, groupBy, seriesBy, metrics, hasRef: !!ref, refLine };
  }, [c, data, filters]);
}

export type PanelComputed = ReturnType<typeof usePanelComputed>;

/** Contexto de impresión: desactiva animaciones para capturar el PDF */
export const PrintContext = createContext(false);

/** Filtros efectivos de un panel (propios o globales) */
export function panelFilters(c: PanelConfig, globalFilters: DashboardFilters): DashboardFilters {
  return c.own
    ? { ...globalFilters, players: c.own.players, onlyMatches: c.own.onlyMatches }
    : globalFilters;
}

export function isEmptyComputed(computed: PanelComputed): boolean {
  return (
    (computed.kind === "series" && computed.res.rows.length === 0) ||
    (computed.kind === "scatter" && computed.pts.length === 0) ||
    (computed.kind === "radar" && computed.players.length === 0)
  );
}

/** La gráfica de un panel (sin cabecera ni configuración) */
export function PanelChartBody({
  c,
  data,
  computed,
}: {
  c: PanelConfig;
  data: DashboardData;
  computed: PanelComputed;
}) {
  if (isEmptyComputed(computed))
    return (
      <div className="h-[280px] grid place-items-center text-sm text-muted-foreground border border-dashed rounded-md">
        No hay datos con estos filtros
      </div>
    );
  if (computed.kind === "scatter")
    return <ScatterView c={c} computed={computed} players={data.players} />;
  if (computed.kind === "radar") return <RadarView computed={computed} players={data.players} />;
  if (c.chart === "heatmap") return <HeatmapView metric={c.metric} computed={computed} />;
  if (c.chart === "tabla") return <TableView computed={computed} />;
  return <SeriesView c={c} computed={computed} players={data.players} />;
}

export function ChartPanel({
  config: c,
  data,
  globalFilters,
  onChange,
  onDuplicate,
  onDelete,
  onMove,
  copyButton,
}: ChartPanelProps) {
  const [showConfig, setShowConfig] = useState(false);
  const set = (patch: Partial<PanelConfig>) => onChange({ ...c, ...patch });

  const filters: DashboardFilters = useMemo(
    () => panelFilters(c, globalFilters),
    [c, globalFilters],
  );
  const shownPlayers = filters.players.filter((x) => x !== NONE);
  const title = c.title || autoTitle(c, shownPlayers);
  const domId = `dash-${c.id}`;

  // ── Cálculo según tipo ──
  const computed = usePanelComputed(c, data, filters);

  // ── Exportar CSV ──
  function exportCsv() {
    let csv = "";
    if (computed.kind === "scatter") {
      csv = toCsv(
        [
          "Punto",
          `${METRIC[c.metric].short} (${METRIC[c.metric].unit})`,
          `${METRIC[computed.my].short} (${METRIC[computed.my].unit})`,
        ],
        computed.pts.map((p) => [p.label, p.x, p.y]),
      );
    } else if (computed.kind === "radar") {
      csv = toCsv(
        ["Métrica", ...computed.players],
        computed.rows.map((r) => [
          String(r.metric),
          ...computed.players.map((p) => r[`${p}__raw`] as number | null),
        ]),
      );
    } else {
      const { res, groupBy } = computed;
      csv = toCsv(
        [
          GROUP_LABEL[groupBy],
          ...res.series.map((s) => `${s.label} (${METRIC[s.metric].unit})`),
          ...(computed.hasRef ? ["Media equipo"] : []),
        ],
        res.rows.map((r) => [
          String(r.xLabel),
          ...res.series.map((s) => r[s.key] as number | null),
          ...(computed.hasRef ? [r.__ref as number | null] : []),
        ]),
      );
    }
    const safe = title
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 80);
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${safe || "grafica"}.csv`);
  }

  const metricOptions = METRICS.map((m) => (
    <option key={m.id} value={m.id}>
      {m.label}
    </option>
  ));

  return (
    <section className="rounded-lg border bg-card flex flex-col min-w-0">
      {/* Cabecera */}
      <div className="flex items-center gap-2 px-3 pt-3">
        <input
          value={c.title}
          placeholder={autoTitle(c, shownPlayers)}
          onChange={(e) => set({ title: e.target.value })}
          className="flex-1 min-w-0 bg-transparent text-sm font-medium placeholder:text-foreground focus:outline-none focus:placeholder:text-muted-foreground border-b border-transparent focus:border-border"
          aria-label="Título de la gráfica"
        />
        <label
          className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer select-none shrink-0"
          title="Incluir esta gráfica en el informe PDF"
        >
          <input
            type="checkbox"
            checked={c.inReport !== false}
            onChange={(e) => set({ inReport: e.target.checked })}
          />
          PDF
        </label>
        <div className="flex items-center gap-0.5 shrink-0">
          <IconBtn label="Configurar" onClick={() => setShowConfig((s) => !s)} active={showConfig}>
            <Settings2 className="size-3.5" />
          </IconBtn>
          <IconBtn label="Mover arriba" onClick={() => onMove(-1)}>
            <ArrowUp className="size-3.5" />
          </IconBtn>
          <IconBtn label="Mover abajo" onClick={() => onMove(1)}>
            <ArrowDown className="size-3.5" />
          </IconBtn>
          <IconBtn label="Duplicar" onClick={onDuplicate}>
            <Copy className="size-3.5" />
          </IconBtn>
          <IconBtn label="Exportar CSV" onClick={exportCsv}>
            <Download className="size-3.5" />
          </IconBtn>
          {copyButton(domId)}
          <IconBtn label="Eliminar" onClick={onDelete} danger>
            <Trash2 className="size-3.5" />
          </IconBtn>
        </div>
      </div>

      {/* Configuración */}
      {showConfig && (
        <div className="mx-3 mt-2 rounded-md border bg-muted/20 p-2.5 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          <Field label="Tipo de gráfica">
            <select
              className={sel}
              value={c.chart}
              onChange={(e) => set({ chart: e.target.value as ChartType })}
            >
              {(Object.keys(CHART_LABEL) as ChartType[]).map((t) => (
                <option key={t} value={t}>
                  {CHART_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>

          {c.chart !== "radar" && (
            <Field label={c.chart === "dispersion" ? "Métrica eje X" : "Métrica"}>
              <select
                className={sel}
                value={c.metric}
                onChange={(e) => set({ metric: e.target.value as MetricId })}
              >
                {metricOptions}
              </select>
            </Field>
          )}

          {c.chart !== "radar" && c.chart !== "heatmap" && (
            <Field
              label={
                c.chart === "dispersion"
                  ? "Métrica eje Y"
                  : c.chart === "combo"
                    ? "Métrica de la línea"
                    : "2ª métrica (eje dcho.)"
              }
            >
              <select
                className={sel}
                value={c.metric2 ?? ""}
                onChange={(e) => set({ metric2: (e.target.value || null) as MetricId | null })}
              >
                {c.chart !== "dispersion" && c.chart !== "combo" && (
                  <option value="">— Ninguna —</option>
                )}
                {metricOptions}
              </select>
            </Field>
          )}

          {!["dispersion", "radar"].includes(c.chart) && (
            <Field label="Agrupar por (eje X)">
              <select
                className={sel}
                value={c.groupBy}
                onChange={(e) => set({ groupBy: e.target.value as GroupBy })}
              >
                {(Object.keys(GROUP_LABEL) as GroupBy[])
                  .filter((g) => c.chart !== "heatmap" || g === "sesion" || g === "dia")
                  .map((g) => (
                    <option key={g} value={g}>
                      {GROUP_LABEL[g]}
                    </option>
                  ))}
              </select>
            </Field>
          )}

          {!["dispersion", "radar", "heatmap"].includes(c.chart) && c.groupBy !== "jugador" && (
            <Field label="Una serie por">
              <select
                className={sel}
                value={c.seriesBy}
                onChange={(e) => set({ seriesBy: e.target.value as SeriesBy })}
              >
                <option value="equipo">Equipo (todos juntos)</option>
                <option value="jugador">Jugador</option>
              </select>
            </Field>
          )}

          {c.chart === "dispersion" && (
            <Field label="Un punto por">
              <select
                className={sel}
                value={c.scatterUnit}
                onChange={(e) => set({ scatterUnit: e.target.value as ScatterUnit })}
              >
                <option value="jugador">Jugador (convocatoria)</option>
                <option value="jugador-dia">Jugador y día</option>
                <option value="jugador-sesion">Jugador y sesión</option>
              </select>
            </Field>
          )}
          {c.chart === "dispersion" && c.scatterUnit === "jugador-dia" && (
            <Field label="Eje Y">
              <select
                className={sel}
                value={c.lagY}
                onChange={(e) => set({ lagY: Number(e.target.value) as 0 | 1 })}
              >
                <option value={0}>Mismo día</option>
                <option value={1}>Día siguiente</option>
              </select>
            </Field>
          )}

          <Field label="Agregación">
            <select
              className={sel}
              value={c.agg}
              onChange={(e) => set({ agg: e.target.value as AggId })}
            >
              {(Object.keys(AGG_LABEL) as AggId[]).map((a) => (
                <option key={a} value={a}>
                  {AGG_LABEL[a]}
                  {a === "defecto" ? ` (${resolveAgg(c.metric, "defecto")})` : ""}
                </option>
              ))}
            </select>
          </Field>

          {c.chart === "radar" && (
            <div className="col-span-2 sm:col-span-3">
              <div className="text-muted-foreground mb-1">Métricas del radar (mínimo 3)</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {METRICS.map((m) => (
                  <label key={m.id} className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={c.radarMetrics.includes(m.id)}
                      onChange={(e) =>
                        set({
                          radarMetrics: e.target.checked
                            ? [...c.radarMetrics, m.id]
                            : c.radarMetrics.filter((x) => x !== m.id),
                        })
                      }
                    />
                    {m.short}
                  </label>
                ))}
              </div>
            </div>
          )}

          {!["dispersion", "radar", "heatmap", "tabla"].includes(c.chart) &&
            (c.seriesBy === "jugador" || c.groupBy === "jugador") && (
              <label className="flex items-center gap-1.5 cursor-pointer self-end pb-1">
                <input
                  type="checkbox"
                  checked={c.teamRef}
                  onChange={(e) => set({ teamRef: e.target.checked })}
                />
                Comparar con la media del equipo
              </label>
            )}

          <div className="col-span-2 sm:col-span-3 border-t pt-2 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <Filter className="size-3" />
              <input
                type="checkbox"
                checked={!!c.own}
                onChange={(e) =>
                  set({
                    own: e.target.checked
                      ? { players: globalFilters.players, onlyMatches: globalFilters.onlyMatches }
                      : null,
                  })
                }
              />
              Filtros propios en esta gráfica
            </label>
            {c.own && (
              <>
                <PlayerMultiSelect
                  players={data.players}
                  value={c.own.players}
                  onChange={(players) => set({ own: { ...c.own!, players } })}
                  compact
                />
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={c.own.onlyMatches}
                    onChange={(e) => set({ own: { ...c.own!, onlyMatches: e.target.checked } })}
                  />
                  Solo partidos
                </label>
              </>
            )}
          </div>
        </div>
      )}

      {/* Gráfica */}
      <div id={domId} className="p-3 bg-card rounded-b-lg flex-1">
        <PanelChartBody c={c} data={data} computed={computed} />
        {c.own && (
          <div className="text-[10px] text-muted-foreground mt-1">
            Con filtros propios de esta gráfica.
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Vistas ───────────────────────────────────────────────────────────────────

interface SeriesComputed {
  kind: "series";
  res: AggregateResult;
  groupBy: GroupBy;
  seriesBy: SeriesBy;
  metrics: MetricId[];
  hasRef: boolean;
  refLine: number | null;
}

const AGG_SHORT = {
  suma: "suma",
  media: "media",
  max: "máx.",
  min: "mín.",
  ultimo: "último",
} as const;

function SeriesView({
  c,
  computed,
  players,
}: {
  c: PanelConfig;
  computed: SeriesComputed;
  players: string[];
}) {
  const print = useContext(PrintContext);
  const { res, metrics, hasRef, refLine } = computed;
  const right = metrics[1];
  const colorOf = (s: (typeof res.series)[number]) =>
    s.jugador
      ? playerColor(players, s.jugador)
      : s.metric === right && right === c.metric
        ? "#f472b6"
        : METRIC_COLORS[s.metric];
  const many = res.rows.length > 8;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart
        data={res.rows}
        margin={{ top: 10, right: right ? 4 : 16, left: 0, bottom: many ? 30 : 0 }}
      >
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis
          dataKey="xLabel"
          tick={AXIS}
          angle={many ? -40 : 0}
          textAnchor={many ? "end" : "middle"}
          interval={0}
          height={many ? 72 : 30}
        />
        <YAxis yAxisId="L" tick={AXIS} />
        {right && <YAxis yAxisId="R" orientation="right" tick={AXIS} />}
        <Tooltip
          contentStyle={TT_STYLE}
          formatter={(
            v: number,
            _name: string,
            item: { dataKey?: string | number; payload?: Record<string, unknown> },
          ) => {
            const key = String(item.dataKey);
            if (key === "__ref")
              return [fmtValue(c.metric, v), `Media equipo (${METRIC[c.metric].unit})`];
            const s = res.series.find((x) => x.key === key);
            if (!s) return [String(v), key];
            const n = item.payload?.[`${key}__n`];
            return [
              `${fmtValue(s.metric, v)} ${METRIC[s.metric].unit} · ${AGG_SHORT[resolveAgg(s.metric, c.agg)]} · n=${n}`,
              s.label,
            ];
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {res.series.map((s) => {
          const axis = s.metric === right && right !== c.metric ? "R" : "L";
          const color = colorOf(s);
          const asLine = c.chart === "lineas" || (c.chart === "combo" && axis === "R");
          if (asLine)
            return (
              <Line
                isAnimationActive={!print}
                key={s.key}
                yAxisId={axis}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={color}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            );
          if (c.chart === "area")
            return (
              <Area
                isAnimationActive={!print}
                key={s.key}
                yAxisId={axis}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={color}
                fill={color}
                fillOpacity={0.25}
                connectNulls
              />
            );
          return (
            <Bar
              isAnimationActive={!print}
              key={s.key}
              yAxisId={axis}
              dataKey={s.key}
              name={s.label}
              fill={color}
              radius={c.chart === "apiladas" ? 0 : [3, 3, 0, 0]}
              stackId={c.chart === "apiladas" ? s.metric : undefined}
              maxBarSize={48}
            />
          );
        })}
        {hasRef && (
          <Line
            isAnimationActive={!print}
            yAxisId="L"
            type="monotone"
            dataKey="__ref"
            name="Media equipo"
            stroke="#ffffff"
            strokeDasharray="5 4"
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
        )}
        {refLine !== null && (
          <ReferenceLine
            yAxisId="L"
            y={refLine}
            stroke="#ffffff"
            strokeDasharray="5 4"
            label={{
              value: "Media equipo",
              fill: "#cbd5e1",
              fontSize: 10,
              position: "insideTopRight",
            }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function ScatterView({
  c,
  computed,
  players,
}: {
  c: PanelConfig;
  computed: {
    pts: ReturnType<typeof scatterPoints>;
    r: number | null;
    fit: { a: number; b: number } | null;
    my: MetricId;
  };
  players: string[];
}) {
  const print = useContext(PrintContext);
  const { pts, r, fit, my } = computed;
  const xs = pts.map((p) => p.x);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const strength =
    r === null
      ? ""
      : Math.abs(r) >= 0.7
        ? "fuerte"
        : Math.abs(r) >= 0.4
          ? "moderada"
          : Math.abs(r) >= 0.2
            ? "débil"
            : "muy débil o nula";
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">
        {r === null ? (
          "Se necesitan al menos 3 puntos para la correlación."
        ) : (
          <>
            r de Pearson = <b className="text-foreground">{r.toFixed(2).replace(".", ",")}</b> ·
            relación {strength}
            {r > 0 ? " positiva" : r < 0 ? " negativa" : ""} · {pts.length} puntos
          </>
        )}
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 10, right: 16, left: 0, bottom: 10 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="x"
            name={METRIC[c.metric].short}
            tick={AXIS}
            domain={["auto", "auto"]}
            label={{
              value: `${METRIC[c.metric].short} (${METRIC[c.metric].unit})`,
              position: "insideBottom",
              offset: -4,
              fill: "#94a3b8",
              fontSize: 11,
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={METRIC[my].short}
            tick={AXIS}
            domain={["auto", "auto"]}
            label={{
              value: `${METRIC[my].short}${c.lagY && c.scatterUnit === "jugador-dia" ? " (día sig.)" : ""}`,
              angle: -90,
              position: "insideLeft",
              fill: "#94a3b8",
              fontSize: 11,
            }}
          />
          <ZAxis range={[60, 60]} />
          <Tooltip
            contentStyle={TT_STYLE}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as (typeof pts)[number];
              return (
                <div style={{ ...TT_STYLE, padding: "6px 10px" }}>
                  <div style={{ fontWeight: 600 }}>{p.label}</div>
                  <div>
                    {METRIC[c.metric].short}: {fmtValue(c.metric, p.x)} {METRIC[c.metric].unit}
                  </div>
                  <div>
                    {METRIC[my].short}: {fmtValue(my, p.y)} {METRIC[my].unit}
                  </div>
                </div>
              );
            }}
          />
          <Scatter isAnimationActive={!print} data={pts}>
            {pts.map((p, i) => (
              <Cell key={i} fill={playerColor(players, p.jugador)} />
            ))}
          </Scatter>
          {fit && x1 > x0 && (
            <ReferenceLine
              segment={[
                { x: x0, y: fit.a + fit.b * x0 },
                { x: x1, y: fit.a + fit.b * x1 },
              ]}
              stroke="#ffffff"
              strokeDasharray="5 4"
              ifOverflow="extendDomain"
            />
          )}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

function RadarView({
  computed,
  players: allPlayers,
}: {
  computed: {
    rows: Record<string, string | number | null>[];
    players: string[];
    metrics: MetricId[];
  };
  players: string[];
}) {
  const print = useContext(PrintContext);
  return (
    <div>
      <div className="text-[11px] text-muted-foreground mb-1">
        Cada métrica normalizada de 0 a 100 entre los jugadores mostrados (máx. 8).{" "}
        {print ? "Valores reales en la exportación CSV." : "Pasa el ratón para ver el valor real."}
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <RadarChart data={computed.rows} outerRadius="72%">
          <PolarGrid stroke="var(--border)" />
          <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: "#cbd5e1" }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Tooltip
            contentStyle={TT_STYLE}
            formatter={(_v: number, name: string, item: { payload?: Record<string, unknown> }) => {
              const id = item.payload?.id as MetricId;
              const raw = item.payload?.[`${name}__raw`] as number | null;
              return [`${fmtValue(id, raw)} ${METRIC[id].unit}`, name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {computed.players.map((p) => (
            <Radar
              isAnimationActive={!print}
              key={p}
              dataKey={p}
              name={p}
              stroke={playerColor(allPlayers, p)}
              fill={playerColor(allPlayers, p)}
              fillOpacity={0.12}
            />
          ))}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

function HeatmapView({ metric, computed }: { metric: MetricId; computed: SeriesComputed }) {
  const { res } = computed;
  const vals = res.rows
    .flatMap((r) => res.series.map((s) => r[s.key]))
    .filter((v): v is number => typeof v === "number");
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const def = METRIC[metric];
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-[11px] border-collapse text-center">
        <thead>
          <tr className="bg-muted/30">
            <th className="sticky left-0 z-10 bg-card px-2 py-1.5 text-left text-[10px] uppercase tracking-wider shadow-[1px_0_0_var(--border)]">
              Jugador
            </th>
            {res.rows.map((r) => (
              <th
                key={String(r.x)}
                className="px-2 py-1.5 border-l whitespace-nowrap font-semibold"
              >
                {r.xLabel}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {res.series.map((s) => (
            <tr key={s.key} className="border-t">
              <td className="sticky left-0 z-10 bg-card px-2 py-1 text-left font-bold uppercase text-[10px] whitespace-nowrap shadow-[1px_0_0_var(--border)]">
                {s.jugador ?? s.label}
              </td>
              {res.rows.map((r) => {
                const v = r[s.key];
                if (typeof v !== "number")
                  return (
                    <td key={String(r.x)} className="px-2 py-1 border-l text-muted-foreground/50">
                      —
                    </td>
                  );
                const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
                return (
                  <td
                    key={String(r.x)}
                    className="px-2 py-1 border-l tabular-nums font-semibold text-[#111827]"
                    style={{ background: heatColor(t, def.higherIsWorse) }}
                    title={`${s.jugador} · ${r.xLabel}: ${fmtValue(metric, v)} ${def.unit}`}
                  >
                    {fmtValue(metric, v, Math.min(def.decimals, 1))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[10px] text-muted-foreground px-2 py-1">
        Color relativo al rango mostrado ({fmtValue(metric, lo)}–{fmtValue(metric, hi)} {def.unit});{" "}
        {def.higherIsWorse ? "rojo = valor más alto" : "rojo = valor más bajo"}.
      </div>
    </div>
  );
}

function TableView({ computed }: { computed: SeriesComputed }) {
  const { res, groupBy, hasRef } = computed;
  return (
    <div className="overflow-x-auto rounded-md border max-h-[340px]">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-muted-foreground sticky top-0">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium">{GROUP_LABEL[groupBy]}</th>
            {res.series.map((s) => (
              <th key={s.key} className="px-3 py-1.5 text-right font-medium whitespace-nowrap">
                {s.label} <span className="font-normal">({METRIC[s.metric].unit})</span>
              </th>
            ))}
            {hasRef && <th className="px-3 py-1.5 text-right font-medium">Media equipo</th>}
          </tr>
        </thead>
        <tbody>
          {res.rows.map((r) => (
            <tr key={String(r.x)} className="border-t">
              <td className="px-3 py-1 font-medium whitespace-nowrap">{r.xLabel}</td>
              {res.series.map((s) => (
                <td key={s.key} className="px-3 py-1 text-right tabular-nums">
                  {fmtValue(s.metric, r[s.key] as number | null)}
                </td>
              ))}
              {hasRef && (
                <td className="px-3 py-1 text-right tabular-nums">
                  {fmtValue(res.series[0].metric, r.__ref as number | null)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Pequeños componentes ─────────────────────────────────────────────────────

function IconBtn({
  label,
  onClick,
  children,
  active,
  danger,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`p-1.5 rounded-md transition-colors ${
        active
          ? "bg-accent text-foreground"
          : danger
            ? "text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            : "text-muted-foreground hover:text-foreground hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

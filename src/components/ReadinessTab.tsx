import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  ShieldAlert,
  TrendingDown,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SessionMetrics } from "@/lib/metrics";
import type { StoredMinutes, StoredRecovery } from "@/lib/store";
import { buildRecovery, normName } from "@/lib/recovery";
import { downloadBlob } from "@/lib/pdf-export";
import {
  calcReadiness,
  COMPONENT_LABEL,
  fmtRaw,
  getReadinessConfig,
  readinessToCsv,
  SEMAFORO_INFO,
  type ComponentKey,
  type ReadinessEntry,
  type Semaforo,
} from "@/lib/readiness";
import { PlayerAvatar } from "@/components/PlayerAvatar";

interface ReadinessTabProps {
  sessionMetrics: SessionMetrics[];
  minutes: StoredMinutes[];
  recovery: StoredRecovery[];
  recoverySupported: boolean;
  formPlayers: string[];
  selectedPlayers: string[];
  callUpName: string;
  copyButton: (targetId: string) => ReactNode;
}

const COMPONENT_ORDER: ComponentKey[] = ["rec", "fat", "acwr", "z"];
const LINE_COLORS = [
  "#60a5fa",
  "#f472b6",
  "#a78bfa",
  "#34d399",
  "#fbbf24",
  "#22d3ee",
  "#fb7185",
  "#c084fc",
];

const dm = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};
const weekday = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"][new Date(y, m - 1, d).getDay()];
};
const scoreColor = (s: number) => (s >= 75 ? "#22c55e" : s >= 60 ? "#facc15" : "#ef4444");

export function ReadinessTab({
  sessionMetrics,
  minutes,
  recovery,
  recoverySupported,
  formPlayers,
  selectedPlayers,
  callUpName,
  copyButton,
}: ReadinessTabProps) {
  const config = useMemo(() => getReadinessConfig(), []);
  const recoveryData = useMemo(
    () => buildRecovery(recovery, formPlayers, sessionMetrics),
    [recovery, formPlayers, sessionMetrics],
  );
  const result = useMemo(
    () => calcReadiness(sessionMetrics, minutes, recoveryData, config),
    [sessionMetrics, minutes, recoveryData, config],
  );

  const daysWithData = result.days.filter((d) => result.entries.some((e) => e.fecha === d));
  const [fechaSel, setFechaSel] = useState("");
  const dia = daysWithData.includes(fechaSel)
    ? fechaSel
    : (daysWithData[daysWithData.length - 1] ?? "");
  const [showHow, setShowHow] = useState(false);

  const filtering = selectedPlayers.length > 0;
  const shown = filtering
    ? result.players.filter((j) => selectedPlayers.some((s) => normName(s) === normName(j)))
    : result.players;

  if (daysWithData.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        No hay datos suficientes para calcular el readiness en esta convocatoria.
        {!recoverySupported &&
          " Actualiza el Apps Script para incluir el cuestionario de recuperación."}
      </div>
    );
  }

  const todays = shown.map((j) => result.get(j, dia)).filter((e): e is ReadinessEntry => !!e);
  const complete = todays.filter((e) => !e.incompleto);
  const media = complete.length
    ? complete.reduce((a, e) => a + e.readiness, 0) / complete.length
    : null;
  const count = (s: Semaforo) => complete.filter((e) => e.semaforo === s).length;
  const board = [...todays].sort(
    (a, b) => Number(a.incompleto) - Number(b.incompleto) || a.readiness - b.readiness,
  );

  const chartPlayers = filtering ? shown.slice(0, LINE_COLORS.length) : [];
  const chartData = daysWithData.map((d) => {
    const vals = shown
      .map((j) => result.get(j, d))
      .filter((e): e is ReadinessEntry => !!e && !e.incompleto)
      .map((e) => e.readiness);
    const row: Record<string, string | number | null> = {
      label: dm(d),
      media: vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null,
    };
    for (const j of chartPlayers) row[j] = result.get(j, d)?.readiness ?? null;
    return row;
  });

  function exportCsv() {
    const safe = callUpName.replace(/\s+/g, "_").replace(/[\\/:*?"<>|]/g, "");
    downloadBlob(
      new Blob([readinessToCsv(result, shown)], { type: "text/csv;charset=utf-8" }),
      `Readiness_${safe}.csv`,
    );
  }

  const sticky = "sticky left-0 z-10 bg-card shadow-[1px_0_0_var(--border)]";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Día</span>
          <select
            value={dia}
            onChange={(e) => setFechaSel(e.target.value)}
            className="bg-background border border-border rounded-md px-2 py-1.5 text-sm"
          >
            {[...daysWithData].reverse().map((d) => (
              <option key={d} value={d}>
                {weekday(d)} {dm(d)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={exportCsv}
          className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-md border hover:bg-accent"
        >
          <Download className="size-3.5" /> Exportar CSV
        </button>
      </div>

      {!recoverySupported && (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-800 dark:text-yellow-200 flex gap-2">
          <AlertTriangle className="size-4 shrink-0" />
          Sin datos de recuperación: el Apps Script desplegado no los envía. Los índices saldrán
          incompletos.
        </div>
      )}

      {/* a) Resumen del equipo */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="rounded-lg border bg-card p-4 col-span-2 lg:col-span-1">
          <div className="text-xs text-muted-foreground">Readiness medio</div>
          <div
            className="text-3xl font-bold tabular-nums mt-1"
            style={{ color: media === null ? undefined : scoreColor(media) }}
          >
            {media === null ? "—" : Math.round(media)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {weekday(dia)} {dm(dia)}
          </div>
        </div>
        {(["verde", "amarillo", "rojo"] as Semaforo[]).map((s) => (
          <div key={s} className="rounded-lg border bg-card p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-full"
                style={{ background: SEMAFORO_INFO[s].color }}
              />
              {SEMAFORO_INFO[s].label}
            </div>
            <div className="text-3xl font-bold tabular-nums mt-1">{count(s)}</div>
          </div>
        ))}
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">Incompletos</div>
          <div className="text-3xl font-bold tabular-nums mt-1 text-muted-foreground">
            {todays.filter((e) => e.incompleto).length}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">sin recuperación matinal</div>
        </div>
      </div>

      {/* b) Tablero de jugadores */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Jugadores — de menor a mayor readiness</h3>
          {copyButton("readiness-tablero")}
        </div>
        <div
          id="readiness-tablero"
          className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 bg-background"
        >
          {board.map((e) => (
            <PlayerReadinessCard key={e.jugador} entry={e} />
          ))}
        </div>
      </section>

      {/* c) Heatmap */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Readiness — jugadores × días</h3>
          {copyButton("readiness-heatmap")}
        </div>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table
            id="readiness-heatmap"
            className="w-full text-[11px] border-collapse text-center bg-card"
          >
            <thead>
              <tr className="border-b bg-muted/30">
                <th
                  className={`${sticky} px-3 py-1.5 text-left text-[10px] uppercase tracking-wider min-w-[150px]`}
                >
                  Fecha
                </th>
                {daysWithData.map((d) => (
                  <th
                    key={d}
                    className={`px-2 py-1.5 border-l font-semibold tabular-nums whitespace-nowrap ${d === dia ? "bg-primary/20" : ""}`}
                  >
                    {dm(d)}
                  </th>
                ))}
              </tr>
              <tr className="border-b bg-muted/30">
                <th
                  className={`${sticky} px-3 py-1.5 text-left text-[10px] uppercase tracking-wider`}
                >
                  Jugador
                </th>
                {daysWithData.map((d) => (
                  <th
                    key={d}
                    className="px-2 py-1.5 border-l text-[10px] font-medium text-muted-foreground"
                  >
                    {weekday(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((j) => (
                <tr key={j} className="border-b">
                  <td
                    className={`${sticky} px-3 py-1 text-left font-bold uppercase text-[10px] whitespace-nowrap`}
                  >
                    {j}
                  </td>
                  {daysWithData.map((d) => {
                    const e = result.get(j, d);
                    if (!e) {
                      return (
                        <td key={d} className="px-2 py-1 border-l text-muted-foreground/60">
                          —
                        </td>
                      );
                    }
                    const detail = COMPONENT_ORDER.map((k) => {
                      const c = e.components.find((x) => x.key === k);
                      return c
                        ? `${COMPONENT_LABEL[k]}: ${fmtRaw(k, c.raw)} → ${Math.round(c.score)}`
                        : `${COMPONENT_LABEL[k]}: —`;
                    }).join("\n");
                    return (
                      <td
                        key={d}
                        title={`${j} · ${dm(d)} · readiness ${e.readiness} (${SEMAFORO_INFO[e.semaforo].label})\n${detail}${e.regla ? `\nRegla: ${e.regla}` : ""}${e.incompleto ? "\nIncompleto: sin recuperación matinal" : ""}`}
                        className={`px-2 py-1 border-l tabular-nums font-semibold ${
                          e.incompleto
                            ? "text-muted-foreground italic"
                            : SEMAFORO_INFO[e.semaforo].cls
                        }`}
                      >
                        {e.readiness}
                        {e.regla && <sup className="ml-0.5">!</sup>}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="bg-muted/30 font-semibold">
                <td
                  className={`${sticky} px-3 py-1.5 text-left text-[10px] uppercase tracking-wider`}
                >
                  Media equipo
                </td>
                {chartData.map((r, i) => (
                  <td key={daysWithData[i]} className="px-2 py-1.5 border-l tabular-nums">
                    {r.media === null ? "—" : Math.round(r.media as number)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
          {(["verde", "amarillo", "rojo"] as Semaforo[]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={`inline-block size-3 rounded-sm ${SEMAFORO_INFO[s].cls}`} />
              {SEMAFORO_INFO[s].label}{" "}
              {s === "verde"
                ? `≥ ${config.thresholds.verde}`
                : s === "amarillo"
                  ? `${config.thresholds.amarillo}-${config.thresholds.verde - 1}`
                  : `< ${config.thresholds.amarillo}`}
            </span>
          ))}
          <span>! = regla de seguridad aplicada</span>
          <span>cursiva = incompleto</span>
        </div>
      </section>

      {/* d) Evolución */}
      <section id="readiness-evolucion" className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">
            Evolución del readiness
            {filtering ? " — jugadores seleccionados" : " — media del equipo"}
          </h3>
          {copyButton("readiness-evolucion")}
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <ReferenceArea
              y1={config.thresholds.verde}
              y2={100}
              fill="#22c55e"
              fillOpacity={0.08}
            />
            <ReferenceArea
              y1={config.thresholds.amarillo}
              y2={config.thresholds.verde}
              fill="#facc15"
              fillOpacity={0.08}
            />
            <ReferenceArea
              y1={0}
              y2={config.thresholds.amarillo}
              fill="#ef4444"
              fillOpacity={0.08}
            />
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--popover-foreground)",
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line
              type="monotone"
              dataKey="media"
              name={filtering ? "Media seleccionados" : "Media equipo"}
              stroke="#ffffff"
              strokeWidth={2.5}
              dot={{ r: 4, fill: "#ffffff" }}
              connectNulls
            />
            {chartPlayers.map((j, i) => (
              <Line
                key={j}
                type="monotone"
                dataKey={j}
                name={j}
                stroke={LINE_COLORS[i]}
                strokeWidth={1.5}
                dot={{ r: 3 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* e) ¿Cómo se calcula? */}
      <section className="rounded-lg border bg-card">
        <button
          type="button"
          onClick={() => setShowHow((s) => !s)}
          aria-expanded={showHow}
          className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-left"
        >
          {showHow ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          ¿Cómo se calcula?
        </button>
        {showHow && (
          <div className="px-4 pb-4 text-xs text-muted-foreground space-y-2 leading-relaxed">
            <p>
              Readiness de la mañana del día D (0-100) = media ponderada de los componentes
              disponibles; si falta alguno, su peso se reparte entre los demás.
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <b className="text-foreground">Recuperación matinal de D</b> ({config.weights.rec}{" "}
                %): (10 − valor) × 10.
              </li>
              <li>
                <b className="text-foreground">Fatiga post-sesión de D−1</b> ({config.weights.fat}{" "}
                %): (10 − fatiga) / 9 × 100, última sesión del día anterior.
              </li>
              <li>
                <b className="text-foreground">ACWR individual hasta D−1</b> ({config.weights.acwr}{" "}
                %): 100 entre 0,8 y 1,3; baja hasta 0 en 1,8; por debajo de 0,8 baja hasta 70 en
                0,5. Carga = RPE × tiempo (minutos jugados en partidos), aguda 2 / crónica 5.
              </li>
              <li>
                <b className="text-foreground">Carga de D−1 frente al grupo</b> ({config.weights.z}{" "}
                %): 100 − max(0, z) × 25.
              </li>
            </ul>
            <p>
              Semáforo: verde ≥ {config.thresholds.verde}, amarillo {config.thresholds.amarillo}-
              {config.thresholds.verde - 1}, rojo &lt; {config.thresholds.amarillo}. Reglas de
              seguridad: recuperación ≥ {config.rules.recRojo} → rojo; recuperación ≥{" "}
              {config.rules.recAmarillo} → como mucho amarillo; ACWR &gt;{" "}
              {String(config.rules.acwrAmarillo).replace(".", ",")} → como mucho amarillo. Se marca
              una caída de {config.dropAlert} puntos o más respecto a la media personal.
            </p>
            <p>Los pesos y umbrales se cambian en Ajustes.</p>
          </div>
        )}
      </section>

      <p className="text-[11px] text-muted-foreground">
        Índice orientativo para apoyar la decisión del cuerpo técnico; no sustituye la valoración
        del preparador físico ni de los servicios médicos.
      </p>
    </div>
  );
}

function PlayerReadinessCard({ entry: e }: { entry: ReadinessEntry }) {
  const info = SEMAFORO_INFO[e.semaforo];

  return (
    <div
      className={`rounded-lg border bg-card p-3 flex flex-col gap-2.5 ${e.incompleto ? "opacity-70" : ""}`}
    >
      <div className="flex items-center gap-3">
        <PlayerAvatar name={e.jugador} size={44} accent={info.color} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">{e.jugador}</div>
          <span
            className={`inline-block text-[10px] font-semibold rounded px-1.5 py-0.5 mt-0.5 ${info.cls}`}
          >
            {info.label}
          </span>
        </div>
        <div className="text-right">
          <div
            className="text-3xl font-bold tabular-nums leading-none"
            style={{ color: e.incompleto ? undefined : info.color }}
          >
            {e.readiness}
          </div>
          {e.delta !== null && (
            <div
              className={`text-[10px] tabular-nums mt-1 ${e.caida ? "text-[#f87171] font-semibold" : "text-muted-foreground"}`}
            >
              {e.delta >= 0 ? "+" : ""}
              {Math.round(e.delta)} vs su media
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1">
        {COMPONENT_ORDER.map((k) => {
          const c = e.components.find((x) => x.key === k);
          return (
            <div key={k} className="flex items-center gap-2 text-[10px]">
              <span className="w-[86px] shrink-0 text-muted-foreground">{COMPONENT_LABEL[k]}</span>
              <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                {c && (
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${c.score}%`, background: scoreColor(c.score) }}
                  />
                )}
              </div>
              <span className="w-10 text-right tabular-nums text-muted-foreground">
                {c ? fmtRaw(k, c.raw) : "—"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="text-[11px] flex items-start gap-1.5 border-t pt-2">
        {e.incompleto ? (
          <>
            <AlertTriangle className="size-3.5 shrink-0 text-yellow-500 mt-px" />
            <span className="text-muted-foreground">Incompleto: sin recuperación matinal</span>
          </>
        ) : e.regla ? (
          <>
            <ShieldAlert className="size-3.5 shrink-0 text-[#f87171] mt-px" />
            <span>{e.factorLimitante}</span>
          </>
        ) : (
          <>
            {e.caida ? (
              <TrendingDown className="size-3.5 shrink-0 text-[#f87171] mt-px" />
            ) : (
              <span className="size-3.5 shrink-0" />
            )}
            <span className="text-muted-foreground">
              Limita: <span className="text-foreground">{e.factorLimitante}</span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}
